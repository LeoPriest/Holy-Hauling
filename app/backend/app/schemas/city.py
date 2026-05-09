from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class CityCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    slug: str = Field(min_length=1, max_length=80)
    timezone: str = Field(default="America/Chicago", min_length=1, max_length=80)


class CityPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    slug: str | None = Field(default=None, min_length=1, max_length=80)
    timezone: str | None = Field(default=None, min_length=1, max_length=80)
    is_active: bool | None = None


class CityOut(BaseModel):
    id: str
    name: str
    slug: str
    timezone: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
