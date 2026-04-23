from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

UserRole = Literal["admin", "facilitator", "supervisor", "crew"]


class UserCreate(BaseModel):
    username: str
    pin: str = Field(min_length=4, max_length=4)
    role: UserRole


class UserPatch(BaseModel):
    role: Optional[UserRole] = None
    pin: Optional[str] = Field(default=None, min_length=4, max_length=4)
    is_active: Optional[bool] = None


class UserListItem(BaseModel):
    id: str
    username: str
    role: str
    is_active: bool

    model_config = {"from_attributes": True}
