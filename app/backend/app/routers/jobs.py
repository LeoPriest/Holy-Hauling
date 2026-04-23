from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_auth, require_role
from app.models.lead import Lead, LeadStatus
from app.models.user import User
from app.schemas.jobs import JobOut, JobStatusUpdate
from app.services import lead_service

router = APIRouter(prefix="/jobs", tags=["jobs"])


def _to_job_out(lead: Lead, role: str) -> JobOut:
    date_str = lead.job_date_requested.isoformat() if lead.job_date_requested else None
    return JobOut(
        id=lead.id,
        customer_name=lead.customer_name,
        service_type=lead.service_type.value if hasattr(lead.service_type, "value") else str(lead.service_type),
        job_location=lead.job_location,
        job_date_requested=date_str,
        scope_notes=lead.scope_notes,
        assigned_to=lead.assigned_to,
        customer_phone=lead.customer_phone if role != "crew" else None,
        quote_context=lead.quote_context if role != "crew" else None,
    )


@router.get("", response_model=list[JobOut])
async def get_jobs(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_auth),
):
    result = await db.execute(select(Lead).where(Lead.status == LeadStatus.booked))
    leads = result.scalars().all()
    return [_to_job_out(lead, current_user.role) for lead in leads]


@router.patch("/{lead_id}/status", response_model=JobOut)
async def patch_job_status(
    lead_id: str,
    data: JobStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("supervisor")),
):
    lead = await lead_service.update_job_status(db, lead_id, data.status, actor=current_user.username)
    return _to_job_out(lead, current_user.role)
