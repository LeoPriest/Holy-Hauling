from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class PaymentRequestCreate(BaseModel):
    payment_type: str = "full"  # "full" | "deposit" | "balance"
    # Override amount — defaults to lead's quoted_price_total if omitted
    amount_override_cents: Optional[int] = None
    # Override phone — defaults to lead's customer_phone if omitted
    phone_override: Optional[str] = None


class PaymentOut(BaseModel):
    id: str
    lead_id: str
    amount_cents: int
    payment_type: str
    status: str
    payment_link_url: Optional[str]
    square_order_id: Optional[str]
    square_payment_id: Optional[str]
    sent_to_phone: Optional[str]
    sent_at: Optional[datetime]
    paid_at: Optional[datetime]
    created_by: Optional[str]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
