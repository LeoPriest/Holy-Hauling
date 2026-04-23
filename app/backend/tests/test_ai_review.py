"""Tests for the AI lead review engine (Slice 4 + Slice 6)."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_VALID_SECTIONS = {
    # Action-first
    "a_next_message":    "Hi, thanks for reaching out to Holy Hauling — happy to help with your move!",
    "b_call_plan":       "Confirm move date, crew size needed, and truck size.",
    "c_behavior_class":  "Ready-to-book: clear scope, responsive, specific date.",
    "d_transport_path":  "Local move, single truck, no specialty items noted.",
    "e_escalation_note": "No escalation needed at this stage.",
    # Pricing & Control (internal only)
    "f_pricing_band":      "Moving — Medium (3–4 rooms): $600–$900.",
    "g_band_position":     "Mid — standard scope, no stairs or specialty items mentioned.",
    "h_friction_points":   "Price sensitivity likely; customer may shop around.",
    "i_sayability_check":  "Yes — quote $650–$800 range on first call.",
    "j_quote_style":       "Range",
    "k_quote_source_label": "Based on what you described",
    "l_pricing_guidance":  "Quote $650–$800; adjust up if stairs confirmed.",
    # Support & Context
    "m_quick_read":      "Standard moving request, customer seems ready.",
    "n_pattern_anchor":  "Gate 1 — initial contact required.",
    "o_branch_replies":  "If they ask for price: explain we quote after a quick call.",
}

_OCR_PAYLOAD = {
    "raw_text": "John moving from Springfield on June 1",
    "fields": [
        {"field": "customer_name", "value": "John", "confidence": "high"},
        {"field": "job_date_requested", "value": "2025-06-01", "confidence": "high"},
    ],
}


def _review_mock(sections: dict | None = None) -> AsyncMock:
    payload = sections or _VALID_SECTIONS
    msg = MagicMock()
    msg.content = [MagicMock(text=json.dumps(payload))]
    client = AsyncMock()
    client.messages.create = AsyncMock(return_value=msg)
    return client


def _ocr_mock() -> AsyncMock:
    msg = MagicMock()
    msg.content = [MagicMock(text=json.dumps(_OCR_PAYLOAD))]
    client = AsyncMock()
    client.messages.create = AsyncMock(return_value=msg)
    return client


async def _create_lead(client, **overrides) -> str:
    payload = {"source_type": "manual", "customer_name": "Test Customer", "service_type": "moving"}
    payload.update(overrides)
    r = await client.post("/leads", json=payload)
    assert r.status_code == 201
    return r.json()["id"]


async def _upload_screenshot(client, lead_id: str) -> str:
    r = await client.post(
        f"/leads/{lead_id}/screenshots",
        files={"file": ("test.jpg", b"\xff\xd8\xff" + b"0" * 50, "image/jpeg")},
    )
    assert r.status_code == 201
    return r.json()["id"]


# ---------------------------------------------------------------------------
# Trigger review
# ---------------------------------------------------------------------------

async def test_trigger_review_success(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("AI_REVIEW_MODEL", "test-model")

    lead_id = await _create_lead(client)
    with patch("app.services.ai_review_service._make_client", return_value=_review_mock()):
        r = await client.post(f"/leads/{lead_id}/ai-review")

    assert r.status_code == 201
    body = r.json()
    assert body["lead_id"] == lead_id
    sections = body["sections"]
    for key in (
        "a_next_message", "b_call_plan", "c_behavior_class", "d_transport_path", "e_escalation_note",
        "f_pricing_band", "g_band_position", "h_friction_points", "i_sayability_check",
        "j_quote_style", "k_quote_source_label", "l_pricing_guidance",
        "m_quick_read", "n_pattern_anchor", "o_branch_replies",
    ):
        assert key in sections, f"Missing section: {key}"


async def test_trigger_review_missing_model(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.delenv("AI_REVIEW_MODEL", raising=False)

    lead_id = await _create_lead(client)
    r = await client.post(f"/leads/{lead_id}/ai-review")
    assert r.status_code == 503


async def test_trigger_review_missing_api_key(client, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("AI_REVIEW_MODEL", "test-model")

    lead_id = await _create_lead(client)
    r = await client.post(f"/leads/{lead_id}/ai-review")
    assert r.status_code == 503


async def test_trigger_review_lead_not_found(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("AI_REVIEW_MODEL", "test-model")
    r = await client.post("/leads/nonexistent-id/ai-review")
    assert r.status_code == 404


async def test_trigger_review_stores_record(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("AI_REVIEW_MODEL", "test-model")

    lead_id = await _create_lead(client)
    with patch("app.services.ai_review_service._make_client", return_value=_review_mock()):
        post_r = await client.post(f"/leads/{lead_id}/ai-review")

    get_r = await client.get(f"/leads/{lead_id}/ai-review")
    assert get_r.status_code == 200
    assert get_r.json()["id"] == post_r.json()["id"]


async def test_trigger_review_rerun_creates_new_record(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("AI_REVIEW_MODEL", "test-model")

    lead_id = await _create_lead(client)
    with patch("app.services.ai_review_service._make_client", return_value=_review_mock()):
        r1 = await client.post(f"/leads/{lead_id}/ai-review")
    with patch("app.services.ai_review_service._make_client", return_value=_review_mock()):
        r2 = await client.post(f"/leads/{lead_id}/ai-review")

    assert r1.json()["id"] != r2.json()["id"]


async def test_trigger_review_api_error_returns_502(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("AI_REVIEW_MODEL", "test-model")

    lead_id = await _create_lead(client)
    bad_client = AsyncMock()
    bad_client.messages.create = AsyncMock(side_effect=RuntimeError("timeout"))
    with patch("app.services.ai_review_service._make_client", return_value=bad_client):
        r = await client.post(f"/leads/{lead_id}/ai-review")

    assert r.status_code == 502


async def test_trigger_review_malformed_json_returns_502(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("AI_REVIEW_MODEL", "test-model")

    lead_id = await _create_lead(client)
    bad_msg = MagicMock()
    bad_msg.content = [MagicMock(text="not valid json at all")]
    bad_client = AsyncMock()
    bad_client.messages.create = AsyncMock(return_value=bad_msg)
    with patch("app.services.ai_review_service._make_client", return_value=bad_client):
        r = await client.post(f"/leads/{lead_id}/ai-review")

    assert r.status_code == 502


async def test_trigger_review_missing_sections_returns_502(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("AI_REVIEW_MODEL", "test-model")

    lead_id = await _create_lead(client)
    # Claude returns JSON but is missing required A–O keys
    incomplete = {"a_next_message": "Only this section", "b_call_plan": "Missing the rest"}
    with patch("app.services.ai_review_service._make_client", return_value=_review_mock(incomplete)):
        r = await client.post(f"/leads/{lead_id}/ai-review")

    assert r.status_code == 502


async def test_trigger_review_includes_ocr_data_in_snapshot(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("AI_REVIEW_MODEL", "test-model")
    monkeypatch.setenv("OCR_MODEL", "test-ocr-model")

    lead_id = await _create_lead(client, source_type="thumbtack_screenshot")
    ss_id = await _upload_screenshot(client, lead_id)

    # Run OCR first to populate OcrResult
    with patch("app.services.ocr_service._make_client", return_value=_ocr_mock()):
        ocr_r = await client.post(f"/leads/{lead_id}/screenshots/{ss_id}/extract")
    assert ocr_r.status_code == 200

    # Run AI review — should pick up the OCR extracted fields
    with patch("app.services.ai_review_service._make_client", return_value=_review_mock()):
        r = await client.post(f"/leads/{lead_id}/ai-review")

    assert r.status_code == 201
    snapshot = r.json()["input_snapshot"]
    assert ss_id in snapshot["screenshot_ids"]
    assert len(snapshot["ocr_extracted_fields"]) > 0
    field_names = [f["field"] for f in snapshot["ocr_extracted_fields"]]
    assert "customer_name" in field_names


async def test_trigger_review_stores_prompt_version_and_grounding_source(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("AI_REVIEW_MODEL", "test-model")
    monkeypatch.delenv("AI_GROUNDING_FILE", raising=False)  # isolate from real .env

    lead_id = await _create_lead(client)
    with patch("app.services.ai_review_service._make_client", return_value=_review_mock()):
        r = await client.post(f"/leads/{lead_id}/ai-review")

    body = r.json()
    assert body["prompt_version"] != "" and len(body["prompt_version"]) == 8
    assert body["grounding_source"] == "built-in"


# ---------------------------------------------------------------------------
# Get latest review
# ---------------------------------------------------------------------------

async def test_get_review_returns_latest(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("AI_REVIEW_MODEL", "test-model")

    lead_id = await _create_lead(client)
    with patch("app.services.ai_review_service._make_client", return_value=_review_mock()):
        await client.post(f"/leads/{lead_id}/ai-review")
    with patch("app.services.ai_review_service._make_client", return_value=_review_mock()):
        second = await client.post(f"/leads/{lead_id}/ai-review")

    get_r = await client.get(f"/leads/{lead_id}/ai-review")
    assert get_r.status_code == 200
    assert get_r.json()["id"] == second.json()["id"]


async def test_get_review_not_found(client):
    lead_id = await _create_lead(client)
    r = await client.get(f"/leads/{lead_id}/ai-review")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Grounding file validation
# ---------------------------------------------------------------------------

async def test_trigger_review_grounding_file_missing_returns_503(client, monkeypatch, tmp_path):
    """When AI_GROUNDING_FILE is set but does not exist, review must return 503."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("AI_REVIEW_MODEL", "test-model")
    monkeypatch.setenv("AI_GROUNDING_FILE", str(tmp_path / "nonexistent.md"))

    lead_id = await _create_lead(client)
    with patch("app.services.ai_review_service._make_client", return_value=_review_mock()):
        r = await client.post(f"/leads/{lead_id}/ai-review")

    assert r.status_code == 503
    assert "AI_GROUNDING_FILE" in r.json()["detail"]


async def test_trigger_review_grounding_file_loaded_when_present(client, monkeypatch, tmp_path):
    """When AI_GROUNDING_FILE points to a valid file, it should be used and stored."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("AI_REVIEW_MODEL", "test-model")
    grounding_file = tmp_path / "test_sop.md"
    grounding_file.write_text("# Test SOP\nDo good things.")
    monkeypatch.setenv("AI_GROUNDING_FILE", str(grounding_file))

    lead_id = await _create_lead(client)
    with patch("app.services.ai_review_service._make_client", return_value=_review_mock()):
        r = await client.post(f"/leads/{lead_id}/ai-review")

    assert r.status_code == 201
    assert r.json()["grounding_source"] == "test_sop.md"


async def test_trigger_review_uses_builtin_when_grounding_env_not_set(client, monkeypatch):
    """When AI_GROUNDING_FILE is not set at all, built-in grounding is used without error."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("AI_REVIEW_MODEL", "test-model")
    monkeypatch.delenv("AI_GROUNDING_FILE", raising=False)

    lead_id = await _create_lead(client)
    with patch("app.services.ai_review_service._make_client", return_value=_review_mock()):
        r = await client.post(f"/leads/{lead_id}/ai-review")

    assert r.status_code == 201
    assert r.json()["grounding_source"] == "built-in"


# ---------------------------------------------------------------------------
# Markdown fence stripping
# ---------------------------------------------------------------------------

def _review_mock_with_fence(sections: dict | None = None) -> AsyncMock:
    """Return a mock client that wraps the JSON response in markdown code fences."""
    payload = sections or _VALID_SECTIONS
    fenced = f"```json\n{json.dumps(payload)}\n```"
    msg = MagicMock()
    msg.content = [MagicMock(text=fenced)]
    client = AsyncMock()
    client.messages.create = AsyncMock(return_value=msg)
    return client


async def test_review_succeeds_when_response_wrapped_in_fence(client, monkeypatch):
    """Claude sometimes wraps JSON in markdown fences; AI review must still work."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("AI_REVIEW_MODEL", "test-model")
    monkeypatch.delenv("AI_GROUNDING_FILE", raising=False)

    lead_id = await _create_lead(client)
    with patch("app.services.ai_review_service._make_client", return_value=_review_mock_with_fence()):
        r = await client.post(f"/leads/{lead_id}/ai-review")

    assert r.status_code == 201
    sections = r.json()["sections"]
    assert "a_next_message" in sections
    assert "l_pricing_guidance" in sections


# ---------------------------------------------------------------------------
# Legacy A–H record backward compatibility (unit test — no HTTP)
# ---------------------------------------------------------------------------

def test_legacy_ah_record_readable():
    """Old A–H records must map to A–O equivalents without raising an error."""
    from app.models.ai_review import AiReview
    from app.services.ai_review_service import _to_out

    old_sections = {
        "a_quick_read": "Quick summary here.",
        "b_contact_strategy": "Call first, text if no answer.",
        "c_gate_decisions": "Gate 1.",
        "d_next_message": "Hi, thanks for reaching out!",
        "e_call_plan": "Confirm date and crew.",
        "f_branch_replies": "If price asked: explain quote process.",
        "g_pricing_posture": "2 crew × 3 hrs = $450.",
        "h_escalation_notes": "None.",
    }

    review = AiReview(
        id="legacy-id",
        lead_id="lead-id",
        model_used="claude-haiku-4-5-20251001",
        prompt_version="abcd1234",
        grounding_source="built-in",
        sections_json=json.dumps(old_sections),
        input_snapshot_json=json.dumps({"lead_fields": {}, "screenshot_ids": [], "ocr_extracted_fields": []}),
        created_at=datetime.now(timezone.utc),
        actor=None,
    )

    out = _to_out(review)
    # Legacy d_next_message → a_next_message
    assert out.sections.a_next_message == "Hi, thanks for reaching out!"
    # Legacy a_quick_read → m_quick_read
    assert out.sections.m_quick_read == "Quick summary here."
    # Legacy g_pricing_posture → l_pricing_guidance
    assert out.sections.l_pricing_guidance == "2 crew × 3 hrs = $450."
    # Fields with no legacy equivalent default to ""
    assert out.sections.f_pricing_band == ""
    assert out.sections.d_transport_path == ""
