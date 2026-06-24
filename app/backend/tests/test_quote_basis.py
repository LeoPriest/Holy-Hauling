from __future__ import annotations

import json

from sqlalchemy import select

from app.models.lead import Lead, LeadSourceType, LeadStatus, ServiceType
from app.models.quote_suggestion_log import QuoteSuggestionLog
from app.schemas.quote_suggestion import ComparableOut, QuoteSuggestionOut
from app.services import quote_service
from datetime import datetime, timezone


def _factory(client):
    from main import app
    return app.state.test_session_factory


async def _make_lead(factory) -> str:
    async with factory() as s:
        lead = Lead(
            source_type=LeadSourceType.manual, status=LeadStatus.ready_for_quote,
            service_type=ServiceType.moving, urgency_flag=False, customer_name="Basis Test",
            city_id="st-louis", created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc),
        )
        s.add(lead); await s.commit(); await s.refresh(lead)
        return lead.id


def _comparable(lead_id="cmp-1", score=5):
    return ComparableOut(lead_id=lead_id, conversion="won", price_cents=131000,
                         price_basis="realized", score=score, move_size_label="4 bedroom home",
                         move_distance_miles=8.0, move_type="labor_only")


async def test_log_suggestion_persists_comparables_and_rationale(client):
    factory = _factory(client)
    lead_id = await _make_lead(factory)
    comps = [_comparable("cmp-1"), _comparable("cmp-2", score=3)]
    suggestion = QuoteSuggestionOut(quoted_price_total=1240.0, estimated_duration_minutes=390,
                                    rationale="Anchored on 2 won 4-bed jobs.", comparables=comps)
    async with factory() as s:
        lead = (await s.execute(select(Lead).where(Lead.id == lead_id))).scalar_one()
        await quote_service._log_suggestion(s, lead, comps, suggestion, model="test-model")
    async with factory() as s:
        row = (await s.execute(select(QuoteSuggestionLog).where(QuoteSuggestionLog.lead_id == lead_id))).scalar_one()
    assert row.rationale == "Anchored on 2 won 4-bed jobs."
    assert row.comparables_count == 2
    assert row.was_grounded is True
    decoded = json.loads(row.comparables_json)
    assert len(decoded) == 2
    assert decoded[0]["lead_id"] == "cmp-1"
    assert decoded[0]["conversion"] == "won"
    assert decoded[0]["price_cents"] == 131000


async def test_latest_snapshot_returns_deserialized_basis(client):
    factory = _factory(client)
    lead_id = await _make_lead(factory)
    comps = [_comparable("cmp-1")]
    suggestion = QuoteSuggestionOut(quoted_price_total=890.0, estimated_duration_minutes=240,
                                    rationale="SOP base rate.", comparables=comps)
    async with factory() as s:
        lead = (await s.execute(select(Lead).where(Lead.id == lead_id))).scalar_one()
        await quote_service._log_suggestion(s, lead, comps, suggestion, model="m")

    r = await client.get(f"/leads/{lead_id}/quote-suggestion/latest")
    assert r.status_code == 200
    body = r.json()
    assert body["rationale"] == "SOP base rate."
    assert body["was_grounded"] is True
    assert body["comparables_count"] == 1
    assert body["comparables"][0]["lead_id"] == "cmp-1"
    assert body["comparables"][0]["price_basis"] == "realized"


async def test_latest_snapshot_returns_most_recent(client):
    factory = _factory(client)
    lead_id = await _make_lead(factory)
    async with factory() as s:
        lead = (await s.execute(select(Lead).where(Lead.id == lead_id))).scalar_one()
        await quote_service._log_suggestion(s, lead, [], QuoteSuggestionOut(
            quoted_price_total=100.0, estimated_duration_minutes=60, rationale="first", comparables=[]), model="m")
        await quote_service._log_suggestion(s, lead, [_comparable()], QuoteSuggestionOut(
            quoted_price_total=200.0, estimated_duration_minutes=60, rationale="second", comparables=[_comparable()]), model="m")
    r = await client.get(f"/leads/{lead_id}/quote-suggestion/latest")
    assert r.json()["rationale"] == "second"
    assert r.json()["comparables_count"] == 1


async def test_latest_snapshot_null_when_never_drafted(client):
    factory = _factory(client)
    lead_id = await _make_lead(factory)
    r = await client.get(f"/leads/{lead_id}/quote-suggestion/latest")
    assert r.status_code == 200
    assert r.json() is None


async def test_latest_snapshot_tolerates_malformed_json(client):
    factory = _factory(client)
    lead_id = await _make_lead(factory)
    async with factory() as s:
        s.add(QuoteSuggestionLog(lead_id=lead_id, city_id="st-louis", was_grounded=True,
                                 comparables_count=1, rationale="ok", comparables_json="{not json"))
        await s.commit()
    r = await client.get(f"/leads/{lead_id}/quote-suggestion/latest")
    assert r.status_code == 200
    assert r.json()["comparables"] == []
    assert r.json()["rationale"] == "ok"
