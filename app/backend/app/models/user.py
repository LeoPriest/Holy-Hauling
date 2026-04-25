from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, String
from sqlalchemy.orm import relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    username = Column(String, nullable=False, unique=True)
    credential_hash = Column(String, nullable=False)  # bcrypt hash; generic name allows password upgrade later
    role = Column(String, nullable=False)  # admin | facilitator | supervisor | crew
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    created_by = Column(String, nullable=True)  # user_id of admin who created this user
    email = Column(String, nullable=True)

    push_subscriptions = relationship(
        "PushSubscription", back_populates="user", cascade="all, delete-orphan", lazy="select"
    )
    availability_entries = relationship(
        "UserAvailability", back_populates="user", cascade="all, delete-orphan", lazy="select"
    )
    weekly_availability_entries = relationship(
        "UserWeeklyAvailability", back_populates="user", cascade="all, delete-orphan", lazy="select"
    )
