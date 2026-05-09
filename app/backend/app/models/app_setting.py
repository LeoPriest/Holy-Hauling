from __future__ import annotations

from sqlalchemy import Column, ForeignKey, String

from app.database import Base
from app.models.city import DEFAULT_CITY_ID


class AppSetting(Base):
    __tablename__ = "app_settings"

    key = Column(String, primary_key=True)
    city_id = Column(String, ForeignKey("cities.id"), primary_key=True, default=DEFAULT_CITY_ID)
    value = Column(String, nullable=True)
