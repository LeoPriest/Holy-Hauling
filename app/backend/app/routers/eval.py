from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_role
from app.models.user import User
from app.schemas.eval import QuoteGroundingEval
from app.services.eval_service import compute_quote_grounding_eval

router = APIRouter(tags=["eval"])


@router.get("/admin/eval/quote-grounding", response_model=QuoteGroundingEval)
async def quote_grounding_eval(
    city_id: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("admin")),
):
    return await compute_quote_grounding_eval(db, city_id)
