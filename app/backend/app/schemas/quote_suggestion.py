from __future__ import annotations

from pydantic import BaseModel, Field


class QuoteLineItem(BaseModel):
    note: str
    amount: float


class QuoteSuggestionOut(BaseModel):
    quoted_price_total: float
    line_items: list[QuoteLineItem] = Field(default_factory=list)
    estimated_duration_minutes: int
    rationale: str = ""
