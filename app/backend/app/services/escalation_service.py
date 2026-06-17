"""
Escalation overlay service.

Escalation is modeled as a resolvable overlay on a lead, independent of the
pipeline status. A lead has at most one open escalation at a time. The AI
summary reuses ai_review_service's client/grounding helpers, mirroring
quote_service.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai_review import AiReview
from app.models.lead import Lead
from app.models.lead_escalation import LeadEscalation
from app.models.lead_event import LeadEvent
from app.services.ai_review_service import (
    _load_grounding,
    _make_client,
    _require_api_key,
    _require_model,
)

_log = logging.getLogger(__name__)

_SYSTEM_PROMPT_TEMPLATE = """
You are the Escalation Assistant for Holy Hauling, a moving and junk hauling company.
A lead handler is escalating a lead to the owner for a decision. Using the lead scope
and any prior AI review below, write a concise Escalation Summary in exactly this format:

Lead type: <moving | hauling>
Customer request: <what they want right now>
Scope as understood: <short summary>
Access/risk: <stairs, elevator, heavy items, dump burden, etc.>
AI posture: <pricing posture / escalation notes from the review, or "none">
Decision needed: <price | schedule | truck | release | owner takeover>

Be specific and brief. Do not invent facts not present in the scope. Output only the summary.

[HOLY HAULING SOPs]
{grounding}
""".strip()


def _build_scope(lead: Lead) -> str:
    fields = {
        "service_type": lead.service_type.value if lead.service_type else None,
        "job_location": lead.job_location,
        "job_origin": lead.job_origin,
        "job_destination": lead.job_destination,
        "move_size_label": lead.move_size_label,
        "move_type": lead.move_type,
        "move_distance_miles": lead.move_distance_miles,
        "load_stairs": lead.load_stairs,
        "unload_stairs": lead.unload_stairs,
        "scope_notes": lead.scope_notes,
        "quote_context": lead.quote_context,
        "current_status": lead.status.value if lead.status else None,
    }
    return "\n".join(f"{k}: {v}" for k, v in fields.items() if v is not None)


async def _latest_ai_posture(db: AsyncSession, lead_id: str) -> str:
    result = await db.execute(
        select(AiReview).where(AiReview.lead_id == lead_id).order_by(AiReview.created_at.desc()).limit(1)
    )
    review = result.scalar_one_or_none()
    if not review:
        return ""
    import json
    try:
        sections = json.loads(review.sections_json)
    except (json.JSONDecodeError, TypeError):
        return ""
    # Real A-O keys: l_pricing_guidance, e_escalation_note, b_call_plan
    keys = ["l_pricing_guidance", "e_escalation_note", "b_call_plan"]
    lines = [f"{k}: {sections[k]}" for k in keys if sections.get(k)]
    return ("\nPRIOR AI REVIEW:\n" + "\n".join(lines)) if lines else ""


async def get_open(db: AsyncSession, lead_id: str) -> LeadEscalation | None:
    result = await db.execute(
        select(LeadEscalation)
        .where(LeadEscalation.lead_id == lead_id, LeadEscalation.status == "open")
        .order_by(LeadEscalation.raised_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def suggest_summary(db: AsyncSession, lead: Lead) -> str:
    """Assemble an AI Escalation Summary. Raises HTTPException(503) if AI unconfigured."""
    api_key = _require_api_key()
    model = _require_model()
    grounding_content, _ = _load_grounding()
    system_prompt = _SYSTEM_PROMPT_TEMPLATE.format(grounding=grounding_content)
    user_content = "LEAD SCOPE:\n" + _build_scope(lead) + await _latest_ai_posture(db, lead.id)
    try:
        client = _make_client(api_key)
        response = await client.messages.create(
            model=model,
            max_tokens=512,
            system=system_prompt,
            messages=[{"role": "user", "content": user_content}],
        )
        return response.content[0].text.strip()
    except HTTPException:
        raise
    except Exception as exc:
        _log.exception("Escalation summary call failed")
        raise HTTPException(502, f"Escalation summary call failed: {exc}") from exc


async def _notify(db: AsyncSession, roles: list[str], message: str, city_id: str) -> None:
    try:
        from app.services.push_service import send_push_to_roles
        await send_push_to_roles(db, roles, message, city_id=city_id)
    except Exception as exc:  # push is best-effort, never blocks the flow
        _log.warning("escalation push failed: %s", exc)


async def raise_escalation(
    db: AsyncSession,
    lead: Lead,
    *,
    level: str,
    decision_needed: str,
    summary: str,
    source: str = "manual",
    raised_by: str | None = None,
) -> LeadEscalation:
    """Open an escalation. If one is already open, return it unchanged (idempotent)."""
    existing = await get_open(db, lead.id)
    if existing:
        return existing

    esc = LeadEscalation(
        id=str(uuid.uuid4()),
        lead_id=lead.id,
        level=level,
        source=source,
        decision_needed=decision_needed,
        summary=summary,
        raised_by=raised_by,
        raised_at=datetime.now(timezone.utc),
        status="open",
    )
    db.add(esc)
    db.add(LeadEvent(
        id=str(uuid.uuid4()),
        lead_id=lead.id,
        event_type="escalation_raised",
        actor=raised_by or source,
        note=f"{level} — {decision_needed}",
    ))
    await db.commit()
    await db.refresh(esc)
    await _notify(db, ["admin", "supervisor"], f'Lead escalated ({level}) — {decision_needed}', lead.city_id)
    return esc


async def resolve_escalation(
    db: AsyncSession,
    escalation_id: str,
    *,
    outcome: str,
    resolution_note: str | None,
    resolved_by: str | None,
) -> LeadEscalation:
    result = await db.execute(select(LeadEscalation).where(LeadEscalation.id == escalation_id))
    esc = result.scalar_one_or_none()
    if esc is None:
        raise HTTPException(404, "Escalation not found")
    if esc.status != "open":
        raise HTTPException(409, "Escalation is already resolved")

    esc.status = "resolved"
    esc.outcome = outcome
    esc.resolution_note = resolution_note
    esc.resolved_by = resolved_by
    esc.resolved_at = datetime.now(timezone.utc)
    db.add(LeadEvent(
        id=str(uuid.uuid4()),
        lead_id=esc.lead_id,
        event_type="escalation_resolved",
        actor=resolved_by,
        note=f"{outcome}" + (f" — {resolution_note}" if resolution_note else ""),
    ))
    await db.commit()
    await db.refresh(esc)

    result = await db.execute(select(Lead).where(Lead.id == esc.lead_id))
    lead = result.scalar_one_or_none()
    if lead:
        await _notify(db, ["facilitator"], f'Escalation resolved: {outcome}', lead.city_id)
    return esc


async def open_auto_escalation(db: AsyncSession, lead: Lead) -> LeadEscalation | None:
    """Called by the idle ladder at T2. Best-effort AI summary; static fallback."""
    if await get_open(db, lead.id):
        return None
    try:
        summary = await suggest_summary(db, lead)
    except Exception:
        summary = "Idle past threshold — review. (auto-raised by the alert ladder)"
    return await raise_escalation(
        db, lead,
        level="monitor",
        decision_needed="review",
        summary=summary,
        source="auto_idle",
        raised_by="alert_scheduler",
    )
