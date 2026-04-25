import os
os.environ.setdefault("JWT_SECRET", "test-secret-32-characters-long!!!")

import unittest.mock
import uuid
import pytest
import pytest_asyncio
from datetime import date, datetime, timezone
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base, get_db
from app.dependencies import require_auth
from app.models.app_setting import AppSetting
from app.models.lead import Lead, LeadSourceType, LeadStatus, ServiceType
from app.models.user import User
import app.models.user_availability  # noqa: F401
import app.models.user_weekly_availability  # noqa: F401

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


async def _seed_lead(
    factory,
    status="booked",
    customer_phone="555-123-4567",
    quote_context="high end",
    job_date_requested=None,
    appointment_time_slot=None,
    estimated_job_duration_minutes=None,
    google_calendar_event_id=None,
):
    async with factory() as s:
        lead = Lead(
            source_type=LeadSourceType.manual,
            status=LeadStatus[status],
            service_type=ServiceType.hauling,
            urgency_flag=False,
            customer_name="Test Customer",
            customer_phone=customer_phone,
            quote_context=quote_context,
            job_date_requested=job_date_requested,
            appointment_time_slot=appointment_time_slot,
            estimated_job_duration_minutes=estimated_job_duration_minutes,
            google_calendar_event_id=google_calendar_event_id,
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
async def test_get_jobs_exposes_time_slot_and_google_sync(supervisor_client):
    client, factory = supervisor_client
    await _seed_lead(
        factory,
        status="booked",
        job_date_requested=date(2026, 5, 10),
        appointment_time_slot="09:30",
        estimated_job_duration_minutes=180,
        google_calendar_event_id="gcal-123",
    )

    r = await client.get("/jobs")

    assert r.status_code == 200
    job = r.json()[0]
    assert job["appointment_time_slot"] == "09:30"
    assert job["estimated_job_duration_minutes"] == 180
    assert job["has_google_calendar_event"] is True


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


async def _seed_user(factory, role="crew", username="test-crew", email=None):
    async with factory() as s:
        user = User(
            id=str(uuid.uuid4()),
            username=username,
            credential_hash="x",
            role=role,
            is_active=True,
            email=email,
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


@pytest.mark.asyncio
async def test_add_assignment_user_not_found_returns_404(supervisor_client):
    client, factory = supervisor_client
    lead = await _seed_lead(factory, status="booked")
    r = await client.post(f"/jobs/{lead.id}/assignments", json={"user_id": "nonexistent-user-id"})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_add_assignment_to_non_booked_lead_returns_404(supervisor_client):
    client, factory = supervisor_client
    lead = await _seed_lead(factory, status="new")
    crew_user = await _seed_user(factory)
    r = await client.post(f"/jobs/{lead.id}/assignments", json={"user_id": crew_user.id})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_add_assignment_stores_calendar_event_id(supervisor_client):
    """Adding a crew member with an email should store a calendar event ID on the lead."""
    from unittest.mock import AsyncMock, patch
    from sqlalchemy import select as _select
    from app.models.lead import Lead as _Lead

    client, factory = supervisor_client
    lead = await _seed_lead(factory, status="booked")
    crew_user = await _seed_user(factory, username="crew-email", email="crew@gmail.com")

    with patch("app.services.calendar_service.create_event", new=AsyncMock(return_value="gcal-abc")) as mock_create:
        r = await client.post(f"/jobs/{lead.id}/assignments", json={"user_id": crew_user.id})

    assert r.status_code == 201
    mock_create.assert_called_once()
    async with factory() as s:
        result = await s.execute(_select(_Lead).where(_Lead.id == lead.id))
        db_lead = result.scalar_one()
        assert db_lead.google_calendar_event_id == "gcal-abc"


@pytest.mark.asyncio
async def test_add_assignment_no_email_skips_calendar_create(supervisor_client):
    """Adding a crew member without an email should not call create_event."""
    from unittest.mock import AsyncMock, patch

    client, factory = supervisor_client
    lead = await _seed_lead(factory, status="booked")
    crew_user = await _seed_user(factory, username="crew-noemail", email=None)

    with patch("app.services.calendar_service.create_event", new=AsyncMock(return_value=None)) as mock_create:
        r = await client.post(f"/jobs/{lead.id}/assignments", json={"user_id": crew_user.id})

    assert r.status_code == 201
    mock_create.assert_not_called()


@pytest.mark.asyncio
async def test_manual_google_sync_creates_event(supervisor_client, monkeypatch):
    from unittest.mock import AsyncMock, patch

    client, factory = supervisor_client
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "test-client-id.apps.googleusercontent.com")
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_SECRET", "test-client-secret")

    lead = await _seed_lead(factory, status="booked", job_date_requested=date(2026, 5, 10))
    crew_user = await _seed_user(factory, username="sync-crew", email="sync-crew@gmail.com")
    await _seed_assignment(factory, lead_id=lead.id, user_id=crew_user.id)

    async with factory() as s:
        s.add(AppSetting(key="google_refresh_token", value="refresh-token"))
        await s.commit()

    with (
        patch("app.services.calendar_service._get_credentials", new=AsyncMock(return_value=object())),
        patch("app.services.calendar_service._insert_event_or_raise", new=AsyncMock(return_value="gcal-manual")),
    ):
        r = await client.post(f"/jobs/{lead.id}/sync-google")

    assert r.status_code == 200
    assert r.json()["has_google_calendar_event"] is True


@pytest.mark.asyncio
async def test_manual_google_sync_requires_crew_email(supervisor_client, monkeypatch):
    from unittest.mock import AsyncMock, patch

    client, factory = supervisor_client
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "test-client-id.apps.googleusercontent.com")
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_SECRET", "test-client-secret")

    lead = await _seed_lead(factory, status="booked", job_date_requested=date(2026, 5, 10))
    crew_user = await _seed_user(factory, username="no-email-crew", email=None)
    await _seed_assignment(factory, lead_id=lead.id, user_id=crew_user.id)

    async with factory() as s:
        s.add(AppSetting(key="google_refresh_token", value="refresh-token"))
        await s.commit()

    with patch("app.services.calendar_service._get_credentials", new=AsyncMock(return_value=object())):
        r = await client.post(f"/jobs/{lead.id}/sync-google")

    assert r.status_code == 409
    assert "Google email" in r.json()["detail"]


@pytest.mark.asyncio
async def test_manual_google_sync_surfaces_disabled_calendar_api(supervisor_client, monkeypatch):
    from unittest.mock import AsyncMock, MagicMock, patch

    from googleapiclient.errors import HttpError

    client, factory = supervisor_client
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "test-client-id.apps.googleusercontent.com")
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_SECRET", "test-client-secret")

    lead = await _seed_lead(factory, status="booked", job_date_requested=date(2026, 5, 10))
    crew_user = await _seed_user(factory, username="calendar-crew", email="calendar-crew@gmail.com")
    await _seed_assignment(factory, lead_id=lead.id, user_id=crew_user.id)

    async with factory() as s:
        s.add(AppSetting(key="google_refresh_token", value="refresh-token"))
        await s.commit()

    http_error = HttpError(
        resp=MagicMock(status=403, reason="Forbidden"),
        content=(
            b'{"error":{"code":403,"message":"Google Calendar API has not been used in project 123 before or it is disabled.",'
            b'"errors":[{"message":"Google Calendar API has not been used in project 123 before or it is disabled.",'
            b'"domain":"usageLimits","reason":"accessNotConfigured"}]}}'
        ),
        uri="https://www.googleapis.com/calendar/v3/calendars/primary/events",
    )

    with (
        patch("app.services.calendar_service._get_credentials", new=AsyncMock(return_value=object())),
        patch("app.services.calendar_service._insert_event_or_raise", new=AsyncMock(side_effect=http_error)),
    ):
        r = await client.post(f"/jobs/{lead.id}/sync-google")

    assert r.status_code == 503
    assert "Enable the Google Calendar API" in r.json()["detail"]


@pytest.mark.asyncio
async def test_remove_assignment_clears_calendar_event_id_when_crew_empty(supervisor_client):
    """Removing the last crew member should delete the event and clear the event ID."""
    from unittest.mock import AsyncMock, patch
    from sqlalchemy import select as _select
    from app.models.lead import Lead as _Lead

    client, factory = supervisor_client
    lead = await _seed_lead(factory, status="booked")
    crew_user = await _seed_user(factory, username="only-crew", email="only@gmail.com")
    await _seed_assignment(factory, lead_id=lead.id, user_id=crew_user.id)

    async with factory() as s:
        result = await s.execute(_select(_Lead).where(_Lead.id == lead.id))
        db_lead = result.scalar_one()
        db_lead.google_calendar_event_id = "gcal-existing"
        await s.commit()

    with patch("app.services.calendar_service.delete_event", new=AsyncMock(return_value=True)) as mock_delete:
        r = await client.delete(f"/jobs/{lead.id}/assignments/{crew_user.id}")

    assert r.status_code == 200
    mock_delete.assert_called_once_with(unittest.mock.ANY, "gcal-existing")
    async with factory() as s:
        result = await s.execute(_select(_Lead).where(_Lead.id == lead.id))
        db_lead = result.scalar_one()
        assert db_lead.google_calendar_event_id is None
