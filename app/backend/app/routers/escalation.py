from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_auth
from app.models.lead import Lead
from app.models.lead_escalation import LeadEscalation
from app.models.user import User
from app.schemas.escalation import (
    EscalationSummaryOut,
    LeadEscalationOut,
    RaiseEscalationIn,
    ResolveEscalationIn,
)
from app.services import escalation_service

router = APIRouter(tags=["escalation"])


async def _get_lead_or_404(db: AsyncSession, lead_id: str) -> Lead:
    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    if lead is None:
        raise HTTPException(404, "Lead not found")
    return lead


@router.get("/leads/{lead_id}/escalation", response_model=LeadEscalationOut | None)
async def get_lead_escalation(lead_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_auth)):
    esc = await escalation_service.get_open(db, lead_id)
    return esc


@router.post("/leads/{lead_id}/escalation/suggest", response_model=EscalationSummaryOut)
async def suggest_escalation_summary(lead_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_auth)):
    lead = await _get_lead_or_404(db, lead_id)
    summary = await escalation_service.suggest_summary(db, lead)
    return EscalationSummaryOut(summary=summary)


@router.post("/leads/{lead_id}/escalation", response_model=LeadEscalationOut)
async def raise_lead_escalation(
    lead_id: str,
    body: RaiseEscalationIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_auth),
):
    lead = await _get_lead_or_404(db, lead_id)
    esc = await escalation_service.raise_escalation(
        db, lead,
        level=body.level,
        decision_needed=body.decision_needed,
        summary=body.summary,
        raised_by=body.raised_by or user.username,
    )
    return esc


@router.post("/escalations/{escalation_id}/resolve", response_model=LeadEscalationOut)
async def resolve_lead_escalation(
    escalation_id: str,
    body: ResolveEscalationIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_auth),
):
    return await escalation_service.resolve_escalation(
        db, escalation_id,
        outcome=body.outcome,
        resolution_note=body.resolution_note,
        resolved_by=body.resolved_by or user.username,
    )


@router.get("/escalations", response_model=list[LeadEscalationOut])
async def list_escalations(
    status: str = Query("open"),
    city_id: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_auth),
):
    stmt = (
        select(LeadEscalation, Lead.customer_name, Lead.status)
        .join(Lead, Lead.id == LeadEscalation.lead_id)
        .where(LeadEscalation.status == status)
        .order_by(LeadEscalation.raised_at.desc())
    )
    if city_id:
        stmt = stmt.where(Lead.city_id == city_id)
    rows = (await db.execute(stmt)).all()
    out: list[LeadEscalationOut] = []
    for esc, customer_name, lead_status in rows:
        item = LeadEscalationOut.model_validate(esc)
        item.lead_customer_name = customer_name
        item.lead_status = lead_status.value if lead_status else None
        out.append(item)
    return out
