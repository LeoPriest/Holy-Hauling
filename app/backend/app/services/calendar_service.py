from __future__ import annotations

import logging
import os
from datetime import date, timedelta

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_setting import AppSetting
from app.models.job_assignment import JobAssignment
from app.models.lead import Lead
from app.models.user import User

_log = logging.getLogger(__name__)
_SCOPES = ["https://www.googleapis.com/auth/calendar.events"]
_TOKEN_URI = "https://oauth2.googleapis.com/token"


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
        "summary": f"{service_name} — {customer}",
        "start": {"date": event_date},
        "end": {"date": event_date},
        "attendees": [{"email": addr} for addr in crew_emails],
    }
    if lead.job_address:
        body["location"] = lead.job_address
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


async def create_event(db: AsyncSession, lead: Lead, crew_emails: list[str]) -> str | None:
    """Create a Calendar event and return its Google event ID, or None on failure."""
    if not crew_emails:
        return None
    credentials = await _get_credentials(db)
    if credentials is None:
        return None
    try:
        credentials.refresh(Request())
        service = build("calendar", "v3", credentials=credentials)
        event = service.events().insert(
            calendarId="primary",
            body=_build_event_body(lead, crew_emails),
            sendUpdates="all",
        ).execute()
        return event.get("id")
    except Exception as exc:
        _log.error("calendar create_event failed: %s", exc)
        return None


async def update_event(
    db: AsyncSession, event_id: str, lead: Lead, crew_emails: list[str]
) -> None:
    """Update an existing Calendar event's details and attendees."""
    credentials = await _get_credentials(db)
    if credentials is None:
        return
    try:
        credentials.refresh(Request())
        service = build("calendar", "v3", credentials=credentials)
        service.events().update(
            calendarId="primary",
            eventId=event_id,
            body=_build_event_body(lead, crew_emails),
            sendUpdates="all",
        ).execute()
    except Exception as exc:
        _log.error("calendar update_event failed: %s", exc)


async def delete_event(db: AsyncSession, event_id: str) -> bool:
    """Delete a Calendar event and notify attendees. Returns True on success."""
    credentials = await _get_credentials(db)
    if credentials is None:
        return False
    try:
        credentials.refresh(Request())
        service = build("calendar", "v3", credentials=credentials)
        service.events().delete(
            calendarId="primary",
            eventId=event_id,
            sendUpdates="all",
        ).execute()
        return True
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
