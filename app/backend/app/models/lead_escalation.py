from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, String, Text

from app.database import Base

# String-valued vocabularies (validated in Pydantic; stored as plain strings)
LEVELS = ("monitor", "pause", "owner_takeover")
SOURCES = ("manual", "auto_idle")
STATUSES = ("open", "resolved")
OUTCOMES = ("approved", "adjusted", "owner_takeover", "release", "need_more_info")


class LeadEscalation(Base):
    __tablename__ = "lead_escalations"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    lead_id = Column(String, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False)
    level = Column(String, nullable=False)            # monitor | pause | owner_takeover
    source = Column(String, nullable=False)           # manual | auto_idle
    decision_needed = Column(String, nullable=False)
    summary = Column(Text, nullable=False)
    raised_by = Column(String, nullable=True)
    raised_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    status = Column(String, nullable=False, default="open")   # open | resolved
    outcome = Column(String, nullable=True)
    resolution_note = Column(Text, nullable=True)
    resolved_by = Column(String, nullable=True)
    resolved_at = Column(DateTime, nullable=True)
