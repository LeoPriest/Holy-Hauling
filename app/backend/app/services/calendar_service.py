from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_setting import AppSetting
from app.models.job_assignment import JobAssignment
from app.models.lead import Lead
from app.models.user import User

_log = logging.getLogger(__name__)
_SCOPES = ["https://www.googleapis.com/auth/calendar.events"]
_TOKEN_URI = "https://oauth2.googleapis.com/token"
_CALENDAR_TIME_ZONE = os.getenv("BUSINESS_TIME_ZONE", "America/Chicago")
_DEFAULT_EVENT_DURATION_MINUTES = 60


@dataclass
class CalendarSyncResult:
    ok: bool
    detail: str | None = None
    status_code: int = 200


async def _build_calendar_service(db: AsyncSession):
    credentials = await _get_credentials(db)
    if credentials is None:
        return None
    await asyncio.to_thread(credentials.refresh, Request())
    return build("calendar", "v3", credentials=credentials)


async def _get_credentials(db: AsyncSession) -> Credentials | None:
    """Return refreshable credentials from app_settings, or None if not configured."""
    client_id = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "")
    client_secret = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", "")
    if not client_id or not client_secret:
        return None
    result = await db.execute(
        select(AppSetting).where(AppSetting.key == "google_refresh_token")
    )
    row = result.scalar_one_or_none()
    if row is None or not row.value:
        return None
    return Credentials(
        token=None,
        refresh_token=row.value,
        token_uri=_TOKEN_URI,
        client_id=client_id,
        client_secret=client_secret,
        scopes=_SCOPES,
    )


def _build_event_body(lead: Lead, crew_emails: list[str]) -> dict:
    service_name = lead.service_type.value.title() if lead.service_type else "Job"
    customer = lead.customer_name or "Customer"
    if lead.job_date_requested:
        event_date = lead.job_date_requested.isoformat()
    else:
        event_date = (date.today() + timedelta(days=1)).isoformat()

    body: dict = {
        "summary": f"{service_name} - {customer}",
        "attendees": [{"email": addr} for addr in crew_emails],
    }

    duration_minutes = (
        lead.estimated_job_duration_minutes
        if isinstance(lead.estimated_job_duration_minutes, int) and lead.estimated_job_duration_minutes > 0
        else _DEFAULT_EVENT_DURATION_MINUTES
    )

    if lead.appointment_time_slot:
        start_dt = datetime.fromisoformat(f"{event_date}T{lead.appointment_time_slot}:00")
        end_dt = start_dt + timedelta(minutes=duration_minutes)
        body["start"] = {"dateTime": start_dt.isoformat(), "timeZone": _CALENDAR_TIME_ZONE}
        body["end"] = {"dateTime": end_dt.isoformat(), "timeZone": _CALENDAR_TIME_ZONE}
    else:
        body["start"] = {"date": event_date}
        body["end"] = {"date": event_date}

    if lead.job_address:
        body["location"] = lead.job_address
    elif lead.job_location:
        body["location"] = lead.job_location
    if lead.scope_notes:
        body["description"] = lead.scope_notes
    return body


async def get_crew_emails(db: AsyncSession, lead_id: str) -> list[str]:
    """Return Google email addresses for all crew assigned to a job."""
    result = await db.execute(
        select(User.email)
        .join(JobAssignment, User.id == JobAssignment.user_id)
        .where(JobAssignment.lead_id == lead_id, User.email.isnot(None))
    )
    return [row[0] for row in result.fetchall() if row[0]]


async def _insert_event_or_raise(
    db: AsyncSession, lead: Lead, crew_emails: list[str]
) -> str | None:
    if not crew_emails:
        return None
    service = await _build_calendar_service(db)
    if service is None:
        return None
    event = await asyncio.to_thread(
        service.events().insert(
            calendarId="primary",
            body=_build_event_body(lead, crew_emails),
            sendUpdates="all",
        ).execute
    )
    return event.get("id")


async def _update_event_or_raise(
    db: AsyncSession, event_id: str, lead: Lead, crew_emails: list[str]
) -> bool:
    service = await _build_calendar_service(db)
    if service is None:
        return False
    await asyncio.to_thread(
        service.events().update(
            calendarId="primary",
            eventId=event_id,
            body=_build_event_body(lead, crew_emails),
            sendUpdates="all",
        ).execute
    )
    return True


async def _delete_event_or_raise(db: AsyncSession, event_id: str) -> bool:
    service = await _build_calendar_service(db)
    if service is None:
        return False
    await asyncio.to_thread(
        service.events().delete(
            calendarId="primary",
            eventId=event_id,
            sendUpdates="all",
        ).execute
    )
    return True


def _calendar_sync_error_result(exc: Exception) -> CalendarSyncResult:
    message = str(exc).strip() or exc.__class__.__name__

    if isinstance(exc, HttpError):
        status = int(getattr(exc.resp, "status", 502) or 502)
        reason = ""
        api_message = message
        raw_content = exc.content
        if isinstance(raw_content, bytes):
            raw_content = raw_content.decode("utf-8", "ignore")
        if raw_content:
            try:
                payload = json.loads(str(raw_content))
                error_block = payload.get("error", {})
                api_message = error_block.get("message") or api_message
                errors = error_block.get("errors") or []
                if errors and isinstance(errors[0], dict):
                    reason = str(errors[0].get("reason") or "")
                    api_message = str(errors[0].get("message") or api_message)
            except Exception:
                pass

        lowered = api_message.lower()
        if reason == "accessNotConfigured" or (
            "has not been used in project" in lowered and "disabled" in lowered
        ):
            return CalendarSyncResult(
                ok=False,
                detail=(
                    "Google Calendar API is disabled for the connected Google Cloud project. "
                    "Enable the Google Calendar API in Google Cloud Console, wait a minute for "
                    "Google to propagate the change, then try syncing again."
                ),
                status_code=503,
            )

        if status in {401, 403} and (
            "invalid credentials" in lowered
            or "login required" in lowered
            or "request had invalid authentication credentials" in lowered
        ):
            return CalendarSyncResult(
                ok=False,
                detail="Google Calendar authorization expired or was rejected. Reconnect Google Calendar in Settings and try again.",
                status_code=502,
            )

        return CalendarSyncResult(
            ok=False,
            detail=f"Google Calendar sync failed. {api_message}",
            status_code=502,
        )

    return CalendarSyncResult(
        ok=False,
        detail=f"Google Calendar sync failed. {message}",
        status_code=502,
    )


async def create_event(db: AsyncSession, lead: Lead, crew_emails: list[str]) -> str | None:
    """Create a Calendar event and return its Google event ID, or None on failure."""
    try:
        return await _insert_event_or_raise(db, lead, crew_emails)
    except Exception as exc:
        _log.error("calendar create_event failed: %s", exc)
        return None


async def update_event(
    db: AsyncSession, event_id: str, lead: Lead, crew_emails: list[str]
) -> bool:
    """Update an existing Calendar event's details and attendees."""
    try:
        return await _update_event_or_raise(db, event_id, lead, crew_emails)
    except Exception as exc:
        _log.error("calendar update_event failed: %s", exc)
        return False


async def delete_event(db: AsyncSession, event_id: str) -> bool:
    """Delete a Calendar event and notify attendees. Returns True on success."""
    try:
        return await _delete_event_or_raise(db, event_id)
    except Exception as exc:
        _log.error("calendar delete_event failed: %s", exc)
        return False


async def sync_job_calendar(db: AsyncSession, lead_id: str) -> None:
    """Create, update, or delete the Calendar event for a job based on current state.

    Fire-and-forget: errors are logged but never propagated to callers.
    One event per job; all assigned crew with emails are attendees.
    """
    try:
        result = await db.execute(select(Lead).where(Lead.id == lead_id))
        lead = result.scalar_one_or_none()
        if lead is None:
            return
        crew_emails = await get_crew_emails(db, lead_id)
        if lead.google_calendar_event_id:
            if crew_emails:
                await update_event(db, lead.google_calendar_event_id, lead, crew_emails)
            else:
                deleted = await delete_event(db, lead.google_calendar_event_id)
                if deleted:
                    lead.google_calendar_event_id = None
                    await db.commit()
        else:
            if crew_emails:
                event_id = await create_event(db, lead, crew_emails)
                if event_id:
                    lead.google_calendar_event_id = event_id
                    await db.commit()
    except Exception as exc:
        _log.error("sync_job_calendar failed for lead %s: %s", lead_id, exc)


async def sync_job_calendar_now(db: AsyncSession, lead: Lead) -> CalendarSyncResult:
    """Synchronize one booked lead to Google Calendar and return a user-facing result."""
    credentials = await _get_credentials(db)
    if credentials is None:
        return CalendarSyncResult(
            ok=False,
            detail="Google Calendar is not connected.",
            status_code=503,
        )

    if not lead.job_date_requested:
        return CalendarSyncResult(
            ok=False,
            detail="This booked job needs a confirmed date before it can sync to Google Calendar.",
            status_code=409,
        )

    crew_emails = await get_crew_emails(db, lead.id)
    if not crew_emails:
        return CalendarSyncResult(
            ok=False,
            detail="Assign at least one crew member with a Google email before syncing this job.",
            status_code=409,
        )

    try:
        if lead.google_calendar_event_id:
            updated = await _update_event_or_raise(db, lead.google_calendar_event_id, lead, crew_emails)
            if not updated:
                return CalendarSyncResult(
                    ok=False,
                    detail="Google Calendar sync failed. Check backend logs for the Google API error.",
                    status_code=502,
                )
            return CalendarSyncResult(ok=True)

        event_id = await _insert_event_or_raise(db, lead, crew_emails)
        if not event_id:
            return CalendarSyncResult(
                ok=False,
                detail="Google Calendar sync failed. Check backend logs for the Google API error.",
                status_code=502,
            )
    except Exception as exc:
        _log.error("manual calendar sync failed for lead %s: %s", lead.id, exc)
        return _calendar_sync_error_result(exc)

    lead.google_calendar_event_id = event_id
    await db.commit()
    await db.refresh(lead)
    return CalendarSyncResult(ok=True)
