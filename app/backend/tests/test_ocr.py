"""Tests for screenshot/image extraction endpoints (Slice 3)."""

from __future__ import annotations

import json
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_FAKE_RESPONSE_PAYLOAD = {
    "raw_text": "John Doe needs help moving on 2025-06-01 from 123 Main St to 456 Oak Ave",
    "fields": [
        {"field": "customer_name",     "value": "John Doe",    "confidence": "high"},
        {"field": "job_location",      "value": "123 Main St", "confidence": "high"},
        {"field": "job_origin",        "value": "123 Main St", "confidence": "high"},
        {"field": "job_destination",   "value": "456 Oak Ave", "confidence": "high"},
        {"field": "job_date_requested","value": "2025-06-01",  "confidence": "medium"},
        {"field": "service_type",      "value": "moving",      "confidence": "high"},
        {"field": "scope_notes",       "value": "3rd floor walk-up, no elevator", "confidence": "medium"},
    ],
}


def _mock_client(payload: dict | None = None) -> MagicMock:
    """Return a mocked AsyncAnthropic client that returns a canned extraction payload."""
    p = payload or _FAKE_RESPONSE_PAYLOAD
    msg = MagicMock()
    msg.content = [MagicMock(text=json.dumps(p))]
    mock = AsyncMock()
    mock.messages.create = AsyncMock(return_value=msg)
    return mock


async def _create_lead(client) -> str:
    r = await client.post("/leads", json={
        "source_type": "thumbtack_screenshot",
        "customer_name": "Test Customer",
        "service_type": "unknown",
    })
    assert r.status_code == 201
    return r.json()["id"]


async def _upload_screenshot(client, lead_id: str) -> str:
    r = await client.post(
        f"/leads/{lead_id}/screenshots",
        files={"file": ("test.jpg", b"\xff\xd8\xff" + b"0" * 100, "image/jpeg")},
    )
    assert r.status_code == 201
    return r.json()["id"]


# ---------------------------------------------------------------------------
# Trigger extraction
# ---------------------------------------------------------------------------

async def test_trigger_extraction_success(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("OCR_MODEL", "test-model")

    lead_id = await _create_lead(client)
    ss_id = await _upload_screenshot(client, lead_id)

    with patch("app.services.ocr_service._make_client", return_value=_mock_client()):
        r = await client.post(f"/leads/{lead_id}/screenshots/{ss_id}/extract")

    assert r.status_code == 200
    body = r.json()
    assert body["screenshot_id"] == ss_id
    assert "John Doe" in body["raw_text"]
    fields = json.loads(body["extracted_fields"])
    assert any(f["field"] == "customer_name" for f in fields)


async def test_trigger_extraction_sets_ocr_status_done(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("OCR_MODEL", "test-model")

    lead_id = await _create_lead(client)
    ss_id = await _upload_screenshot(client, lead_id)

    with patch("app.services.ocr_service._make_client", return_value=_mock_client()):
        await client.post(f"/leads/{lead_id}/screenshots/{ss_id}/extract")

    # Verify ocr_status on the detail response
    detail = await client.get(f"/leads/{lead_id}")
    ss = next(s for s in detail.json()["screenshots"] if s["id"] == ss_id)
    assert ss["ocr_status"] == "done"


async def test_trigger_extraction_screenshot_not_found(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("OCR_MODEL", "test-model")

    lead_id = await _create_lead(client)
    r = await client.post(f"/leads/{lead_id}/screenshots/nonexistent-id/extract")
    assert r.status_code == 404


async def test_trigger_extraction_missing_api_key(client, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("OCR_MODEL", "test-model")

    lead_id = await _create_lead(client)
    r = await client.post(f"/leads/{lead_id}/screenshots/any-id/extract")
    assert r.status_code == 503


async def test_trigger_extraction_missing_model(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.delenv("OCR_MODEL", raising=False)

    lead_id = await _create_lead(client)
    r = await client.post(f"/leads/{lead_id}/screenshots/any-id/extract")
    assert r.status_code == 503


async def test_trigger_extraction_api_error_returns_502(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("OCR_MODEL", "test-model")

    lead_id = await _create_lead(client)
    ss_id = await _upload_screenshot(client, lead_id)

    bad_client = AsyncMock()
    bad_client.messages.create = AsyncMock(side_effect=RuntimeError("API timeout"))

    with patch("app.services.ocr_service._make_client", return_value=bad_client):
        r = await client.post(f"/leads/{lead_id}/screenshots/{ss_id}/extract")

    assert r.status_code == 502


async def test_trigger_extraction_api_error_sets_ocr_status_failed(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("OCR_MODEL", "test-model")

    lead_id = await _create_lead(client)
    ss_id = await _upload_screenshot(client, lead_id)

    bad_client = AsyncMock()
    bad_client.messages.create = AsyncMock(side_effect=RuntimeError("nope"))

    with patch("app.services.ocr_service._make_client", return_value=bad_client):
        await client.post(f"/leads/{lead_id}/screenshots/{ss_id}/extract")

    detail = await client.get(f"/leads/{lead_id}")
    ss = next(s for s in detail.json()["screenshots"] if s["id"] == ss_id)
    assert ss["ocr_status"] == "failed"


async def test_trigger_extraction_rerun_overwrites(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("OCR_MODEL", "test-model")

    lead_id = await _create_lead(client)
    ss_id = await _upload_screenshot(client, lead_id)

    with patch("app.services.ocr_service._make_client", return_value=_mock_client()):
        r1 = await client.post(f"/leads/{lead_id}/screenshots/{ss_id}/extract")

    second_payload = {**_FAKE_RESPONSE_PAYLOAD, "raw_text": "Updated text on rerun"}
    with patch("app.services.ocr_service._make_client", return_value=_mock_client(second_payload)):
        r2 = await client.post(f"/leads/{lead_id}/screenshots/{ss_id}/extract")

    assert r2.status_code == 200
    assert r2.json()["raw_text"] == "Updated text on rerun"
    # Only one result row should exist
    r_get = await client.get(f"/leads/{lead_id}/screenshots/{ss_id}/extract")
    assert r_get.json()["raw_text"] == "Updated text on rerun"


# ---------------------------------------------------------------------------
# Get extraction result
# ---------------------------------------------------------------------------

async def test_get_extraction_result_success(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("OCR_MODEL", "test-model")

    lead_id = await _create_lead(client)
    ss_id = await _upload_screenshot(client, lead_id)

    with patch("app.services.ocr_service._make_client", return_value=_mock_client()):
        await client.post(f"/leads/{lead_id}/screenshots/{ss_id}/extract")

    r = await client.get(f"/leads/{lead_id}/screenshots/{ss_id}/extract")
    assert r.status_code == 200
    assert r.json()["screenshot_id"] == ss_id


async def test_get_extraction_result_not_found(client):
    lead_id = await _create_lead(client)
    ss_id = await _upload_screenshot(client, lead_id)

    r = await client.get(f"/leads/{lead_id}/screenshots/{ss_id}/extract")
    assert r.status_code == 404


async def test_get_extraction_result_wrong_lead(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("OCR_MODEL", "test-model")

    lead_id = await _create_lead(client)
    other_lead_id = await _create_lead(client)
    ss_id = await _upload_screenshot(client, lead_id)

    r = await client.get(f"/leads/{other_lead_id}/screenshots/{ss_id}/extract")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Apply extracted fields
# ---------------------------------------------------------------------------

async def test_apply_ocr_fields_updates_lead(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("OCR_MODEL", "test-model")

    lead_id = await _create_lead(client)
    ss_id = await _upload_screenshot(client, lead_id)

    r = await client.post(
        f"/leads/{lead_id}/screenshots/{ss_id}/apply",
        json={"customer_name": "Jane Smith", "job_location": "456 Oak Ave"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["customer_name"] == "Jane Smith"
    assert body["job_location"] == "456 Oak Ave"


async def test_apply_ocr_fields_writes_event(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("OCR_MODEL", "test-model")

    lead_id = await _create_lead(client)
    ss_id = await _upload_screenshot(client, lead_id)

    await client.post(
        f"/leads/{lead_id}/screenshots/{ss_id}/apply",
        json={"customer_name": "Jane Smith", "job_location": "456 Oak Ave"},
    )

    events_r = await client.get(f"/leads/{lead_id}/events")
    events = events_r.json()
    applied_event = next((e for e in events if e["event_type"] == "ocr_fields_applied"), None)
    assert applied_event is not None
    assert "customer_name" in applied_event["note"]
    assert "job_location" in applied_event["note"]


async def test_apply_ocr_fields_screenshot_not_in_lead(client):
    lead_id = await _create_lead(client)
    other_lead_id = await _create_lead(client)
    ss_id = await _upload_screenshot(client, lead_id)

    r = await client.post(
        f"/leads/{other_lead_id}/screenshots/{ss_id}/apply",
        json={"customer_name": "Jane Smith"},
    )
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Markdown fence stripping
# ---------------------------------------------------------------------------

def _mock_client_with_fence(payload: dict | None = None) -> MagicMock:
    """Return a mock client that wraps the JSON response in markdown code fences."""
    p = payload or _FAKE_RESPONSE_PAYLOAD
    fenced = f"```json\n{json.dumps(p)}\n```"
    msg = MagicMock()
    msg.content = [MagicMock(text=fenced)]
    mock = AsyncMock()
    mock.messages.create = AsyncMock(return_value=msg)
    return mock


async def test_extraction_succeeds_when_response_wrapped_in_fence(client, monkeypatch):
    """Claude sometimes wraps JSON in markdown fences; extraction must still work."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("OCR_MODEL", "test-model")

    lead_id = await _create_lead(client)
    ss_id = await _upload_screenshot(client, lead_id)

    with patch("app.services.ocr_service._make_client", return_value=_mock_client_with_fence()):
        r = await client.post(f"/leads/{lead_id}/screenshots/{ss_id}/extract")

    assert r.status_code == 200
    body = r.json()
    assert "John Doe" in body["raw_text"]
    fields = json.loads(body["extracted_fields"])
    assert any(f["field"] == "customer_name" for f in fields)


# ---------------------------------------------------------------------------
# Slice 7: new extracted fields (origin, destination, scope_notes)
# ---------------------------------------------------------------------------

async def test_extraction_returns_v7_fields(client, monkeypatch):
    """OCR extraction returns job_origin, job_destination, scope_notes when present."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("OCR_MODEL", "test-model")

    lead_id = await _create_lead(client)
    ss_id = await _upload_screenshot(client, lead_id)

    with patch("app.services.ocr_service._make_client", return_value=_mock_client()):
        r = await client.post(f"/leads/{lead_id}/screenshots/{ss_id}/extract")

    assert r.status_code == 200
    fields = json.loads(r.json()["extracted_fields"])
    field_names = {f["field"] for f in fields}
    assert "job_origin" in field_names
    assert "job_destination" in field_names
    assert "scope_notes" in field_names


async def test_apply_v7_fields_updates_lead(client, monkeypatch):
    """Applying extraction result writes origin, destination, scope_notes to the lead."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("OCR_MODEL", "test-model")

    lead_id = await _create_lead(client)
    ss_id = await _upload_screenshot(client, lead_id)

    r = await client.post(
        f"/leads/{lead_id}/screenshots/{ss_id}/apply",
        json={
            "job_origin": "123 Main St",
            "job_destination": "456 Oak Ave",
            "scope_notes": "3rd floor walk-up, no elevator",
        },
    )
    assert r.status_code == 200
    d = r.json()
    assert d["job_origin"] == "123 Main St"
    assert d["job_destination"] == "456 Oak Ave"
    assert d["scope_notes"] == "3rd floor walk-up, no elevator"


async def test_apply_sets_field_sources_ocr(client, monkeypatch):
    """Applying OCR fields marks them as 'ocr' in field_sources."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("OCR_MODEL", "test-model")

    lead_id = await _create_lead(client)
    ss_id = await _upload_screenshot(client, lead_id)

    await client.post(
        f"/leads/{lead_id}/screenshots/{ss_id}/apply",
        json={"customer_name": "John Doe", "job_origin": "123 Main St"},
    )

    lead = (await client.get(f"/leads/{lead_id}")).json()
    assert lead["field_sources"] is not None
    assert lead["field_sources"].get("customer_name") == "ocr"
    assert lead["field_sources"].get("job_origin") == "ocr"


# ---------------------------------------------------------------------------
# Slice 8: new extracted fields (move details + contact flow via OCR)
# ---------------------------------------------------------------------------

_V8_RESPONSE_PAYLOAD = {
    "raw_text": "Moving 2BR from 123 Main to 456 Oak, 3rd floor, no elevator. Accept and Pay.",
    "fields": [
        {"field": "customer_name",       "value": "Jane Smith",     "confidence": "high"},
        {"field": "move_size_label",     "value": "2 bedroom home", "confidence": "high"},
        {"field": "move_type",           "value": "labor_only",     "confidence": "medium"},
        {"field": "move_distance_miles", "value": 8.0,              "confidence": "medium"},
        {"field": "load_stairs",         "value": 3,                "confidence": "high"},
        {"field": "unload_stairs",       "value": 0,                "confidence": "high"},
        {"field": "move_date_options",   "value": "2025-07-01, 2025-07-05", "confidence": "medium"},
        {"field": "accept_and_pay",      "value": True,             "confidence": "high"},
    ],
}


async def test_extraction_returns_v8_fields(client, monkeypatch):
    """OCR extraction returns v8 move fields when present in mock response."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("OCR_MODEL", "test-model")

    lead_id = await _create_lead(client)
    ss_id = await _upload_screenshot(client, lead_id)

    with patch("app.services.ocr_service._make_client", return_value=_mock_client(_V8_RESPONSE_PAYLOAD)):
        r = await client.post(f"/leads/{lead_id}/screenshots/{ss_id}/extract")

    assert r.status_code == 200
    fields = json.loads(r.json()["extracted_fields"])
    field_names = {f["field"] for f in fields}
    assert "move_size_label" in field_names
    assert "load_stairs" in field_names
    assert "unload_stairs" in field_names
    assert "accept_and_pay" in field_names


async def test_apply_v8_fields_updates_lead(client, monkeypatch):
    """apply endpoint writes move-specific fields to the lead."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("OCR_MODEL", "test-model")

    lead_id = await _create_lead(client)
    ss_id = await _upload_screenshot(client, lead_id)

    r = await client.post(
        f"/leads/{lead_id}/screenshots/{ss_id}/apply",
        json={
            "move_size_label": "2 bedroom home",
            "move_type": "labor_only",
            "move_distance_miles": 8.0,
            "load_stairs": 3,
            "unload_stairs": 0,
        },
    )
    assert r.status_code == 200
    d = r.json()
    assert d["move_size_label"] == "2 bedroom home"
    assert d["move_type"] == "labor_only"
    assert d["move_distance_miles"] == 8.0
    assert d["load_stairs"] == 3
    assert d["unload_stairs"] == 0


async def test_apply_move_date_options_converts_to_list(client, monkeypatch):
    """move_date_options comma-separated string → stored as JSON array → returned as list."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("OCR_MODEL", "test-model")

    lead_id = await _create_lead(client)
    ss_id = await _upload_screenshot(client, lead_id)

    await client.post(
        f"/leads/{lead_id}/screenshots/{ss_id}/apply",
        json={"move_date_options": "2025-07-01, 2025-07-05"},
    )

    lead = (await client.get(f"/leads/{lead_id}")).json()
    assert isinstance(lead["move_date_options"], list)
    assert "2025-07-01" in lead["move_date_options"]
    assert "2025-07-05" in lead["move_date_options"]


async def test_apply_accept_and_pay_true_unlocks_contact(client, monkeypatch):
    """Applying accept_and_pay=True via OCR sets contact_status to unlocked."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("OCR_MODEL", "test-model")

    lead_id = await _create_lead(client)
    ss_id = await _upload_screenshot(client, lead_id)

    lead_before = (await client.get(f"/leads/{lead_id}")).json()
    assert lead_before["contact_status"] == "locked"

    r = await client.post(
        f"/leads/{lead_id}/screenshots/{ss_id}/apply",
        json={"accept_and_pay": True},
    )
    assert r.status_code == 200
    assert r.json()["contact_status"] == "unlocked"


async def test_phone_via_ocr_apply_on_unlocked_lead_acknowledges(client, monkeypatch):
    """Phone applied via OCR on an unlocked lead triggers acknowledged_at."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("OCR_MODEL", "test-model")

    # Create accept_and_pay lead (starts unlocked)
    r = await client.post("/leads", json={
        "source_type": "thumbtack_screenshot",
        "customer_name": "Unlock Test",
        "service_type": "moving",
        "accept_and_pay": True,
    })
    assert r.status_code == 201
    lead_id = r.json()["id"]
    assert r.json()["contact_status"] == "unlocked"
    assert r.json()["acknowledged_at"] is None

    ss_id = await _upload_screenshot(client, lead_id)

    apply_r = await client.post(
        f"/leads/{lead_id}/screenshots/{ss_id}/apply",
        json={"customer_phone": "555-444-3333"},
    )
    assert apply_r.status_code == 200
    d = apply_r.json()
    assert d["customer_phone"] == "555-444-3333"
    assert d["acknowledged_at"] is not None
