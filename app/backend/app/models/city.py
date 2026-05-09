from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, String

from app.database import Base

DEFAULT_CITY_ID = "st-louis"
CHICAGO_CITY_ID = "chicago"

DEFAULT_CITIES = [
    {
        "id": DEFAULT_CITY_ID,
        "name": "St. Louis",
        "slug": "st-louis",
        "timezone": "America/Chicago",
    },
    {
        "id": CHICAGO_CITY_ID,
        "name": "Chicago",
        "slug": "chicago",
        "timezone": "America/Chicago",
    },
]


class City(Base):
    __tablename__ = "cities"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    slug = Column(String, nullable=False, unique=True)
    timezone = Column(String, nullable=False, default="America/Chicago")
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
