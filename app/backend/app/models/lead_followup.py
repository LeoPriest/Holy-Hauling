from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, Text

from app.database import Base


class LeadFollowup(Base):
    __tablename__ = "lead_followups"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    lead_id = Column(String, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True)
    scheduled_at = Column(DateTime, nullable=False)  # naive UTC
    note = Column(Text, nullable=True)
    fired = Column(Boolean, nullable=False, default=False)
    created_by = Column(String, nullable=True)  # username
    created_at = Column(
        DateTime,
        nullable=False,
        default=lambda: datetime.now(timezone.utc).replace(tzinfo=None),
    )
