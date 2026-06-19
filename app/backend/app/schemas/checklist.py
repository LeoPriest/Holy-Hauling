from __future__ import annotations

from pydantic import BaseModel


class ChecklistItemOut(BaseModel):
    id: str
    lead_id: str
    label: str
    is_checked: bool
    source: str
    sort_order: int
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}


class ChecklistItemCreate(BaseModel):
    label: str


class ChecklistItemUpdate(BaseModel):
    is_checked: bool | None = None
    label: str | None = None


class StandardKitOut(BaseModel):
    items: list[str]


class StandardKitUpdate(BaseModel):
    items: list[str]
