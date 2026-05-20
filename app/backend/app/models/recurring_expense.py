# app/backend/app/models/recurring_expense.py
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Integer, String, Text

from app.database import Base
from app.models.city import DEFAULT_CITY_ID


class RecurringExpense(Base):
    __tablename__ = "recurring_expenses"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    city_id = Column(String, ForeignKey("cities.id"), nullable=False, default=DEFAULT_CITY_ID)
    name = Column(String, nullable=False)
    category = Column(String, nullable=False)
    amount_cents = Column(Integer, nullable=False)
    payment_method = Column(String, nullable=True)
    vendor_customer = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    interval_value = Column(Integer, nullable=False)
    interval_unit = Column(String, nullable=False)  # "days" | "weeks" | "months"
    next_due_date = Column(Date, nullable=False)
    google_calendar_event_id = Column(String, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
