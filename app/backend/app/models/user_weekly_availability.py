from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import relationship

from app.database import Base

# Period buckets for a weekday block (labels only — no specific hours)
PERIODS = ("morning", "afternoon", "evening")


class UserWeeklyAvailability(Base):
    __tablename__ = "user_weekly_availability"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "weekday", "period",
            name="uq_user_weekly_availability_user_weekday_period",
        ),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    weekday = Column(String, nullable=False)
    period = Column(String, nullable=False)  # morning | afternoon | evening
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="weekly_availability_entries")
