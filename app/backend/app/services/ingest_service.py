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
    # Lead cost + competition
    "lead_cost_total", "lead_cost_gross", "lead_cost_bonus",
    "pros_contacted", "pros_responded",
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


# A phone's photo picker will happily let you select thirty images by accident,
# and every one is a separate paid vision call. Refuse rather than truncate.
MAX_INTAKE_SCREENSHOTS = 5


def _resolved_value(field: str, raw: str):
    """The value a field would actually be written as, or None if uncoercible.

    Conflict detection compares THIS, not the raw text. "$36.24" and "36.24"
    are the same number; treating them as a disagreement would fire the warning
    constantly and teach the operator to ignore it.
    """
    coerced = ocr_service.coerce_extracted_field(field, raw)
    if coerced is not None:
        return coerced          # (column_name, value)
    value = _coerce_field(field, raw)
    if value is not None:
        return (field, value)
    return None


def _merge_high_confidence(
    extractions: list[OcrResultOut],
) -> tuple[dict[str, tuple[str, object]], list[str]]:
    """Fold every extraction's high-confidence fields into one set of writes.

    Returns (writes, conflicts). `writes` maps the OCR field name to the
    (column, value) pair to set. `conflicts` lists fields where the screenshots
    resolved to different values — those are deliberately NOT written.
    """
    seen: dict[str, list[tuple[str, object]]] = {}

    for extraction in extractions:
        if not extraction.extracted_fields:
            continue
        for entry in json.loads(extraction.extracted_fields):
            field = entry.get("field")
            if entry.get("confidence") != "high" or field not in _AUTO_APPLY_FIELDS:
                continue
            resolved = _resolved_value(field, entry.get("value", ""))
            if resolved is None:
                continue
            seen.setdefault(field, []).append(resolved)

    writes: dict[str, tuple[str, object]] = {}
    conflicts: list[str] = []
    for field, resolved_values in seen.items():
        distinct = {v for v in resolved_values}
        if len(distinct) > 1:
            conflicts.append(field)
            continue
        writes[field] = resolved_values[0]

    return writes, conflicts


async def ingest_screenshot(
    db: AsyncSession,
    files: list[UploadFile],
    source_type: LeadSourceType,
    actor: Optional[str] = None,
    actor_role: Optional[str] = None,
    city_id: str | None = None,
) -> IngestResult:
    """
    Create one lead stub from one or more screenshots of the SAME lead, run OCR
    on each, and auto-apply high-confidence fields the screenshots agree on.

    The stub has customer_name=None — the facilitator fills it in the review step.
    OCR failure is silent per screenshot: the lead and every image are still
    created, and any shot that did read still contributes its fields.
    """
    if source_type not in _SCREENSHOT_SOURCE_TYPES:
        raise HTTPException(400, f"source_type must be a screenshot source, got: {source_type}")
    if len(files) > MAX_INTAKE_SCREENSHOTS:
        raise HTTPException(
            400,
            f"Too many screenshots: {len(files)}. "
            f"At most {MAX_INTAKE_SCREENSHOTS} can be ingested as one lead.",
        )

    # 1. Create lead stub — no customer name yet
    stub = Lead(
        id=lead_service._id(),
        city_id=city_id,
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

    # 2. Save every image (reuses lead_service validation + storage), then OCR each.
    #    A failed extraction loses only that shot's fields, never the lead.
    extractions: list[OcrResultOut] = []
    ocr_enabled = bool(os.environ.get("ANTHROPIC_API_KEY") and os.environ.get("OCR_MODEL"))

    for upload in files:
        screenshot = await lead_service.upload_screenshot(db, stub.id, upload, city_id=city_id)
        if not ocr_enabled:
            continue
        try:
            ocr_orm = await ocr_service.trigger_extraction(db, stub.id, screenshot.id)
            extractions.append(OcrResultOut.model_validate(ocr_orm))
        except Exception:
            continue  # this shot did not read; the others still count

    # 3. Apply only what the screenshots agree on
    writes, conflicts = _merge_high_confidence(extractions)
    auto_applied: list[str] = []
    for column, value in writes.values():
        setattr(stub, column, value)
        auto_applied.append(column)

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

    if conflicts:
        # Recorded on the lead's timeline so the disagreement survives the
        # response being dismissed.
        db.add(LeadEvent(
            id=lead_service._id(), lead_id=stub.id,
            event_type="field_conflict",
            note="screenshots disagreed: " + ", ".join(sorted(conflicts)),
            actor="ocr_ingest",
        ))
        await db.commit()

    if actor_role == "facilitator" and stub.acknowledged_at is None:
        db.add(lead_service._apply_acknowledgement(stub, actor=actor))
        await db.commit()
        await db.refresh(stub)

    # 4. Load detailed lead (includes screenshots + events) for response
    detailed_orm = await lead_service.get_lead(db, stub.id, detailed=True)
    detailed = LeadDetailOut.model_validate(detailed_orm)

    return IngestResult(
        lead=detailed,
        extractions=extractions,
        auto_applied_fields=auto_applied,
        conflicts=sorted(conflicts),
    )


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
    city_id: str,
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
            Lead.city_id == city_id,
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
        city_id=city_id,
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
