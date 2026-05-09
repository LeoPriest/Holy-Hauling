from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field

from app.schemas.city import CityOut


class LoginRequest(BaseModel):
    username: str
    pin: str = Field(min_length=4, max_length=4)


class UserOut(BaseModel):
    id: str
    username: str
    role: str
    city_id: Optional[str] = None
    city_name: Optional[str] = None
    city_slug: Optional[str] = None
    is_active: bool
    email: Optional[str] = None
    available_cities: list[CityOut] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class TokenOut(BaseModel):
    token: str
    user: UserOut
