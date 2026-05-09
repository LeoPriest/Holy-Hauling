from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class FollowupCreate(BaseModel):
    scheduled_at: datetime
    note: str | None = None


class FollowupOut(BaseModel):
    id: str
    lead_id: str
    scheduled_at: datetime
    note: str | None
    fired: bool
    created_by: str | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
