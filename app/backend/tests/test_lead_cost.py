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


from app.services import ocr_service


def test_parse_cents():
    assert ocr_service.parse_cents("$7.05") == 705
    assert ocr_service.parse_cents("−$7.39") == 739       # unicode minus stripped → positive magnitude
    assert ocr_service.parse_cents("-7.39") == 739        # ascii minus too
    assert ocr_service.parse_cents("1,234.50") == 123450
    assert ocr_service.parse_cents("14.44") == 1444
    assert ocr_service.parse_cents("") is None
    assert ocr_service.parse_cents(None) is None
    assert ocr_service.parse_cents("n/a") is None
    assert ocr_service.parse_cents("1.2.3") is None       # multi-dot OCR junk → None
    assert ocr_service.parse_cents("1.005") == 101         # half-up, no float drift


def test_parse_count_zero_is_zero():
    assert ocr_service.parse_count("0") == 0   # must be 0, not None
    assert ocr_service.parse_count("2") == 2
    assert ocr_service.parse_count("") is None
    assert ocr_service.parse_count(None) is None


def test_coerce_extracted_field_maps_cost_to_columns():
    assert ocr_service.coerce_extracted_field("lead_cost_total", "$7.05") == ("lead_cost_cents", 705)
    assert ocr_service.coerce_extracted_field("lead_cost_gross", "14.44") == ("lead_cost_gross_cents", 1444)
    assert ocr_service.coerce_extracted_field("lead_cost_bonus", "-7.39") == ("lead_cost_bonus_cents", 739)
    assert ocr_service.coerce_extracted_field("pros_contacted", "2") == ("pros_contacted", 2)
    assert ocr_service.coerce_extracted_field("pros_responded", "0") == ("pros_responded", 0)
    assert ocr_service.coerce_extracted_field("customer_name", "Bob") is None


def test_prompt_disambiguates_estimated_cost():
    assert "Estimated cost" in ocr_service._EXTRACTION_PROMPT
    assert "Direct lead" in ocr_service._EXTRACTION_PROMPT
