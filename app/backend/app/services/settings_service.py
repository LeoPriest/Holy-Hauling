from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_setting import AppSetting
from app.models.city import DEFAULT_CITY_ID
from app.schemas.settings import SettingsOut, _DEFAULTS

_VALID_KEYS = frozenset(_DEFAULTS.keys())


async def get_settings(db: AsyncSession, city_id: str = DEFAULT_CITY_ID) -> SettingsOut:
    result = await db.execute(select(AppSetting).where(AppSetting.city_id == city_id))
    stored = {row.key: row.value for row in result.scalars().all() if row.value is not None}
    merged = {**_DEFAULTS, **stored}
    def _bool(key: str) -> bool:
        return merged[key].lower() == "true"

    return SettingsOut(
        t1_minutes=int(merged["t1_minutes"]),
        t2_minutes=int(merged["t2_minutes"]),
        quiet_hours_start=merged["quiet_hours_start"],
        quiet_hours_end=merged["quiet_hours_end"],
        quiet_hours_enabled=_bool("quiet_hours_enabled"),
        primary_sms=merged["primary_sms"],
        primary_email=merged["primary_email"],
        backup_name=merged["backup_name"],
        backup_sms=merged["backup_sms"],
        backup_email=merged["backup_email"],
        t1_push=_bool("t1_push"),
        t1_sms=_bool("t1_sms"),
        t1_email=_bool("t1_email"),
        t2_push=_bool("t2_push"),
        t2_sms=_bool("t2_sms"),
        t2_email=_bool("t2_email"),
    )


async def patch_settings(db: AsyncSession, updates: dict, city_id: str = DEFAULT_CITY_ID) -> SettingsOut:
    for key, val in updates.items():
        if key not in _VALID_KEYS:
            continue
        result = await db.execute(select(AppSetting).where(AppSetting.key == key, AppSetting.city_id == city_id))
        row = result.scalar_one_or_none()
        if row:
            row.value = str(val).lower() if isinstance(val, bool) else str(val)
        else:
            str_val = str(val).lower() if isinstance(val, bool) else str(val)
            db.add(AppSetting(key=key, city_id=city_id, value=str_val))
    await db.commit()
    return await get_settings(db, city_id)
