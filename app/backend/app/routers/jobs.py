from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_auth, require_role
from app.models.job_assignment import JobAssignment
from app.models.lead import Lead, LeadStatus
from app.models.user import User
from app.schemas.jobs import JobAssignmentCreate, JobOut, JobStatusUpdate
import logging

from app.services import calendar_service, lead_service

_log = logging.getLogger(__name__)

router = APIRouter(prefix="/jobs", tags=["jobs"])


async def _get_crew(db: AsyncSession, lead_id: str) -> list[str]:
    # N+1 per lead — acceptable for V1 with small booked-job counts
    result = await db.execute(
        select(User.username)
        .join(JobAssignment, User.id == JobAssignment.user_id)
        .where(JobAssignment.lead_id == lead_id)
    )
    return [row[0] for row in result.fetchall()]


def _job_phase(lead: Lead) -> str | None:
    if lead.started_at:
        return "started"
    if lead.arrived_at:
        return "arrived"
    if lead.en_route_at:
        return "en_route"
    if lead.dispatched_at:
        return "dispatched"
    return None


def _iso(dt) -> str | None:
    return dt.isoformat() if dt else None


def _quote_modifiers(lead: Lead) -> list[dict] | None:
    if not lead.quote_modifiers:
        return None
    try:
        parsed = json.loads(lead.quote_modifiers)
    except (TypeError, ValueError):
        return None
    return parsed if isinstance(parsed, list) else None


async def _to_job_out(db: AsyncSession, lead: Lead, role: str) -> JobOut:
    crew = await _get_crew(db, lead.id)
    date_str = lead.job_date_requested.isoformat() if lead.job_date_requested else None
    show_quote = role in ("admin", "facilitator")
    return JobOut(
        id=lead.id,
        customer_name=lead.customer_name,
        service_type=lead.service_type.value if lead.service_type is not None else None,
        job_location=lead.job_location,
        job_address=lead.job_address,
        job_date_requested=date_str,
        appointment_time_slot=lead.appointment_time_slot,
        estimated_job_duration_minutes=lead.estimated_job_duration_minutes,
        scope_notes=lead.scope_notes,
        crew=crew,
        customer_phone=lead.customer_phone if role != "crew" else None,
        quote_context=lead.quote_context if role != "crew" else None,
        quoted_price_total=lead.quoted_price_total if show_quote else None,
        quote_modifiers=_quote_modifiers(lead) if show_quote else None,
        has_google_calendar_event=bool(lead.google_calendar_event_id),
        job_phase=_job_phase(lead),
        dispatched_at=_iso(lead.dispatched_at),
        en_route_at=_iso(lead.en_route_at),
        arrived_at=_iso(lead.arrived_at),
        started_at=_iso(lead.started_at),
    )


@router.get("", response_model=list[JobOut])
async def get_jobs(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_auth),
):
    sort_order = (
        Lead.job_date_requested.is_(None),
        Lead.job_date_requested,
        Lead.appointment_time_slot.is_(None),
        Lead.appointment_time_slot,
        Lead.created_at,
    )
    if current_user.role in ("supervisor", "admin", "facilitator"):
        result = await db.execute(
            select(Lead)
            .where(Lead.status == LeadStatus.booked)
            .order_by(*sort_order)
        )
    else:
        result = await db.execute(
            select(Lead)
            .join(JobAssignment, Lead.id == JobAssignment.lead_id)
            .where(Lead.status == LeadStatus.booked, JobAssignment.user_id == current_user.id)
            .order_by(*sort_order)
        )
    leads = result.scalars().all()
    return [await _to_job_out(db, lead, current_user.role) for lead in leads]


@router.patch("/{lead_id}/status", response_model=JobOut)
async def patch_job_status(
    lead_id: str,
    data: JobStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("supervisor", "admin")),
):
    lead = await lead_service.update_job_status(db, lead_id, data.status, actor=current_user.username)
    return await _to_job_out(db, lead, current_user.role)


@router.post("/{lead_id}/assignments", response_model=JobOut, status_code=201)
async def add_assignment(
    lead_id: str,
    data: JobAssignmentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("supervisor", "admin", "facilitator")),
):
    result = await db.execute(select(Lead).where(Lead.id == lead_id, Lead.status == LeadStatus.booked))
    lead = result.scalar_one_or_none()
    if lead is None:
        raise HTTPException(status_code=404, detail="Job not found")
    result = await db.execute(select(User).where(User.id == data.user_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="User not found")
    result = await db.execute(
        select(JobAssignment).where(JobAssignment.lead_id == lead_id, JobAssignment.user_id == data.user_id)
    )
    if result.scalar_one_or_none() is None:
        db.add(JobAssignment(lead_id=lead_id, user_id=data.user_id, assigned_by=current_user.username))
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
    await calendar_service.sync_job_calendar(db, lead_id)
    return await _to_job_out(db, lead, current_user.role)


@router.delete("/{lead_id}/assignments/{user_id}", response_model=JobOut)
async def remove_assignment(
    lead_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("supervisor", "admin", "facilitator")),
):
    result = await db.execute(
        select(JobAssignment).where(JobAssignment.lead_id == lead_id, JobAssignment.user_id == user_id)
    )
    assignment = result.scalar_one_or_none()
    if assignment is None:
        raise HTTPException(status_code=404, detail="Assignment not found")
    # Verify lead exists before deleting
    lead_result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = lead_result.scalar_one_or_none()
    if lead is None:
        raise HTTPException(status_code=404, detail="Job not found")
    await db.delete(assignment)
    await db.commit()
    await calendar_service.sync_job_calendar(db, lead_id)
    return await _to_job_out(db, lead, current_user.role)


@router.post("/{lead_id}/sync-google", response_model=JobOut)
async def sync_google_calendar_job(
    lead_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("supervisor", "admin", "facilitator")),
):
    result = await db.execute(select(Lead).where(Lead.id == lead_id, Lead.status == LeadStatus.booked))
    lead = result.scalar_one_or_none()
    if lead is None:
        raise HTTPException(status_code=404, detail="Job not found")

    sync_result = await calendar_service.sync_job_calendar_now(db, lead)
    if not sync_result.ok:
        raise HTTPException(status_code=sync_result.status_code, detail=sync_result.detail)
    return await _to_job_out(db, lead, current_user.role)
