from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select

from app.models.finance import FinanceTransaction, FinanceTransactionType
from app.models.lead import Lead, LeadSourceType, LeadStatus, ServiceType
from app.services import lead_cost_service


async def _make_lead(factory, **kw) -> str:
    async with factory() as s:
        lead = Lead(
            source_type=LeadSourceType.manual,
            status=kw.get("status", LeadStatus.booked),
            service_type=ServiceType.moving,
            urgency_flag=False,
            customer_name="Cost Test",
            city_id="st-louis",
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        s.add(lead)
        await s.commit()
        await s.refresh(lead)
        return lead.id


async def _expenses(factory, lead_id):
    async with factory() as s:
        r = await s.execute(
            select(FinanceTransaction).where(FinanceTransaction.lead_id == lead_id)
        )
        return r.scalars().all()


def _factory(client):
    from main import app
    return app.state.test_session_factory


async def test_sync_creates_expense_when_cost_set(client):
    factory = _factory(client)
    lead_id = await _make_lead(factory)
    async with factory() as s:
        lead = (await s.execute(select(Lead).where(Lead.id == lead_id))).scalar_one()
        lead.lead_cost_cents = 705
        await lead_cost_service.sync_lead_cost_expense(s, lead)
        await s.commit()
        await s.refresh(lead)
        assert lead.lead_cost_finance_transaction_id is not None
    txns = await _expenses(factory, lead_id)
    assert len(txns) == 1
    assert txns[0].transaction_type == FinanceTransactionType.expense
    assert txns[0].category == "Thumbtack lead fee"
    assert txns[0].amount_cents == 705


async def test_sync_updates_in_place(client):
    factory = _factory(client)
    lead_id = await _make_lead(factory)
    async with factory() as s:
        lead = (await s.execute(select(Lead).where(Lead.id == lead_id))).scalar_one()
        lead.lead_cost_cents = 705
        await lead_cost_service.sync_lead_cost_expense(s, lead)
        await s.commit()
    async with factory() as s:
        lead = (await s.execute(select(Lead).where(Lead.id == lead_id))).scalar_one()
        lead.lead_cost_cents = 1444
        await lead_cost_service.sync_lead_cost_expense(s, lead)
        await s.commit()
    txns = await _expenses(factory, lead_id)
    assert len(txns) == 1
    assert txns[0].amount_cents == 1444


async def test_sync_deletes_when_cleared(client):
    factory = _factory(client)
    lead_id = await _make_lead(factory)
    async with factory() as s:
        lead = (await s.execute(select(Lead).where(Lead.id == lead_id))).scalar_one()
        lead.lead_cost_cents = 705
        await lead_cost_service.sync_lead_cost_expense(s, lead)
        await s.commit()
    async with factory() as s:
        lead = (await s.execute(select(Lead).where(Lead.id == lead_id))).scalar_one()
        lead.lead_cost_cents = None
        await lead_cost_service.sync_lead_cost_expense(s, lead)
        await s.commit()
        await s.refresh(lead)
        assert lead.lead_cost_finance_transaction_id is None
    assert await _expenses(factory, lead_id) == []


async def test_update_lead_triggers_sync(client):
    factory = _factory(client)
    lead_id = await _make_lead(factory)
    r = await client.patch(f"/leads/{lead_id}", json={"lead_cost_cents": 705})
    assert r.status_code == 200
    assert r.json()["lead_cost_cents"] == 705
    txns = await _expenses(factory, lead_id)
    assert len(txns) == 1 and txns[0].amount_cents == 705


async def test_synced_expense_feeds_outcome_realized_cost(client):
    from app.services import outcome_service
    factory = _factory(client)
    lead_id = await _make_lead(factory, status=LeadStatus.released)
    async with factory() as s:
        lead = (await s.execute(select(Lead).where(Lead.id == lead_id))).scalar_one()
        lead.lead_cost_cents = 705
        await lead_cost_service.sync_lead_cost_expense(s, lead)
        await s.commit()
    async with factory() as s:
        _rev, cost = await outcome_service._realized_amounts(s, lead_id)
    assert cost == 705
