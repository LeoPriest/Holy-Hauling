"""Escalation overlay lifecycle + query tests."""

from __future__ import annotations


async def _create_lead(client, **overrides) -> str:
    payload = {"source_type": "manual", "customer_name": "Esc Customer", "service_type": "moving"}
    payload.update(overrides)
    r = await client.post("/leads", json=payload)
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def test_raise_creates_open_escalation(client):
    lead_id = await _create_lead(client)
    r = await client.post(f"/leads/{lead_id}/escalation", json={
        "level": "pause", "decision_needed": "price", "summary": "Pricing feels risky.",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "open"
    assert body["level"] == "pause"
    assert body["source"] == "manual"

    # The lead's pipeline status is NOT touched
    lead = (await client.get(f"/leads/{lead_id}")).json()
    assert lead["status"] != "escalated"


async def test_raise_is_idempotent_when_open(client):
    lead_id = await _create_lead(client)
    first = (await client.post(f"/leads/{lead_id}/escalation", json={
        "level": "monitor", "decision_needed": "review", "summary": "Keep an eye on this.",
    })).json()
    second = (await client.post(f"/leads/{lead_id}/escalation", json={
        "level": "owner_takeover", "decision_needed": "owner takeover", "summary": "Different.",
    })).json()
    assert first["id"] == second["id"]
    assert second["level"] == "monitor"  # unchanged - still the first one


async def test_get_open_returns_current(client):
    lead_id = await _create_lead(client)
    assert (await client.get(f"/leads/{lead_id}/escalation")).json() is None
    await client.post(f"/leads/{lead_id}/escalation", json={
        "level": "pause", "decision_needed": "truck", "summary": "Truck timing unclear.",
    })
    assert (await client.get(f"/leads/{lead_id}/escalation")).json()["decision_needed"] == "truck"


async def test_resolve_closes_and_records_outcome(client):
    lead_id = await _create_lead(client)
    esc = (await client.post(f"/leads/{lead_id}/escalation", json={
        "level": "pause", "decision_needed": "price", "summary": "Risky.",
    })).json()
    r = await client.post(f"/escalations/{esc['id']}/resolve", json={
        "outcome": "approved", "resolution_note": "Price is fine, send it.",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "resolved"
    assert body["outcome"] == "approved"
    assert body["resolved_at"] is not None
    # Drops out of the open view
    assert (await client.get(f"/leads/{lead_id}/escalation")).json() is None


async def test_resolve_twice_is_409(client):
    lead_id = await _create_lead(client)
    esc = (await client.post(f"/leads/{lead_id}/escalation", json={
        "level": "monitor", "decision_needed": "review", "summary": "x",
    })).json()
    await client.post(f"/escalations/{esc['id']}/resolve", json={"outcome": "release"})
    r = await client.post(f"/escalations/{esc['id']}/resolve", json={"outcome": "approved"})
    assert r.status_code == 409


async def test_list_open_includes_lead_name(client):
    lead_id = await _create_lead(client, customer_name="Jane Doe")
    await client.post(f"/leads/{lead_id}/escalation", json={
        "level": "pause", "decision_needed": "price", "summary": "x",
    })
    rows = (await client.get("/escalations?status=open")).json()
    assert any(row["lead_customer_name"] == "Jane Doe" for row in rows)


async def test_raise_writes_event(client):
    lead_id = await _create_lead(client)
    await client.post(f"/leads/{lead_id}/escalation", json={
        "level": "pause", "decision_needed": "price", "summary": "x",
    })
    lead = (await client.get(f"/leads/{lead_id}")).json()
    assert any(e["event_type"] == "escalation_raised" for e in lead["events"])
