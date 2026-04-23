import os
os.environ.setdefault("JWT_SECRET", "test-secret-32-characters-long!!!")

import pytest
import pytest_asyncio
from datetime import datetime, timezone
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base, get_db
from app.dependencies import require_auth
from app.models.lead import Lead, LeadSourceType, LeadStatus, ServiceType
from app.models.user import User

TEST_DB = "sqlite+aiosqlite:///:memory:"


def _mock_user(role="supervisor"):
    return User(
        id=f"mock-{role}",
        username=f"mock-{role}",
        credential_hash="x",
        role=role,
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )


@pytest_asyncio.fixture
async def supervisor_client():
    from main import app
    engine = create_async_engine(TEST_DB)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async def override_get_db():
        async with Factory() as s:
            yield s

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[require_auth] = lambda: _mock_user("supervisor")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac, Factory

    app.dependency_overrides.clear()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


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


async def _seed_lead(factory, status="booked", customer_phone="555-123-4567", quote_context="high end"):
    async with factory() as s:
        lead = Lead(
            source_type=LeadSourceType.manual,
            status=LeadStatus[status],
            service_type=ServiceType.hauling,
            urgency_flag=False,
            customer_name="Test Customer",
            customer_phone=customer_phone,
            quote_context=quote_context,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        s.add(lead)
        await s.commit()
        await s.refresh(lead)
        return lead


@pytest.mark.asyncio
async def test_get_jobs_returns_only_booked(supervisor_client):
    client, factory = supervisor_client
    await _seed_lead(factory, status="booked")
    await _seed_lead(factory, status="new")
    r = await client.get("/jobs")
    assert r.status_code == 200
    assert len(r.json()) == 1


@pytest.mark.asyncio
async def test_supervisor_sees_phone_and_quote(supervisor_client):
    client, factory = supervisor_client
    await _seed_lead(factory, status="booked", customer_phone="555-000-0001", quote_context="$500")
    r = await client.get("/jobs")
    assert r.status_code == 200
    job = r.json()[0]
    assert job["customer_phone"] == "555-000-0001"
    assert job["quote_context"] == "$500"


@pytest.mark.asyncio
async def test_crew_omits_phone_and_quote(crew_client):
    client, factory = crew_client
    lead = await _seed_lead(factory, status="booked", customer_phone="555-000-0002", quote_context="secret")
    await _seed_assignment(factory, lead_id=lead.id, user_id="mock-crew")
    r = await client.get("/jobs")
    assert r.status_code == 200
    job = r.json()[0]
    assert job["customer_phone"] is None
    assert job["quote_context"] is None


@pytest.mark.asyncio
async def test_patch_job_status_as_supervisor(supervisor_client):
    client, factory = supervisor_client
    lead = await _seed_lead(factory, status="booked")
    r = await client.patch(f"/jobs/{lead.id}/status", json={"status": "en_route"})
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_patch_job_status_as_crew_forbidden(crew_client):
    client, factory = crew_client
    lead = await _seed_lead(factory, status="booked")
    r = await client.patch(f"/jobs/{lead.id}/status", json={"status": "started"})
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_patch_job_status_completed_releases_lead(supervisor_client):
    client, factory = supervisor_client
    lead = await _seed_lead(factory, status="booked")
    r = await client.patch(f"/jobs/{lead.id}/status", json={"status": "completed"})
    assert r.status_code == 200
    async with factory() as s:
        result = await s.execute(select(Lead).where(Lead.id == lead.id))
        db_lead = result.scalar_one()
        assert db_lead.status.value == "released"


@pytest.mark.asyncio
async def test_patch_non_booked_lead_returns_409(supervisor_client):
    client, factory = supervisor_client
    lead = await _seed_lead(factory, status="new")
    r = await client.patch(f"/jobs/{lead.id}/status", json={"status": "en_route"})
    assert r.status_code == 409


def test_job_assignment_model_importable():
    from app.models.job_assignment import JobAssignment
    assert JobAssignment.__tablename__ == "job_assignments"


def test_job_out_has_crew_field():
    from app.schemas.jobs import JobOut
    job = JobOut(id="x", crew=["alice", "bob"])
    assert job.crew == ["alice", "bob"]


def test_job_out_crew_defaults_empty():
    from app.schemas.jobs import JobOut
    job = JobOut(id="x")
    assert job.crew == []


def test_job_assignment_create_schema():
    from app.schemas.jobs import JobAssignmentCreate
    schema = JobAssignmentCreate(user_id="u-123")
    assert schema.user_id == "u-123"


import uuid as _uuid


async def _seed_user(factory, role="crew", username="test-crew"):
    async with factory() as s:
        user = User(
            id=str(_uuid.uuid4()),
            username=username,
            credential_hash="x",
            role=role,
            is_active=True,
            created_at=datetime.now(timezone.utc),
        )
        s.add(user)
        await s.commit()
        await s.refresh(user)
        return user


async def _seed_assignment(factory, lead_id: str, user_id: str):
    from app.models.job_assignment import JobAssignment
    async with factory() as s:
        s.add(JobAssignment(lead_id=lead_id, user_id=user_id, assigned_by="test"))
        await s.commit()


@pytest.mark.asyncio
async def test_crew_only_sees_assigned_jobs(crew_client):
    client, factory = crew_client
    await _seed_lead(factory, status="booked")
    r = await client.get("/jobs")
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_crew_sees_assigned_job(crew_client):
    client, factory = crew_client
    lead = await _seed_lead(factory, status="booked")
    await _seed_assignment(factory, lead_id=lead.id, user_id="mock-crew")
    r = await client.get("/jobs")
    assert r.status_code == 200
    assert len(r.json()) == 1


@pytest.mark.asyncio
async def test_crew_field_returns_assigned_usernames(supervisor_client):
    client, factory = supervisor_client
    lead = await _seed_lead(factory, status="booked")
    crew_user = await _seed_user(factory)
    await _seed_assignment(factory, lead_id=lead.id, user_id=crew_user.id)
    r = await client.get("/jobs")
    assert r.status_code == 200
    assert crew_user.username in r.json()[0]["crew"]


@pytest.mark.asyncio
async def test_add_assignment_as_supervisor(supervisor_client):
    client, factory = supervisor_client
    lead = await _seed_lead(factory, status="booked")
    crew_user = await _seed_user(factory)
    r = await client.post(f"/jobs/{lead.id}/assignments", json={"user_id": crew_user.id})
    assert r.status_code == 201
    assert crew_user.username in r.json()["crew"]


@pytest.mark.asyncio
async def test_add_assignment_as_crew_forbidden(crew_client):
    client, factory = crew_client
    lead = await _seed_lead(factory, status="booked")
    r = await client.post(f"/jobs/{lead.id}/assignments", json={"user_id": "any"})
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_add_duplicate_assignment_is_idempotent(supervisor_client):
    client, factory = supervisor_client
    lead = await _seed_lead(factory, status="booked")
    crew_user = await _seed_user(factory)
    await client.post(f"/jobs/{lead.id}/assignments", json={"user_id": crew_user.id})
    r = await client.post(f"/jobs/{lead.id}/assignments", json={"user_id": crew_user.id})
    assert r.status_code == 201
    assert r.json()["crew"].count(crew_user.username) == 1


@pytest.mark.asyncio
async def test_remove_assignment_as_supervisor(supervisor_client):
    client, factory = supervisor_client
    lead = await _seed_lead(factory, status="booked")
    crew_user = await _seed_user(factory)
    await _seed_assignment(factory, lead_id=lead.id, user_id=crew_user.id)
    r = await client.delete(f"/jobs/{lead.id}/assignments/{crew_user.id}")
    assert r.status_code == 200
    assert crew_user.username not in r.json()["crew"]


@pytest.mark.asyncio
async def test_remove_nonexistent_assignment_returns_404(supervisor_client):
    client, factory = supervisor_client
    lead = await _seed_lead(factory, status="booked")
    r = await client.delete(f"/jobs/{lead.id}/assignments/nonexistent-user")
    assert r.status_code == 404
