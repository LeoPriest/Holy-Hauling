from __future__ import annotations

import enum
import uuid
from datetime import date, datetime, timezone

from sqlalchemy import Column, Date, DateTime, Enum as SAEnum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.database import Base
from app.models.city import DEFAULT_CITY_ID


class FinanceTransactionType(str, enum.Enum):
    income = "income"
    expense = "expense"


class FinanceTransaction(Base):
    __tablename__ = "finance_transactions"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    city_id = Column(String, ForeignKey("cities.id"), nullable=False, default=DEFAULT_CITY_ID)
    occurred_on = Column(Date, nullable=False, default=date.today)
    transaction_type = Column(SAEnum(FinanceTransactionType), nullable=False)
    category = Column(String, nullable=False)
    amount_cents = Column(Integer, nullable=False)
    payment_method = Column(String, nullable=True)
    vendor_customer = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    lead_id = Column(String, ForeignKey("leads.id"), nullable=True)
    created_by = Column(String, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))

    lead = relationship("Lead", lazy="select")
