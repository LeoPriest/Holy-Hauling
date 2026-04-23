from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base


class Screenshot(Base):
    __tablename__ = "screenshots"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    lead_id = Column(String, ForeignKey("leads.id"), nullable=False)
    original_filename = Column(String, nullable=False)
    # Relative path from UPLOAD_DIR root, e.g. "screenshots/{uuid}.jpg"
    stored_path = Column(String, nullable=False)
    file_size = Column(Integer, nullable=False)
    # None = not started, "pending" = in progress, "done" = extracted, "failed" = error
    ocr_status = Column(String, nullable=True)
    # "intake" = original screenshot; "correspondence" = customer messages added later
    screenshot_type = Column(String, nullable=False, default="intake")
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))

    lead = relationship("Lead", back_populates="screenshots")
    ocr_result = relationship("OcrResult", back_populates="screenshot", uselist=False)
