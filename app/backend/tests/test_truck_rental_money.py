"""Tests for rental → finance-expense sync and confirmation-screenshot OCR."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

from sqlalchemy import select

from app.models.finance import FinanceTransaction, FinanceTransactionType


async def _create_lead(client, customer_name: str = "Jane Doe") -> str:
    r = await client.post("/leads", json={
        "source_type": "manual",
        "customer_name": customer_name,
        "service_type": "hauling",
    })
    assert r.status_code == 201
    return r.json()["id"]


async def _lead_expenses(db_session, lead_id):
    res = await db_session.execute(
        select(FinanceTransaction).where(FinanceTransaction.lead_id == lead_id)
    )
    return res.scalars().all()


# ---------------------------------------------------------------------------
# Finance expense sync
# ---------------------------------------------------------------------------

async def test_rental_cost_creates_linked_expense(client, db_session):
    lead_id = await _create_lead(client)
    await client.post(f"/leads/{lead_id}/rental", json={
        "status": "reserved", "truck_size": "20ft", "rental_cost_cents": 18500,
    })
    txs = await _lead_expenses(db_session, lead_id)
    assert len(txs) == 1
    tx = txs[0]
    assert tx.transaction_type == FinanceTransactionType.expense
    assert tx.category == "Truck Rental"
    assert tx.amount_cents == 18500
    assert tx.vendor_customer == "U-Haul"


async def test_rental_cost_update_keeps_single_expense(client, db_session):
    lead_id = await _create_lead(client)
    await client.post(f"/leads/{lead_id}/rental", json={"rental_cost_cents": 18500})
    await client.post(f"/leads/{lead_id}/rental", json={"rental_cost_cents": 20000})
    txs = await _lead_expenses(db_session, lead_id)
    assert len(txs) == 1
    assert txs[0].amount_cents == 20000


async def test_clearing_rental_cost_removes_expense(client, db_session):
    lead_id = await _create_lead(client)
    await client.post(f"/leads/{lead_id}/rental", json={"rental_cost_cents": 18500})
    await client.post(f"/leads/{lead_id}/rental", json={"rental_cost_cents": None})
    assert await _lead_expenses(db_session, lead_id) == []


async def test_deleting_rental_removes_expense(client, db_session):
    lead_id = await _create_lead(client)
    await client.post(f"/leads/{lead_id}/rental", json={"rental_cost_cents": 18500})
    await client.delete(f"/leads/{lead_id}/rental")
    assert await _lead_expenses(db_session, lead_id) == []


# ---------------------------------------------------------------------------
# Confirmation screenshot OCR
# ---------------------------------------------------------------------------

async def _upload_confirmation(client, lead_id):
    return await client.post(
        f"/leads/{lead_id}/rental/confirmation",
        files={"file": ("conf.jpg", b"\xff\xd8\xff" + b"0" * 50, "image/jpeg")},
    )


def _ocr_mock(payload: dict) -> AsyncMock:
    msg = MagicMock()
    msg.content = [MagicMock(text=json.dumps(payload))]
    cli = AsyncMock()
    cli.messages.create = AsyncMock(return_value=msg)
    return cli


async def test_extract_confirmation_returns_structured_fields(client, tmp_path, monkeypatch):
    monkeypatch.setattr("app.routers.truck_rental.CONFIRMATIONS_DIR", str(tmp_path / "confirmations"))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("OCR_MODEL", "test-ocr")

    lead_id = await _create_lead(client)
    await client.post(f"/leads/{lead_id}/rental", json={"status": "reserved"})
    up = await _upload_confirmation(client, lead_id)
    assert up.status_code == 200, up.text
    assert up.json()["confirmation_url"]

    payload = {
        "confirmation_number": "HHL-9",
        "truck_size": "15ft",
        "rental_cost": 89.0,
        "pickup_location": "123 Pickup Ave",
        "dropoff_location": "456 Return Rd",
        "pickup_datetime": "2026-06-20T09:00",
        "dropoff_datetime": "2026-06-20T18:00",
        "one_way": True,
        "estimated_miles": 30,
    }
    with patch("app.services.ocr_service._make_client", return_value=_ocr_mock(payload)):
        r = await client.post(f"/leads/{lead_id}/rental/confirmation/extract")

    assert r.status_code == 200, r.text
    d = r.json()
    assert d["confirmation_number"] == "HHL-9"
    assert d["truck_size"] == "15ft"
    assert d["rental_cost_cents"] == 8900  # dollars -> cents
    assert d["pickup_location"] == "123 Pickup Ave"
    assert d["dropoff_location"] == "456 Return Rd"
    assert d["one_way"] is True
    assert d["estimated_miles"] == 30


async def test_extract_confirmation_without_screenshot_returns_400(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("OCR_MODEL", "test-ocr")
    lead_id = await _create_lead(client)
    await client.post(f"/leads/{lead_id}/rental", json={"status": "reserved"})
    r = await client.post(f"/leads/{lead_id}/rental/confirmation/extract")
    assert r.status_code == 400


async def test_upload_confirmation_requires_rental(client, tmp_path, monkeypatch):
    monkeypatch.setattr("app.routers.truck_rental.CONFIRMATIONS_DIR", str(tmp_path / "confirmations"))
    lead_id = await _create_lead(client)
    r = await _upload_confirmation(client, lead_id)
    assert r.status_code == 404  # no rental yet
