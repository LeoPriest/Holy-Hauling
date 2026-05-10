from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String

from app.database import Base


class LeadPayment(Base):
    __tablename__ = "lead_payments"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    lead_id = Column(String, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True)

    # Amount in cents to avoid float rounding issues
    amount_cents = Column(Integer, nullable=False)
    # "full" | "deposit" | "balance"
    payment_type = Column(String, nullable=False, default="full")
    # "pending" | "paid" | "failed" | "refunded" | "cancelled"
    status = Column(String, nullable=False, default="pending")

    # Square identifiers — populated after link creation
    square_order_id = Column(String, nullable=True, index=True)
    square_payment_id = Column(String, nullable=True, index=True)
    square_payment_link_id = Column(String, nullable=True)
    square_location_id = Column(String, nullable=True)
    payment_link_url = Column(String, nullable=True)

    # Delivery tracking
    sent_to_phone = Column(String, nullable=True)
    sent_at = Column(DateTime, nullable=True)
    paid_at = Column(DateTime, nullable=True)

    created_by = Column(String, nullable=True)
    created_at = Column(
        DateTime,
        nullable=False,
        default=lambda: datetime.now(timezone.utc).replace(tzinfo=None),
    )
