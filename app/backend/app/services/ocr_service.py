"""
Screenshot/image extraction service.

Sends lead screenshots to a Claude vision model and extracts:
  - raw_text: all visible text from the image
  - extracted_fields: structured lead fields (name, phone, location, date, service type, notes)
    with per-field confidence ratings

The model is fully configurable via the OCR_MODEL env var — no model version is hardcoded.
"""

from __future__ import annotations

import base64
import json
import os
from datetime import date
from pathlib import Path
from typing import Optional

# Fields that carry provenance badges in the UI (keep in sync with lead_service._PROVENANCE_FIELDS)
_PROVENANCE_FIELDS = {
    "customer_name", "customer_phone", "service_type",
    "job_location", "job_origin", "job_destination",
    "job_date_requested", "scope_notes",
    # Slice 8
    "move_size_label", "move_type", "move_distance_miles",
    "load_stairs", "unload_stairs", "move_date_options",
}

import anthropic
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.lead import Lead, LeadStatus
from app.models.lead_event import LeadEvent
from app.models.ocr_result import OcrResult
from app.models.screenshot import Screenshot
from app.schemas.ocr import OcrApply
from app.services import lead_service

_EXTRACTION_PROMPT = """
You are analyzing a screenshot from a moving or hauling service lead platform (e.g. Thumbtack, Yelp, Google).

Extract the following from the image:
1. ALL visible text verbatim (raw_text)
2. Structured lead fields you can identify

Return ONLY a JSON object with this exact structure — no markdown, no extra text:
{
  "raw_text": "<all visible text from the image>",
  "fields": [
    {"field": "customer_name", "value": "...", "confidence": "high"},
    {"field": "customer_phone", "value": "...", "confidence": "medium"},
    {"field": "job_location", "value": "<general job location if no separate origin/destination>", "confidence": "high"},
    {"field": "job_origin", "value": "<moving FROM address or pickup location>", "confidence": "high"},
    {"field": "job_destination", "value": "<moving TO address or drop-off location>", "confidence": "medium"},
    {"field": "job_date_requested", "value": "YYYY-MM-DD", "confidence": "low"},
    {"field": "service_type", "value": "moving|hauling|both|unknown", "confidence": "high"},
    {"field": "scope_notes", "value": "<one focused sentence: stairs/elevator, large or heavy items, access/parking issues, assembly needs>", "confidence": "medium"},
    {"field": "notes", "value": "<customer description or additional context>", "confidence": "medium"},
    {"field": "move_size_label", "value": "studio|1 bedroom apartment|2 bedroom home|selective move", "confidence": "high"},
    {"field": "move_type", "value": "labor_only|customer_truck|rental_needed|pickup_truck_service", "confidence": "medium"},
    {"field": "move_distance_miles", "value": "<numeric miles, e.g. 12.5>", "confidence": "medium"},
    {"field": "load_stairs", "value": "<integer number of stair flights at origin, e.g. 2>", "confidence": "high"},
    {"field": "unload_stairs", "value": "<integer number of stair flights at destination, e.g. 0>", "confidence": "high"},
    {"field": "move_date_options", "value": "<comma-separated date options, e.g. 2025-06-01, 2025-06-08>", "confidence": "medium"},
    {"field": "accept_and_pay", "value": "true|false", "confidence": "high"}
  ]
}

Only include fields where you found evidence. Confidence: "high" = clearly stated, "medium" = inferred, "low" = uncertain.
For scope_notes: synthesize stairs/elevator info, bulky or heavy item clues, building/parking access friction, and assembly/disassembly needs into one concise operational sentence. Omit if nothing relevant is visible.
For accept_and_pay: return true only if you see "Accept and Pay" or similar payment-on-booking language clearly visible. Default false if absent.
""".strip()

_EXT_TO_MEDIA_TYPE: dict[str, str] = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}

_APPLICABLE_FIELDS = {
    "customer_name", "customer_phone",
    "job_location", "job_origin", "job_destination",
    "job_date_requested", "service_type",
    "scope_notes", "notes",
    # Slice 8
    "move_size_label", "move_type", "move_distance_miles",
    "load_stairs", "unload_stairs", "move_date_options",
    "accept_and_pay",
}


def _require_api_key() -> str:
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not key:
        raise HTTPException(503, "ANTHROPIC_API_KEY not configured")
    return key


def _require_model() -> str:
    model = os.environ.get("OCR_MODEL", "")
    if not model:
        raise HTTPException(503, "OCR_MODEL not configured — set the OCR_MODEL environment variable")
    return model


def _make_client(api_key: str) -> anthropic.AsyncAnthropic:
    return anthropic.AsyncAnthropic(api_key=api_key)


def _strip_fence(raw: str) -> str:
    """Strip markdown code fences Claude sometimes wraps JSON in despite prompt instructions."""
    raw = raw.strip()
    if raw.startswith("```"):
        lines = raw.splitlines()
        lines = lines[1:]  # drop opening fence line (```json or ```)
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        raw = "\n".join(lines).strip()
    return raw


async def _get_screenshot(db: AsyncSession, screenshot_id: str, lead_id: str) -> Screenshot:
    result = await db.execute(
        select(Screenshot).where(Screenshot.id == screenshot_id, Screenshot.lead_id == lead_id)
    )
    ss = result.scalar_one_or_none()
    if not ss:
        raise HTTPException(404, "Screenshot not found")
    return ss


async def trigger_extraction(db: AsyncSession, lead_id: str, screenshot_id: str) -> OcrResult:
    """Run image extraction on the screenshot and return the structured result."""
    api_key = _require_api_key()
    model = _require_model()

    ss = await _get_screenshot(db, screenshot_id, lead_id)
    ss.ocr_status = "pending"
    await db.commit()

    # Resolve image path: stored_path is relative to the uploads root (parent of SCREENSHOTS_DIR)
    uploads_dir = Path(lead_service.SCREENSHOTS_DIR).parent
    image_path = uploads_dir / ss.stored_path
    if not image_path.exists():
        ss.ocr_status = "failed"
        await db.commit()
        raise HTTPException(422, "Image file not found on disk")

    ext = Path(ss.stored_path).suffix.lower()
    media_type = _EXT_TO_MEDIA_TYPE.get(ext, "image/jpeg")
    b64_data = base64.standard_b64encode(image_path.read_bytes()).decode()

    try:
        client = _make_client(api_key)
        response = await client.messages.create(
            model=model,
            max_tokens=1024,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": b64_data,
                        },
                    },
                    {"type": "text", "text": _EXTRACTION_PROMPT},
                ],
            }],
        )
        raw_response = _strip_fence(response.content[0].text)
        parsed = json.loads(raw_response)
        raw_text: str = parsed.get("raw_text", "")
        fields_json: str = json.dumps(parsed.get("fields", []))
    except HTTPException:
        raise
    except Exception as exc:
        ss.ocr_status = "failed"
        await db.commit()
        raise HTTPException(502, f"Extraction failed: {exc}") from exc

    # Upsert: overwrite any prior result for this screenshot
    existing = await db.execute(select(OcrResult).where(OcrResult.screenshot_id == screenshot_id))
    ocr = existing.scalar_one_or_none()
    if ocr:
        ocr.raw_text = raw_text
        ocr.extracted_fields = fields_json
        ocr.model_used = model
        ocr.created_at = lead_service._now()
    else:
        ocr = OcrResult(
            id=lead_service._id(),
            screenshot_id=screenshot_id,
            raw_text=raw_text,
            extracted_fields=fields_json,
            model_used=model,
        )
        db.add(ocr)

    ss.ocr_status = "done"
    await db.commit()
    await db.refresh(ocr)
    return ocr


async def get_extraction_result(db: AsyncSession, lead_id: str, screenshot_id: str) -> OcrResult:
    """Return the existing extraction result for a screenshot."""
    await _get_screenshot(db, screenshot_id, lead_id)
    result = await db.execute(select(OcrResult).where(OcrResult.screenshot_id == screenshot_id))
    ocr = result.scalar_one_or_none()
    if not ocr:
        raise HTTPException(404, "No extraction result found — run extraction first")
    return ocr


async def apply_ocr_fields(
    db: AsyncSession,
    lead_id: str,
    screenshot_id: str,
    data: OcrApply,
) -> Lead:
    """Apply extracted fields to the lead and write an ocr_fields_applied event."""
    lead_result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = lead_result.scalar_one_or_none()
    if not lead:
        raise HTTPException(404, "Lead not found")

    await _get_screenshot(db, screenshot_id, lead_id)

    applied: list[str] = []
    for field, value in data.model_dump(exclude_unset=True).items():
        if field == "actor" or field not in _APPLICABLE_FIELDS:
            continue
        if value is None:
            continue

        # Skip masked/invalid phone values — same rule as manual PATCH
        if field == "customer_phone" and not lead_service._is_valid_phone(str(value)):
            continue

        # Special handling: move_date_options — convert to JSON array
        if field == "move_date_options":
            try:
                json.loads(value)  # already valid JSON — store as-is
            except (json.JSONDecodeError, ValueError, TypeError):
                dates = [d.strip() for d in str(value).split(",") if d.strip()]
                value = json.dumps(dates)
            setattr(lead, field, value)
            applied.append(field)
            continue

        setattr(lead, field, value)
        applied.append(field)

    if applied:
        lead.updated_at = lead_service._now()
        # Track provenance: mark applied fields as "ocr" in field_sources
        sources: dict = json.loads(lead.field_sources) if lead.field_sources else {}
        for f in applied:
            if f in _PROVENANCE_FIELDS:
                sources[f] = "ocr"
        lead.field_sources = json.dumps(sources)

        db.add(LeadEvent(
            id=lead_service._id(),
            lead_id=lead_id,
            event_type="ocr_fields_applied",
            note=", ".join(applied),
            actor=data.actor,
        ))
        await db.commit()
        await db.refresh(lead)
    return lead
