from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str
    pin: str = Field(min_length=4, max_length=4)


class UserOut(BaseModel):
    id: str
    username: str
    role: str
    is_active: bool
    email: Optional[str] = None

    model_config = {"from_attributes": True}


class TokenOut(BaseModel):
    token: str
    user: UserOut
