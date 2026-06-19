from __future__ import annotations

import os
os.environ.setdefault("JWT_SECRET", "test-secret-32-characters-long!!!")

from datetime import date, datetime, timezone

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base, get_db
from app.dependencies import require_auth
from app.models.lead import Lead, LeadSourceType, LeadStatus, ServiceType
from app.models.pay_record import PayRecord, PayType
from app.models.user import User

TEST_DB = "sqlite+aiosqlite:///:memory:"


def _mock_user(role="crew", user_id="mock-crew"):
    return User(
        id=user_id,
        username=user_id,
        credential_hash="x",
        role=role,
        city_id="st-louis",
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )


@pytest_asyncio.fixture
async def crew_client():
    from main import app
    engine = create_async_engine(TEST_DB)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async def override_get_db():
        async with Factory() as s:
            yield s

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[require_auth] = lambda: _mock_user("crew")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac, Factory

    app.dependency_overrides.clear()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


async def _seed_lead(factory, customer_name="Maria Lopez", job_date=None):
    async with factory() as s:
        lead = Lead(
            source_type=LeadSourceType.manual,
            status=LeadStatus.released,
            service_type=ServiceType.hauling,
            urgency_flag=False,
            customer_name=customer_name,
            customer_phone="555-000-0000",
            quote_context="x",
            job_date_requested=job_date,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        s.add(lead)
        await s.commit()
        await s.refresh(lead)
        return lead.id


async def _seed_pay(factory, lead_id, user_id, pay_type, amount_cents, hours_worked=None):
    async with factory() as s:
        rec = PayRecord(
            lead_id=lead_id,
            user_id=user_id,
            pay_type=PayType(pay_type),
            hours_worked=hours_worked,
            amount_cents=amount_cents,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        s.add(rec)
        await s.commit()
        await s.refresh(rec)
        return rec.id


async def test_my_pay_empty_when_no_records(crew_client):
    client, _factory = crew_client
    r = await client.get("/users/me/pay")
    assert r.status_code == 200
    body = r.json()
    assert body == {
        "total_earnings_cents": 0,
        "total_hours": 0.0,
        "job_count": 0,
        "entries": [],
    }


async def test_my_pay_returns_only_callers_records(crew_client):
    client, factory = crew_client
    lead_id = await _seed_lead(factory, customer_name="Maria Lopez", job_date=date(2026, 6, 19))
    await _seed_pay(factory, lead_id, "mock-crew", "hourly", 12000, hours_worked=6.0)
    await _seed_pay(factory, lead_id, "other-user", "flat", 99999, hours_worked=None)

    r = await client.get("/users/me/pay")
    assert r.status_code == 200
    body = r.json()
    assert body["job_count"] == 1
    assert len(body["entries"]) == 1
    assert body["entries"][0]["amount_cents"] == 12000
    assert body["entries"][0]["customer_name"] == "Maria Lopez"
    assert body["entries"][0]["job_date"] == "2026-06-19"


async def test_my_pay_totals_sum_amounts_and_hours_ignoring_null(crew_client):
    client, factory = crew_client
    lead_a = await _seed_lead(factory, customer_name="A", job_date=date(2026, 6, 19))
    lead_b = await _seed_lead(factory, customer_name="B", job_date=date(2026, 6, 17))
    await _seed_pay(factory, lead_a, "mock-crew", "hourly", 12000, hours_worked=6.0)
    await _seed_pay(factory, lead_b, "mock-crew", "flat", 45000, hours_worked=None)

    r = await client.get("/users/me/pay")
    body = r.json()
    assert body["total_earnings_cents"] == 57000
    assert body["total_hours"] == 6.0
    assert body["job_count"] == 2


async def test_my_pay_orders_newest_job_first_nulls_last(crew_client):
    client, factory = crew_client
    lead_old = await _seed_lead(factory, customer_name="Old", job_date=date(2026, 6, 10))
    lead_new = await _seed_lead(factory, customer_name="New", job_date=date(2026, 6, 19))
    lead_undated = await _seed_lead(factory, customer_name="Undated", job_date=None)
    await _seed_pay(factory, lead_old, "mock-crew", "flat", 1000)
    await _seed_pay(factory, lead_new, "mock-crew", "flat", 2000)
    await _seed_pay(factory, lead_undated, "mock-crew", "flat", 3000)

    r = await client.get("/users/me/pay")
    names = [e["customer_name"] for e in r.json()["entries"]]
    assert names == ["New", "Old", "Undated"]
    assert r.json()["entries"][-1]["job_date"] is None
