from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import city_scope, require_auth, require_role
from app.models.city import City
from app.models.user_availability import UserAvailability
from app.models.user_weekly_availability import PERIODS, UserWeeklyAvailability
from app.models.user import User
from app.schemas.user import (
    UserAvailabilityCreate,
    UserAvailabilityDeleteResult,
    UserAvailabilityItem,
    UserListItem,
    UserWeeklyAvailabilityOut,
    UserWeeklyAvailabilityUpdate,
)

router = APIRouter(prefix="/users", tags=["users"])
_WEEKDAY_ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
_PERIOD_ORDER = list(PERIODS)  # single source of truth (model); morning -> afternoon -> evening


def _blocks_from_rows(rows) -> dict[str, list[str]]:
    grouped: dict[str, set[str]] = {}
    for row in rows:
        grouped.setdefault(row.weekday, set()).add(row.period)
    return {
        day: [p for p in _PERIOD_ORDER if p in grouped[day]]
        for day in _WEEKDAY_ORDER if day in grouped
    }


@router.get(
    "/me/availability",
    response_model=list[UserAvailabilityItem],
)
async def list_my_availability(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_auth),
):
    result = await db.execute(
        select(UserAvailability)
        .where(UserAvailability.user_id == current_user.id)
        .order_by(UserAvailability.unavailable_on)
    )
    rows = result.scalars().all()
    return [UserAvailabilityItem(day=row.unavailable_on) for row in rows]


@router.post(
    "/me/availability",
    response_model=UserAvailabilityItem,
)
async def add_my_availability(
    data: UserAvailabilityCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_auth),
):
    result = await db.execute(
        select(UserAvailability).where(
            UserAvailability.user_id == current_user.id,
            UserAvailability.unavailable_on == data.day,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        row = UserAvailability(user_id=current_user.id, unavailable_on=data.day)
        db.add(row)
        await db.commit()
        await db.refresh(row)
    return UserAvailabilityItem(day=row.unavailable_on)


@router.delete(
    "/me/availability/{day}",
    response_model=UserAvailabilityDeleteResult,
)
async def delete_my_availability(
    day: date,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_auth),
):
    result = await db.execute(
        select(UserAvailability).where(
            UserAvailability.user_id == current_user.id,
            UserAvailability.unavailable_on == day,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        return UserAvailabilityDeleteResult(removed=False)
    await db.delete(row)
    await db.commit()
    return UserAvailabilityDeleteResult(removed=True)


@router.get("/me/weekly-availability", response_model=UserWeeklyAvailabilityOut)
async def get_my_weekly_availability(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_auth),
):
    rows = (await db.execute(
        select(UserWeeklyAvailability).where(UserWeeklyAvailability.user_id == current_user.id)
    )).scalars().all()
    return UserWeeklyAvailabilityOut(blocks=_blocks_from_rows(rows))


@router.put("/me/weekly-availability", response_model=UserWeeklyAvailabilityOut)
async def replace_my_weekly_availability(
    data: UserWeeklyAvailabilityUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_auth),
):
    await db.execute(
        delete(UserWeeklyAvailability).where(UserWeeklyAvailability.user_id == current_user.id)
    )
    for weekday, periods in data.blocks.items():
        for period in dict.fromkeys(periods):
            db.add(UserWeeklyAvailability(user_id=current_user.id, weekday=weekday, period=period))
    await db.commit()
    rows = (await db.execute(
        select(UserWeeklyAvailability).where(UserWeeklyAvailability.user_id == current_user.id)
    )).scalars().all()
    return UserWeeklyAvailabilityOut(blocks=_blocks_from_rows(rows))


@router.get("", response_model=list[UserListItem])
async def list_active_users(
    city_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin", "facilitator", "supervisor")),
):
    effective_city_id = city_scope(current_user, city_id)
    q = select(User).where(User.is_active == True).order_by(User.role, User.username)
    if effective_city_id:
        q = q.where(User.city_id == effective_city_id)
    result = await db.execute(q)
    users = result.scalars().all()
    if not users:
        return []
    city_result = await db.execute(select(City))
    city_map = {city.id: city for city in city_result.scalars().all()}

    user_ids = [user.id for user in users]
    availability_result = await db.execute(
        select(UserAvailability)
        .where(UserAvailability.user_id.in_(user_ids))
        .order_by(UserAvailability.unavailable_on)
    )
    availability_map: dict[str, list[str]] = {user_id: [] for user_id in user_ids}
    for row in availability_result.scalars().all():
        availability_map.setdefault(row.user_id, []).append(row.unavailable_on.isoformat())

    weekly_result = await db.execute(
        select(UserWeeklyAvailability)
        .where(UserWeeklyAvailability.user_id.in_(user_ids))
    )
    # user_id -> weekday -> set(periods); a weekday is "unavailable" only when all 3 are blocked
    weekly_periods: dict[str, dict[str, set[str]]] = {user_id: {} for user_id in user_ids}
    for row in weekly_result.scalars().all():
        weekly_periods.setdefault(row.user_id, {}).setdefault(row.weekday, set()).add(row.period)

    return [
        UserListItem(
            id=user.id,
            username=user.username,
            role=user.role,
            city_id=user.city_id,
            city_name=city_map[user.city_id].name if user.city_id in city_map else None,
            city_slug=city_map[user.city_id].slug if user.city_id in city_map else None,
            is_active=user.is_active,
            email=user.email,
            unavailable_dates=availability_map.get(user.id, []),
            unavailable_weekdays=[
                day for day in _WEEKDAY_ORDER
                if len(weekly_periods.get(user.id, {}).get(day, set())) == len(_PERIOD_ORDER)
            ],
        )
        for user in users
    ]
