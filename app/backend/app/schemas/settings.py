from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel

_DEFAULTS: dict[str, str] = {
    "t1_minutes": "15",
    "t2_minutes": "30",
    "quiet_hours_start": "22:00",
    "quiet_hours_end": "07:00",
    "quiet_hours_enabled": "false",
    "primary_sms": "",
    "primary_email": "",
    "backup_name": "",
    "backup_sms": "",
    "backup_email": "",
    # Alert channel toggles — which delivery methods fire at each tier
    "t1_push": "true",
    "t1_sms": "false",
    "t1_email": "false",
    "t2_push": "true",
    "t2_sms": "true",
    "t2_email": "false",
}


class SettingsOut(BaseModel):
    t1_minutes: int = 15
    t2_minutes: int = 30
    quiet_hours_start: str = "22:00"
    quiet_hours_end: str = "07:00"
    quiet_hours_enabled: bool = False
    primary_sms: str = ""
    primary_email: str = ""
    backup_name: str = ""
    backup_sms: str = ""
    backup_email: str = ""
    t1_push: bool = True
    t1_sms: bool = False
    t1_email: bool = False
    t2_push: bool = True
    t2_sms: bool = True
    t2_email: bool = False


class SettingsPatch(BaseModel):
    t1_minutes: Optional[int] = None
    t2_minutes: Optional[int] = None
    quiet_hours_start: Optional[str] = None
    quiet_hours_end: Optional[str] = None
    quiet_hours_enabled: Optional[bool] = None
    primary_sms: Optional[str] = None
    primary_email: Optional[str] = None
    backup_name: Optional[str] = None
    backup_sms: Optional[str] = None
    backup_email: Optional[str] = None
    t1_push: Optional[bool] = None
    t1_sms: Optional[bool] = None
    t1_email: Optional[bool] = None
    t2_push: Optional[bool] = None
    t2_sms: Optional[bool] = None
    t2_email: Optional[bool] = None


class TestAlertRequest(BaseModel):
    channel: Literal["sms", "email"]
    recipient: Literal["primary", "backup"]


class TestAlertResult(BaseModel):
    sent: bool
    reason: Optional[str] = None


class NotificationChannelStatus(BaseModel):
    configured: bool
    missing: list[str] = []
    detail: Optional[str] = None


class NotificationStatusOut(BaseModel):
    sms: NotificationChannelStatus
    email: NotificationChannelStatus
    web_push: NotificationChannelStatus
