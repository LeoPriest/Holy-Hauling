from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, Text

from app.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ThumbtackConnection(Base):
    """One row per webhook created in the Thumbtack pro dashboard."""

    __tablename__ = "thumbtack_connections"

    id = Column(String, primary_key=True, default=_uuid)
    label = Column(String, nullable=False)
    # The pin: every event from this connection belongs to this city.
    city_id = Column(String, ForeignKey("cities.id"), nullable=False)
    business = Column(String, nullable=False)        # 'holy_hauling' | 'holy_handy'
    # Learned from the first payload's business.businessID; not known at create time.
    business_id = Column(String, nullable=True)
    # Basic-auth username Thumbtack sends, when it can send one.
    auth_username = Column(String, nullable=True, unique=True)
    auth_secret_hash = Column(String, nullable=True)
    # Unguessable path segment. This is the primary identifier for an inbound request.
    url_token = Column(String, nullable=False, unique=True)
    is_active = Column(Boolean, nullable=False, default=True)
    last_event_at = Column(DateTime, nullable=True)
    last_error_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=_now)


class ThumbtackWebhookEvent(Base):
    """Capture-first ledger. Every accepted request lands here before it is parsed."""

    __tablename__ = "thumbtack_webhook_events"

    id = Column(String, primary_key=True, default=_uuid)
    connection_id = Column(
        String, ForeignKey("thumbtack_connections.id", ondelete="CASCADE"), nullable=False
    )
    kind = Column(String, nullable=False)            # lead | message | review | unknown
    external_id = Column(String, nullable=True)      # leadID / messageID / reviewID
    raw_body = Column(Text, nullable=False)          # verbatim request body
    # received | processed | duplicate | orphaned | failed | ignored
    status = Column(String, nullable=False, default="received")
    error = Column(Text, nullable=True)
    lead_id = Column(String, ForeignKey("leads.id", ondelete="SET NULL"), nullable=True)
    received_at = Column(DateTime, nullable=False, default=_now)
    processed_at = Column(DateTime, nullable=True)
