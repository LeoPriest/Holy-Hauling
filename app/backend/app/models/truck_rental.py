from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, Enum as SAEnum, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from app.database import Base


class TruckRentalStatus(str, enum.Enum):
    reserved = "reserved"
    confirmed = "confirmed"
    completed = "completed"


class TruckRental(Base):
    __tablename__ = "truck_rentals"
    __table_args__ = (UniqueConstraint("lead_id", name="uq_truck_rental_lead"),)

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    lead_id = Column(String, ForeignKey("leads.id"), nullable=False)
    status = Column(SAEnum(TruckRentalStatus), nullable=False, default=TruckRentalStatus.reserved)
    confirmation_number = Column(String, nullable=True)
    truck_size = Column(String, nullable=True)  # "10ft" / "15ft" / "20ft" / "26ft"
    pickup_location = Column(String, nullable=True)
    pickup_datetime = Column(DateTime, nullable=True)
    dropoff_datetime = Column(DateTime, nullable=True)
    rental_cost_cents = Column(Integer, nullable=True)  # dollars * 100
    one_way = Column(Boolean, nullable=False, default=False)
    estimated_miles = Column(Float, nullable=True)
    actual_miles = Column(Float, nullable=True)
    receipt_url = Column(String, nullable=True)  # relative path under UPLOADS_DIR, e.g. "receipts/{uuid}.jpg"
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))

    lead = relationship("Lead", lazy="select")
