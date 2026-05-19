from __future__ import annotations


async def _create_lead(client, customer_name: str = "Jane Doe") -> str:
    r = await client.post("/leads", json={
        "source_type": "manual",
        "customer_name": customer_name,
        "service_type": "hauling",
    })
    assert r.status_code == 201
    return r.json()["id"]


# ---------------------------------------------------------------------------
# GET /leads/{lead_id}/rental
# ---------------------------------------------------------------------------

async def test_get_rental_returns_404_when_none(client):
    lead_id = await _create_lead(client)
    r = await client.get(f"/leads/{lead_id}/rental")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# POST /leads/{lead_id}/rental  (upsert)
# ---------------------------------------------------------------------------

async def test_upsert_creates_rental(client):
    lead_id = await _create_lead(client)
    payload = {
        "status": "reserved",
        "confirmation_number": "U-HAUL-123",
        "truck_size": "20ft",
        "rental_cost_cents": 18500,
        "one_way": True,
        "estimated_miles": 42.5,
    }
    r = await client.post(f"/leads/{lead_id}/rental", json=payload)
    assert r.status_code == 200
    data = r.json()
    assert data["truck_size"] == "20ft"
    assert data["confirmation_number"] == "U-HAUL-123"
    assert data["rental_cost_cents"] == 18500
    assert data["one_way"] is True
    assert data["estimated_miles"] == 42.5
    assert data["lead_id"] == lead_id


async def test_upsert_updates_existing_rental(client):
    lead_id = await _create_lead(client)
    # First POST — creates
    r = await client.post(f"/leads/{lead_id}/rental", json={
        "status": "reserved",
        "truck_size": "15ft",
    })
    assert r.status_code == 200
    assert r.json()["status"] == "reserved"
    assert r.json()["truck_size"] == "15ft"

    # Second POST — should overwrite
    r = await client.post(f"/leads/{lead_id}/rental", json={
        "status": "confirmed",
        "truck_size": "26ft",
        "confirmation_number": "CONFIRMED-456",
    })
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "confirmed"
    assert data["truck_size"] == "26ft"
    assert data["confirmation_number"] == "CONFIRMED-456"


async def test_get_rental_after_upsert(client):
    lead_id = await _create_lead(client)
    await client.post(f"/leads/{lead_id}/rental", json={
        "status": "completed",
        "truck_size": "10ft",
        "rental_cost_cents": 9900,
    })

    r = await client.get(f"/leads/{lead_id}/rental")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "completed"
    assert data["truck_size"] == "10ft"
    assert data["rental_cost_cents"] == 9900
    assert data["lead_id"] == lead_id


# ---------------------------------------------------------------------------
# DELETE /leads/{lead_id}/rental
# ---------------------------------------------------------------------------

async def test_delete_rental(client):
    lead_id = await _create_lead(client)
    await client.post(f"/leads/{lead_id}/rental", json={"status": "reserved"})

    r = await client.delete(f"/leads/{lead_id}/rental")
    assert r.status_code == 200
    assert r.json() == {"deleted": True}

    # Should be gone
    r = await client.get(f"/leads/{lead_id}/rental")
    assert r.status_code == 404


async def test_delete_rental_404_when_none(client):
    lead_id = await _create_lead(client)
    r = await client.delete(f"/leads/{lead_id}/rental")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Isolation between leads
# ---------------------------------------------------------------------------

async def test_upsert_different_leads_are_independent(client):
    lead_a = await _create_lead(client, customer_name="Alice")
    lead_b = await _create_lead(client, customer_name="Bob")

    await client.post(f"/leads/{lead_a}/rental", json={
        "status": "reserved",
        "truck_size": "10ft",
        "rental_cost_cents": 5000,
    })
    await client.post(f"/leads/{lead_b}/rental", json={
        "status": "confirmed",
        "truck_size": "26ft",
        "rental_cost_cents": 30000,
    })

    r_a = await client.get(f"/leads/{lead_a}/rental")
    assert r_a.status_code == 200
    assert r_a.json()["truck_size"] == "10ft"
    assert r_a.json()["rental_cost_cents"] == 5000
    assert r_a.json()["status"] == "reserved"

    r_b = await client.get(f"/leads/{lead_b}/rental")
    assert r_b.status_code == 200
    assert r_b.json()["truck_size"] == "26ft"
    assert r_b.json()["rental_cost_cents"] == 30000
    assert r_b.json()["status"] == "confirmed"


# ---------------------------------------------------------------------------
# GET /admin/rentals
# ---------------------------------------------------------------------------

async def test_admin_rentals_list(client):
    lead_id = await _create_lead(client)
    await client.post(f"/leads/{lead_id}/rental", json={
        "status": "reserved",
        "truck_size": "15ft",
    })

    r = await client.get("/admin/rentals")
    assert r.status_code == 200
    rentals = r.json()
    assert isinstance(rentals, list)
    ids = [item["lead_id"] for item in rentals]
    assert lead_id in ids


async def test_admin_rentals_filter_by_status(client):
    lead_id = await _create_lead(client)
    await client.post(f"/leads/{lead_id}/rental", json={
        "status": "confirmed",
        "truck_size": "20ft",
    })

    # Should appear when filtering by its own status
    r = await client.get("/admin/rentals?status=confirmed")
    assert r.status_code == 200
    confirmed_ids = [item["lead_id"] for item in r.json()]
    assert lead_id in confirmed_ids

    # Should NOT appear when filtering by a different status
    r = await client.get("/admin/rentals?status=reserved")
    assert r.status_code == 200
    reserved_ids = [item["lead_id"] for item in r.json()]
    assert lead_id not in reserved_ids


# ---------------------------------------------------------------------------
# Receipt endpoints
# ---------------------------------------------------------------------------

async def test_delete_receipt_when_no_receipt_is_noop(client):
    lead_id = await _create_lead(client)
    await client.post(f"/leads/{lead_id}/rental", json={"status": "reserved"})

    r = await client.delete(f"/leads/{lead_id}/rental/receipt")
    assert r.status_code == 200
    assert r.json()["receipt_url"] is None


async def test_receipt_upload_and_delete(client, tmp_path, monkeypatch):
    import app.routers.truck_rental as tr_router
    monkeypatch.setattr(tr_router, "RECEIPTS_DIR", str(tmp_path))

    lead_id = await _create_lead(client)
    await client.post(f"/leads/{lead_id}/rental", json={"status": "reserved"})

    fake_file = b"fake-pdf-content"
    r = await client.post(
        f"/leads/{lead_id}/rental/receipt",
        files={"file": ("receipt.pdf", fake_file, "application/pdf")},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["receipt_url"] is not None
    assert data["receipt_url"].startswith("receipts/")

    r = await client.delete(f"/leads/{lead_id}/rental/receipt")
    assert r.status_code == 200
    assert r.json()["receipt_url"] is None
