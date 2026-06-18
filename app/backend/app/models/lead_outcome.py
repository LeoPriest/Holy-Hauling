from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text

from app.database import Base

# String-valued vocabularies (validated in code; stored as plain strings).
# Only terminal leads get a row, so a stored conversion is always won or lost —
# non-terminal leads have no row at all (there is no persisted "pending").
CONVERSIONS = ("won", "lost")


class LeadOutcome(Base):
    __tablename__ = "lead_outcomes"

    lead_id = Column(String, ForeignKey("leads.id", ondelete="CASCADE"), primary_key=True)
    city_id = Column(String, nullable=False)
    conversion = Column(String, nullable=False)            # won | lost
    terminal_status = Column(String, nullable=False)       # booked | released | lost
    quoted_price_cents = Column(Integer, nullable=True)
    realized_revenue_cents = Column(Integer, nullable=True)
    realized_cost_cents = Column(Integer, nullable=True)
    price_delta_cents = Column(Integer, nullable=True)
    was_escalated = Column(Boolean, nullable=False, default=False)
    escalation_outcome = Column(String, nullable=True)
    scope_snapshot = Column(Text, nullable=True)           # JSON string of frozen scope fields
    ai_prompt_version = Column(String, nullable=True)
    booked_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    time_to_book_minutes = Column(Integer, nullable=True)
    finalized = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
