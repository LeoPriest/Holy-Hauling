from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_role
from app.models.user import User
from app.schemas.metrics import AdminMetrics
from app.services import metrics_service

router = APIRouter(prefix="/admin/metrics", tags=["admin"])


@router.get("", response_model=AdminMetrics)
async def get_admin_metrics(
    city_id: Optional[str] = Query(None),
    days: int = Query(30, ge=7, le=365),
    _current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    data = await metrics_service.get_metrics(db, city_id=city_id, days=days)
    return AdminMetrics(**data)
