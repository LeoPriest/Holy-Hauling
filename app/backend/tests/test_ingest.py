"""Tests for the unified lead ingest pipeline (Slice 5)."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_THUMBTACK_PAYLOAD = {
    "event": "lead.created",
    "lead": {
        "leadID": "tt-abc123",
        "createTimestamp": "2025-01-15T10:30:00Z",
        "customer": {"name": "Jane Smith", "phone": "555-0101"},
        "request": {
            "description": "Need help moving a 2BR apartment",
            "location": {"city": "Los Angeles", "state": "CA", "zipCode": "90001"},
            "serviceDate": {"startDate": "2025-06-01", "endDate": "2025-06-01"},
            "category": "Moving",
        },
    },
}

_OCR_WITH_NAME = {
    "raw_text": "Jane Smith — moving from LA on June 1",
    "fields": [
        {"field": "customer_name", "value": "Jane Smith", "confidence": "high"},
        {"field": "job_location", "value": "Los Angeles, CA", "confidence": "high"},
        {"field": "service_type", "value": "moving", "confidence": "medium"},
    ],
}


def _ocr_mock(payload: dict | None = None) -> AsyncMock:
    p = payload or _OCR_WITH_NAME
    msg = MagicMock()
    msg.content = [MagicMock(text=json.dumps(p))]
    client = AsyncMock()
    client.messages.create = AsyncMock(return_value=msg)
    return client


def _jpg() -> bytes:
    return b"\xff\xd8\xff" + b"0" * 64


# ---------------------------------------------------------------------------
# Screenshot ingest
# ---------------------------------------------------------------------------

async def test_ingest_screenshot_creates_lead(client):
    r = await client.post(
        "/ingest/screenshot",
        files={"file": ("test.jpg", _jpg(), "image/jpeg")},
        data={"source_type": "thumbtack_screenshot"},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["lead"]["id"]
    assert body["lead"]["source_type"] == "thumbtack_screenshot"


async def test_ingest_screenshot_customer_name_is_null_without_ocr(client, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("OCR_MODEL", raising=False)

    r = await client.post(
        "/ingest/screenshot",
        files={"file": ("test.jpg", _jpg(), "image/jpeg")},
        data={"source_type": "thumbtack_screenshot"},
    )
    assert r.status_code == 201
    assert r.json()["lead"]["customer_name"] is None


async def test_ingest_screenshot_skips_ocr_when_unconfigured(client, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("OCR_MODEL", raising=False)

    r = await client.post(
        "/ingest/screenshot",
        files={"file": ("test.jpg", _jpg(), "image/jpeg")},
        data={"source_type": "yelp_screenshot"},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["extraction"] is None
    assert body["auto_applied_fields"] == []


async def test_ingest_screenshot_runs_ocr_and_auto_applies_high_confidence(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("OCR_MODEL", "test-model")

    with patch("app.services.ocr_service._make_client", return_value=_ocr_mock()):
        r = await client.post(
            "/ingest/screenshot",
            files={"file": ("test.jpg", _jpg(), "image/jpeg")},
            data={"source_type": "thumbtack_screenshot"},
        )

    assert r.status_code == 201
    body = r.json()
    assert body["lead"]["customer_name"] == "Jane Smith"
    assert body["lead"]["job_location"] == "Los Angeles, CA"
    assert "customer_name" in body["auto_applied_fields"]
    assert "job_location" in body["auto_applied_fields"]
    # medium-confidence service_type NOT auto-applied
    assert "service_type" not in body["auto_applied_fields"]


async def test_ingest_screenshot_medium_confidence_not_auto_applied(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("OCR_MODEL", "test-model")

    # Only medium-confidence fields
    ocr_payload = {
        "raw_text": "some text",
        "fields": [{"field": "service_type", "value": "moving", "confidence": "medium"}],
    }
    with patch("app.services.ocr_service._make_client", return_value=_ocr_mock(ocr_payload)):
        r = await client.post(
            "/ingest/screenshot",
            files={"file": ("test.jpg", _jpg(), "image/jpeg")},
            data={"source_type": "thumbtack_screenshot"},
        )

    assert r.status_code == 201
    body = r.json()
    assert "service_type" not in body["auto_applied_fields"]
    assert body["lead"]["service_type"] == "unknown"  # unchanged stub default


async def test_ingest_screenshot_lead_appears_in_queue(client):
    r = await client.post(
        "/ingest/screenshot",
        files={"file": ("test.jpg", _jpg(), "image/jpeg")},
        data={"source_type": "google_screenshot"},
    )
    lead_id = r.json()["lead"]["id"]

    queue = await client.get("/leads")
    assert any(l["id"] == lead_id for l in queue.json())


async def test_ingest_screenshot_invalid_file_type(client):
    r = await client.post(
        "/ingest/screenshot",
        files={"file": ("doc.pdf", b"%PDF-1.4", "application/pdf")},
        data={"source_type": "thumbtack_screenshot"},
    )
    assert r.status_code == 400


async def test_ingest_screenshot_invalid_source_type(client):
    r = await client.post(
        "/ingest/screenshot",
        files={"file": ("test.jpg", _jpg(), "image/jpeg")},
        data={"source_type": "manual"},  # not a screenshot source
    )
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# Thumbtack webhook ingest
# ---------------------------------------------------------------------------

async def test_ingest_webhook_thumbtack_creates_lead(client):
    r = await client.post("/ingest/webhook/thumbtack", json=_THUMBTACK_PAYLOAD)
    assert r.status_code == 200
    body = r.json()
    assert body["created"] is True
    assert body["was_duplicate"] is False
    assert body["lead"]["source_type"] == "thumbtack_api"


async def test_ingest_webhook_thumbtack_normalizes_fields(client):
    r = await client.post("/ingest/webhook/thumbtack", json=_THUMBTACK_PAYLOAD)
    lead = r.json()["lead"]
    assert lead["customer_name"] == "Jane Smith"
    assert lead["customer_phone"] == "555-0101"
    assert "Los Angeles" in lead["job_location"]
    assert lead["job_date_requested"] == "2025-06-01"
    assert lead["service_type"] == "moving"
    assert lead["source_reference_id"] == "tt-abc123"


async def test_ingest_webhook_thumbtack_lead_appears_in_queue(client):
    await client.post("/ingest/webhook/thumbtack", json=_THUMBTACK_PAYLOAD)
    queue = await client.get("/leads")
    leads = queue.json()
    assert any(l["source_type"] == "thumbtack_api" for l in leads)


async def test_ingest_webhook_unknown_event_is_no_op(client):
    payload = {"event": "business.updated", "lead": None}
    r = await client.post("/ingest/webhook/thumbtack", json=payload)
    assert r.status_code == 200
    body = r.json()
    assert body["created"] is False
    assert body["lead"] is None

    queue = await client.get("/leads")
    assert queue.json() == []


async def test_ingest_webhook_dedup_returns_existing_lead(client):
    r1 = await client.post("/ingest/webhook/thumbtack", json=_THUMBTACK_PAYLOAD)
    r2 = await client.post("/ingest/webhook/thumbtack", json=_THUMBTACK_PAYLOAD)

    assert r2.status_code == 200
    body = r2.json()
    assert body["was_duplicate"] is True
    assert body["created"] is False
    assert body["lead"]["id"] == r1.json()["lead"]["id"]


async def test_ingest_webhook_dedup_does_not_create_duplicate_in_db(client):
    await client.post("/ingest/webhook/thumbtack", json=_THUMBTACK_PAYLOAD)
    await client.post("/ingest/webhook/thumbtack", json=_THUMBTACK_PAYLOAD)
    await client.post("/ingest/webhook/thumbtack", json=_THUMBTACK_PAYLOAD)

    queue = await client.get("/leads?source_type=thumbtack_api")
    thumbtack_leads = [l for l in queue.json() if l["source_reference_id"] == "tt-abc123"]
    assert len(thumbtack_leads) == 1


async def test_ingest_webhook_different_lead_ids_create_separate_leads(client):
    p2 = {**_THUMBTACK_PAYLOAD, "lead": {**_THUMBTACK_PAYLOAD["lead"], "leadID": "tt-xyz999"}}
    r1 = await client.post("/ingest/webhook/thumbtack", json=_THUMBTACK_PAYLOAD)
    r2 = await client.post("/ingest/webhook/thumbtack", json=p2)

    assert r1.json()["lead"]["id"] != r2.json()["lead"]["id"]
    assert r1.json()["was_duplicate"] is False
    assert r2.json()["was_duplicate"] is False
