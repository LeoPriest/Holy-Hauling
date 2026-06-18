from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class QuoteLineItem(BaseModel):
    note: str
    amount: float


class ComparableOut(BaseModel):
    lead_id: str
    conversion: str          # won | lost
    price_cents: int
    price_basis: str         # realized | quoted
    score: int
    move_size_label: Optional[str] = None
    move_distance_miles: Optional[float] = None
    move_type: Optional[str] = None


class QuoteSuggestionOut(BaseModel):
    quoted_price_total: float
    line_items: list[QuoteLineItem] = Field(default_factory=list)
    estimated_duration_minutes: int
    rationale: str = ""
    comparables: List[ComparableOut] = Field(default_factory=list)
