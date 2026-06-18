from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_auth
from app.models.lead_outcome import LeadOutcome
from app.models.user import User
from app.schemas.outcome import LeadOutcomeOut

router = APIRouter(tags=["outcomes"])


@router.get("/admin/outcomes", response_model=list[LeadOutcomeOut])
async def list_outcomes(
    city_id: str | None = Query(None),
    conversion: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_auth),
):
    stmt = select(LeadOutcome).order_by(LeadOutcome.updated_at.desc())
    if city_id:
        stmt = stmt.where(LeadOutcome.city_id == city_id)
    if conversion:
        stmt = stmt.where(LeadOutcome.conversion == conversion)
    return (await db.execute(stmt)).scalars().all()
