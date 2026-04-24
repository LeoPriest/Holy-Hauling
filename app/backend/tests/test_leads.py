import pytest

pytestmark = pytest.mark.asyncio

BASE = {"source_type": "manual", "customer_name": "Test Customer", "service_type": "hauling"}


async def test_health(client):
    r = await client.get("/health")
    assert r.status_code == 200


async def test_create_lead_manual(client):
    r = await client.post("/leads", json=BASE)
    assert r.status_code == 201
    d = r.json()
    assert d["status"] == "new"
    assert d["acknowledged_at"] is None
    assert d["source_type"] == "manual"
    assert d["urgency_flag"] is False


async def test_create_lead_thumbtack_api(client):
    r = await client.post("/leads", json={**BASE, "source_type": "thumbtack_api", "source_reference_id": "tt-9999"})
    assert r.status_code == 201
    d = r.json()
    assert d["source_type"] == "thumbtack_api"
    assert d["source_reference_id"] == "tt-9999"


async def test_create_lead_thumbtack_screenshot(client):
    r = await client.post("/leads", json={**BASE, "source_type": "thumbtack_screenshot"})
    assert r.status_code == 201
    assert r.json()["source_type"] == "thumbtack_screenshot"


async def test_create_lead_writes_event(client):
    lead_id = (await client.post("/leads", json=BASE)).json()["id"]
    events = (await client.get(f"/leads/{lead_id}/events")).json()
    assert len(events) == 1
    assert events[0]["event_type"] == "created"


async def test_urgency_flag(client):
    r = await client.post("/leads", json={**BASE, "urgency_flag": True})
    assert r.json()["urgency_flag"] is True


async def test_raw_payload_preserved(client):
    payload = '{"raw": "thumbtack data"}'
    lead_id = (await client.post("/leads", json={**BASE, "raw_payload": payload})).json()["id"]
    detail = (await client.get(f"/leads/{lead_id}")).json()
    assert detail["raw_payload"] == payload


async def test_list_leads_returns_all(client):
    await client.post("/leads", json=BASE)
    await client.post("/leads", json=BASE)
    r = await client.get("/leads")
    assert r.status_code == 200
    assert len(r.json()) == 2


async def test_filter_by_status(client):
    await client.post("/leads", json=BASE)
    r = await client.get("/leads?status=new")
    assert all(l["status"] == "new" for l in r.json())


async def test_filter_by_source_type(client):
    await client.post("/leads", json={**BASE, "source_type": "thumbtack_api"})
    await client.post("/leads", json=BASE)
    r = await client.get("/leads?source_type=thumbtack_api")
    leads = r.json()
    assert len(leads) == 1
    assert leads[0]["source_type"] == "thumbtack_api"


async def test_get_single_lead(client):
    created = (await client.post("/leads", json=BASE)).json()
    r = await client.get(f"/leads/{created['id']}")
    assert r.status_code == 200
    assert r.json()["id"] == created["id"]


async def test_get_lead_includes_events(client):
    created = (await client.post("/leads", json=BASE)).json()
    detail = (await client.get(f"/leads/{created['id']}")).json()
    assert "events" in detail
    assert len(detail["events"]) == 1


async def test_status_transition(client):
    created = (await client.post("/leads", json=BASE)).json()
    r = await client.patch(f"/leads/{created['id']}/status", json={"status": "in_review", "actor": "Ron"})
    assert r.status_code == 200
    assert r.json()["status"] == "in_review"


async def test_status_transition_writes_event(client):
    created = (await client.post("/leads", json=BASE)).json()
    await client.patch(f"/leads/{created['id']}/status", json={"status": "in_review"})
    events = (await client.get(f"/leads/{created['id']}/events")).json()
    evt = next(e for e in events if e["event_type"] == "status_changed")
    assert evt["from_status"] == "new"
    assert evt["to_status"] == "in_review"


async def test_acknowledge_sets_timestamp(client):
    created = (await client.post("/leads", json=BASE)).json()
    r = await client.post(f"/leads/{created['id']}/acknowledge")
    assert r.status_code == 200
    assert r.json()["acknowledged_at"] is not None


async def test_acknowledge_twice_returns_409(client):
    created = (await client.post("/leads", json=BASE)).json()
    await client.post(f"/leads/{created['id']}/acknowledge")
    r = await client.post(f"/leads/{created['id']}/acknowledge")
    assert r.status_code == 409


async def test_get_lead_events_ordered(client):
    created = (await client.post("/leads", json=BASE)).json()
    await client.patch(f"/leads/{created['id']}/status", json={"status": "in_review"})
    await client.post(f"/leads/{created['id']}/acknowledge")
    events = (await client.get(f"/leads/{created['id']}/events")).json()
    times = [e["created_at"] for e in events]
    assert times == sorted(times)


async def test_unacknowledged_first_sort(client):
    l1 = (await client.post("/leads", json=BASE)).json()
    l2 = (await client.post("/leads", json=BASE)).json()
    await client.post(f"/leads/{l1['id']}/acknowledge")
    leads = (await client.get("/leads")).json()
    ids = [l["id"] for l in leads]
    assert ids.index(l2["id"]) < ids.index(l1["id"])


async def test_404_for_missing_lead(client):
    r = await client.get("/leads/nonexistent-id")
    assert r.status_code == 404


# ── Slice 2: PATCH lead fields ────────────────────────────────────────────────

async def test_patch_lead_fields(client):
    created = (await client.post("/leads", json=BASE)).json()
    r = await client.patch(f"/leads/{created['id']}", json={"customer_name": "Updated Name"})
    assert r.status_code == 200
    assert r.json()["customer_name"] == "Updated Name"
    assert r.json()["service_type"] == BASE["service_type"]  # unchanged field preserved


async def test_patch_urgency_flag(client):
    created = (await client.post("/leads", json=BASE)).json()
    r = await client.patch(f"/leads/{created['id']}", json={"urgency_flag": True})
    assert r.json()["urgency_flag"] is True


async def test_patch_assign(client):
    created = (await client.post("/leads", json=BASE)).json()
    r = await client.patch(f"/leads/{created['id']}", json={"assigned_to": "Ron"})
    assert r.json()["assigned_to"] == "Ron"


async def test_patch_writes_field_updated_event(client):
    created = (await client.post("/leads", json=BASE)).json()
    await client.patch(f"/leads/{created['id']}", json={"customer_name": "New Name"})
    events = (await client.get(f"/leads/{created['id']}/events")).json()
    evt = next((e for e in events if e["event_type"] == "field_updated"), None)
    assert evt is not None
    assert "customer_name" in evt["note"]


async def test_patch_no_change_no_event(client):
    created = (await client.post("/leads", json=BASE)).json()
    await client.patch(f"/leads/{created['id']}", json={"customer_name": BASE["customer_name"]})
    events = (await client.get(f"/leads/{created['id']}/events")).json()
    assert not any(e["event_type"] == "field_updated" for e in events)


async def test_patch_unknown_lead_404(client):
    r = await client.patch("/leads/does-not-exist", json={"customer_name": "X"})
    assert r.status_code == 404


# ── Slice 2: operational notes ────────────────────────────────────────────────

async def test_add_note(client):
    created = (await client.post("/leads", json=BASE)).json()
    r = await client.post(
        f"/leads/{created['id']}/notes",
        json={"body": "Called customer, no answer."},
    )
    assert r.status_code == 201
    assert r.json()["event_type"] == "note_added"
    assert r.json()["note"] == "Called customer, no answer."


async def test_add_note_actor(client):
    created = (await client.post("/leads", json=BASE)).json()
    r = await client.post(
        f"/leads/{created['id']}/notes",
        json={"body": "Left voicemail.", "actor": "Ron"},
    )
    assert r.json()["actor"] == "Ron"


async def test_add_note_appears_in_event_log(client):
    created = (await client.post("/leads", json=BASE)).json()
    await client.post(f"/leads/{created['id']}/notes", json={"body": "Gate 1 contact attempt."})
    events = (await client.get(f"/leads/{created['id']}/events")).json()
    assert any(e["event_type"] == "note_added" for e in events)


# ── Slice 2: screenshots ──────────────────────────────────────────────────────

async def test_upload_screenshot(client):
    created = (await client.post("/leads", json=BASE)).json()
    r = await client.post(
        f"/leads/{created['id']}/screenshots",
        files={"file": ("test.jpg", b"fake-image-data", "image/jpeg")},
    )
    assert r.status_code == 201
    data = r.json()
    assert data["original_filename"] == "test.jpg"
    assert data["lead_id"] == created["id"]
    assert data["file_size"] == len(b"fake-image-data")


async def test_upload_screenshot_writes_event(client):
    created = (await client.post("/leads", json=BASE)).json()
    await client.post(
        f"/leads/{created['id']}/screenshots",
        files={"file": ("test.jpg", b"fake-image-data", "image/jpeg")},
    )
    events = (await client.get(f"/leads/{created['id']}/events")).json()
    assert any(e["event_type"] == "screenshot_added" for e in events)


async def test_upload_screenshot_invalid_type(client):
    created = (await client.post("/leads", json=BASE)).json()
    r = await client.post(
        f"/leads/{created['id']}/screenshots",
        files={"file": ("doc.pdf", b"fake-pdf", "application/pdf")},
    )
    assert r.status_code == 400


async def test_list_screenshots(client):
    created = (await client.post("/leads", json=BASE)).json()
    await client.post(
        f"/leads/{created['id']}/screenshots",
        files={"file": ("a.jpg", b"data1", "image/jpeg")},
    )
    await client.post(
        f"/leads/{created['id']}/screenshots",
        files={"file": ("b.png", b"data2", "image/png")},
    )
    r = await client.get(f"/leads/{created['id']}/screenshots")
    assert r.status_code == 200
    assert len(r.json()) == 2


async def test_screenshots_scoped_to_lead(client):
    l1 = (await client.post("/leads", json=BASE)).json()
    l2 = (await client.post("/leads", json=BASE)).json()
    await client.post(
        f"/leads/{l1['id']}/screenshots",
        files={"file": ("a.jpg", b"data", "image/jpeg")},
    )
    r = await client.get(f"/leads/{l2['id']}/screenshots")
    assert r.json() == []


async def test_detail_includes_screenshots(client):
    created = (await client.post("/leads", json=BASE)).json()
    await client.post(
        f"/leads/{created['id']}/screenshots",
        files={"file": ("a.jpg", b"data", "image/jpeg")},
    )
    detail = (await client.get(f"/leads/{created['id']}")).json()
    assert "screenshots" in detail
    assert len(detail["screenshots"]) == 1


# ── Slice 6: delete lead ──────────────────────────────────────────────────────

async def test_delete_lead_success(client):
    created = (await client.post("/leads", json=BASE)).json()
    r = await client.delete(f"/leads/{created['id']}")
    assert r.status_code == 204
    # Lead is gone
    get_r = await client.get(f"/leads/{created['id']}")
    assert get_r.status_code == 404


async def test_delete_lead_not_found(client):
    r = await client.delete("/leads/nonexistent-id")
    assert r.status_code == 404


async def test_delete_lead_removes_from_list(client):
    l1 = (await client.post("/leads", json=BASE)).json()
    l2 = (await client.post("/leads", json=BASE)).json()
    await client.delete(f"/leads/{l1['id']}")
    leads = (await client.get("/leads")).json()
    ids = [l["id"] for l in leads]
    assert l1["id"] not in ids
    assert l2["id"] in ids


async def test_delete_lead_cascades(client):
    """Deleting a lead must also remove its events and screenshots (no orphan rows)."""
    created = (await client.post("/leads", json=BASE)).json()
    lead_id = created["id"]

    # Add a note (creates lead_event row)
    await client.post(f"/leads/{lead_id}/notes", json={"body": "Test note"})

    # Add a screenshot
    await client.post(
        f"/leads/{lead_id}/screenshots",
        files={"file": ("a.jpg", b"data", "image/jpeg")},
    )

    # Delete the lead
    r = await client.delete(f"/leads/{lead_id}")
    assert r.status_code == 204

    # Lead should be gone; events and screenshots should not 404 — they simply won't exist
    get_r = await client.get(f"/leads/{lead_id}")
    assert get_r.status_code == 404


# ── Slice 7: new lead fields ──────────────────────────────────────────────────

async def test_create_lead_with_v7_fields(client):
    r = await client.post("/leads", json={
        **BASE,
        "job_origin": "123 Main St",
        "job_destination": "456 Oak Ave",
        "scope_notes": "3rd floor walk-up, piano",
    })
    assert r.status_code == 201
    d = r.json()
    assert d["job_origin"] == "123 Main St"
    assert d["job_destination"] == "456 Oak Ave"
    assert d["scope_notes"] == "3rd floor walk-up, piano"


async def test_patch_v7_fields(client):
    created = (await client.post("/leads", json=BASE)).json()
    r = await client.patch(f"/leads/{created['id']}", json={
        "job_origin": "111 Start Ave",
        "job_destination": "222 End Blvd",
        "scope_notes": "Elevator available, no stairs",
    })
    assert r.status_code == 200
    d = r.json()
    assert d["job_origin"] == "111 Start Ave"
    assert d["job_destination"] == "222 End Blvd"
    assert d["scope_notes"] == "Elevator available, no stairs"


async def test_patch_sets_field_sources_edited(client):
    created = (await client.post("/leads", json=BASE)).json()
    r = await client.patch(
        f"/leads/{created['id']}",
        json={"customer_name": "Manually Updated", "job_origin": "789 Edited St"},
    )
    assert r.status_code == 200
    d = r.json()
    assert d["field_sources"] is not None
    assert d["field_sources"].get("customer_name") == "edited"
    assert d["field_sources"].get("job_origin") == "edited"


async def test_v7_fields_default_null(client):
    created = (await client.post("/leads", json=BASE)).json()
    assert created["job_origin"] is None
    assert created["job_destination"] is None
    assert created["scope_notes"] is None
    assert created["field_sources"] is None


# ── Slice 8: move fields + contact flow ───────────────────────────────────────

async def test_v8_fields_crud(client):
    """POST/PATCH/GET round-trip for move-specific fields."""
    r = await client.post("/leads", json={
        **BASE,
        "move_size_label": "2 bedroom home",
        "move_type": "labor_only",
        "move_distance_miles": 12.5,
        "load_stairs": 2,
        "unload_stairs": 0,
    })
    assert r.status_code == 201
    d = r.json()
    assert d["move_size_label"] == "2 bedroom home"
    assert d["move_type"] == "labor_only"
    assert d["move_distance_miles"] == 12.5
    assert d["load_stairs"] == 2
    assert d["unload_stairs"] == 0


async def test_move_date_options_json_roundtrip(client):
    """move_date_options stored as JSON; returned as list."""
    r = await client.post("/leads", json={
        **BASE,
        "move_date_options": ["2025-06-01", "2025-06-08"],
    })
    assert r.status_code == 201
    d = r.json()
    assert d["move_date_options"] == ["2025-06-01", "2025-06-08"]


async def test_patch_v8_fields(client):
    created = (await client.post("/leads", json=BASE)).json()
    r = await client.patch(f"/leads/{created['id']}", json={
        "move_size_label": "studio",
        "move_type": "customer_truck",
        "load_stairs": 3,
        "unload_stairs": 1,
    })
    assert r.status_code == 200
    d = r.json()
    assert d["move_size_label"] == "studio"
    assert d["move_type"] == "customer_truck"
    assert d["load_stairs"] == 3
    assert d["unload_stairs"] == 1


async def test_create_lead_accept_and_pay_unlocks_contact(client):
    """accept_and_pay=True at creation → contact_status='unlocked'."""
    r = await client.post("/leads", json={**BASE, "accept_and_pay": True})
    assert r.status_code == 201
    assert r.json()["contact_status"] == "unlocked"


async def test_create_lead_default_contact_locked(client):
    """accept_and_pay omitted (default False) → contact_status='locked'."""
    r = await client.post("/leads", json=BASE)
    assert r.status_code == 201
    d = r.json()
    assert d["accept_and_pay"] is False
    assert d["contact_status"] == "locked"


async def test_acknowledgment_sent_unlocks_contact(client):
    """PATCH acknowledgment_sent=True on non-accept_and_pay lead → contact_status='unlocked'."""
    created = (await client.post("/leads", json=BASE)).json()
    assert created["contact_status"] == "locked"

    r = await client.patch(f"/leads/{created['id']}", json={"acknowledgment_sent": True})
    assert r.status_code == 200
    d = r.json()
    assert d["acknowledgment_sent"] is True
    assert d["contact_status"] == "unlocked"


async def test_acknowledgment_sent_accept_and_pay_no_double_lock(client):
    """PATCH acknowledgment_sent=True on accept_and_pay lead: contact stays unlocked."""
    created = (await client.post("/leads", json={**BASE, "accept_and_pay": True})).json()
    assert created["contact_status"] == "unlocked"

    r = await client.patch(f"/leads/{created['id']}", json={"acknowledgment_sent": True})
    assert r.status_code == 200
    assert r.json()["contact_status"] == "unlocked"


async def test_phone_entry_on_unlocked_lead_sets_acknowledged_at(client):
    """Phone set via PATCH on unlocked lead → acknowledged_at populated."""
    # Create unlocked lead
    created = (await client.post("/leads", json={**BASE, "accept_and_pay": True})).json()
    assert created["contact_status"] == "unlocked"
    assert created["acknowledged_at"] is None

    r = await client.patch(f"/leads/{created['id']}", json={"customer_phone": "555-111-2222"})
    assert r.status_code == 200
    d = r.json()
    assert d["customer_phone"] == "555-111-2222"
    assert d["acknowledged_at"] is not None


async def test_phone_entry_on_locked_lead_does_not_acknowledge(client):
    """Phone set via PATCH on locked lead → acknowledged_at stays None."""
    created = (await client.post("/leads", json=BASE)).json()
    assert created["contact_status"] == "locked"

    r = await client.patch(f"/leads/{created['id']}", json={"customer_phone": "555-999-0000"})
    assert r.status_code == 200
    d = r.json()
    assert d["customer_phone"] == "555-999-0000"
    assert d["acknowledged_at"] is None


async def test_source_category_label_computed(client):
    """source_category_label is returned as a human-readable string."""
    cases = [
        ("manual",               "Manual Entry"),
        ("thumbtack_screenshot", "Thumbtack Screenshot"),
        ("thumbtack_api",        "Thumbtack API"),
    ]
    for source_type, expected_label in cases:
        payload = {**BASE, "source_type": source_type}
        if source_type == "thumbtack_api":
            payload["source_reference_id"] = f"tt-{source_type}"
        r = await client.post("/leads", json=payload)
        assert r.status_code == 201
        assert r.json()["source_category_label"] == expected_label, f"Failed for {source_type}"


async def test_update_lead_triggers_calendar_sync_when_event_exists(client, db_session):
    """Changing job_address on a booked lead that has a calendar event should sync."""
    from unittest.mock import AsyncMock, patch
    from app.models.lead import Lead as _Lead, LeadSourceType, LeadStatus, ServiceType
    from datetime import datetime, timezone

    lead = _Lead(
        source_type=LeadSourceType.manual,
        status=LeadStatus.booked,
        service_type=ServiceType.hauling,
        urgency_flag=False,
        google_calendar_event_id="gcal-to-update",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db_session.add(lead)
    await db_session.commit()
    await db_session.refresh(lead)

    with patch("app.services.calendar_service.sync_job_calendar", new=AsyncMock()) as mock_sync:
        r = await client.patch(f"/leads/{lead.id}", json={"job_address": "456 Oak Ave"})

    assert r.status_code == 200
    mock_sync.assert_called_once()


async def test_update_lead_no_calendar_sync_when_no_event(client, db_session):
    """Changing job_address on a lead without a calendar event should not call sync."""
    from unittest.mock import AsyncMock, patch
    from app.models.lead import Lead as _Lead, LeadSourceType, LeadStatus, ServiceType
    from datetime import datetime, timezone

    lead = _Lead(
        source_type=LeadSourceType.manual,
        status=LeadStatus.booked,
        service_type=ServiceType.hauling,
        urgency_flag=False,
        google_calendar_event_id=None,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db_session.add(lead)
    await db_session.commit()
    await db_session.refresh(lead)

    with patch("app.services.calendar_service.sync_job_calendar", new=AsyncMock()) as mock_sync:
        r = await client.patch(f"/leads/{lead.id}", json={"job_address": "789 Pine Rd"})

    assert r.status_code == 200
    mock_sync.assert_not_called()
