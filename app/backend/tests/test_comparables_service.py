"""Structured comparable-outcome retrieval tests."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models.lead import Lead
from app.models.lead_outcome import LeadOutcome
from app.services.comparables_service import find_comparables


async def _make_lead(client, **overrides) -> str:
    payload = {"source_type": "manual", "customer_name": "Cur", "service_type": "moving"}
    payload.update(overrides)
    r = await client.post("/leads", json=payload)
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _lead_obj(db_session, lead_id: str) -> Lead:
    return (await db_session.execute(select(Lead).where(Lead.id == lead_id))).scalar_one()


async def _set_scope(db_session, lead_id: str, **fields) -> None:
    lead = await _lead_obj(db_session, lead_id)
    for k, v in fields.items():
        setattr(lead, k, v)
    await db_session.commit()


_NOW = datetime(2026, 6, 1, 12, 0, 0)  # fixed naive time for deterministic recency


async def _add_outcome(
    db_session, city, *, conversion="won", service="moving", scope=None,
    realized=None, quoted=None, finalized=True, completed_at=None,
) -> str:
    snap = {"service_type": service}
    snap.update(scope or {})
    lead_id = str(uuid.uuid4())
    db_session.add(LeadOutcome(
        lead_id=lead_id,
        city_id=city,
        conversion=conversion,
        terminal_status="released" if conversion == "won" else "lost",
        realized_revenue_cents=realized,
        quoted_price_cents=quoted,
        scope_snapshot=json.dumps(snap),
        was_escalated=False,
        finalized=finalized,
        completed_at=completed_at,
        created_at=_NOW,
        updated_at=_NOW,
    ))
    await db_session.commit()
    return lead_id


async def test_closer_scope_ranks_higher(client, db_session):
    lead_id = await _make_lead(client)
    await _set_scope(db_session, lead_id, move_size_label="2 bedroom apartment", move_distance_miles=8.0)
    lead = await _lead_obj(db_session, lead_id)
    city = lead.city_id
    close = await _add_outcome(db_session, city, scope={"move_size_label": "2 bedroom apartment", "move_distance_miles": 8.0}, realized=72000)
    far = await _add_outcome(db_session, city, scope={"move_size_label": "studio", "move_distance_miles": 9.0}, realized=40000)
    out = await find_comparables(db_session, lead, 5)
    assert out[0].lead_id == close
    assert out[0].score > out[1].score


async def test_filters_exclude_other_city_service_unfinalized_and_unpriced(client, db_session):
    lead_id = await _make_lead(client)
    await _set_scope(db_session, lead_id, move_size_label="studio")
    lead = await _lead_obj(db_session, lead_id)
    city = lead.city_id
    keep = await _add_outcome(db_session, city, scope={"move_size_label": "studio"}, realized=30000)
    await _add_outcome(db_session, "other-city", scope={"move_size_label": "studio"}, realized=30000)
    await _add_outcome(db_session, city, service="hauling", scope={"move_size_label": "studio"}, realized=30000)
    await _add_outcome(db_session, city, scope={"move_size_label": "studio"}, realized=30000, finalized=False)
    await _add_outcome(db_session, city, scope={"move_size_label": "studio"})  # no price
    out = await find_comparables(db_session, lead, 5)
    ids = {c.lead_id for c in out}
    assert ids == {keep}


async def test_returns_won_and_lost_labeled(client, db_session):
    lead_id = await _make_lead(client)
    lead = await _lead_obj(db_session, lead_id)
    city = lead.city_id
    await _add_outcome(db_session, city, conversion="won", realized=70000)
    await _add_outcome(db_session, city, conversion="lost", quoted=95000)
    out = await find_comparables(db_session, lead, 5)
    convs = {c.conversion for c in out}
    assert convs == {"won", "lost"}


async def test_price_basis_realized_then_quoted_fallback(client, db_session):
    lead_id = await _make_lead(client)
    lead = await _lead_obj(db_session, lead_id)
    city = lead.city_id
    await _add_outcome(db_session, city, realized=72000, quoted=70000)  # realized wins
    await _add_outcome(db_session, city, conversion="lost", quoted=95000)  # quoted fallback
    out = await find_comparables(db_session, lead, 5)
    by_basis = {c.price_basis: c.price_cents for c in out}
    assert by_basis["realized"] == 72000
    assert by_basis["quoted"] == 95000


async def test_recency_tiebreak_when_scores_equal(client, db_session):
    lead_id = await _make_lead(client)
    lead = await _lead_obj(db_session, lead_id)
    city = lead.city_id
    older = await _add_outcome(db_session, city, realized=50000, completed_at=_NOW - timedelta(days=30))
    newer = await _add_outcome(db_session, city, realized=51000, completed_at=_NOW)
    out = await find_comparables(db_session, lead, 5)
    assert out[0].lead_id == newer  # equal score (0), recent completed_at wins


async def test_empty_pool_returns_empty(client, db_session):
    lead_id = await _make_lead(client)
    lead = await _lead_obj(db_session, lead_id)
    assert await find_comparables(db_session, lead, 5) == []


async def test_malformed_scope_snapshot_is_skipped(client, db_session):
    lead_id = await _make_lead(client)
    lead = await _lead_obj(db_session, lead_id)
    city = lead.city_id
    good = await _add_outcome(db_session, city, realized=60000)
    bad_id = str(uuid.uuid4())
    db_session.add(LeadOutcome(
        lead_id=bad_id, city_id=city, conversion="won", terminal_status="released",
        realized_revenue_cents=61000, scope_snapshot="{not valid json",
        was_escalated=False, finalized=True, created_at=_NOW, updated_at=_NOW,
    ))
    await db_session.commit()
    out = await find_comparables(db_session, lead, 5)
    assert good in {c.lead_id for c in out}


async def test_limit_is_honored(client, db_session):
    lead_id = await _make_lead(client)
    lead = await _lead_obj(db_session, lead_id)
    city = lead.city_id
    for _ in range(7):
        await _add_outcome(db_session, city, realized=50000)
    out = await find_comparables(db_session, lead, 3)
    assert len(out) == 3
