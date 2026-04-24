from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException, UploadFile

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.lead import Lead, LeadSourceType, LeadStatus
from app.models.lead_event import LeadEvent
from app.models.screenshot import Screenshot
from app.schemas.lead import LeadCreate, LeadStatusUpdate, LeadUpdate, NoteCreate

# Resolved at import time. Tests monkeypatch this before any fixture runs.
_SERVICE_DIR = os.path.dirname(os.path.abspath(__file__))
SCREENSHOTS_DIR = os.path.normpath(
    os.path.join(_SERVICE_DIR, "..", "..", "uploads", "screenshots")
)

_ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}

_MASKED_PHONE_RE = re.compile(r'[xX]{3,}')
_DIGIT_RE = re.compile(r'\d')


def _is_valid_phone(value: str | None) -> bool:
    """Return True only if value is a real usable phone number (≥10 digits, not masked).

    Masked values like '314-xxx-xxxx' or '(xxx) xxx-xxxx' are rejected.
    Partial numbers with fewer than 10 digits are rejected.
    """
    if not value:
        return False
    if _MASKED_PHONE_RE.search(value):
        return False
    return len(_DIGIT_RE.findall(value)) >= 10


# Fields that carry provenance badges — tracked in field_sources as "ocr" or "edited"
_PROVENANCE_FIELDS = {
    "customer_name", "customer_phone", "service_type",
    "job_location", "job_origin", "job_destination",
    "job_date_requested", "scope_notes",
    # Slice 8
    "move_size_label", "move_type", "move_distance_miles",
    "load_stairs", "unload_stairs", "move_date_options",
}


# ── helpers ──────────────────────────────────────────────────────────────────

def _id() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── leads ────────────────────────────────────────────────────────────────────

async def create_lead(db: AsyncSession, data: LeadCreate) -> Lead:
    lead_dict = data.model_dump()
    # Serialize list fields for storage
    if isinstance(lead_dict.get("move_date_options"), list):
        lead_dict["move_date_options"] = json.dumps(lead_dict["move_date_options"])
    lead = Lead(id=_id(), status=LeadStatus.new, **lead_dict)
    db.add(lead)
    db.add(LeadEvent(
        id=_id(), lead_id=lead.id,
        event_type="created", to_status=lead.status.value,
        actor=data.assigned_to,
    ))
    await db.commit()
    await db.refresh(lead)
    return lead


async def list_leads(
    db: AsyncSession,
    status: Optional[LeadStatus] = None,
    source_type: Optional[LeadSourceType] = None,
    assigned_to: Optional[str] = None,
) -> list[Lead]:
    q = select(Lead)
    if status:
        q = q.where(Lead.status == status)
    if source_type:
        q = q.where(Lead.source_type == source_type)
    if assigned_to:
        q = q.where(Lead.assigned_to == assigned_to)
    q = q.order_by(Lead.acknowledged_at.is_(None).desc(), Lead.created_at.desc())
    result = await db.execute(q)
    return list(result.scalars().all())


async def get_lead(db: AsyncSession, lead_id: str, detailed: bool = False) -> Lead:
    q = select(Lead).where(Lead.id == lead_id)
    if detailed:
        q = q.options(selectinload(Lead.events), selectinload(Lead.screenshots))
    result = await db.execute(q)
    lead = result.scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    # Auto-advance: opening a lead detail view moves it from 'new' → 'in_review'.
    # This marks the start of the facilitation workflow without a manual status tap.
    # Idempotent — repeated opens of the same lead are no-ops once status advances.
    if detailed and lead.status == LeadStatus.new:
        lead.status = LeadStatus.in_review
        lead.updated_at = _now()
        db.add(LeadEvent(
            id=_id(), lead_id=lead_id,
            event_type="status_changed",
            from_status=LeadStatus.new.value,
            to_status=LeadStatus.in_review.value,
            actor="system",
        ))
        await db.commit()
        # db.refresh() expires relationships without reloading them; re-query with selectinload
        # so callers that need LeadDetailOut (events + screenshots) don't hit MissingGreenlet.
        result = await db.execute(
            select(Lead).where(Lead.id == lead_id).options(
                selectinload(Lead.events), selectinload(Lead.screenshots)
            )
        )
        lead = result.scalar_one()
    return lead


async def update_lead(
    db: AsyncSession, lead_id: str, data: LeadUpdate, actor: Optional[str] = None
) -> Lead:
    lead = await get_lead(db, lead_id)
    updates = data.model_dump(exclude_unset=True)
    if not updates:
        return lead

    # Serialize list fields before comparing/setting
    if isinstance(updates.get("move_date_options"), list):
        updates["move_date_options"] = json.dumps(updates["move_date_options"])

    changed = []
    for field, value in updates.items():
        # Reject masked or short phone values — treat as no-op, not an error
        if field == "customer_phone" and value is not None and not _is_valid_phone(str(value)):
            continue
        if getattr(lead, field) != value:
            setattr(lead, field, value)
            changed.append(field)

    if changed:
        lead.updated_at = _now()
        # Track provenance: mark manually edited provenance fields as "edited"
        sources: dict = json.loads(lead.field_sources) if lead.field_sources else {}
        for f in changed:
            if f in _PROVENANCE_FIELDS:
                sources[f] = "edited"
        lead.field_sources = json.dumps(sources) if sources else lead.field_sources

        # Valid phone entered on in_review lead → advance to waiting_on_customer
        phone_newly_set = "customer_phone" in changed and _is_valid_phone(lead.customer_phone)
        if phone_newly_set and lead.status == LeadStatus.in_review:
            lead.status = LeadStatus.waiting_on_customer
            db.add(LeadEvent(
                id=_id(), lead_id=lead_id,
                event_type="status_changed",
                from_status=LeadStatus.in_review.value,
                to_status=LeadStatus.waiting_on_customer.value,
                actor=actor or "system",
            ))

        # Physical address entered → auto-book if not already booked/closed
        _CLOSED = {LeadStatus.booked, LeadStatus.released, LeadStatus.lost}
        address_newly_set = "job_address" in changed and lead.job_address
        if address_newly_set and lead.status not in _CLOSED:
            old_status = lead.status
            lead.status = LeadStatus.booked
            db.add(LeadEvent(
                id=_id(), lead_id=lead_id,
                event_type="status_changed",
                from_status=old_status.value,
                to_status=LeadStatus.booked.value,
                actor=actor or "system",
                note="auto-booked on address entry",
            ))
            # Fire-and-forget push — same pattern as update_lead_status
            import logging as _logging
            from app.services.push_service import send_push_to_roles
            customer = lead.customer_name or "customer"
            svc = lead.service_type.value if lead.service_type is not None else "job"
            try:
                await send_push_to_roles(db, ["supervisor", "crew"],
                                          f"New job assigned: {customer} — {svc}")
            except Exception as exc:
                _logging.getLogger(__name__).error("Push trigger failed: %s", exc)

        db.add(LeadEvent(
            id=_id(), lead_id=lead_id,
            event_type="field_updated",
            note=", ".join(changed),
            actor=actor,
        ))
        await db.commit()
        await db.refresh(lead)

        # Calendar sync: update the event when job-relevant fields change on a booked job
        _CALENDAR_FIELDS = {"job_date_requested", "job_address", "scope_notes", "customer_name"}
        if lead.google_calendar_event_id and any(f in _CALENDAR_FIELDS for f in changed):
            import logging as _log_cal
            from app.services import calendar_service as _cal
            try:
                await _cal.sync_job_calendar(db, lead_id)
            except Exception as exc:
                _log_cal.getLogger(__name__).error("calendar sync on lead update failed: %s", exc)

    return lead


_JOB_PHASE_ORDER = {"dispatched": 1, "en_route": 2, "arrived": 3, "started": 4, "completed": 5}


async def update_job_status(db: AsyncSession, lead_id: str, job_status: str, actor: str | None = None) -> Lead:
    from fastapi import HTTPException
    lead = await get_lead(db, lead_id)
    if lead.status != LeadStatus.booked:
        raise HTTPException(status_code=409, detail="Job is not in booked status")

    # Prevent going backwards through phases (reset bypasses this)
    current_level = max(
        _JOB_PHASE_ORDER["dispatched"] if lead.dispatched_at else 0,
        _JOB_PHASE_ORDER["en_route"] if lead.en_route_at else 0,
        _JOB_PHASE_ORDER["arrived"] if lead.arrived_at else 0,
        _JOB_PHASE_ORDER["started"] if lead.started_at else 0,
    )
    if job_status != "reset" and _JOB_PHASE_ORDER.get(job_status, 0) < current_level:
        raise HTTPException(status_code=409, detail="Cannot go back to a previous job phase")

    old_status = lead.status
    now = _now()

    if job_status == "dispatched":
        lead.dispatched_at = now
    elif job_status == "en_route":
        if not lead.dispatched_at:
            lead.dispatched_at = now
        lead.en_route_at = now
    elif job_status == "arrived":
        if not lead.dispatched_at:
            lead.dispatched_at = now
        if not lead.en_route_at:
            lead.en_route_at = now
        lead.arrived_at = now
    elif job_status == "started":
        if not lead.dispatched_at:
            lead.dispatched_at = now
        if not lead.en_route_at:
            lead.en_route_at = now
        if not lead.arrived_at:
            lead.arrived_at = now
        lead.started_at = now
    elif job_status == "completed":
        lead.status = LeadStatus.released
    elif job_status == "reset":
        lead.dispatched_at = None
        lead.en_route_at = None
        lead.arrived_at = None
        lead.started_at = None

    lead.updated_at = now
    db.add(LeadEvent(
        id=_id(), lead_id=lead_id,
        event_type="status_changed",
        from_status=old_status.value,
        to_status=lead.status.value,
        note=f"job_phase={job_status}",
        actor=actor,
    ))
    await db.commit()
    await db.refresh(lead)
    return lead


async def update_lead_status(db: AsyncSession, lead_id: str, data: LeadStatusUpdate) -> Lead:
    lead = await get_lead(db, lead_id)
    old_status = lead.status
    lead.status = data.status
    lead.updated_at = _now()
    db.add(LeadEvent(
        id=_id(), lead_id=lead_id,
        event_type="status_changed",
        from_status=old_status.value, to_status=data.status.value,
        actor=data.actor, note=data.note,
    ))
    await db.commit()
    await db.refresh(lead)

    # Push notification triggers — fire-and-forget; DB errors must not block the status update
    import logging as _logging
    from app.services.push_service import send_push_to_roles
    customer = lead.customer_name or "customer"
    svc = lead.service_type.value if lead.service_type is not None else "job"
    try:
        if data.status == LeadStatus.booked:
            await send_push_to_roles(db, ["supervisor", "crew"],
                                      f"New job assigned: {customer} — {svc}")
        elif data.status == LeadStatus.escalated:
            await send_push_to_roles(db, ["supervisor"],
                                      f"Job escalated: {customer} — action needed")
    except Exception as exc:
        _logging.getLogger(__name__).error("Push trigger failed: %s", exc)

    return lead


async def acknowledge_lead(db: AsyncSession, lead_id: str, actor: Optional[str] = None) -> Lead:
    lead = await get_lead(db, lead_id)
    if lead.acknowledged_at is not None:
        raise HTTPException(status_code=409, detail="Lead already acknowledged")
    lead.acknowledged_at = _now()
    lead.updated_at = _now()
    db.add(LeadEvent(id=_id(), lead_id=lead_id, event_type="acknowledged", actor=actor))
    await db.commit()
    await db.refresh(lead)
    return lead


async def get_lead_events(db: AsyncSession, lead_id: str) -> list[LeadEvent]:
    await get_lead(db, lead_id)
    result = await db.execute(
        select(LeadEvent).where(LeadEvent.lead_id == lead_id).order_by(LeadEvent.created_at)
    )
    return list(result.scalars().all())


# ── operational notes ─────────────────────────────────────────────────────────

async def add_note(db: AsyncSession, lead_id: str, data: NoteCreate) -> LeadEvent:
    """Append an operational note to the lead's event log during live handling."""
    await get_lead(db, lead_id)
    event = LeadEvent(
        id=_id(), lead_id=lead_id,
        event_type="note_added",
        note=data.body, actor=data.actor,
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event


# ── screenshots ───────────────────────────────────────────────────────────────

async def upload_screenshot(
    db: AsyncSession,
    lead_id: str,
    file: UploadFile,
    screenshot_type: str = "intake",
) -> Screenshot:
    await get_lead(db, lead_id)

    if file.content_type not in _ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="File must be JPEG, PNG, or WebP")

    ext = os.path.splitext(file.filename or "screenshot")[1] or ".jpg"
    stored_name = f"{uuid.uuid4()}{ext}"
    os.makedirs(SCREENSHOTS_DIR, exist_ok=True)

    content = await file.read()
    with open(os.path.join(SCREENSHOTS_DIR, stored_name), "wb") as fh:
        fh.write(content)

    relative_path = f"screenshots/{stored_name}"
    record = Screenshot(
        id=_id(), lead_id=lead_id,
        original_filename=file.filename or "screenshot",
        stored_path=relative_path,
        file_size=len(content),
        screenshot_type=screenshot_type,
    )
    db.add(record)
    db.add(LeadEvent(
        id=_id(), lead_id=lead_id,
        event_type="screenshot_added",
        note=file.filename,
    ))
    await db.commit()
    await db.refresh(record)
    return record


async def list_screenshots(db: AsyncSession, lead_id: str) -> list[Screenshot]:
    await get_lead(db, lead_id)
    result = await db.execute(
        select(Screenshot).where(Screenshot.lead_id == lead_id).order_by(Screenshot.created_at)
    )
    return list(result.scalars().all())


# ── delete ────────────────────────────────────────────────────────────────────

async def delete_lead(db: AsyncSession, lead_id: str) -> None:
    """Hard-delete a lead and all its children. Raises 404 if not found."""
    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    # Explicit child deletions to avoid async lazy-load issues.
    # ocr_results FK is to screenshots — delete those before screenshots.
    await db.execute(
        text("DELETE FROM ocr_results WHERE screenshot_id IN "
             "(SELECT id FROM screenshots WHERE lead_id = :id)"),
        {"id": lead_id},
    )
    await db.execute(text("DELETE FROM lead_events WHERE lead_id = :id"), {"id": lead_id})
    await db.execute(text("DELETE FROM screenshots WHERE lead_id = :id"), {"id": lead_id})
    await db.execute(text("DELETE FROM ai_reviews WHERE lead_id = :id"), {"id": lead_id})
    await db.delete(lead)
    await db.commit()
