from __future__ import annotations

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.city import City
from app.models.user import User
from app.services import auth_service

_bearer = HTTPBearer(auto_error=False)


async def require_auth(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = auth_service.decode_token(credentials.credentials)
        user_id = payload["user_id"]
    except (JWTError, KeyError):
        raise HTTPException(status_code=401, detail="Invalid token")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or deactivated")
    return user


def require_role(*roles: str):
    async def _check(current_user: User = Depends(require_auth)) -> User:
        if current_user.role not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return current_user
    return _check


def city_scope(current_user: User, requested_city_id: str | None = None) -> str | None:
    """Return the effective city filter. Admins may pass None to mean all cities."""
    if current_user.role == "admin":
        return requested_city_id
    if not current_user.city_id:
        raise HTTPException(status_code=403, detail="User is not assigned to a city")
    if requested_city_id and requested_city_id != current_user.city_id:
        raise HTTPException(status_code=403, detail="Insufficient city permissions")
    return current_user.city_id


def city_for_create(current_user: User, requested_city_id: str | None = None) -> str:
    """Resolve the city for newly created city-owned records."""
    if current_user.role == "admin":
        resolved = requested_city_id or current_user.city_id
        if not resolved:
            raise HTTPException(status_code=400, detail="city_id is required")
        return resolved
    if not current_user.city_id:
        raise HTTPException(status_code=403, detail="User is not assigned to a city")
    if requested_city_id and requested_city_id != current_user.city_id:
        raise HTTPException(status_code=403, detail="Insufficient city permissions")
    return current_user.city_id


def ensure_city_access(current_user: User, record_city_id: str | None) -> None:
    """Protect direct-ID access to records outside a non-admin user's city."""
    if current_user.role == "admin":
        return
    if not current_user.city_id or current_user.city_id != record_city_id:
        raise HTTPException(status_code=404, detail="Not found")


async def require_active_city(db: AsyncSession, city_id: str) -> City:
    result = await db.execute(select(City).where(City.id == city_id, City.is_active == True))
    city = result.scalar_one_or_none()
    if city is None:
        raise HTTPException(status_code=422, detail="Active city is required")
    return city
