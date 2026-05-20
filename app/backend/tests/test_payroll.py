from __future__ import annotations


async def _create_lead(
    client,
    customer_name: str = "Jane Doe",
    job_date: str | None = None,
    city_id: str | None = None,
    quote_cents: int | None = None,
) -> str:
    payload: dict = {
        "source_type": "manual",
        "customer_name": customer_name,
        "service_type": "hauling",
    }
    if city_id:
        payload["city_id"] = city_id
    r = await client.post("/leads", json=payload)
    assert r.status_code == 201
    lead_id = r.json()["id"]

    patch: dict = {}
    if job_date is not None:
        patch["job_date_requested"] = job_date
    if quote_cents is not None:
        patch["quote_cents"] = quote_cents
    if patch:
        r2 = await client.patch(f"/leads/{lead_id}", json=patch)
        assert r2.status_code == 200

    return lead_id


async def _create_user(
    client,
    username: str,
    role: str = "crew",
    hourly_rate_cents: int | None = None,
) -> str:
    r = await client.post("/admin/users", json={
        "username": username,
        "pin": "1234",
        "role": role,
        "city_id": "st-louis",
    })
    assert r.status_code == 201
    user_id = r.json()["id"]

    if hourly_rate_cents is not None:
        r2 = await client.patch(f"/admin/users/{user_id}", json={"hourly_rate_cents": hourly_rate_cents})
        assert r2.status_code == 200

    return user_id


# ---------------------------------------------------------------------------
# GET /leads/{lead_id}/pay-records
# ---------------------------------------------------------------------------

async def test_list_pay_records_returns_empty_when_none(client):
    lead_id = await _create_lead(client)
    r = await client.get(f"/leads/{lead_id}/pay-records")
    assert r.status_code == 200
    assert r.json() == []


# ---------------------------------------------------------------------------
# POST /leads/{lead_id}/pay-records  (upsert)
# ---------------------------------------------------------------------------

async def test_create_facilitator_pct_pay_record(client):
    lead_id = await _create_lead(client, quote_cents=100000)  # $1000.00
    user_id = await _create_user(client, username="facilitator1", role="facilitator")

    r = await client.post(f"/leads/{lead_id}/pay-records", json={
        "user_id": user_id,
        "pay_type": "facilitator_pct",
    })
    assert r.status_code == 200
    data = r.json()
    assert data["pay_type"] == "facilitator_pct"
    assert data["amount_cents"] == 10000  # 10% of 100000
    assert data["user_id"] == user_id
    assert data["lead_id"] == lead_id


async def test_create_hourly_pay_record(client):
    lead_id = await _create_lead(client)
    user_id = await _create_user(client, username="crew1", role="crew", hourly_rate_cents=2000)  # $20/hr

    r = await client.post(f"/leads/{lead_id}/pay-records", json={
        "user_id": user_id,
        "pay_type": "hourly",
        "hours_worked": 3.5,
    })
    assert r.status_code == 200
    data = r.json()
    assert data["pay_type"] == "hourly"
    assert data["amount_cents"] == 7000  # round(3.5 * 2000)
    assert data["hours_worked"] == 3.5


async def test_create_flat_pay_record(client):
    lead_id = await _create_lead(client)
    user_id = await _create_user(client, username="crew2", role="crew")

    r = await client.post(f"/leads/{lead_id}/pay-records", json={
        "user_id": user_id,
        "pay_type": "flat",
        "override_amount_cents": 15000,
    })
    assert r.status_code == 200
    data = r.json()
    assert data["pay_type"] == "flat"
    assert data["amount_cents"] == 15000
    assert data["override_amount_cents"] == 15000


async def test_upsert_updates_existing_record(client):
    lead_id = await _create_lead(client)
    user_id = await _create_user(client, username="crew3", role="crew")

    # First POST — creates
    r = await client.post(f"/leads/{lead_id}/pay-records", json={
        "user_id": user_id,
        "pay_type": "flat",
        "override_amount_cents": 5000,
    })
    assert r.status_code == 200
    record_id = r.json()["id"]

    # Second POST — should update in place
    r = await client.post(f"/leads/{lead_id}/pay-records", json={
        "user_id": user_id,
        "pay_type": "flat",
        "override_amount_cents": 8000,
    })
    assert r.status_code == 200
    data = r.json()
    assert data["id"] == record_id
    assert data["amount_cents"] == 8000

    # GET should show only one record
    r = await client.get(f"/leads/{lead_id}/pay-records")
    assert len(r.json()) == 1


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

async def test_facilitator_pct_fails_if_quote_cents_null(client):
    lead_id = await _create_lead(client)  # no quote_cents
    user_id = await _create_user(client, username="facilitator2", role="facilitator")

    r = await client.post(f"/leads/{lead_id}/pay-records", json={
        "user_id": user_id,
        "pay_type": "facilitator_pct",
    })
    assert r.status_code == 422


async def test_hourly_fails_if_hourly_rate_not_set(client):
    lead_id = await _create_lead(client)
    user_id = await _create_user(client, username="crew4", role="crew")  # no hourly_rate_cents

    r = await client.post(f"/leads/{lead_id}/pay-records", json={
        "user_id": user_id,
        "pay_type": "hourly",
        "hours_worked": 2.0,
    })
    assert r.status_code == 422


async def test_hourly_fails_if_hours_worked_missing(client):
    lead_id = await _create_lead(client)
    user_id = await _create_user(client, username="crew5", role="crew", hourly_rate_cents=2000)

    r = await client.post(f"/leads/{lead_id}/pay-records", json={
        "user_id": user_id,
        "pay_type": "hourly",
        # hours_worked intentionally omitted
    })
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# DELETE /leads/{lead_id}/pay-records/{record_id}
# ---------------------------------------------------------------------------

async def test_delete_pay_record(client):
    lead_id = await _create_lead(client)
    user_id = await _create_user(client, username="crew6", role="crew")

    r = await client.post(f"/leads/{lead_id}/pay-records", json={
        "user_id": user_id,
        "pay_type": "flat",
        "override_amount_cents": 5000,
    })
    assert r.status_code == 200
    record_id = r.json()["id"]

    r = await client.delete(f"/leads/{lead_id}/pay-records/{record_id}")
    assert r.status_code == 200
    assert r.json() == {"deleted": True}

    r = await client.get(f"/leads/{lead_id}/pay-records")
    assert r.json() == []


# ---------------------------------------------------------------------------
# GET /admin/payroll
# ---------------------------------------------------------------------------

async def test_admin_payroll_sums_correctly(client):
    user_id = await _create_user(client, username="crew7", role="crew")
    lead1 = await _create_lead(client, customer_name="Customer A")
    lead2 = await _create_lead(client, customer_name="Customer B")

    await client.post(f"/leads/{lead1}/pay-records", json={
        "user_id": user_id, "pay_type": "flat", "override_amount_cents": 5000,
    })
    await client.post(f"/leads/{lead2}/pay-records", json={
        "user_id": user_id, "pay_type": "flat", "override_amount_cents": 7500,
    })

    r = await client.get("/admin/payroll")
    assert r.status_code == 200
    summaries = r.json()
    user_summary = next((s for s in summaries if s["user_id"] == user_id), None)
    assert user_summary is not None
    assert user_summary["total_amount_cents"] == 12500
    assert user_summary["record_count"] == 2
    assert len(user_summary["jobs"]) == 2


async def test_admin_payroll_date_filter_excludes_out_of_range(client):
    user_id = await _create_user(client, username="crew8", role="crew")
    lead_in = await _create_lead(client, customer_name="In Range", job_date="2026-05-15")
    lead_out = await _create_lead(client, customer_name="Out of Range", job_date="2026-04-01")

    await client.post(f"/leads/{lead_in}/pay-records", json={
        "user_id": user_id, "pay_type": "flat", "override_amount_cents": 5000,
    })
    await client.post(f"/leads/{lead_out}/pay-records", json={
        "user_id": user_id, "pay_type": "flat", "override_amount_cents": 3000,
    })

    r = await client.get("/admin/payroll?date_from=2026-05-01&date_to=2026-05-31")
    assert r.status_code == 200
    summaries = r.json()
    user_summary = next((s for s in summaries if s["user_id"] == user_id), None)
    assert user_summary is not None
    assert user_summary["total_amount_cents"] == 5000  # only in-range job
    assert user_summary["record_count"] == 1


async def test_admin_payroll_city_filter(client):
    user_id = await _create_user(client, username="crew9", role="crew")
    lead_stl = await _create_lead(client, customer_name="St. Louis Job", city_id="st-louis")
    lead_chi = await _create_lead(client, customer_name="Chicago Job", city_id="chicago")

    await client.post(f"/leads/{lead_stl}/pay-records", json={
        "user_id": user_id, "pay_type": "flat", "override_amount_cents": 5000,
    })
    await client.post(f"/leads/{lead_chi}/pay-records", json={
        "user_id": user_id, "pay_type": "flat", "override_amount_cents": 9000,
    })

    # Filter by Chicago only
    r = await client.get("/admin/payroll?city_id=chicago")
    assert r.status_code == 200
    summaries = r.json()
    user_summary = next((s for s in summaries if s["user_id"] == user_id), None)
    assert user_summary is not None
    assert user_summary["total_amount_cents"] == 9000
    assert user_summary["record_count"] == 1
