"""Tests for the AI quote drafting engine (POST /leads/{id}/quote-suggestion)."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

_VALID = {
    "quoted_price_total": 725,
    "line_items": [
        {"note": "Base move", "amount": 650},
        {"note": "Stairs x2", "amount": 75},
    ],
    "estimated_duration_minutes": 240,
    "rationale": "Medium 2-bedroom local move with two flights of stairs.",
}


def _mock_client(payload: dict | None = None) -> AsyncMock:
    msg = MagicMock()
    msg.content = [MagicMock(text=json.dumps(payload if payload is not None else _VALID))]
    client = AsyncMock()
    client.messages.create = AsyncMock(return_value=msg)
    return client


async def _create_lead(client, **overrides) -> str:
    payload = {"source_type": "manual", "customer_name": "Test Customer", "service_type": "moving"}
    payload.update(overrides)
    r = await client.post("/leads", json=payload)
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def test_suggest_quote_success(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("AI_REVIEW_MODEL", "test-model")
    monkeypatch.delenv("AI_GROUNDING_FILE", raising=False)

    lead_id = await _create_lead(client)
    with patch("app.services.quote_service._make_client", return_value=_mock_client()):
        r = await client.post(f"/leads/{lead_id}/quote-suggestion")

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["quoted_price_total"] == 725
    assert len(body["line_items"]) == 2
    assert body["line_items"][0]["note"] == "Base move"
    assert body["estimated_duration_minutes"] == 240
    assert body["rationale"]


async def test_suggest_quote_reconciles_total_to_line_items(client, monkeypatch):
    """When the model's total disagrees with its breakdown, total is set to the sum."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("AI_REVIEW_MODEL", "test-model")
    monkeypatch.delenv("AI_GROUNDING_FILE", raising=False)

    lead_id = await _create_lead(client)
    inconsistent = {
        **_VALID,
        "quoted_price_total": 999,  # wrong on purpose
        "line_items": [{"note": "Base", "amount": 650}, {"note": "Stairs", "amount": 75}],
    }
    with patch("app.services.quote_service._make_client", return_value=_mock_client(inconsistent)):
        r = await client.post(f"/leads/{lead_id}/quote-suggestion")

    assert r.status_code == 200
    assert r.json()["quoted_price_total"] == 725  # reconciled to the breakdown sum


async def test_suggest_quote_missing_model(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.delenv("AI_REVIEW_MODEL", raising=False)

    lead_id = await _create_lead(client)
    r = await client.post(f"/leads/{lead_id}/quote-suggestion")
    assert r.status_code == 503


async def test_suggest_quote_missing_api_key(client, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("AI_REVIEW_MODEL", "test-model")

    lead_id = await _create_lead(client)
    r = await client.post(f"/leads/{lead_id}/quote-suggestion")
    assert r.status_code == 503


async def test_suggest_quote_lead_not_found(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("AI_REVIEW_MODEL", "test-model")
    r = await client.post("/leads/nonexistent-id/quote-suggestion")
    assert r.status_code == 404


async def test_suggest_quote_bad_json_returns_502(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("AI_REVIEW_MODEL", "test-model")
    monkeypatch.delenv("AI_GROUNDING_FILE", raising=False)

    lead_id = await _create_lead(client)
    bad_msg = MagicMock()
    bad_msg.content = [MagicMock(text="not valid json")]
    bad_client = AsyncMock()
    bad_client.messages.create = AsyncMock(return_value=bad_msg)
    with patch("app.services.quote_service._make_client", return_value=bad_client):
        r = await client.post(f"/leads/{lead_id}/quote-suggestion")

    assert r.status_code == 502


async def test_suggest_quote_missing_keys_returns_502(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("AI_REVIEW_MODEL", "test-model")
    monkeypatch.delenv("AI_GROUNDING_FILE", raising=False)

    lead_id = await _create_lead(client)
    incomplete = {"quoted_price_total": 500}  # missing estimated_duration_minutes
    with patch("app.services.quote_service._make_client", return_value=_mock_client(incomplete)):
        r = await client.post(f"/leads/{lead_id}/quote-suggestion")

    assert r.status_code == 502


async def test_suggest_quote_injects_comparables_block(client, db_session, monkeypatch):
    import json as _json
    import uuid as _uuid
    from datetime import datetime, timezone
    from unittest.mock import patch
    from sqlalchemy import select
    from app.models.lead import Lead
    from app.models.lead_outcome import LeadOutcome

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("AI_REVIEW_MODEL", "test-model")
    monkeypatch.delenv("AI_GROUNDING_FILE", raising=False)

    lead_id = await _create_lead(client)
    lead = (await db_session.execute(select(Lead).where(Lead.id == lead_id))).scalar_one()
    db_session.add(LeadOutcome(
        lead_id=str(_uuid.uuid4()), city_id=lead.city_id, conversion="won",
        terminal_status="released", realized_revenue_cents=72000,
        scope_snapshot=_json.dumps({"service_type": "moving", "move_size_label": "2 bedroom apartment"}),
        was_escalated=False, finalized=True,
        created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc),
    ))
    await db_session.commit()

    mock = _mock_client()
    with patch("app.services.quote_service._make_client", return_value=mock):
        r = await client.post(f"/leads/{lead_id}/quote-suggestion")

    assert r.status_code == 200, r.text
    sent = mock.messages.create.call_args.kwargs["messages"][0]["content"]
    assert "COMPARABLE LOCAL JOBS" in sent
    assert len(r.json()["comparables"]) == 1
    assert r.json()["comparables"][0]["conversion"] == "won"


async def test_suggest_quote_cold_start_no_block(client, monkeypatch):
    from unittest.mock import patch
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("AI_REVIEW_MODEL", "test-model")
    monkeypatch.delenv("AI_GROUNDING_FILE", raising=False)

    lead_id = await _create_lead(client)
    mock = _mock_client()
    with patch("app.services.quote_service._make_client", return_value=mock):
        r = await client.post(f"/leads/{lead_id}/quote-suggestion")

    assert r.status_code == 200, r.text
    sent = mock.messages.create.call_args.kwargs["messages"][0]["content"]
    assert "COMPARABLE LOCAL JOBS" not in sent
    assert r.json()["comparables"] == []
