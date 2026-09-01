from __future__ import annotations

from typing import Optional

from pydantic import BaseModel

from app.schemas.lead import LeadDetailOut, LeadOut
from app.schemas.ocr import OcrResultOut


class IngestResult(BaseModel):
    """Response for POST /ingest/screenshot — lead created + OCR results if extraction ran."""
    lead: LeadDetailOut
    # One entry per screenshot that OCR successfully read. A shot whose
    # extraction failed simply has no entry; the lead and image are still kept.
    extractions: list[OcrResultOut] = []
    # Fields auto-applied to the lead from high-confidence OCR results
    auto_applied_fields: list[str] = []
    # Fields where the screenshots disagreed. Nothing is written for these —
    # a silently-wrong lead cost is worse than a blank one the operator fills in.
    conflicts: list[str] = []


class WebhookIngestResult(BaseModel):
    """Response for POST /ingest/webhook/thumbtack — idempotent."""
    lead: Optional[LeadOut] = None
    created: bool = False
    was_duplicate: bool = False
    message: Optional[str] = None


# ── Thumbtack webhook payload schema ──────────────────────────────────────────
# Matches Thumbtack's documented webhook format.
# TODO: enforce HMAC signature verification before production use.

class ThumbTackCustomer(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None


class ThumbTackServiceDate(BaseModel):
    startDate: Optional[str] = None
    endDate: Optional[str] = None


class ThumbTackLocation(BaseModel):
    city: Optional[str] = None
    state: Optional[str] = None
    zipCode: Optional[str] = None


class ThumbTackRequest(BaseModel):
    description: Optional[str] = None
    location: Optional[ThumbTackLocation] = None
    serviceDate: Optional[ThumbTackServiceDate] = None
    category: Optional[str] = None


class ThumbTackBudget(BaseModel):
    minBudget: Optional[float] = None
    maxBudget: Optional[float] = None


class ThumbTackBusiness(BaseModel):
    targetBudget: Optional[ThumbTackBudget] = None


class ThumbTackLead(BaseModel):
    leadID: str
    createTimestamp: Optional[str] = None
    customer: Optional[ThumbTackCustomer] = None
    request: Optional[ThumbTackRequest] = None
    business: Optional[ThumbTackBusiness] = None


class ThumbTackWebhookPayload(BaseModel):
    event: str
    lead: Optional[ThumbTackLead] = None
