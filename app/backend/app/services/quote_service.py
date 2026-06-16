"""
AI Quote Drafting Engine.

Drafts a structured quote (total, line-item breakdown, duration) for a lead,
grounded in the Holy Hauling SOP plus the lead's scope and any prior AI pricing
review. The facilitator reviews and edits the draft before locking the booking.

Reuses the AI review engine's client/grounding/fence helpers so model and
grounding stay configured in one place.
"""

from __future__ import annotations

import json
import logging

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai_review import AiReview
from app.models.lead import Lead
from app.schemas.quote_suggestion import QuoteSuggestionOut
from app.services.ai_review_service import (
    _load_grounding,
    _make_client,
    _require_api_key,
    _require_model,
    _strip_fence,
)

_log = logging.getLogger(__name__)

_SYSTEM_PROMPT_TEMPLATE = """
You are the Quote Drafting Engine for Holy Hauling, a moving and junk hauling company.

Using the Holy Hauling SOP pricing rules and the lead's scope below, draft ONE
quote the facilitator can review and adjust. Return ONLY a valid JSON object with
exactly these keys — no markdown, no code fences, no text outside the JSON:
{{
  "quoted_price_total": <number>,
  "line_items": [{{"note": "<what this charge is for>", "amount": <number>}}],
  "estimated_duration_minutes": <integer>,
  "rationale": "<one or two sentences on how you arrived at this price>"
}}

Rules:
- line_items MUST sum exactly to quoted_price_total.
- The first line item is the base quote; add modifiers for stairs, distance,
  specialty items, or access difficulty only when the scope calls for them.
- Price within the SOP bands. Never invent services outside moving/hauling.
- estimated_duration_minutes is the on-site job length in minutes.

[HOLY HAULING SOPs]
{grounding}
""".strip()

_USER_TEMPLATE = """
LEAD SCOPE:
{scope_json}
{pricing_section}
Draft the quote for this lead.
""".strip()


def _build_scope(lead: Lead) -> dict:
    try:
        move_date_options = json.loads(lead.move_date_options) if lead.move_date_options else None
    except (json.JSONDecodeError, TypeError):
        move_date_options = lead.move_date_options
    return {
        "service_type": lead.service_type.value,
        "job_location": lead.job_location,
        "job_origin": lead.job_origin,
        "job_destination": lead.job_destination,
        "move_size_label": lead.move_size_label,
        "move_type": lead.move_type,
        "move_distance_miles": lead.move_distance_miles,
        "load_stairs": lead.load_stairs,
        "unload_stairs": lead.unload_stairs,
        "move_date_options": move_date_options,
        "scope_notes": lead.scope_notes,
        "quote_context": lead.quote_context,
    }


async def _latest_pricing_context(db: AsyncSession, lead_id: str) -> str:
    """Fold the latest AI review's pricing sections in as extra grounding, if present."""
    result = await db.execute(
        select(AiReview).where(AiReview.lead_id == lead_id).order_by(AiReview.created_at.desc()).limit(1)
    )
    review = result.scalar_one_or_none()
    if not review:
        return ""
    try:
        sections = json.loads(review.sections_json)
    except (json.JSONDecodeError, TypeError):
        return ""
    keys = ["f_pricing_band", "g_band_position", "l_pricing_guidance"]
    lines = [f"{key}: {sections[key]}" for key in keys if sections.get(key)]
    if not lines:
        return ""
    return "\nPRIOR AI PRICING GUIDANCE:\n" + "\n".join(lines)


async def suggest_quote(db: AsyncSession, lead_id: str) -> QuoteSuggestionOut:
    """Draft a structured quote for the lead. Returns the validated suggestion."""
    api_key = _require_api_key()
    model = _require_model()

    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    if not lead:
        raise HTTPException(404, "Lead not found")

    grounding_content, _ = _load_grounding()
    system_prompt = _SYSTEM_PROMPT_TEMPLATE.format(grounding=grounding_content)
    scope_json = json.dumps(_build_scope(lead), indent=2)
    pricing_section = await _latest_pricing_context(db, lead_id)
    user_content = _USER_TEMPLATE.format(scope_json=scope_json, pricing_section=pricing_section)

    try:
        client = _make_client(api_key)
        response = await client.messages.create(
            model=model,
            max_tokens=1024,
            system=system_prompt,
            messages=[{"role": "user", "content": user_content}],
        )
        raw = _strip_fence(response.content[0].text)
    except HTTPException:
        raise
    except Exception as exc:
        _log.exception("Quote suggestion call failed")
        raise HTTPException(502, f"Quote suggestion call failed: {exc}") from exc

    try:
        parsed = json.loads(raw)
        suggestion = QuoteSuggestionOut.model_validate(parsed)
    except (json.JSONDecodeError, ValidationError) as exc:
        raise HTTPException(502, f"AI returned an invalid quote structure: {exc}") from exc

    # Guarantee the breakdown is internally consistent (line items sum to total)
    # so the facilitator can book without manual reconciliation.
    if suggestion.line_items:
        summed = round(sum(item.amount for item in suggestion.line_items), 2)
        if round(suggestion.quoted_price_total, 2) != summed:
            suggestion = suggestion.model_copy(update={"quoted_price_total": summed})

    return suggestion
