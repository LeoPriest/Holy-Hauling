"""
AI Lead Review Engine.

Assembles a normalized context snapshot from the lead record and any available
OCR extraction results, grounds the prompt in Holy Hauling SOPs, then calls
Claude to generate the locked A–O internal review structure (15 sections).

The model and grounding file are fully env-configurable — no version strings
or file paths are hardcoded.
"""

from __future__ import annotations

import hashlib
import json
import os
from typing import Optional

import anthropic
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai_review import AiReview
from app.models.lead import Lead
from app.models.ocr_result import OcrResult
from app.models.screenshot import Screenshot
from app.schemas.ai_review import AiReviewOut, AiReviewSections
from app.services.lead_service import _id, _now

# ---------------------------------------------------------------------------
# Built-in grounding fallback — used when AI_GROUNDING_FILE is not set.
# Replace with your real SOP doc via the env var.
# ---------------------------------------------------------------------------
_BUILTIN_GROUNDING = """
## Holy Hauling — Core Operating Rules

### Services
- Moving: quote by crew size × hours + truck + materials
- Hauling: quote by estimated load volume + disposal fees
- Moving ≠ Hauling — never mix pricing models

### Gate Workflow
- Gate 0: triage — is this lead viable?
- Gate 1: initial contact and basic qualification
- Gate 2A: needs alignment (scope, date, budget)
- Gate 2B: commitment ready — close toward booking
- Outcome: book / release / escalate

### Contact Protocol
- Always call first; text is a follow-up tool only
- First contact target: within 1 hour of lead arrival
- If no answer: leave brief voicemail, follow with text

### Release Criteria (releasing is a valid success)
- Out-of-range location
- Timeline misalignment
- Scope outside our services
- Budget gap too large to bridge

### Escalation Criteria
- Unclear or oversized job scope
- Difficult or unresponsive customer
- Pricing dispute beyond facilitator authority
- Legal/liability concerns

### Pricing Band (internal only)
A band is the expected price range for a job category and scope level.
- Moving bands: small (1–2 rooms) ~$350–$550; medium (3–4 rooms) ~$600–$900; large (5+ rooms / commercial) $950+
- Hauling bands: quarter load ~$175–$225; half load ~$325–$375; full load ~$500–$600; add disposal fees

### Band Position (internal only)
Where within the band this lead falls — Low / Mid / High — based on scope complexity,
access difficulty, distance, stairs, specialty items (piano, safe, fragile art), and timeline urgency.

### Main Friction Points (internal only)
The 1–3 issues most likely to cause the customer to stall, object, or shop around.
Examples: price sensitivity, tight timeline, unclear scope, out-of-area concerns.

### Sayability Check (internal only)
A brief judgment on whether the facilitator can confidently state a price range on the first call
without a site visit. "Yes — quote $X–$Y" / "Partial — give range pending stair/access confirmation"
/ "No — assessment required first."

### Quote Style (internal only)
How to frame the number to the customer: Flat / Range / Estimate / Assessment-required.
Choose the style that minimizes sticker shock while keeping the commitment accurate.

### Quote Source Label (internal only)
What to tell the customer about where the number comes from.
Examples: "Our standard rate for jobs like this", "Based on what you described", "Subject to on-site confirmation".

### Internal Pricing Guidance (internal only)
Synthesized recommendation: the specific dollar figure or range the facilitator should
use on this call, the band and position driving it, and any adjustments to apply before quoting.
Never share this section verbatim with the customer.
""".strip()

_SYSTEM_PROMPT_TEMPLATE = """
You are the AI Lead Review Engine for Holy Hauling, a moving and junk hauling company.

Your job is to help the lead handler (facilitator) make fast, accurate decisions.
You support facilitator judgment — you do not auto-commit or make promises.
Sections F through L are strictly internal pricing/control data and must never be shared with the customer.

[HOLY HAULING SOPs]
{grounding}

Generate the A–O internal review. Return ONLY a valid JSON object with exactly these 15 keys.
No markdown, no code blocks, no text outside the JSON:
{{
  "a_next_message": "...",
  "b_call_plan": "...",
  "c_behavior_class": "...",
  "d_transport_path": "...",
  "e_escalation_note": "...",
  "f_pricing_band": "...",
  "g_band_position": "...",
  "h_friction_points": "...",
  "i_sayability_check": "...",
  "j_quote_style": "...",
  "k_quote_source_label": "...",
  "l_pricing_guidance": "...",
  "m_quick_read": "...",
  "n_pattern_anchor": "...",
  "o_branch_replies": "..."
}}
""".strip()

_USER_TEMPLATE = """
LEAD DATA:
{lead_json}
{ocr_section}
Run the A–O review for this lead.
""".strip()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _require_api_key() -> str:
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not key:
        raise HTTPException(503, "ANTHROPIC_API_KEY not configured")
    return key


def _require_model() -> str:
    model = os.environ.get("AI_REVIEW_MODEL", "")
    if not model:
        raise HTTPException(503, "AI_REVIEW_MODEL not configured — set the AI_REVIEW_MODEL environment variable")
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


def _load_grounding() -> tuple[str, str]:
    """Return (grounding_content, grounding_source_label).

    Raises 503 if AI_GROUNDING_FILE is set but the file cannot be read —
    this prevents silent fallback to the stub when a real SOP is expected.
    """
    path = os.environ.get("AI_GROUNDING_FILE", "")
    if path:
        try:
            content = open(path, encoding="utf-8").read().strip()
            return content, os.path.basename(path)
        except OSError as exc:
            raise HTTPException(
                503,
                f"AI_GROUNDING_FILE is set but cannot be read: {path!r} — {exc}",
            ) from exc
    return _BUILTIN_GROUNDING, "built-in"


def _prompt_version(grounding: str) -> str:
    """SHA-256[:8] of grounding + template. Updates whenever either changes."""
    raw = (grounding + _SYSTEM_PROMPT_TEMPLATE).encode()
    return hashlib.sha256(raw).hexdigest()[:8]


def _build_input_snapshot(
    lead: Lead,
    screenshots: list[Screenshot],
    merged_ocr_fields: list[dict],
) -> dict:
    return {
        "lead_fields": {
            "id": lead.id,
            "customer_name": lead.customer_name,
            "customer_phone": lead.customer_phone,
            "service_type": lead.service_type.value,
            "job_location": lead.job_location,
            "job_date_requested": str(lead.job_date_requested) if lead.job_date_requested else None,
            "source_type": lead.source_type.value,
            "status": lead.status.value,
            "urgency_flag": lead.urgency_flag,
            "notes": lead.notes,
            "assigned_to": lead.assigned_to,
        },
        "screenshot_ids": [s.id for s in screenshots],
        "ocr_extracted_fields": merged_ocr_fields,
    }


_LEGACY_KEY_MAP = {
    # old A–H key → new A–O key
    "a_quick_read": "m_quick_read",
    "b_contact_strategy": "n_pattern_anchor",
    "c_gate_decisions": "c_behavior_class",
    "d_next_message": "a_next_message",
    "e_call_plan": "b_call_plan",
    "f_branch_replies": "o_branch_replies",
    "g_pricing_posture": "l_pricing_guidance",
    "h_escalation_notes": "e_escalation_note",
}


def _to_out(review: AiReview) -> AiReviewOut:
    try:
        sections = AiReviewSections.model_validate_json(review.sections_json)
    except ValidationError:
        # Legacy A–H record — map old keys to new A–O equivalents; unmapped fields get "".
        raw = json.loads(review.sections_json)
        remapped: dict[str, str] = {}
        for old_key, new_key in _LEGACY_KEY_MAP.items():
            remapped[new_key] = raw.get(old_key, "")
        # Fill any remaining A–O keys that had no legacy equivalent
        all_ao_keys = [
            "a_next_message", "b_call_plan", "c_behavior_class", "d_transport_path",
            "e_escalation_note", "f_pricing_band", "g_band_position", "h_friction_points",
            "i_sayability_check", "j_quote_style", "k_quote_source_label", "l_pricing_guidance",
            "m_quick_read", "n_pattern_anchor", "o_branch_replies",
        ]
        for key in all_ao_keys:
            remapped.setdefault(key, "")
        sections = AiReviewSections.model_validate(remapped)

    return AiReviewOut(
        id=review.id,
        lead_id=review.lead_id,
        model_used=review.model_used,
        prompt_version=review.prompt_version,
        grounding_source=review.grounding_source,
        sections=sections,
        input_snapshot=json.loads(review.input_snapshot_json),
        created_at=review.created_at,
        actor=review.actor,
    )


# ---------------------------------------------------------------------------
# Service functions
# ---------------------------------------------------------------------------

async def trigger_review(
    db: AsyncSession,
    lead_id: str,
    actor: Optional[str] = None,
) -> AiReviewOut:
    """Generate and store an AI review for the lead. Returns the validated result."""
    api_key = _require_api_key()
    model = _require_model()

    # Verify lead exists
    lead_result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = lead_result.scalar_one_or_none()
    if not lead:
        raise HTTPException(404, "Lead not found")

    # Gather screenshots and merge OCR extracted fields (latest value wins per field)
    ss_result = await db.execute(
        select(Screenshot).where(Screenshot.lead_id == lead_id)
    )
    screenshots = list(ss_result.scalars().all())

    merged_ocr: dict[str, dict] = {}  # field_name → {field, value, confidence}
    done_ids = [s.id for s in screenshots if s.ocr_status == "done"]
    if done_ids:
        ocr_result = await db.execute(
            select(OcrResult).where(OcrResult.screenshot_id.in_(done_ids))
        )
        for ocr in ocr_result.scalars().all():
            if ocr.extracted_fields:
                for entry in json.loads(ocr.extracted_fields):
                    merged_ocr[entry["field"]] = entry
    merged_ocr_fields = list(merged_ocr.values())

    # Build input snapshot
    snapshot = _build_input_snapshot(lead, screenshots, merged_ocr_fields)

    # Load grounding
    grounding_content, grounding_source = _load_grounding()
    version = _prompt_version(grounding_content)

    # Build prompts
    system_prompt = _SYSTEM_PROMPT_TEMPLATE.format(grounding=grounding_content)
    lead_json = json.dumps(snapshot["lead_fields"], indent=2)
    ocr_section = ""
    if merged_ocr_fields:
        ocr_section = "\nEXTRACTED FROM SCREENSHOT(S):\n" + json.dumps(merged_ocr_fields, indent=2)
    user_content = _USER_TEMPLATE.format(lead_json=lead_json, ocr_section=ocr_section)

    # Call Claude
    try:
        client = _make_client(api_key)
        response = await client.messages.create(
            model=model,
            max_tokens=2048,
            system=system_prompt,
            messages=[{"role": "user", "content": user_content}],
        )
        raw = _strip_fence(response.content[0].text)
    except HTTPException:
        raise
    except Exception as exc:
        import logging as _logging
        _logging.getLogger(__name__).exception("AI review call failed")
        raise HTTPException(502, f"AI review call failed: {exc}") from exc

    # Validate A–H structure — raises 502 on missing keys or bad JSON
    try:
        parsed = json.loads(raw)
        sections = AiReviewSections.model_validate(parsed)
    except (json.JSONDecodeError, ValidationError) as exc:
        raise HTTPException(502, f"AI returned an invalid A–O structure: {exc}") from exc

    # Persist
    review = AiReview(
        id=_id(),
        lead_id=lead_id,
        model_used=model,
        prompt_version=version,
        grounding_source=grounding_source,
        sections_json=sections.model_dump_json(),
        input_snapshot_json=json.dumps(snapshot),
        created_at=_now(),
        actor=actor,
    )
    db.add(review)
    await db.commit()
    await db.refresh(review)

    return _to_out(review)


async def get_latest_review(db: AsyncSession, lead_id: str) -> AiReviewOut:
    """Return the most recent AI review for the lead, or 404."""
    lead_result = await db.execute(select(Lead).where(Lead.id == lead_id))
    if not lead_result.scalar_one_or_none():
        raise HTTPException(404, "Lead not found")

    result = await db.execute(
        select(AiReview)
        .where(AiReview.lead_id == lead_id)
        .order_by(AiReview.created_at.desc())
        .limit(1)
    )
    review = result.scalar_one_or_none()
    if not review:
        raise HTTPException(404, "No AI review found for this lead — run a review first")

    return _to_out(review)
