from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class LeadOutcomeOut(BaseModel):
    lead_id: str
    city_id: str
    conversion: str
    terminal_status: str
    quoted_price_cents: Optional[int] = None
    realized_revenue_cents: Optional[int] = None
    realized_cost_cents: Optional[int] = None
    price_delta_cents: Optional[int] = None
    was_escalated: bool
    escalation_outcome: Optional[str] = None
    scope_snapshot: Optional[str] = None
    ai_prompt_version: Optional[str] = None
    booked_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    time_to_book_minutes: Optional[int] = None
    finalized: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
