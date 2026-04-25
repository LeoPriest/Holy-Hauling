from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_auth, require_role
from app.models.user import User
from app.schemas.settings import (
    NotificationStatusOut,
    SettingsOut,
    SettingsPatch,
    TestAlertRequest,
    TestAlertResult,
)
from app.services import alert_service, push_service, settings_service

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=SettingsOut)
async def get_settings(
    _: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    return await settings_service.get_settings(db)


@router.patch("", response_model=SettingsOut)
async def patch_settings(
    data: SettingsPatch,
    _: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    updates = data.model_dump(exclude_unset=True)
    return await settings_service.patch_settings(db, updates)


@router.post("/test-alert", response_model=TestAlertResult)
async def test_alert(
    data: TestAlertRequest,
    _: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    settings = await settings_service.get_settings(db)
    return await alert_service.fire_test_alert(settings, data.channel, data.recipient)


@router.get("/notification-status", response_model=NotificationStatusOut)
async def notification_status(
    _: User = Depends(require_auth),
):
    return NotificationStatusOut(
        sms=alert_service.twilio_status(),
        email=alert_service.smtp_status(),
        web_push=push_service.web_push_status(),
    )
