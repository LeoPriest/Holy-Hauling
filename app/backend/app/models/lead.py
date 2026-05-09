from __future__ import annotations

import uuid
import enum
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, Date, DateTime, Enum as SAEnum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.database import Base
from app.models.city import DEFAULT_CITY_ID


class LeadSourceType(str, enum.Enum):
    thumbtack_api = "thumbtack_api"
    thumbtack_screenshot = "thumbtack_screenshot"
    yelp_screenshot = "yelp_screenshot"
    google_screenshot = "google_screenshot"
    website_form = "website_form"
    manual = "manual"


class LeadStatus(str, enum.Enum):
    new = "new"
    in_review = "in_review"
    replied = "replied"
    waiting_on_customer = "waiting_on_customer"
    ready_for_quote = "ready_for_quote"
    ready_for_booking = "ready_for_booking"
    escalated = "escalated"
    booked = "booked"
    released = "released"
    lost = "lost"


class ServiceType(str, enum.Enum):
    moving = "moving"
    hauling = "hauling"
    both = "both"
    unknown = "unknown"


class Lead(Base):
    __tablename__ = "leads"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    city_id = Column(String, ForeignKey("cities.id"), nullable=False, default=DEFAULT_CITY_ID)
    source_type = Column(SAEnum(LeadSourceType), nullable=False)
    source_reference_id = Column(String, nullable=True)  # provider's external ID (e.g. Thumbtack lead ID)
    raw_payload = Column(Text, nullable=True)
    status = Column(SAEnum(LeadStatus), nullable=False, default=LeadStatus.new)
    urgency_flag = Column(Boolean, nullable=False, default=False)
    # Null until confirmed by OCR or the facilitator (ingest stubs start without a name)
    customer_name = Column(String, nullable=True)
    customer_phone = Column(String, nullable=True)
    service_type = Column(SAEnum(ServiceType), nullable=False, default=ServiceType.unknown)
    job_location = Column(String, nullable=True)
    job_date_requested = Column(Date, nullable=True)
    job_date_end = Column(String, nullable=True)  # range end; ISO date string
    notes = Column(Text, nullable=True)
    ingested_by = Column(String, nullable=True)
    assigned_to = Column(String, nullable=True)
    # Slice 7: origin/destination (moving), scope summary, field provenance
    job_origin = Column(String, nullable=True)
    job_destination = Column(String, nullable=True)
    scope_notes = Column(Text, nullable=True)
    # JSON dict: {field_name: "ocr" | "edited"} — absence means manually entered
    field_sources = Column(Text, nullable=True)
    # Slice 8: move-specific operational fields
    move_distance_miles = Column(Float, nullable=True)
    load_stairs = Column(Integer, nullable=True)
    unload_stairs = Column(Integer, nullable=True)
    move_size_label = Column(String, nullable=True)   # studio / 1 bedroom apartment / etc.
    move_type = Column(String, nullable=True)          # labor_only / customer_truck / etc.
    move_date_options = Column(Text, nullable=True)    # JSON array of date strings
    # Thumbtack Accept-and-Pay flag — informational, no workflow side-effects
    accept_and_pay = Column(Boolean, nullable=False, default=False)
    # Facilitator-entered supplemental notes fed into AI review for quoting accuracy
    quote_context = Column(Text, nullable=True)
    quoted_price_total = Column(Float, nullable=True)
    quote_modifiers = Column(Text, nullable=True)

    # Confirmed physical address — entered when job is booked; triggers status → booked
    job_address = Column(String, nullable=True)
    appointment_time_slot = Column(String, nullable=True)
    estimated_job_duration_minutes = Column(Integer, nullable=True)

    # Job phase timestamps — set as supervisor/crew advance through the workflow
    dispatched_at = Column(DateTime, nullable=True)  # office dispatches crew
    en_route_at = Column(DateTime, nullable=True)    # crew leaves for job site
    arrived_at = Column(DateTime, nullable=True)     # crew on site, pre-start
    started_at = Column(DateTime, nullable=True)     # work begins
    google_calendar_event_id = Column(String, nullable=True)

    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    acknowledged_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))

    events = relationship(
        "LeadEvent",
        back_populates="lead",
        order_by="LeadEvent.created_at",
        lazy="select",
        cascade="all, delete-orphan",
    )
    screenshots = relationship(
        "Screenshot",
        back_populates="lead",
        order_by="Screenshot.created_at",
        lazy="select",
        cascade="all, delete-orphan",
    )
    ai_reviews = relationship(
        "AiReview",
        back_populates="lead",
        order_by="AiReview.created_at",
        lazy="select",
        cascade="all, delete-orphan",
    )
