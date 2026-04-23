from __future__ import annotations

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
from app.services import lead_service

router = APIRouter(prefix="/jobs", tags=["jobs"])


async def _get_crew(db: AsyncSession, lead_id: str) -> list[str]:
    # N+1 per lead — acceptable for V1 with small booked-job counts
    result = await db.execute(
        select(User.username)
        .join(JobAssignment, User.id == JobAssignment.user_id)
        .where(JobAssignment.lead_id == lead_id)
    )
    return [row[0] for row in result.fetchall()]


async def _to_job_out(db: AsyncSession, lead: Lead, role: str) -> JobOut:
    crew = await _get_crew(db, lead.id)
    date_str = lead.job_date_requested.isoformat() if lead.job_date_requested else None
    return JobOut(
        id=lead.id,
        customer_name=lead.customer_name,
        service_type=lead.service_type.value if lead.service_type is not None else None,
        job_location=lead.job_location,
        job_date_requested=date_str,
        scope_notes=lead.scope_notes,
        crew=crew,
        customer_phone=lead.customer_phone if role != "crew" else None,
        quote_context=lead.quote_context if role != "crew" else None,
    )


@router.get("", response_model=list[JobOut])
async def get_jobs(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_auth),
):
    if current_user.role in ("supervisor", "admin", "facilitator"):
        result = await db.execute(select(Lead).where(Lead.status == LeadStatus.booked))
    else:
        result = await db.execute(
            select(Lead)
            .join(JobAssignment, Lead.id == JobAssignment.lead_id)
            .where(Lead.status == LeadStatus.booked, JobAssignment.user_id == current_user.id)
        )
    leads = result.scalars().all()
    return [await _to_job_out(db, lead, current_user.role) for lead in leads]


@router.patch("/{lead_id}/status", response_model=JobOut)
async def patch_job_status(
    lead_id: str,
    data: JobStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("supervisor")),
):
    lead = await lead_service.update_job_status(db, lead_id, data.status, actor=current_user.username)
    return await _to_job_out(db, lead, current_user.role)


@router.post("/{lead_id}/assignments", response_model=JobOut, status_code=201)
async def add_assignment(
    lead_id: str,
    data: JobAssignmentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("supervisor")),
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
    return await _to_job_out(db, lead, current_user.role)


@router.delete("/{lead_id}/assignments/{user_id}", response_model=JobOut)
async def remove_assignment(
    lead_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("supervisor")),
):
    result = await db.execute(
        select(JobAssignment).where(JobAssignment.lead_id == lead_id, JobAssignment.user_id == user_id)
    )
    assignment = result.scalar_one_or_none()
    if assignment is None:
        raise HTTPException(status_code=404, detail="Assignment not found")
    await db.delete(assignment)
    await db.commit()
    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    if lead is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return await _to_job_out(db, lead, current_user.role)
