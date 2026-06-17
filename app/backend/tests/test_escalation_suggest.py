"""Tests for the AI escalation summary (POST /leads/{id}/escalation/suggest)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

_SUMMARY_TEXT = (
    "Lead type: moving\nCustomer request: quote\nScope as understood: 2BR local\n"
    "Access/risk: 2 flights stairs\nAI posture: none\nDecision needed: price"
)


def _mock_client(text: str = _SUMMARY_TEXT) -> AsyncMock:
    msg = MagicMock()
    msg.content = [MagicMock(text=text)]
    client = AsyncMock()
    client.messages.create = AsyncMock(return_value=msg)
    return client


async def _create_lead(client) -> str:
    r = await client.post("/leads", json={"source_type": "manual", "customer_name": "S", "service_type": "moving"})
    assert r.status_code == 201
    return r.json()["id"]


async def test_suggest_summary_success(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("AI_REVIEW_MODEL", "test-model")
    monkeypatch.delenv("AI_GROUNDING_FILE", raising=False)
    lead_id = await _create_lead(client)
    with patch("app.services.escalation_service._make_client", return_value=_mock_client()):
        r = await client.post(f"/leads/{lead_id}/escalation/suggest")
    assert r.status_code == 200, r.text
    assert "Decision needed: price" in r.json()["summary"]


async def test_suggest_summary_missing_api_key_503(client, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("AI_REVIEW_MODEL", "test-model")
    lead_id = await _create_lead(client)
    r = await client.post(f"/leads/{lead_id}/escalation/suggest")
    assert r.status_code == 503


async def test_suggest_summary_lead_not_found_404(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("AI_REVIEW_MODEL", "test-model")
    r = await client.post("/leads/missing/escalation/suggest")
    assert r.status_code == 404
