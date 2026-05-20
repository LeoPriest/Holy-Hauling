# app/backend/tests/test_recurring_expenses.py
from __future__ import annotations

from datetime import date, timedelta


def _today() -> str:
    return date.today().isoformat()


def _in_days(n: int) -> str:
    return (date.today() + timedelta(days=n)).isoformat()


async def _create(client, **kwargs) -> dict:
    payload = {
        "name": "Test expense",
        "category": "Insurance",
        "amount_cents": 10000,
        "interval_value": 1,
        "interval_unit": "months",
        "next_due_date": _in_days(5),
        **kwargs,
    }
    r = await client.post("/admin/recurring-expenses", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

async def test_list_empty(client):
    r = await client.get("/admin/recurring-expenses")
    assert r.status_code == 200
    assert r.json() == []


async def test_create_and_list(client):
    await _create(client, name="Truck insurance")
    r = await client.get("/admin/recurring-expenses")
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 1
    assert items[0]["name"] == "Truck insurance"
    assert items[0]["amount_cents"] == 10000
    assert items[0]["is_active"] is True


# ---------------------------------------------------------------------------
# /due endpoint
# ---------------------------------------------------------------------------

async def test_due_includes_within_7_days(client):
    await _create(client, name="Due soon", next_due_date=_in_days(5))
    r = await client.get("/admin/recurring-expenses/due")
    assert r.status_code == 200
    names = [x["name"] for x in r.json()]
    assert "Due soon" in names


async def test_due_includes_overdue(client):
    await _create(client, name="Overdue", next_due_date=_in_days(-3))
    r = await client.get("/admin/recurring-expenses/due")
    assert r.status_code == 200
    names = [x["name"] for x in r.json()]
    assert "Overdue" in names


async def test_due_excludes_far_future(client):
    await _create(client, name="Far future", next_due_date=_in_days(30))
    r = await client.get("/admin/recurring-expenses/due")
    assert r.status_code == 200
    names = [x["name"] for x in r.json()]
    assert "Far future" not in names


async def test_due_excludes_inactive(client):
    rec = await _create(client, name="Inactive due", next_due_date=_in_days(2))
    await client.patch(f"/admin/recurring-expenses/{rec['id']}", json={"is_active": False})
    r = await client.get("/admin/recurring-expenses/due")
    assert r.status_code == 200
    names = [x["name"] for x in r.json()]
    assert "Inactive due" not in names


# ---------------------------------------------------------------------------
# Log action
# ---------------------------------------------------------------------------

async def test_log_creates_finance_transaction(client):
    rec = await _create(client, name="Monthly sub", amount_cents=5000, next_due_date=_in_days(0))
    r = await client.post(f"/admin/recurring-expenses/{rec['id']}/log")
    assert r.status_code == 200
    data = r.json()
    assert "transaction_id" in data
    assert "next_due_date" in data


async def test_log_advances_days(client):
    rec = await _create(client, interval_value=10, interval_unit="days", next_due_date=_today())
    r = await client.post(f"/admin/recurring-expenses/{rec['id']}/log")
    assert r.status_code == 200
    new_due = r.json()["next_due_date"]
    expected = (date.today() + timedelta(days=10)).isoformat()
    assert new_due == expected


async def test_log_advances_weeks(client):
    rec = await _create(client, interval_value=2, interval_unit="weeks", next_due_date=_today())
    r = await client.post(f"/admin/recurring-expenses/{rec['id']}/log")
    assert r.status_code == 200
    new_due = r.json()["next_due_date"]
    expected = (date.today() + timedelta(weeks=2)).isoformat()
    assert new_due == expected


async def test_log_advances_months(client):
    rec = await _create(client, interval_value=1, interval_unit="months", next_due_date="2026-01-15")
    r = await client.post(f"/admin/recurring-expenses/{rec['id']}/log")
    assert r.status_code == 200
    assert r.json()["next_due_date"] == "2026-02-15"


async def test_log_removes_from_due_list(client):
    rec = await _create(client, name="Log and remove", next_due_date=_in_days(1))
    await client.post(f"/admin/recurring-expenses/{rec['id']}/log")
    r = await client.get("/admin/recurring-expenses/due")
    names = [x["name"] for x in r.json()]
    # after logging, next_due_date advances beyond 7-day window (1 month later)
    assert "Log and remove" not in names


# ---------------------------------------------------------------------------
# Patch / delete
# ---------------------------------------------------------------------------

async def test_patch_updates_name(client):
    rec = await _create(client)
    r = await client.patch(f"/admin/recurring-expenses/{rec['id']}", json={"name": "Updated"})
    assert r.status_code == 200
    assert r.json()["name"] == "Updated"


async def test_delete_removes_expense(client):
    rec = await _create(client)
    r = await client.delete(f"/admin/recurring-expenses/{rec['id']}")
    assert r.status_code == 200
    assert r.json()["deleted"] is True
    r2 = await client.get("/admin/recurring-expenses")
    assert r2.json() == []
