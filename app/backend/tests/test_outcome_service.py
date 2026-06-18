"""Outcome reconciliation tests — derive lead_outcome rows from lead state + finance + escalation."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select, text

from app.models.lead_outcome import LeadOutcome
from app.services.outcome_service import reconcile_outcomes


async def _make_lead(client, **overrides) -> tuple[str, str]:
    payload = {"source_type": "manual", "customer_name": "Outcome Cust", "service_type": "moving"}
    payload.update(overrides)
    r = await client.post("/leads", json=payload)
    assert r.status_code == 201, r.text
    body = r.json()
    return body["id"], body["city_id"]


async def _set_status(db_session, lead_id: str, status: str) -> None:
    await db_session.execute(text("UPDATE leads SET status = :s WHERE id = :id"), {"s": status, "id": lead_id})
    await db_session.commit()


async def _add_finance(db_session, lead_id: str, city_id: str, txn_type: str, cents: int) -> None:
    await db_session.execute(text(
        "INSERT INTO finance_transactions (id, city_id, occurred_on, transaction_type, category, amount_cents, lead_id, created_at, updated_at) "
        "VALUES (:id, :city, :on, :tt, 'job', :amt, :lid, :now, :now)"
    ), {
        "id": str(uuid.uuid4()), "city": city_id, "on": datetime.now(timezone.utc).date(),
        "tt": txn_type, "amt": cents, "lid": lead_id, "now": datetime.now(timezone.utc),
    })
    await db_session.commit()


async def _get_outcome(db_session, lead_id: str) -> LeadOutcome | None:
    return (await db_session.execute(select(LeadOutcome).where(LeadOutcome.lead_id == lead_id))).scalar_one_or_none()


async def test_booked_lead_becomes_won(client, db_session):
    lead_id, city = await _make_lead(client)
    await _set_status(db_session, lead_id, "booked")
    await reconcile_outcomes(db_session, city)
    row = await _get_outcome(db_session, lead_id)
    assert row is not None
    assert row.conversion == "won"
    assert row.terminal_status == "booked"
    assert row.finalized is False  # booked but not completed


async def test_released_lead_is_won_and_finalized(client, db_session):
    lead_id, city = await _make_lead(client)
    await _set_status(db_session, lead_id, "released")
    await reconcile_outcomes(db_session, city)
    row = await _get_outcome(db_session, lead_id)
    assert row.conversion == "won"
    assert row.finalized is True


async def test_lost_lead_is_lost_and_finalized(client, db_session):
    lead_id, city = await _make_lead(client)
    await _set_status(db_session, lead_id, "lost")
    await reconcile_outcomes(db_session, city)
    row = await _get_outcome(db_session, lead_id)
    assert row.conversion == "lost"
    assert row.finalized is True


async def test_non_terminal_lead_gets_no_row(client, db_session):
    lead_id, city = await _make_lead(client)  # status 'new'
    await reconcile_outcomes(db_session, city)
    assert await _get_outcome(db_session, lead_id) is None


async def test_realized_revenue_cost_and_delta(client, db_session):
    lead_id, city = await _make_lead(client)
    await db_session.execute(text("UPDATE leads SET quote_cents = 50000 WHERE id = :id"), {"id": lead_id})
    await db_session.commit()
    await _set_status(db_session, lead_id, "released")
    await _add_finance(db_session, lead_id, city, "income", 52000)
    await _add_finance(db_session, lead_id, city, "expense", 8000)
    await reconcile_outcomes(db_session, city)
    row = await _get_outcome(db_session, lead_id)
    assert row.quoted_price_cents == 50000
    assert row.realized_revenue_cents == 52000
    assert row.realized_cost_cents == 8000
    assert row.price_delta_cents == 2000  # 52000 - 50000


async def test_no_finance_leaves_amounts_null(client, db_session):
    lead_id, city = await _make_lead(client)
    await _set_status(db_session, lead_id, "released")
    await reconcile_outcomes(db_session, city)
    row = await _get_outcome(db_session, lead_id)
    assert row.realized_revenue_cents is None
    assert row.price_delta_cents is None


async def test_finalized_row_is_frozen(client, db_session):
    lead_id, city = await _make_lead(client)
    await _set_status(db_session, lead_id, "lost")
    await reconcile_outcomes(db_session, city)
    await _add_finance(db_session, lead_id, city, "income", 99999)
    await reconcile_outcomes(db_session, city)
    row = await _get_outcome(db_session, lead_id)
    assert row.realized_revenue_cents is None  # frozen — the late income is ignored


async def test_unfinalized_booked_row_fills_in_revenue_on_next_sweep(client, db_session):
    lead_id, city = await _make_lead(client)
    await _set_status(db_session, lead_id, "booked")
    await reconcile_outcomes(db_session, city)
    assert (await _get_outcome(db_session, lead_id)).realized_revenue_cents is None
    await _add_finance(db_session, lead_id, city, "income", 40000)
    await reconcile_outcomes(db_session, city)
    assert (await _get_outcome(db_session, lead_id)).realized_revenue_cents == 40000


async def test_reconcile_is_idempotent(client, db_session):
    lead_id, city = await _make_lead(client)
    await _set_status(db_session, lead_id, "booked")
    await reconcile_outcomes(db_session, city)
    await reconcile_outcomes(db_session, city)
    rows = (await db_session.execute(select(LeadOutcome).where(LeadOutcome.lead_id == lead_id))).scalars().all()
    assert len(rows) == 1


async def test_escalation_fields_populated(client, db_session):
    lead_id, city = await _make_lead(client)
    esc = (await client.post(f"/leads/{lead_id}/escalation", json={
        "level": "pause", "decision_needed": "price", "summary": "x",
    })).json()
    await client.post(f"/escalations/{esc['id']}/resolve", json={"outcome": "approved"})
    await _set_status(db_session, lead_id, "released")
    await reconcile_outcomes(db_session, city)
    row = await _get_outcome(db_session, lead_id)
    assert row.was_escalated is True
    assert row.escalation_outcome == "approved"


async def test_scope_snapshot_and_prompt_version(client, db_session):
    lead_id, city = await _make_lead(client, move_size_label="2 bedroom apartment")
    await _set_status(db_session, lead_id, "released")
    await reconcile_outcomes(db_session, city)
    row = await _get_outcome(db_session, lead_id)
    assert "2 bedroom apartment" in (row.scope_snapshot or "")
    assert row.ai_prompt_version is None
