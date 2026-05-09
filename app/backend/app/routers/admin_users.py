from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_role
from app.models.city import City, DEFAULT_CITY_ID
from app.models.user import User
from app.schemas.auth import UserOut
from app.schemas.user import UserCreate, UserListItem, UserPatch
from app.services.auth_service import hash_pin

router = APIRouter(prefix="/admin/users", tags=["admin-users"])


async def _city_lookup(db: AsyncSession) -> dict[str, City]:
    result = await db.execute(select(City))
    return {city.id: city for city in result.scalars().all()}


def _user_item(user: User, cities: dict[str, City]) -> UserListItem:
    city = cities.get(user.city_id or "")
    return UserListItem(
        id=user.id,
        username=user.username,
        role=user.role,
        city_id=user.city_id,
        city_name=city.name if city else None,
        city_slug=city.slug if city else None,
        is_active=user.is_active,
        email=user.email,
    )


async def _ensure_city(db: AsyncSession, city_id: str | None, role: str) -> str | None:
    if role == "admin" and not city_id:
        return None
    target = city_id or DEFAULT_CITY_ID
    result = await db.execute(select(City).where(City.id == target, City.is_active == True))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=422, detail="Active city is required")
    return target


@router.get("", response_model=list[UserListItem])
async def list_users(
    city_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(require_role("admin")),
):
    q = select(User).order_by(User.created_at)
    if city_id:
        q = q.where(User.city_id == city_id)
    result = await db.execute(q)
    cities = await _city_lookup(db)
    return [_user_item(user, cities) for user in result.scalars().all()]


@router.post("", response_model=UserOut, status_code=201)
async def create_user(
    data: UserCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    existing = await db.execute(select(User).where(User.username == data.username))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Username already exists")
    city_id = await _ensure_city(db, data.city_id, data.role)
    user = User(
        username=data.username,
        credential_hash=hash_pin(data.pin),
        role=data.role,
        city_id=city_id,
        email=data.email,
        created_at=datetime.now(timezone.utc),
        created_by=current_user.id,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return UserOut.model_validate(user)


@router.patch("/{user_id}", response_model=UserOut)
async def patch_user(
    user_id: str,
    data: UserPatch,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot modify your own account")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if data.role is not None:
        user.role = data.role
    target_role = data.role or user.role
    if "city_id" in data.model_fields_set or data.role is not None:
        user.city_id = await _ensure_city(db, data.city_id if "city_id" in data.model_fields_set else user.city_id, target_role)
    if data.pin is not None:
        user.credential_hash = hash_pin(data.pin)
    if data.is_active is not None:
        user.is_active = data.is_active
    if "email" in data.model_fields_set:
        user.email = data.email
    await db.commit()
    await db.refresh(user)
    return UserOut.model_validate(user)
