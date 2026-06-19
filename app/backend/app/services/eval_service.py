"""
Quote-grounding eval (item 3 of the self-learning roadmap).

Joins the latest quote-suggestion provenance per lead to finalized outcomes,
splits into grounded vs ungrounded cohorts, and reports win rate, pricing
accuracy, and pricing bias. Pure read.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.lead_outcome import LeadOutcome
from app.models.quote_suggestion_log import QuoteSuggestionLog
from app.schemas.eval import CohortMetrics, QuoteGroundingEval


async def _latest_logs_by_lead(db: AsyncSession, city_id: str | None) -> dict:
    # Loads the city's logs and dedups to the latest-per-lead in Python. The logs
    # table is append-only, so if it ever grows past ~50k rows this should move to a
    # DB-side window function (row_number over lead_id ordered by created_at desc).
    stmt = select(QuoteSuggestionLog)
    if city_id:
        stmt = stmt.where(QuoteSuggestionLog.city_id == city_id)
    latest: dict = {}
    for row in (await db.execute(stmt)).scalars().all():
        cur = latest.get(row.lead_id)
        if cur is None or row.created_at > cur.created_at:
            latest[row.lead_id] = row
    return latest


async def _finalized_outcomes_by_lead(db: AsyncSession, city_id: str | None) -> dict:
    stmt = select(LeadOutcome).where(LeadOutcome.finalized.is_(True))
    if city_id:
        stmt = stmt.where(LeadOutcome.city_id == city_id)
    return {row.lead_id: row for row in (await db.execute(stmt)).scalars().all()}


def _cohort_metrics(pairs: list[tuple[QuoteSuggestionLog, LeadOutcome]]) -> CohortMetrics:
    """pairs: list of (log, outcome)."""
    n = len(pairs)
    won = sum(1 for _, o in pairs if o.conversion == "won")
    lost = sum(1 for _, o in pairs if o.conversion == "lost")
    win_rate = (won / (won + lost)) if (won + lost) > 0 else None

    priced = [
        (log, o) for log, o in pairs
        if o.conversion == "won"
        and o.realized_revenue_cents not in (None, 0)  # exclude $0 sale (divide-by-zero guard)
        and log.suggested_price_cents is not None
    ]
    priced_n = len(priced)
    if priced_n > 0:
        accuracy = sum(
            abs(log.suggested_price_cents - o.realized_revenue_cents) / o.realized_revenue_cents
            for log, o in priced
        ) / priced_n
        bias = sum(
            (log.suggested_price_cents - o.realized_revenue_cents) / o.realized_revenue_cents
            for log, o in priced
        ) / priced_n
    else:
        accuracy = None
        bias = None

    return CohortMetrics(
        n=n, win_rate=win_rate, priced_n=priced_n,
        pricing_accuracy=accuracy, pricing_bias=bias,
    )


async def compute_quote_grounding_eval(db: AsyncSession, city_id: str | None = None) -> QuoteGroundingEval:
    logs = await _latest_logs_by_lead(db, city_id)
    outcomes = await _finalized_outcomes_by_lead(db, city_id)

    grounded: list = []
    ungrounded: list = []
    for lead_id, log in logs.items():
        outcome = outcomes.get(lead_id)
        if outcome is None:
            continue  # not yet evaluable
        (grounded if log.was_grounded else ungrounded).append((log, outcome))

    return QuoteGroundingEval(
        grounded=_cohort_metrics(grounded),
        ungrounded=_cohort_metrics(ungrounded),
    )
