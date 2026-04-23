from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

_CONTEXT_UPDATE_RE = re.compile(r'\[CONTEXT_UPDATE\](.*?)\[/CONTEXT_UPDATE\]', re.DOTALL)

import anthropic
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai_review import AiReview
from app.models.lead import Lead
from app.models.lead_chat_message import LeadChatMessage
from app.services.ai_review_service import _load_grounding


def _make_client(api_key: str) -> anthropic.AsyncAnthropic:
    return anthropic.AsyncAnthropic(api_key=api_key)


def _build_system_prompt(lead: Lead, latest_review: Optional[AiReview]) -> str:
    grounding_content, _ = _load_grounding()

    parts = [
        f"Service: {lead.service_type.value}",
        f"Customer: {lead.customer_name or 'Unknown'}",
    ]
    if lead.job_origin or lead.job_destination:
        parts.append(f"Moving: {lead.job_origin or '?'} → {lead.job_destination or '?'}")
    elif lead.job_location:
        parts.append(f"Location: {lead.job_location}")
    if lead.job_date_requested:
        parts.append(f"Date: {lead.job_date_requested}")
    if lead.move_size_label:
        parts.append(f"Move size: {lead.move_size_label}")
    if lead.move_type:
        parts.append(f"Move type: {lead.move_type}")
    if lead.move_distance_miles is not None:
        parts.append(f"Distance: {lead.move_distance_miles} miles")
    if lead.load_stairs is not None:
        parts.append(f"Load stairs: {lead.load_stairs} flights")
    if lead.unload_stairs is not None:
        parts.append(f"Unload stairs: {lead.unload_stairs} flights")
    if lead.scope_notes:
        parts.append(f"Scope notes: {lead.scope_notes}")
    if lead.quote_context:
        parts.append(f"Facilitator context: {lead.quote_context}")

    lead_summary = "\n".join(parts)

    pricing_context = ""
    if latest_review:
        s = json.loads(latest_review.sections_json)
        pricing_context = (
            "\n\nCURRENT AI PRICING ASSESSMENT (internal):\n"
            f"F - Pricing Band: {s.get('f_pricing_band', '—')}\n"
            f"G - Band Position: {s.get('g_band_position', '—')}\n"
            f"H - Friction Points: {s.get('h_friction_points', '—')}\n"
            f"I - Sayability: {s.get('i_sayability_check', '—')}\n"
            f"J - Quote Style: {s.get('j_quote_style', '—')}\n"
            f"K - Source Label: {s.get('k_quote_source_label', '—')}\n"
            f"L - Internal Guidance: {s.get('l_pricing_guidance', '—')}"
        )

    return (
        "You are a pricing coach for Holy Hauling, a moving and junk hauling company. "
        "The facilitator is reviewing a live lead and wants to challenge or refine the AI pricing assessment. "
        "Respond in 2–4 sentences. Be direct and specific — give dollar ranges when you can. "
        "This is an internal tool; never write as if speaking to the customer.\n\n"
        "If this conversation reveals new operational details that were not already in the lead data "
        "(e.g. stairs count, elevator type, heavy or specialty items, building access issues, "
        "wrapping needs, confirmed dates), append a context block at the very end of your response:\n"
        "[CONTEXT_UPDATE]\n"
        "<1-2 sentences of new scope context for the AI review re-run>\n"
        "[/CONTEXT_UPDATE]\n"
        "Only include this block when there is genuinely new, specific scope information. "
        "Omit it when answering general pricing questions or when no new scope details were shared.\n\n"
        f"HOLY HAULING SOPs:\n{grounding_content}\n\n"
        f"CURRENT LEAD:\n{lead_summary}"
        f"{pricing_context}"
    )


async def get_messages(db: AsyncSession, lead_id: str) -> list[LeadChatMessage]:
    lead_result = await db.execute(select(Lead).where(Lead.id == lead_id))
    if not lead_result.scalar_one_or_none():
        raise HTTPException(404, "Lead not found")

    result = await db.execute(
        select(LeadChatMessage)
        .where(LeadChatMessage.lead_id == lead_id)
        .order_by(LeadChatMessage.created_at)
    )
    return list(result.scalars().all())


async def send_message(
    db: AsyncSession,
    lead_id: str,
    message: str,
    ai_review_id: Optional[str] = None,
) -> tuple[list[LeadChatMessage], Optional[str]]:
    lead_result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = lead_result.scalar_one_or_none()
    if not lead:
        raise HTTPException(404, "Lead not found")

    review_result = await db.execute(
        select(AiReview)
        .where(AiReview.lead_id == lead_id)
        .order_by(AiReview.created_at.desc())
        .limit(1)
    )
    latest_review = review_result.scalar_one_or_none()

    history_result = await db.execute(
        select(LeadChatMessage)
        .where(LeadChatMessage.lead_id == lead_id)
        .order_by(LeadChatMessage.created_at)
    )
    history = list(history_result.scalars().all())

    user_msg = LeadChatMessage(
        id=str(uuid.uuid4()),
        lead_id=lead_id,
        ai_review_id=ai_review_id,
        role="user",
        content=message,
        created_at=datetime.now(timezone.utc),
    )
    db.add(user_msg)
    await db.flush()

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise HTTPException(503, "ANTHROPIC_API_KEY not configured")

    model = os.environ.get("AI_REVIEW_MODEL", "claude-haiku-4-5-20251001")
    client = _make_client(api_key)
    system = _build_system_prompt(lead, latest_review)
    chat_messages = [{"role": m.role, "content": m.content} for m in history]
    chat_messages.append({"role": "user", "content": message})

    try:
        response = await client.messages.create(
            model=model,
            max_tokens=600,
            system=system,
            messages=chat_messages,
        )
        raw_reply = response.content[0].text
    except Exception as exc:
        raise HTTPException(502, f"Chat AI call failed: {exc}") from exc

    # Extract context update block before saving — keep stored content clean
    match = _CONTEXT_UPDATE_RE.search(raw_reply)
    quote_context_update: Optional[str] = None
    if match:
        quote_context_update = match.group(1).strip()
        raw_reply = _CONTEXT_UPDATE_RE.sub('', raw_reply).strip()

    assistant_msg = LeadChatMessage(
        id=str(uuid.uuid4()),
        lead_id=lead_id,
        ai_review_id=ai_review_id,
        role="assistant",
        content=raw_reply,
        created_at=datetime.now(timezone.utc),
    )
    db.add(assistant_msg)
    await db.commit()

    return [user_msg, assistant_msg], quote_context_update
