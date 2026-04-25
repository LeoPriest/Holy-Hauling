from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, EmailStr, Field

UserRole = Literal["admin", "facilitator", "supervisor", "crew"]
Weekday = Literal["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


class UserCreate(BaseModel):
    username: str
    pin: str = Field(min_length=4, max_length=4)
    role: UserRole
    email: Optional[EmailStr] = None


class UserPatch(BaseModel):
    role: Optional[UserRole] = None
    pin: Optional[str] = Field(default=None, min_length=4, max_length=4)
    is_active: Optional[bool] = None
    email: Optional[EmailStr] = None


class UserListItem(BaseModel):
    id: str
    username: str
    role: str
    is_active: bool
    email: Optional[str] = None
    unavailable_dates: list[str] = Field(default_factory=list)
    unavailable_weekdays: list[Weekday] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class UserAvailabilityCreate(BaseModel):
    day: date


class UserAvailabilityItem(BaseModel):
    day: date


class UserAvailabilityDeleteResult(BaseModel):
    removed: bool


class UserWeeklyAvailabilityUpdate(BaseModel):
    weekdays: list[Weekday] = Field(default_factory=list)


class UserWeeklyAvailabilityOut(BaseModel):
    weekdays: list[Weekday] = Field(default_factory=list)
