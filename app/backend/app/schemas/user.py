from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class UserCreate(BaseModel):
    username: str
    pin: str
    role: str


class UserPatch(BaseModel):
    role: Optional[str] = None
    pin: Optional[str] = None
    is_active: Optional[bool] = None


class UserListItem(BaseModel):
    id: str
    username: str
    role: str
    is_active: bool

    model_config = {"from_attributes": True}
