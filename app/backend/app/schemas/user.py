from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, EmailStr, Field

UserRole = Literal["admin", "facilitator", "supervisor", "crew"]
Weekday = Literal["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
Period = Literal["morning", "afternoon", "evening"]


class UserCreate(BaseModel):
    username: str
    pin: str = Field(min_length=4, max_length=4)
    role: UserRole
    city_id: Optional[str] = None
    email: Optional[EmailStr] = None


class UserPatch(BaseModel):
    role: Optional[UserRole] = None
    city_id: Optional[str] = None
    pin: Optional[str] = Field(default=None, min_length=4, max_length=4)
    is_active: Optional[bool] = None
    email: Optional[EmailStr] = None
    hourly_rate_cents: Optional[int] = Field(default=None, ge=0)


class UserListItem(BaseModel):
    id: str
    username: str
    role: str
    city_id: Optional[str] = None
    city_name: Optional[str] = None
    city_slug: Optional[str] = None
    is_active: bool
    email: Optional[str] = None
    hourly_rate_cents: Optional[int] = None
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
    blocks: dict[Weekday, list[Period]] = Field(default_factory=dict)


class UserWeeklyAvailabilityOut(BaseModel):
    blocks: dict[Weekday, list[Period]] = Field(default_factory=dict)
