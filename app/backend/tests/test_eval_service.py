"""Quote-grounding eval aggregation tests."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from app.models.lead_outcome import LeadOutcome
from app.models.quote_suggestion_log import QuoteSuggestionLog
from app.services.eval_service import compute_quote_grounding_eval

_CITY = "st-louis"
_NOW = datetime(2026, 6, 1, 12, 0, 0)


async def _log(db, lead_id, *, grounded, suggested=None, count=0, when=_NOW, city=_CITY):
    db.add(QuoteSuggestionLog(
        id=str(uuid.uuid4()), lead_id=lead_id, city_id=city,
        was_grounded=grounded, comparables_count=count,
        suggested_price_cents=suggested, model_used="m", created_at=when,
    ))
    await db.commit()


async def _outcome(db, lead_id, *, conversion, realized=None, finalized=True, city=_CITY):
    db.add(LeadOutcome(
        lead_id=lead_id, city_id=city, conversion=conversion,
        terminal_status="released" if conversion == "won" else "lost",
        realized_revenue_cents=realized, scope_snapshot="{}",
        was_escalated=False, finalized=finalized,
        created_at=_NOW, updated_at=_NOW,
    ))
    await db.commit()


async def test_cohort_uses_latest_log(client, db_session):
    lead = str(uuid.uuid4())
    await _log(db_session, lead, grounded=False, when=_NOW - timedelta(days=1))
    await _log(db_session, lead, grounded=True, when=_NOW)  # latest -> grounded
    await _outcome(db_session, lead, conversion="won", realized=50000)
    out = await compute_quote_grounding_eval(db_session, _CITY)
    assert out.grounded.n == 1
    assert out.ungrounded.n == 0


async def test_win_rate(client, db_session):
    for conv in ("won", "won", "lost"):
        lead = str(uuid.uuid4())
        await _log(db_session, lead, grounded=True)
        await _outcome(db_session, lead, conversion=conv, realized=50000 if conv == "won" else None)
    out = await compute_quote_grounding_eval(db_session, _CITY)
    assert out.grounded.n == 3
    assert round(out.grounded.win_rate, 3) == 0.667


async def test_pricing_accuracy_and_bias(client, db_session):
    # suggested 72000 vs realized 60000 -> +0.2 ; suggested 54000 vs 60000 -> -0.1
    a = str(uuid.uuid4())
    await _log(db_session, a, grounded=True, suggested=72000)
    await _outcome(db_session, a, conversion="won", realized=60000)
    b = str(uuid.uuid4())
    await _log(db_session, b, grounded=True, suggested=54000)
    await _outcome(db_session, b, conversion="won", realized=60000)
    out = await compute_quote_grounding_eval(db_session, _CITY)
    assert out.grounded.priced_n == 2
    assert round(out.grounded.pricing_accuracy, 4) == 0.15   # mean(|0.2|, |-0.1|)
    assert round(out.grounded.pricing_bias, 4) == 0.05       # mean(0.2, -0.1)


async def test_excludes_leads_without_outcome_or_log(client, db_session):
    only_log = str(uuid.uuid4())
    await _log(db_session, only_log, grounded=True, suggested=50000)
    only_outcome = str(uuid.uuid4())
    await _outcome(db_session, only_outcome, conversion="won", realized=50000)
    out = await compute_quote_grounding_eval(db_session, _CITY)
    assert out.grounded.n == 0
    assert out.ungrounded.n == 0


async def test_excludes_unfinalized_outcome(client, db_session):
    lead = str(uuid.uuid4())
    await _log(db_session, lead, grounded=True, suggested=50000)
    await _outcome(db_session, lead, conversion="won", realized=50000, finalized=False)
    out = await compute_quote_grounding_eval(db_session, _CITY)
    assert out.grounded.n == 0


async def test_zero_realized_excluded_from_pricing(client, db_session):
    lead = str(uuid.uuid4())
    await _log(db_session, lead, grounded=True, suggested=50000)
    await _outcome(db_session, lead, conversion="won", realized=0)
    out = await compute_quote_grounding_eval(db_session, _CITY)
    assert out.grounded.n == 1            # counts toward n
    assert out.grounded.priced_n == 0     # but not the pricing set (no divide-by-zero)
    assert out.grounded.pricing_accuracy is None


async def test_empty_cohort_null_metrics(client, db_session):
    out = await compute_quote_grounding_eval(db_session, _CITY)
    assert out.grounded.n == 0
    assert out.grounded.win_rate is None
    assert out.grounded.priced_n == 0
    assert out.grounded.pricing_accuracy is None
    assert out.grounded.pricing_bias is None


async def test_city_filter(client, db_session):
    here = str(uuid.uuid4())
    await _log(db_session, here, grounded=True, suggested=50000)
    await _outcome(db_session, here, conversion="won", realized=50000)
    there = str(uuid.uuid4())
    await _log(db_session, there, grounded=True, suggested=50000, city="other")
    await _outcome(db_session, there, conversion="won", realized=50000, city="other")
    out = await compute_quote_grounding_eval(db_session, _CITY)
    assert out.grounded.n == 1  # only the st-louis lead
