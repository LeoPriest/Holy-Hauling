from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import city_for_create, require_auth, require_role
from app.models.lead import Lead, LeadStatus
from app.models.lead_checklist_item import LeadChecklistItem
from app.models.user import User
from app.schemas.checklist import (
    ChecklistItemCreate,
    ChecklistItemOut,
    ChecklistItemUpdate,
    StandardKitOut,
    StandardKitUpdate,
)
from app.services import checklist_service

router = APIRouter(tags=["checklist"])
lead_router = APIRouter(prefix="/leads/{lead_id}/checklist")
kit_router = APIRouter(prefix="/settings")


def _item_out(item: LeadChecklistItem) -> ChecklistItemOut:
    return ChecklistItemOut.model_validate({
        "id": item.id,
        "lead_id": item.lead_id,
        "label": item.label,
        "is_checked": item.is_checked,
        "source": item.source,
        "sort_order": item.sort_order,
        "created_at": item.created_at.isoformat(),
        "updated_at": item.updated_at.isoformat(),
    })


async def _load_lead(db: AsyncSession, lead_id: str) -> Lead:
    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead


@lead_router.get("", response_model=list[ChecklistItemOut])
async def get_checklist(
    lead_id: str,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_auth),
):
    lead = await _load_lead(db, lead_id)
    if lead.checklist_seeded_at is None and lead.status == LeadStatus.booked:
        await checklist_service.seed_checklist(db, lead)
    result = await db.execute(
        select(LeadChecklistItem)
        .where(LeadChecklistItem.lead_id == lead_id)
        .order_by(LeadChecklistItem.sort_order, LeadChecklistItem.created_at)
    )
    return [_item_out(i) for i in result.scalars().all()]


@lead_router.post("", response_model=ChecklistItemOut)
async def add_checklist_item(
    lead_id: str,
    data: ChecklistItemCreate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_auth),
):
    label = data.label.strip()
    if not label:
        raise HTTPException(status_code=422, detail="label must not be blank")
    await _load_lead(db, lead_id)
    result = await db.execute(
        select(LeadChecklistItem).where(LeadChecklistItem.lead_id == lead_id)
    )
    existing = result.scalars().all()
    next_order = max((i.sort_order for i in existing), default=-1) + 1
    item = LeadChecklistItem(lead_id=lead_id, label=label, source="custom", sort_order=next_order)
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return _item_out(item)


@lead_router.patch("/{item_id}", response_model=ChecklistItemOut)
async def update_checklist_item(
    lead_id: str,
    item_id: str,
    data: ChecklistItemUpdate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_auth),
):
    result = await db.execute(
        select(LeadChecklistItem).where(
            LeadChecklistItem.id == item_id,
            LeadChecklistItem.lead_id == lead_id,
        )
    )
    item = result.scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="Checklist item not found")
    if data.is_checked is not None:
        item.is_checked = data.is_checked
    if data.label is not None:
        new_label = data.label.strip()
        if not new_label:
            raise HTTPException(status_code=422, detail="label must not be blank")
        item.label = new_label
    item.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(item)
    return _item_out(item)


@lead_router.delete("/{item_id}", status_code=200)
async def delete_checklist_item(
    lead_id: str,
    item_id: str,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_auth),
):
    result = await db.execute(
        select(LeadChecklistItem).where(
            LeadChecklistItem.id == item_id,
            LeadChecklistItem.lead_id == lead_id,
        )
    )
    item = result.scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="Checklist item not found")
    await db.delete(item)
    await db.commit()
    return {"deleted": True}


@kit_router.get("/checklist-kit", response_model=StandardKitOut)
async def get_checklist_kit(
    city_id: str | None = None,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    resolved = city_for_create(current_user, city_id)
    items = await checklist_service.get_standard_kit(db, resolved)
    return StandardKitOut(items=items)


@kit_router.put("/checklist-kit", response_model=StandardKitOut)
async def put_checklist_kit(
    data: StandardKitUpdate,
    city_id: str | None = None,
    current_user: User = Depends(require_role("admin", "facilitator")),
    db: AsyncSession = Depends(get_db),
):
    resolved = city_for_create(current_user, city_id)
    items = await checklist_service.set_standard_kit(db, data.items, resolved)
    return StandardKitOut(items=items)


router.include_router(lead_router)
router.include_router(kit_router)
