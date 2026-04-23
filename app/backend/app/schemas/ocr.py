from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any, Optional

from pydantic import BaseModel, field_validator

from app.models.lead import ServiceType


class OcrResultOut(BaseModel):
    id: str
    screenshot_id: str
    # Raw visible text extracted from the image
    raw_text: Optional[str] = None
    # JSON string: array of {field, value, confidence} — parse client-side
    extracted_fields: Optional[str] = None
    model_used: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class OcrApply(BaseModel):
    """Fields from an extraction result to apply to the lead. Only supplied fields are written."""
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    job_location: Optional[str] = None
    job_origin: Optional[str] = None
    job_destination: Optional[str] = None
    job_date_requested: Optional[date] = None
    service_type: Optional[ServiceType] = None
    scope_notes: Optional[str] = None
    notes: Optional[str] = None
    # Slice 8
    move_size_label: Optional[str] = None
    move_type: Optional[str] = None
    move_distance_miles: Optional[float] = None
    load_stairs: Optional[int] = None
    unload_stairs: Optional[int] = None
    move_date_options: Optional[str] = None   # raw string from OCR; converted to JSON array on apply
    accept_and_pay: Optional[bool] = None
    actor: Optional[str] = None

    @field_validator("job_date_requested", mode="before")
    @classmethod
    def _coerce_date(cls, v: Any) -> Any:
        if v is None or isinstance(v, date):
            return v
        s = str(v).strip()
        if not s:
            return None
        try:
            return date.fromisoformat(s)
        except ValueError:
            return None

    @field_validator("move_distance_miles", mode="before")
    @classmethod
    def _coerce_float(cls, v: Any) -> Any:
        if v is None or isinstance(v, (int, float)):
            return v
        s = re.sub(r"[^\d.]", "", str(v))
        if not s:
            return None
        try:
            return float(s)
        except ValueError:
            return None

    @field_validator("load_stairs", "unload_stairs", mode="before")
    @classmethod
    def _coerce_int(cls, v: Any) -> Any:
        if v is None or isinstance(v, int):
            return v
        s = re.sub(r"[^\d]", "", str(v))
        if not s:
            return None
        try:
            return int(s)
        except ValueError:
            return None
