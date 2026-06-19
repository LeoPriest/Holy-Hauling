"""GET /admin/eval/quote-grounding endpoint."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from app.models.lead_outcome import LeadOutcome
from app.models.quote_suggestion_log import QuoteSuggestionLog

_NOW = datetime(2026, 6, 1, 12, 0, 0)


async def _seed(db, lead_id, *, grounded, conversion, suggested, realized, city="st-louis"):
    db.add(QuoteSuggestionLog(
        id=str(uuid.uuid4()), lead_id=lead_id, city_id=city,
        was_grounded=grounded, comparables_count=2 if grounded else 0,
        suggested_price_cents=suggested, model_used="m", created_at=_NOW,
    ))
    db.add(LeadOutcome(
        lead_id=lead_id, city_id=city, conversion=conversion,
        terminal_status="released" if conversion == "won" else "lost",
        realized_revenue_cents=realized, scope_snapshot="{}",
        was_escalated=False, finalized=True, created_at=_NOW, updated_at=_NOW,
    ))
    await db.commit()


async def test_quote_grounding_eval_endpoint(client, db_session):
    await _seed(db_session, str(uuid.uuid4()), grounded=True, conversion="won", suggested=63000, realized=60000)
    await _seed(db_session, str(uuid.uuid4()), grounded=False, conversion="won", suggested=72000, realized=60000)

    r = await client.get("/admin/eval/quote-grounding")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["grounded"]["n"] == 1
    assert body["ungrounded"]["n"] == 1
    assert round(body["grounded"]["pricing_accuracy"], 3) == 0.05    # |63000-60000|/60000
    assert round(body["ungrounded"]["pricing_accuracy"], 3) == 0.2   # |72000-60000|/60000
