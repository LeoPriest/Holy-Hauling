from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String

from app.database import Base


class LeadAlert(Base):
    __tablename__ = "lead_alerts"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    lead_id = Column(String, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False)
    tier = Column(Integer, nullable=False)        # 1 or 2
    channel = Column(String, nullable=False)      # 'sms' | 'email'
    sent_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    suppressed = Column(Boolean, nullable=False, default=False)
    lead_updated_at_snapshot = Column(DateTime, nullable=False)  # updated_at at send time
