import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Enum as SAEnum, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from app.database import Base


class PayType(str, enum.Enum):
    facilitator_pct = "facilitator_pct"
    hourly = "hourly"
    flat = "flat"


class PayRecord(Base):
    __tablename__ = "pay_records"
    __table_args__ = (UniqueConstraint("lead_id", "user_id", name="uq_pay_record_lead_user"),)

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    lead_id = Column(String, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    pay_type = Column(SAEnum(PayType), nullable=False)
    hours_worked = Column(Float, nullable=True)
    override_amount_cents = Column(Integer, nullable=True)
    amount_cents = Column(Integer, nullable=False)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))

    lead = relationship("Lead", back_populates="pay_records")
    user = relationship("User", back_populates="pay_records")
