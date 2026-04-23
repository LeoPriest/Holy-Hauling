import os

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

# Ensure the service doesn't 503 on missing API key during tests
os.environ.setdefault("ANTHROPIC_API_KEY", "test-key")


async def _make_lead(client):
    r = await client.post("/leads", json={
        "source_type": "manual",
        "customer_name": "Tina M.",
        "service_type": "moving",
        "job_location": "St. Louis, MO",
    })
    assert r.status_code == 201
    return r.json()["id"]


@pytest.mark.asyncio
async def test_get_chat_empty(client):
    lead_id = await _make_lead(client)
    r = await client.get(f"/leads/{lead_id}/chat")
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_get_chat_404_unknown_lead(client):
    r = await client.get("/leads/does-not-exist/chat")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_send_chat_message(client):
    lead_id = await _make_lead(client)

    mock_resp = MagicMock()
    mock_resp.content = [MagicMock(text="Based on a standard moving job, $350–$500 is reasonable.")]

    with patch("app.services.chat_service._make_client") as mock_client_fn:
        mock_instance = MagicMock()
        mock_instance.messages.create = AsyncMock(return_value=mock_resp)
        mock_client_fn.return_value = mock_instance

        r = await client.post(
            f"/leads/{lead_id}/chat",
            json={"message": "Why is the band $350–$500?"},
        )

    assert r.status_code == 200
    messages = r.json()
    assert len(messages) == 2
    assert messages[0]["role"] == "user"
    assert messages[0]["content"] == "Why is the band $350–$500?"
    assert messages[1]["role"] == "assistant"
    assert "350" in messages[1]["content"]


@pytest.mark.asyncio
async def test_chat_history_persists(client):
    lead_id = await _make_lead(client)

    mock_resp = MagicMock()
    mock_resp.content = [MagicMock(text="Yes, stairs add $50–$75.")]

    with patch("app.services.chat_service._make_client") as mock_client_fn:
        mock_instance = MagicMock()
        mock_instance.messages.create = AsyncMock(return_value=mock_resp)
        mock_client_fn.return_value = mock_instance

        await client.post(f"/leads/{lead_id}/chat", json={"message": "Does 2 flights of stairs change the price?"})

    r = await client.get(f"/leads/{lead_id}/chat")
    assert r.status_code == 200
    messages = r.json()
    assert len(messages) == 2
    assert messages[0]["role"] == "user"
    assert messages[1]["role"] == "assistant"
