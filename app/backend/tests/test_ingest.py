"""Tests for the unified lead ingest pipeline (Slice 5)."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch


async def _mock_facilitator():
    from datetime import datetime, timezone
    from app.models.user import User
    return User(
        id="test-facilitator-id",
        username="test-facilitator",
        credential_hash="placeholder",
        role="facilitator",
        city_id="st-louis",
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )

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
        files=[("files", ("test.jpg", _jpg(), "image/jpeg"))],
        data={"source_type": "thumbtack_screenshot"},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["lead"]["id"]
    assert body["lead"]["source_type"] == "thumbtack_screenshot"
    assert body["lead"]["ingested_by"] == "test-admin"
    assert body["lead"]["acknowledged_at"] is None


async def test_ingest_screenshot_by_facilitator_auto_acknowledges(client):
    from app.dependencies import require_auth
    from main import app

    original_override = app.dependency_overrides.get(require_auth)
    app.dependency_overrides[require_auth] = _mock_facilitator
    try:
        r = await client.post(
            "/ingest/screenshot",
            files=[("files", ("test.jpg", _jpg(), "image/jpeg"))],
            data={"source_type": "thumbtack_screenshot"},
        )
    finally:
        app.dependency_overrides[require_auth] = original_override

    assert r.status_code == 201
    body = r.json()
    assert body["lead"]["ingested_by"] == "test-facilitator"
    assert body["lead"]["acknowledged_at"] is not None


async def test_ingest_screenshot_customer_name_is_null_without_ocr(client, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("OCR_MODEL", raising=False)

    r = await client.post(
        "/ingest/screenshot",
        files=[("files", ("test.jpg", _jpg(), "image/jpeg"))],
        data={"source_type": "thumbtack_screenshot"},
    )
    assert r.status_code == 201
    assert r.json()["lead"]["customer_name"] is None


async def test_ingest_screenshot_skips_ocr_when_unconfigured(client, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("OCR_MODEL", raising=False)

    r = await client.post(
        "/ingest/screenshot",
        files=[("files", ("test.jpg", _jpg(), "image/jpeg"))],
        data={"source_type": "yelp_screenshot"},
    )
    assert r.status_code == 201
    body = r.json()
    # `extractions` is plural now — one entry per shot that OCR read. With OCR
    # unconfigured, nothing is read and the list is empty.
    assert body["extractions"] == []
    assert body["auto_applied_fields"] == []


async def test_ingest_screenshot_runs_ocr_and_auto_applies_high_confidence(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("OCR_MODEL", "test-model")

    with patch("app.services.ocr_service._make_client", return_value=_ocr_mock()):
        r = await client.post(
            "/ingest/screenshot",
            files=[("files", ("test.jpg", _jpg(), "image/jpeg"))],
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
            files=[("files", ("test.jpg", _jpg(), "image/jpeg"))],
            data={"source_type": "thumbtack_screenshot"},
        )

    assert r.status_code == 201
    body = r.json()
    assert "service_type" not in body["auto_applied_fields"]
    assert body["lead"]["service_type"] == "unknown"  # unchanged stub default


async def test_ingest_screenshot_lead_appears_in_queue(client):
    r = await client.post(
        "/ingest/screenshot",
        files=[("files", ("test.jpg", _jpg(), "image/jpeg"))],
        data={"source_type": "google_screenshot"},
    )
    lead_id = r.json()["lead"]["id"]

    queue = await client.get("/leads")
    assert any(l["id"] == lead_id for l in queue.json())


async def test_ingest_screenshot_invalid_file_type(client):
    r = await client.post(
        "/ingest/screenshot",
        files=[("files", ("doc.pdf", b"%PDF-1.4", "application/pdf"))],
        data={"source_type": "thumbtack_screenshot"},
    )
    assert r.status_code == 400


async def test_ingest_screenshot_invalid_source_type(client):
    r = await client.post(
        "/ingest/screenshot",
        files=[("files", ("test.jpg", _jpg(), "image/jpeg"))],
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


# ---------------------------------------------------------------------------
# Multi-screenshot intake (2026-09-01)
#
# A Thumbtack lead often spans several screenshots — the details at the top,
# the cost at the bottom. These land as one lead with every shot attached and
# the extracted fields merged. Where shots DISAGREE about a field, nothing is
# written and the conflict is reported: a silently-wrong lead cost is worse
# than a blank one the operator fills in.
# ---------------------------------------------------------------------------

def _seq_ocr_mock(payloads: list[dict]) -> AsyncMock:
    """An OCR client that returns a different payload per call, in order."""
    msgs = []
    for p in payloads:
        m = MagicMock()
        m.content = [MagicMock(text=json.dumps(p))]
        msgs.append(m)
    client = AsyncMock()
    client.messages.create = AsyncMock(side_effect=msgs)
    return client


async def test_ingest_accepts_several_screenshots_as_one_lead(client):
    r = await client.post(
        "/ingest/screenshot",
        files=[
            ("files", ("a.jpg", _jpg(), "image/jpeg")),
            ("files", ("b.jpg", _jpg(), "image/jpeg")),
            ("files", ("c.jpg", _jpg(), "image/jpeg")),
        ],
        data={"source_type": "thumbtack_screenshot"},
    )

    assert r.status_code == 201
    body = r.json()
    # One lead, not three.
    assert body["lead"]["id"]
    assert len(body["lead"]["screenshots"]) == 3


async def test_ingest_still_accepts_a_single_screenshot(client):
    # The one-file path is what the app has always done; it must keep working.
    r = await client.post(
        "/ingest/screenshot",
        files=[("files", ("only.jpg", _jpg(), "image/jpeg"))],
        data={"source_type": "thumbtack_screenshot"},
    )

    assert r.status_code == 201
    assert len(r.json()["lead"]["screenshots"]) == 1


async def test_ingest_merges_non_conflicting_fields_across_screenshots(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("OCR_MODEL", "test-model")

    details = {
        "raw_text": "details shot",
        "fields": [{"field": "customer_name", "value": "Jane Smith", "confidence": "high"}],
    }
    cost = {
        "raw_text": "cost shot",
        "fields": [{"field": "job_location", "value": "Los Angeles, CA", "confidence": "high"}],
    }

    with patch("app.services.ocr_service._make_client", return_value=_seq_ocr_mock([details, cost])):
        r = await client.post(
            "/ingest/screenshot",
            files=[
                ("files", ("a.jpg", _jpg(), "image/jpeg")),
                ("files", ("b.jpg", _jpg(), "image/jpeg")),
            ],
            data={"source_type": "thumbtack_screenshot"},
        )

    body = r.json()
    # Each shot contributed its own field to one lead.
    assert body["lead"]["customer_name"] == "Jane Smith"
    assert body["lead"]["job_location"] == "Los Angeles, CA"
    assert set(body["auto_applied_fields"]) >= {"customer_name", "job_location"}
    assert body["conflicts"] == []
    assert len(body["extractions"]) == 2


async def test_ingest_leaves_a_conflicting_field_blank_and_reports_it(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("OCR_MODEL", "test-model")

    first = {
        "raw_text": "shot one",
        "fields": [{"field": "customer_name", "value": "Jane Smith", "confidence": "high"}],
    }
    second = {
        "raw_text": "shot two",
        "fields": [{"field": "customer_name", "value": "Jane Smyth", "confidence": "high"}],
    }

    with patch("app.services.ocr_service._make_client", return_value=_seq_ocr_mock([first, second])):
        r = await client.post(
            "/ingest/screenshot",
            files=[
                ("files", ("a.jpg", _jpg(), "image/jpeg")),
                ("files", ("b.jpg", _jpg(), "image/jpeg")),
            ],
            data={"source_type": "thumbtack_screenshot"},
        )

    body = r.json()
    # Neither value wins. The operator is told to set it.
    assert body["lead"]["customer_name"] is None
    assert "customer_name" not in body["auto_applied_fields"]
    assert "customer_name" in body["conflicts"]


async def test_ingest_same_money_written_differently_is_not_a_conflict(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("OCR_MODEL", "test-model")

    # "$36.24" and "36.24" are the same number. Treating them as a conflict
    # would fire the warning constantly and teach the operator to ignore it.
    dollar = {
        "raw_text": "shot one",
        "fields": [{"field": "lead_cost_total", "value": "$36.24", "confidence": "high"}],
    }
    bare = {
        "raw_text": "shot two",
        "fields": [{"field": "lead_cost_total", "value": "36.24", "confidence": "high"}],
    }

    with patch("app.services.ocr_service._make_client", return_value=_seq_ocr_mock([dollar, bare])):
        r = await client.post(
            "/ingest/screenshot",
            files=[
                ("files", ("a.jpg", _jpg(), "image/jpeg")),
                ("files", ("b.jpg", _jpg(), "image/jpeg")),
            ],
            data={"source_type": "thumbtack_screenshot"},
        )

    body = r.json()
    assert body["conflicts"] == []
    assert body["lead"]["lead_cost_cents"] == 3624


async def test_ingest_survives_one_screenshot_failing_ocr(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("OCR_MODEL", "test-model")

    good = MagicMock()
    good.content = [MagicMock(text=json.dumps(_OCR_WITH_NAME))]
    failing_client = AsyncMock()
    failing_client.messages.create = AsyncMock(side_effect=[RuntimeError("vision down"), good])

    with patch("app.services.ocr_service._make_client", return_value=failing_client):
        r = await client.post(
            "/ingest/screenshot",
            files=[
                ("files", ("a.jpg", _jpg(), "image/jpeg")),
                ("files", ("b.jpg", _jpg(), "image/jpeg")),
            ],
            data={"source_type": "thumbtack_screenshot"},
        )

    assert r.status_code == 201
    body = r.json()
    # Both images are kept, and the shot that DID read still contributes.
    assert len(body["lead"]["screenshots"]) == 2
    assert body["lead"]["customer_name"] == "Jane Smith"


async def test_ingest_refuses_more_screenshots_than_the_cap(client):
    from app.services.ingest_service import MAX_INTAKE_SCREENSHOTS

    too_many = [
        ("files", (f"{i}.jpg", _jpg(), "image/jpeg"))
        for i in range(MAX_INTAKE_SCREENSHOTS + 1)
    ]
    r = await client.post(
        "/ingest/screenshot",
        files=too_many,
        data={"source_type": "thumbtack_screenshot"},
    )

    # Refuses outright rather than silently dropping the extras.
    assert r.status_code == 400
    assert str(MAX_INTAKE_SCREENSHOTS) in r.json()["detail"]


async def test_ingest_refuses_zero_screenshots(client):
    r = await client.post(
        "/ingest/screenshot",
        data={"source_type": "thumbtack_screenshot"},
    )
    assert r.status_code == 422
