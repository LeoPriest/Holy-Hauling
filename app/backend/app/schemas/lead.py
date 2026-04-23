from __future__ import annotations

import json
from datetime import date, datetime
from typing import Any, Optional

from pydantic import BaseModel, field_validator, model_validator

from app.models.lead import LeadSourceType, LeadStatus, ServiceType

_SOURCE_LABELS: dict[str, str] = {
    "thumbtack_api":        "Thumbtack API",
    "thumbtack_screenshot": "Thumbtack Screenshot",
    "yelp_screenshot":      "Yelp Screenshot",
    "google_screenshot":    "Google Screenshot",
    "website_form":         "Website Form",
    "manual":               "Manual Entry",
}


class LeadCreate(BaseModel):
    source_type: LeadSourceType
    source_reference_id: Optional[str] = None
    raw_payload: Optional[str] = None
    customer_name: str
    customer_phone: Optional[str] = None
    service_type: ServiceType = ServiceType.unknown
    job_location: Optional[str] = None
    job_origin: Optional[str] = None
    job_destination: Optional[str] = None
    job_date_requested: Optional[date] = None
    scope_notes: Optional[str] = None
    # Intake notes — initial context recorded at lead creation
    notes: Optional[str] = None
    assigned_to: Optional[str] = None
    urgency_flag: bool = False
    # Slice 8
    move_distance_miles: Optional[float] = None
    load_stairs: Optional[int] = None
    unload_stairs: Optional[int] = None
    move_size_label: Optional[str] = None
    move_type: Optional[str] = None
    move_date_options: Optional[list[str]] = None
    accept_and_pay: bool = False


class LeadUpdate(BaseModel):
    """Partial update for mutable lead fields. Only supplied fields are written.
    For operational notes logged during live handling, use POST /leads/{id}/notes."""
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    service_type: Optional[ServiceType] = None
    job_location: Optional[str] = None
    job_origin: Optional[str] = None
    job_destination: Optional[str] = None
    job_date_requested: Optional[date] = None
    scope_notes: Optional[str] = None
    urgency_flag: Optional[bool] = None
    assigned_to: Optional[str] = None
    # Intake notes only — corrections to initial context, not live handling updates
    notes: Optional[str] = None
    # Slice 8 / 9
    move_distance_miles: Optional[float] = None
    load_stairs: Optional[int] = None
    unload_stairs: Optional[int] = None
    move_size_label: Optional[str] = None
    move_type: Optional[str] = None
    move_date_options: Optional[list[str]] = None
    quote_context: Optional[str] = None


class NoteCreate(BaseModel):
    """Operational note appended to the lead event log during live handling."""
    body: str
    actor: Optional[str] = None


class LeadStatusUpdate(BaseModel):
    status: LeadStatus
    actor: Optional[str] = None
    note: Optional[str] = None


class LeadEventOut(BaseModel):
    id: str
    lead_id: str
    event_type: str
    from_status: Optional[str]
    to_status: Optional[str]
    actor: Optional[str]
    note: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


class ScreenshotOut(BaseModel):
    id: str
    lead_id: str
    original_filename: str
    stored_path: str  # relative path; prefix with /uploads/ to build URL
    file_size: int
    ocr_status: Optional[str] = None
    # "intake" = original ingest screenshot; "correspondence" = customer messages
    screenshot_type: str = "intake"
    created_at: datetime

    model_config = {"from_attributes": True}


class LeadOut(BaseModel):
    id: str
    source_type: LeadSourceType
    source_reference_id: Optional[str]
    raw_payload: Optional[str]
    status: LeadStatus
    urgency_flag: bool
    # None for ingest stubs not yet confirmed by OCR or the facilitator
    customer_name: Optional[str]
    customer_phone: Optional[str]
    service_type: ServiceType
    job_location: Optional[str]
    job_origin: Optional[str] = None
    job_destination: Optional[str] = None
    job_date_requested: Optional[date]
    scope_notes: Optional[str] = None
    # JSON dict: {field_name: "ocr" | "edited"} — parsed by the router; absence = manual
    field_sources: Optional[dict[str, Any]] = None
    notes: Optional[str]
    assigned_to: Optional[str]
    created_at: datetime
    acknowledged_at: Optional[datetime]
    updated_at: datetime
    # Slice 8 / 9
    move_distance_miles: Optional[float] = None
    load_stairs: Optional[int] = None
    unload_stairs: Optional[int] = None
    move_size_label: Optional[str] = None
    move_type: Optional[str] = None
    move_date_options: Optional[list[str]] = None
    accept_and_pay: bool = False
    quote_context: Optional[str] = None
    # Computed — not stored; maps source_type to human-readable label
    source_category_label: str = ""

    model_config = {"from_attributes": True}

    @field_validator("field_sources", mode="before")
    @classmethod
    def _parse_field_sources(cls, v: Any) -> Any:
        """field_sources is stored as a JSON string in the DB; deserialize it here."""
        if isinstance(v, str):
            try:
                return json.loads(v)
            except (ValueError, TypeError):
                return None
        return v

    @field_validator("move_date_options", mode="before")
    @classmethod
    def _parse_move_date_options(cls, v: Any) -> Any:
        """move_date_options is stored as a JSON array string in the DB; deserialize it here."""
        if isinstance(v, str):
            try:
                return json.loads(v)
            except (ValueError, TypeError):
                return None
        return v

    @model_validator(mode="after")
    def _set_source_label(self) -> "LeadOut":
        key = self.source_type.value if hasattr(self.source_type, "value") else str(self.source_type)
        self.source_category_label = _SOURCE_LABELS.get(key, key)
        return self


class LeadDetailOut(LeadOut):
    events: list[LeadEventOut] = []
    screenshots: list[ScreenshotOut] = []
