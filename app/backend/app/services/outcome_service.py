"""
Lead outcome layer.

Derives a stable, queryable `lead_outcome` row per lead — the decision-time
snapshot plus the real-world result (conversion, realized price, escalation).
Kept current by an idempotent reconciliation sweep; finalized rows are frozen.

This is item 1 of the self-learning roadmap. Items 2 (retrieval grounding) and
3 (eval) read these rows; this module does not consume them.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models.ai_review import AiReview
from app.models.city import City, DEFAULT_CITY_ID
from app.models.finance import FinanceTransaction, FinanceTransactionType
from app.models.lead import Lead, LeadStatus
from app.models.lead_escalation import LeadEscalation
from app.models.lead_event import LeadEvent
from app.models.lead_outcome import LeadOutcome

_log = logging.getLogger(__name__)

_TERMINAL = (LeadStatus.booked, LeadStatus.released, LeadStatus.lost)


def _naive(dt: datetime) -> datetime:
    """Drop tzinfo so naive (SQLite) and tz-aware datetimes can be subtracted."""
    return dt.replace(tzinfo=None) if dt.tzinfo is not None else dt


def _conversion_and_terminal(lead: Lead) -> tuple[str, str] | None:
    """(conversion, terminal_status) for a terminal-ish lead, else None."""
    if lead.status in (LeadStatus.booked, LeadStatus.released):
        return "won", lead.status.value
    if lead.status == LeadStatus.lost:
        return "lost", lead.status.value
    return None


def _is_finalized(lead: Lead) -> bool:
    return lead.status in (LeadStatus.lost, LeadStatus.released)


def _quoted_price_cents(lead: Lead) -> int | None:
    if lead.quote_cents is not None:
        return lead.quote_cents
    if lead.quoted_price_total is not None:
        return round(lead.quoted_price_total * 100)
    return None


def _scope_snapshot(lead: Lead) -> str:
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
    }
    return json.dumps(fields)


async def _realized_amounts(db: AsyncSession, lead_id: str) -> tuple[int | None, int | None]:
    """(revenue_cents, cost_cents) from finance txns, or (None, None) when absent."""
    result = await db.execute(
        select(FinanceTransaction.transaction_type, func.sum(FinanceTransaction.amount_cents))
        .where(FinanceTransaction.lead_id == lead_id)
        .group_by(FinanceTransaction.transaction_type)
    )
    revenue: int | None = None
    cost: int | None = None
    for txn_type, total in result.all():
        if txn_type == FinanceTransactionType.income:
            revenue = int(total)
        elif txn_type == FinanceTransactionType.expense:
            cost = int(total)
    return revenue, cost


async def _escalation_fields(db: AsyncSession, lead_id: str) -> tuple[bool, str | None]:
    result = await db.execute(
        select(LeadEscalation)
        .where(LeadEscalation.lead_id == lead_id)
        .order_by(LeadEscalation.raised_at.desc())
    )
    escs = result.scalars().all()
    if not escs:
        return False, None
    outcome = next((e.outcome for e in escs if e.status == "resolved" and e.outcome), None)
    return True, outcome


async def _latest_prompt_version(db: AsyncSession, lead_id: str) -> str | None:
    result = await db.execute(
        select(AiReview.prompt_version)
        .where(AiReview.lead_id == lead_id)
        .order_by(AiReview.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _booked_completed_times(
    db: AsyncSession, lead: Lead
) -> tuple[datetime | None, datetime | None, int | None]:
    booked_at = (await db.execute(
        select(func.min(LeadEvent.created_at)).where(
            LeadEvent.lead_id == lead.id,
            LeadEvent.event_type == "status_changed",
            LeadEvent.to_status == "booked",
        )
    )).scalar_one_or_none()
    completed_at = (await db.execute(
        select(func.min(LeadEvent.created_at)).where(
            LeadEvent.lead_id == lead.id,
            LeadEvent.event_type == "status_changed",
            LeadEvent.to_status == "released",
        )
    )).scalar_one_or_none()
    ttb = None
    if booked_at is not None and lead.created_at is not None:
        # Normalize to naive UTC before subtracting — stored datetimes may come back
        # naive (SQLite) or tz-aware depending on how they were written; mixing raises.
        ttb = max(0, int((_naive(booked_at) - _naive(lead.created_at)).total_seconds() / 60))
    return booked_at, completed_at, ttb


async def upsert_outcome(db: AsyncSession, lead: Lead) -> LeadOutcome | None:
    """Compute and upsert the outcome row for a terminal-ish lead. Frozen if finalized."""
    conv = _conversion_and_terminal(lead)
    if conv is None:
        return None
    conversion, terminal_status = conv

    existing = (await db.execute(
        select(LeadOutcome).where(LeadOutcome.lead_id == lead.id)
    )).scalar_one_or_none()
    if existing is not None and existing.finalized:
        return existing  # frozen — preserve the decision-time snapshot

    revenue, cost = await _realized_amounts(db, lead.id)
    quoted = _quoted_price_cents(lead)
    delta = (revenue - quoted) if (revenue is not None and quoted is not None) else None
    was_esc, esc_outcome = await _escalation_fields(db, lead.id)
    booked_at, completed_at, ttb = await _booked_completed_times(db, lead)
    now = datetime.now(timezone.utc)

    values = dict(
        city_id=lead.city_id,
        conversion=conversion,
        terminal_status=terminal_status,
        quoted_price_cents=quoted,
        realized_revenue_cents=revenue,
        realized_cost_cents=cost,
        price_delta_cents=delta,
        was_escalated=was_esc,
        escalation_outcome=esc_outcome,
        scope_snapshot=_scope_snapshot(lead),
        ai_prompt_version=await _latest_prompt_version(db, lead.id),
        booked_at=booked_at,
        completed_at=completed_at,
        time_to_book_minutes=ttb,
        finalized=_is_finalized(lead),
        updated_at=now,
    )

    if existing is None:
        row = LeadOutcome(lead_id=lead.id, created_at=now, **values)
        db.add(row)
    else:
        for key, val in values.items():
            setattr(existing, key, val)
        row = existing
    await db.commit()
    await db.refresh(row)
    return row


async def reconcile_outcomes(db: AsyncSession, city_id: str = DEFAULT_CITY_ID) -> int:
    """Upsert outcome rows for terminal-ish leads in a city. Idempotent; frozen rows skipped."""
    leads = (await db.execute(
        select(Lead).where(Lead.city_id == city_id, Lead.status.in_(_TERMINAL))
    )).scalars().all()
    count = 0
    for lead in leads:
        try:
            existing = (await db.execute(
                select(LeadOutcome).where(LeadOutcome.lead_id == lead.id)
            )).scalar_one_or_none()
            if existing is not None and existing.finalized:
                continue
            await upsert_outcome(db, lead)
            count += 1
        except Exception as exc:  # best-effort per lead — never abort the sweep
            _log.warning("[outcome_reconciler] failed for lead %s: %s", lead.id, exc)
    return count


async def reconcile_all_outcomes() -> None:
    """Entry point for the scheduler and the startup backfill — own session, all active cities."""
    try:
        async with AsyncSessionLocal() as db:
            cities = (await db.execute(select(City).where(City.is_active == True))).scalars().all()
            for city in cities:
                try:
                    await reconcile_outcomes(db, city.id)
                except Exception as exc:  # one city's failure must not skip the rest
                    _log.warning("[outcome_reconciler] city %s failed: %s", city.id, exc)
                    await db.rollback()  # clear any dirtied state before the next city
    except Exception as exc:
        _log.error("[outcome_reconciler] error: %s", exc)
