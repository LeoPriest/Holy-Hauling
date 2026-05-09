from __future__ import annotations

import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_role
from app.models.city import City
from app.models.user import User
from app.schemas.city import CityCreate, CityOut, CityPatch

router = APIRouter(prefix="/admin/cities", tags=["admin-cities"])

_SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def _clean(value: str) -> str:
    return value.strip()


def _clean_slug(value: str) -> str:
    slug = value.strip().lower()
    if not _SLUG_RE.fullmatch(slug):
        raise HTTPException(status_code=422, detail="Slug must use lowercase letters, numbers, and single hyphens.")
    return slug


@router.get("", response_model=list[CityOut])
async def list_cities(
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(require_role("admin")),
):
    result = await db.execute(select(City).order_by(City.name))
    return result.scalars().all()


@router.post("", response_model=CityOut, status_code=201)
async def create_city(
    data: CityCreate,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(require_role("admin")),
):
    name = _clean(data.name)
    slug = _clean_slug(data.slug)
    if not name:
        raise HTTPException(status_code=422, detail="City name is required")
    existing = await db.execute(select(City).where(City.slug == slug))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="City slug already exists")
    city = City(name=name, slug=slug, timezone=_clean(data.timezone) or "America/Chicago")
    db.add(city)
    await db.commit()
    await db.refresh(city)
    return city


@router.patch("/{city_id}", response_model=CityOut)
async def patch_city(
    city_id: str,
    data: CityPatch,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(require_role("admin")),
):
    result = await db.execute(select(City).where(City.id == city_id))
    city = result.scalar_one_or_none()
    if city is None:
        raise HTTPException(status_code=404, detail="City not found")
    if "name" in data.model_fields_set and data.name is not None:
        name = _clean(data.name)
        if not name:
            raise HTTPException(status_code=422, detail="City name is required")
        city.name = name
    if "slug" in data.model_fields_set and data.slug is not None:
        slug = _clean_slug(data.slug)
        existing = await db.execute(select(City).where(City.slug == slug, City.id != city_id))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="City slug already exists")
        city.slug = slug
    if "timezone" in data.model_fields_set and data.timezone is not None:
        city.timezone = _clean(data.timezone) or "America/Chicago"
    if data.is_active is not None:
        city.is_active = data.is_active
    city.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(city)
    return city
