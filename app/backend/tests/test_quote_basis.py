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
