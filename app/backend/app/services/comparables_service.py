"""
Structured comparable-outcome retrieval (item 2 of the self-learning roadmap).

Given a lead, returns the most similar same-city finalized past outcomes (won +
lost) by a deterministic attribute-similarity score over each outcome's frozen
`scope_snapshot`. No embeddings - explainable and dependency-free. Consumed by
quote_service to anchor the AI's price on real local results.
"""

from __future__ import annotations

import json
import logging

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.lead import Lead
from app.models.lead_outcome import LeadOutcome
from app.schemas.quote_suggestion import ComparableOut

_log = logging.getLogger(__name__)


def _score(lead: Lead, snap: dict) -> int:
    """Attribute-similarity score; higher = more similar. Missing fields score 0."""
    score = 0

    ls, cs = lead.move_size_label, snap.get("move_size_label")
    if ls and cs and ls == cs:
        score += 3

    ld, cd = lead.move_distance_miles, snap.get("move_distance_miles")
    if ld is not None and cd is not None:
        diff = abs(ld - cd)
        if diff <= 5:
            score += 2
        elif diff <= 20:
            score += 1

    lt, ct = lead.move_type, snap.get("move_type")
    if lt and ct and lt == ct:
        score += 1

    lead_has = lead.load_stairs is not None or lead.unload_stairs is not None
    comp_has = snap.get("load_stairs") is not None or snap.get("unload_stairs") is not None
    if lead_has and comp_has:
        lsum = (lead.load_stairs or 0) + (lead.unload_stairs or 0)
        csum = (snap.get("load_stairs") or 0) + (snap.get("unload_stairs") or 0)
        if abs(lsum - csum) <= 1:
            score += 1

    return score


async def find_comparables(db: AsyncSession, lead: Lead, limit: int = 5) -> list[ComparableOut]:
    """Top-N most similar same-city finalized outcomes (won + lost) for pricing."""
    service_type = lead.service_type.value if lead.service_type else None
    if service_type is None:
        return []

    rows = (await db.execute(
        select(LeadOutcome).where(
            LeadOutcome.city_id == lead.city_id,
            LeadOutcome.finalized.is_(True),
            LeadOutcome.conversion.in_(("won", "lost")),
            LeadOutcome.lead_id != lead.id,
            or_(
                LeadOutcome.realized_revenue_cents.isnot(None),
                LeadOutcome.quoted_price_cents.isnot(None),
            ),
        )
    )).scalars().all()

    scored: list[tuple[int, float, ComparableOut]] = []
    for row in rows:
        try:
            snap = json.loads(row.scope_snapshot) if row.scope_snapshot else {}
        except (json.JSONDecodeError, TypeError):
            continue  # malformed snapshot - skip, never crash retrieval
        if not isinstance(snap, dict) or snap.get("service_type") != service_type:
            continue  # hard service_type filter

        if row.realized_revenue_cents is not None:
            price_cents, basis = row.realized_revenue_cents, "realized"
        else:
            price_cents, basis = row.quoted_price_cents, "quoted"

        comp = ComparableOut(
            lead_id=row.lead_id,
            conversion=row.conversion,
            price_cents=price_cents,
            price_basis=basis,
            score=_score(lead, snap),
            move_size_label=snap.get("move_size_label"),
            move_distance_miles=snap.get("move_distance_miles"),
            move_type=snap.get("move_type"),
        )
        recency = row.completed_at.timestamp() if row.completed_at is not None else float("-inf")
        scored.append((comp.score, recency, comp))

    scored.sort(key=lambda t: (t[0], t[1]), reverse=True)
    return [comp for _, _, comp in scored[:limit]]
