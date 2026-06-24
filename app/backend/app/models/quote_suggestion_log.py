from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text

from app.database import Base


class QuoteSuggestionLog(Base):
    """Append-only provenance of each AI quote suggestion (item 3 capture)."""

    __tablename__ = "quote_suggestion_logs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    lead_id = Column(String, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False)
    city_id = Column(String, nullable=False)
    was_grounded = Column(Boolean, nullable=False, default=False)
    comparables_count = Column(Integer, nullable=False, default=0)
    suggested_price_cents = Column(Integer, nullable=True)
    model_used = Column(String, nullable=True)
    comparables_json = Column(Text, nullable=True)  # JSON-serialized list of ComparableOut the draft anchored on
    rationale = Column(Text, nullable=True)          # the AI's rationale for the draft
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
