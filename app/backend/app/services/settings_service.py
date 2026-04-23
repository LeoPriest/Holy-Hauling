from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_setting import AppSetting
from app.schemas.settings import SettingsOut, _DEFAULTS

_VALID_KEYS = frozenset(_DEFAULTS.keys())


async def get_settings(db: AsyncSession) -> SettingsOut:
    result = await db.execute(select(AppSetting))
    stored = {row.key: row.value for row in result.scalars().all() if row.value is not None}
    merged = {**_DEFAULTS, **stored}
    return SettingsOut(
        t1_minutes=int(merged["t1_minutes"]),
        t2_minutes=int(merged["t2_minutes"]),
        quiet_hours_start=merged["quiet_hours_start"],
        quiet_hours_end=merged["quiet_hours_end"],
        quiet_hours_enabled=merged["quiet_hours_enabled"].lower() == "true",
        primary_sms=merged["primary_sms"],
        primary_email=merged["primary_email"],
        backup_name=merged["backup_name"],
        backup_sms=merged["backup_sms"],
        backup_email=merged["backup_email"],
    )


async def patch_settings(db: AsyncSession, updates: dict) -> SettingsOut:
    for key, val in updates.items():
        if key not in _VALID_KEYS:
            continue
        result = await db.execute(select(AppSetting).where(AppSetting.key == key))
        row = result.scalar_one_or_none()
        if row:
            row.value = str(val).lower() if isinstance(val, bool) else str(val)
        else:
            str_val = str(val).lower() if isinstance(val, bool) else str(val)
            db.add(AppSetting(key=key, value=str_val))
    await db.commit()
    return await get_settings(db)
