from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import relationship

from app.database import Base


class AiReview(Base):
    __tablename__ = "ai_reviews"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    lead_id = Column(String, ForeignKey("leads.id"), nullable=False)
    model_used = Column(String, nullable=False)
    # SHA-256[:8] of grounding content + prompt template; changes when either changes
    prompt_version = Column(String, nullable=False)
    # Filename of grounding doc used, or "built-in"
    grounding_source = Column(String, nullable=True)
    # Validated A–H sections as a serialized JSON object
    sections_json = Column(Text, nullable=False)
    # Normalized lead fields + OCR data used to generate this review (JSON)
    input_snapshot_json = Column(Text, nullable=False)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    actor = Column(String, nullable=True)

    lead = relationship("Lead", back_populates="ai_reviews")
