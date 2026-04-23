from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import relationship

from app.database import Base


class OcrResult(Base):
    __tablename__ = "ocr_results"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    screenshot_id = Column(String, ForeignKey("screenshots.id"), nullable=False, unique=True)
    # Raw visible text extracted from the image
    raw_text = Column(Text, nullable=True)
    # Structured lead fields extracted as a JSON array of {field, value, confidence}
    extracted_fields = Column(Text, nullable=True)
    model_used = Column(String, nullable=True)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))

    screenshot = relationship("Screenshot", back_populates="ocr_result")
