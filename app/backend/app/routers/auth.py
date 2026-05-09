from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_auth
from app.models.city import City
from app.models.user import User
from app.schemas.auth import LoginRequest, TokenOut, UserOut
from app.schemas.city import CityOut
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


async def _user_out(db: AsyncSession, user: User) -> UserOut:
    city = None
    if user.city_id:
        result = await db.execute(select(City).where(City.id == user.city_id))
        city = result.scalar_one_or_none()
    available_cities: list[CityOut] = []
    if user.role == "admin":
        result = await db.execute(select(City).where(City.is_active == True).order_by(City.name))
        available_cities = [CityOut.model_validate(row) for row in result.scalars().all()]
    return UserOut(
        id=user.id,
        username=user.username,
        role=user.role,
        city_id=user.city_id,
        city_name=city.name if city else None,
        city_slug=city.slug if city else None,
        is_active=user.is_active,
        email=user.email,
        available_cities=available_cities,
    )


@router.post("/login", response_model=TokenOut)
async def login(data: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.username == data.username))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not auth_service.verify_pin(data.pin, user.credential_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = auth_service.create_token(user)
    return TokenOut(token=token, user=await _user_out(db, user))


@router.get("/me", response_model=UserOut)
async def me(
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    return await _user_out(db, current_user)
