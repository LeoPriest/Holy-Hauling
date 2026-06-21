from __future__ import annotations

from sqlalchemy import select

from app.models.finance import FinanceTransaction


async def _create_lead(client, source_type="thumbtack_screenshot") -> str:
    r = await client.post("/leads", json={
        "source_type": source_type,
        "customer_name": "Refund Test",
        "service_type": "moving",
    })
    assert r.status_code == 201
    return r.json()["id"]


def _factory(client):
    from main import app
    return app.state.test_session_factory


async def _expenses(client, lead_id):
    async with _factory(client)() as s:
        r = await s.execute(select(FinanceTransaction).where(FinanceTransaction.lead_id == lead_id))
        return r.scalars().all()


async def test_mark_and_unmark_customer_responded(client):
    lead_id = await _create_lead(client)
    r = await client.post(f"/leads/{lead_id}/customer-responded")
    assert r.status_code == 200
    assert r.json()["customer_responded_at"] is not None
    r = await client.delete(f"/leads/{lead_id}/customer-responded")
    assert r.status_code == 200
    assert r.json()["customer_responded_at"] is None


async def test_customer_responded_missing_lead_404(client):
    r = await client.post("/leads/nope/customer-responded")
    assert r.status_code == 404


async def test_resolve_does_not_touch_updated_at(client):
    # refund flags are orthogonal to the Aging/Overdue timer (updated_at)
    from app.models.lead import Lead
    lead_id = await _create_lead(client)
    async with _factory(client)() as s:
        before = (await s.execute(select(Lead).where(Lead.id == lead_id))).scalar_one().updated_at
    await client.post(f"/leads/{lead_id}/customer-responded")
    await client.post(f"/leads/{lead_id}/refund")
    async with _factory(client)() as s:
        after = (await s.execute(select(Lead).where(Lead.id == lead_id))).scalar_one().updated_at
    assert after == before


async def test_mark_refunded_drops_expense_preserves_cost(client):
    lead_id = await _create_lead(client)
    await client.patch(f"/leads/{lead_id}", json={"lead_cost_cents": 705})
    assert len(await _expenses(client, lead_id)) == 1

    r = await client.post(f"/leads/{lead_id}/refund")
    assert r.status_code == 200
    body = r.json()
    assert body["lead_refunded_at"] is not None
    assert body["lead_cost_cents"] == 705
    assert await _expenses(client, lead_id) == []


async def test_unmark_refunded_restores_expense(client):
    lead_id = await _create_lead(client)
    await client.patch(f"/leads/{lead_id}", json={"lead_cost_cents": 705})
    await client.post(f"/leads/{lead_id}/refund")
    assert await _expenses(client, lead_id) == []

    r = await client.delete(f"/leads/{lead_id}/refund")
    assert r.status_code == 200
    assert r.json()["lead_refunded_at"] is None
    exp = await _expenses(client, lead_id)
    assert len(exp) == 1 and exp[0].amount_cents == 705


async def test_refunded_realized_cost_is_zero(client):
    from app.services import outcome_service
    lead_id = await _create_lead(client)
    await client.patch(f"/leads/{lead_id}", json={"lead_cost_cents": 705})
    await client.post(f"/leads/{lead_id}/refund")
    async with _factory(client)() as s:
        _rev, cost = await outcome_service._realized_amounts(s, lead_id)
    assert not cost
