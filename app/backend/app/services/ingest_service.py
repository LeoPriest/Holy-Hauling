"""
Unified lead ingest pipeline.

Two intake paths, one Lead model:
  1. Screenshot ingest  — upload image → create stub → auto-run OCR → auto-apply high-confidence fields
  2. Thumbtack webhook  — normalize payload → dedup by source_reference_id → create lead

Both produce a Lead with source_type and flow into the same queue.
"""

from __future__ import annotations

import json
import os
from datetime import date
from typing import Optional

from fastapi import HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.lead import Lead, LeadSourceType, LeadStatus, ServiceType
from app.models.lead_event import LeadEvent
from app.schemas.ingest import (
    IngestResult,
    ThumbTackLead,
    ThumbTackWebhookPayload,
    WebhookIngestResult,
)
from app.schemas.lead import LeadDetailOut, LeadOut
from app.schemas.ocr import OcrResultOut
from app.services import lead_service, ocr_service

# Fields eligible for silent auto-apply when OCR confidence is "high"
_AUTO_APPLY_FIELDS = {
    "customer_name", "customer_phone", "job_location",
    "service_type",
}

_SCREENSHOT_SOURCE_TYPES = {
    LeadSourceType.thumbtack_screenshot,
    LeadSourceType.yelp_screenshot,
    LeadSourceType.google_screenshot,
}

_THUMBTACK_CATEGORY_MAP: dict[str, ServiceType] = {
    "moving": ServiceType.moving,
    "local moving": ServiceType.moving,
    "long distance moving": ServiceType.moving,
    "junk removal": ServiceType.hauling,
    "hauling": ServiceType.hauling,
    "junk hauling": ServiceType.hauling,
}


def _coerce_field(field: str, raw: str):
    """Coerce OCR string values to the correct Python types for Lead fields."""
    if field == "job_date_requested":
        try:
            return date.fromisoformat(raw)
        except (ValueError, AttributeError):
            return None
    if field == "service_type":
        try:
            return ServiceType(raw)
        except ValueError:
            return None
    return raw  # customer_name, customer_phone, job_location → plain str


async def ingest_screenshot(
    db: AsyncSession,
    file: UploadFile,
    source_type: LeadSourceType,
    actor: Optional[str] = None,
    actor_role: Optional[str] = None,
) -> IngestResult:
    """
    Create a lead stub from a screenshot, run OCR, and auto-apply high-confidence fields.
    The stub has customer_name=None — the facilitator fills it in the review step.
    OCR failure is silent: the lead is still created, extraction=None in the response.
    """
    if source_type not in _SCREENSHOT_SOURCE_TYPES:
        raise HTTPException(400, f"source_type must be a screenshot source, got: {source_type}")

    # 1. Create lead stub — no customer name yet
    stub = Lead(
        id=lead_service._id(),
        source_type=source_type,
        customer_name=None,
        service_type=ServiceType.unknown,
        status=LeadStatus.new,
        urgency_flag=False,
        ingested_by=actor,
        created_at=lead_service._now(),
        updated_at=lead_service._now(),
    )
    db.add(stub)
    db.add(LeadEvent(
        id=lead_service._id(), lead_id=stub.id,
        event_type="created", to_status=LeadStatus.new.value,
        actor=actor,
    ))
    await db.commit()
    await db.refresh(stub)

    # 2. Save image file (reuses lead_service validation + storage)
    screenshot = await lead_service.upload_screenshot(db, stub.id, file)

    # 3. Run OCR if configured — silent failure, lead already created
    extraction: Optional[OcrResultOut] = None
    auto_applied: list[str] = []
    if os.environ.get("ANTHROPIC_API_KEY") and os.environ.get("OCR_MODEL"):
        try:
            ocr_orm = await ocr_service.trigger_extraction(db, stub.id, screenshot.id)
            extraction = OcrResultOut.model_validate(ocr_orm)

            # 4. Auto-apply high-confidence fields
            if extraction.extracted_fields:
                for entry in json.loads(extraction.extracted_fields):
                    field = entry.get("field")
                    if entry.get("confidence") != "high" or field not in _AUTO_APPLY_FIELDS:
                        continue
                    value = _coerce_field(field, entry.get("value", ""))
                    if value is not None:
                        setattr(stub, field, value)
                        auto_applied.append(field)

                if auto_applied:
                    stub.updated_at = lead_service._now()
                    db.add(LeadEvent(
                        id=lead_service._id(), lead_id=stub.id,
                        event_type="field_updated",
                        note=", ".join(auto_applied),
                        actor="ocr_ingest",
                    ))
                    await db.commit()
                    await db.refresh(stub)
        except Exception:
            pass  # OCR failed — lead and screenshot are already persisted, continue

    if actor_role == "facilitator" and stub.acknowledged_at is None:
        db.add(lead_service._apply_acknowledgement(stub, actor=actor))
        await db.commit()
        await db.refresh(stub)

    # 5. Load detailed lead (includes screenshot + events) for response
    detailed_orm = await lead_service.get_lead(db, stub.id, detailed=True)
    detailed = LeadDetailOut.model_validate(detailed_orm)

    return IngestResult(lead=detailed, extraction=extraction, auto_applied_fields=auto_applied)


def _normalize_thumbtack(tt: ThumbTackLead) -> dict:
    """Map Thumbtack lead fields to Holy Hauling Lead model fields."""
    customer = tt.customer
    request = tt.request
    location = request.location if request else None

    loc_parts = [p for p in [
        location.city if location else None,
        location.state if location else None,
    ] if p]
    job_location = ", ".join(loc_parts) or (location.zipCode if location else None) or None

    job_date: Optional[date] = None
    if request and request.serviceDate and request.serviceDate.startDate:
        try:
            job_date = date.fromisoformat(request.serviceDate.startDate)
        except ValueError:
            pass

    category = (request.category or "").lower() if request else ""
    service_type = _THUMBTACK_CATEGORY_MAP.get(category, ServiceType.unknown)

    return {
        "customer_name": customer.name if customer else None,
        "customer_phone": customer.phone if customer else None,
        "job_location": job_location,
        "job_date_requested": job_date,
        "service_type": service_type,
        "notes": request.description if request else None,
    }


async def ingest_thumbtack_webhook(
    db: AsyncSession,
    payload: ThumbTackWebhookPayload,
) -> WebhookIngestResult:
    """
    Normalize a Thumbtack webhook event into a lead.
    Non-lead events return immediately (200, no lead created).
    Duplicate leadIDs return the existing lead without creating a new record.
    """
    if payload.event != "lead.created" or payload.lead is None:
        return WebhookIngestResult(message=f"Event '{payload.event}' — no lead created")

    tt = payload.lead

    # Dedup: if this leadID already exists as a thumbtack_api lead, return existing
    existing_result = await db.execute(
        select(Lead).where(
            Lead.source_type == LeadSourceType.thumbtack_api,
            Lead.source_reference_id == tt.leadID,
        )
    )
    existing = existing_result.scalar_one_or_none()
    if existing:
        return WebhookIngestResult(
            lead=LeadOut.model_validate(existing),
            created=False,
            was_duplicate=True,
        )

    norm = _normalize_thumbtack(tt)
    lead = Lead(
        id=lead_service._id(),
        source_type=LeadSourceType.thumbtack_api,
        source_reference_id=tt.leadID,
        raw_payload=payload.model_dump_json(),
        status=LeadStatus.new,
        urgency_flag=False,
        ingested_by="thumbtack_webhook",
        created_at=lead_service._now(),
        updated_at=lead_service._now(),
        **{k: v for k, v in norm.items() if v is not None},
    )
    db.add(lead)
    db.add(LeadEvent(
        id=lead_service._id(), lead_id=lead.id,
        event_type="created", to_status=LeadStatus.new.value,
        actor="thumbtack_webhook",
    ))
    await db.commit()
    await db.refresh(lead)

    return WebhookIngestResult(
        lead=LeadOut.model_validate(lead),
        created=True,
        was_duplicate=False,
    )
