from __future__ import annotations

import json
import re
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_setting import AppSetting
from app.models.city import DEFAULT_CITY_ID
from app.models.lead import Lead, ServiceType
from app.models.lead_checklist_item import LeadChecklistItem

_KIT_KEY = "checklist_standard_kit"

DEFAULT_STANDARD_KIT = [
    "Moving blankets",
    "Furniture dolly",
    "Hand truck",
    "Ratchet straps",
    "Shrink wrap",
    "Packing tape",
    "Basic tool kit",
    "Floor runners",
    "Work gloves",
]

_LARGE_MOVE_RE = re.compile(r"(\d+)\s*\+?\s*bed")


def _dedupe_preserve_order(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for raw in items:
        label = str(raw).strip()
        key = label.lower()
        if not label or key in seen:
            continue
        seen.add(key)
        out.append(label)
    return out


async def get_standard_kit(db: AsyncSession, city_id: str = DEFAULT_CITY_ID) -> list[str]:
    result = await db.execute(
        select(AppSetting).where(AppSetting.key == _KIT_KEY, AppSetting.city_id == city_id)
    )
    row = result.scalar_one_or_none()
    if row is None or not row.value:
        return list(DEFAULT_STANDARD_KIT)
    try:
        items = json.loads(row.value)
    except (ValueError, TypeError):
        return list(DEFAULT_STANDARD_KIT)
    if not isinstance(items, list):
        return list(DEFAULT_STANDARD_KIT)
    cleaned = _dedupe_preserve_order(items)
    return cleaned or list(DEFAULT_STANDARD_KIT)


async def set_standard_kit(db: AsyncSession, items: list[str], city_id: str = DEFAULT_CITY_ID) -> list[str]:
    cleaned = _dedupe_preserve_order(items)
    value = json.dumps(cleaned)
    result = await db.execute(
        select(AppSetting).where(AppSetting.key == _KIT_KEY, AppSetting.city_id == city_id)
    )
    row = result.scalar_one_or_none()
    if row:
        row.value = value
    else:
        db.add(AppSetting(key=_KIT_KEY, city_id=city_id, value=value))
    await db.commit()
    return cleaned


def _has_stairs(lead: Lead) -> bool:
    return (lead.load_stairs or 0) > 0 or (lead.unload_stairs or 0) > 0


def _is_large_move(lead: Lead) -> bool:
    label = (lead.move_size_label or "").lower()
    if "house" in label:
        return True
    m = _LARGE_MOVE_RE.search(label)
    return bool(m and int(m.group(1)) >= 3)


def _brings_truck(lead: Lead) -> bool:
    move_type = (lead.move_type or "").lower()
    if "labor" in move_type or "customer" in move_type:
        return False
    return True


def scope_items(lead: Lead) -> list[str]:
    items: list[str] = []
    service_type = lead.service_type
    if service_type in (ServiceType.moving, ServiceType.both):
        items += ["Mattress bags", "Wardrobe boxes"]
    if service_type in (ServiceType.hauling, ServiceType.both):
        items += ["Contractor/disposal bags", "Junk bins"]
    if _has_stairs(lead):
        items += ["Stair-climbing hand truck", "Extra straps"]
    if _is_large_move(lead):
        items.append("Extra blankets (large move)")
    if _brings_truck(lead):
        items.append("Company truck — fuel & equipment check")
    return items


async def seed_checklist(db: AsyncSession, lead: Lead) -> None:
    if lead.checklist_seeded_at is not None:
        return
    kit = await get_standard_kit(db, lead.city_id or DEFAULT_CITY_ID)
    seen: set[str] = set()
    ordered: list[tuple[str, str]] = []  # (label, source)
    for label in kit:
        key = label.strip().lower()
        if not label.strip() or key in seen:
            continue
        seen.add(key)
        ordered.append((label.strip(), "standard"))
    for label in scope_items(lead):
        key = label.strip().lower()
        if key in seen:
            continue
        seen.add(key)
        ordered.append((label.strip(), "scope"))
    for index, (label, source) in enumerate(ordered):
        db.add(LeadChecklistItem(lead_id=lead.id, label=label, source=source, sort_order=index))
    lead.checklist_seeded_at = datetime.now(timezone.utc)
    await db.commit()
