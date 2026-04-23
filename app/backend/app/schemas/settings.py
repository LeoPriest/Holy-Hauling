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


class TestAlertRequest(BaseModel):
    channel: Literal["sms", "email"]
    recipient: Literal["primary", "backup"]


class TestAlertResult(BaseModel):
    sent: bool
    reason: Optional[str] = None
