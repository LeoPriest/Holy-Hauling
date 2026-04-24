from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_role
from app.models.user import User
from app.schemas.auth import UserOut
from app.schemas.user import UserCreate, UserListItem, UserPatch
from app.services.auth_service import hash_pin

router = APIRouter(prefix="/admin/users", tags=["admin-users"])


@router.get("", response_model=list[UserListItem], dependencies=[Depends(require_role("admin"))])
async def list_users(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).order_by(User.created_at))
    return result.scalars().all()


@router.post("", response_model=UserOut, status_code=201)
async def create_user(
    data: UserCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    existing = await db.execute(select(User).where(User.username == data.username))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Username already exists")
    user = User(
        username=data.username,
        credential_hash=hash_pin(data.pin),
        role=data.role,
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
    if data.pin is not None:
        user.credential_hash = hash_pin(data.pin)
    if data.is_active is not None:
        user.is_active = data.is_active
    if data.email is not None:
        user.email = data.email
    await db.commit()
    await db.refresh(user)
    return UserOut.model_validate(user)
