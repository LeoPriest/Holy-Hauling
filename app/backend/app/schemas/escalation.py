from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

Level = Literal["monitor", "pause", "owner_takeover"]
Outcome = Literal["approved", "adjusted", "owner_takeover", "release", "need_more_info"]


class RaiseEscalationIn(BaseModel):
    level: Level
    decision_needed: str = Field(min_length=1)
    summary: str = Field(min_length=1)
    raised_by: Optional[str] = None


class ResolveEscalationIn(BaseModel):
    outcome: Outcome
    resolution_note: Optional[str] = None
    resolved_by: Optional[str] = None


class EscalationSummaryOut(BaseModel):
    summary: str


class LeadEscalationOut(BaseModel):
    id: str
    lead_id: str
    level: str
    source: str
    decision_needed: str
    summary: str
    raised_by: Optional[str] = None
    raised_at: datetime
    status: str
    outcome: Optional[str] = None
    resolution_note: Optional[str] = None
    resolved_by: Optional[str] = None
    resolved_at: Optional[datetime] = None
    # Populated via join when listing for the queue band
    lead_customer_name: Optional[str] = None
    lead_status: Optional[str] = None

    model_config = {"from_attributes": True}
