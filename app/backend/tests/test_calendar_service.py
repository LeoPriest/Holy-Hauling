import os
from datetime import date, datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.app_setting import AppSetting
from app.models.lead import Lead, LeadSourceType, LeadStatus, ServiceType

# Import related models so SQLAlchemy can resolve Lead relationships.
import app.models.ai_review  # noqa: F401
import app.models.job_assignment  # noqa: F401
import app.models.lead_alert  # noqa: F401
import app.models.lead_chat_message  # noqa: F401
import app.models.lead_event  # noqa: F401
import app.models.ocr_result  # noqa: F401
import app.models.push_subscription  # noqa: F401
import app.models.screenshot  # noqa: F401
import app.models.user  # noqa: F401
import app.models.user_availability  # noqa: F401
import app.models.user_weekly_availability  # noqa: F401

os.environ.setdefault("JWT_SECRET", "test-secret-32-characters-long!!!")
os.environ.setdefault("GOOGLE_OAUTH_CLIENT_ID", "test-client-id")
os.environ.setdefault("GOOGLE_OAUTH_CLIENT_SECRET", "test-client-secret")

TEST_DB = "sqlite+aiosqlite:///:memory:"


@pytest_asyncio.fixture
async def db():
    engine = create_async_engine(TEST_DB)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    async with Factory() as session:
        yield session
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


def _make_lead(**kwargs):
    defaults = dict(
        id="lead-1",
        source_type=LeadSourceType.manual,
        status=LeadStatus.booked,
        service_type=ServiceType.hauling,
        urgency_flag=False,
        customer_name="Jane Doe",
        job_date_requested=date(2026, 5, 10),
        job_address="123 Main St, Springfield",
        scope_notes="2 sofas, 1 dresser",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    defaults.update(kwargs)
    return Lead(**defaults)


def test_build_event_body_fields():
    from app.services.calendar_service import _build_event_body

    lead = _make_lead()
    body = _build_event_body(lead, ["crew@gmail.com"])

    assert body["summary"] == "Hauling - Jane Doe"
    assert body["start"] == {"date": "2026-05-10"}
    assert body["end"] == {"date": "2026-05-10"}
    assert {"email": "crew@gmail.com"} in body["attendees"]
    assert body["location"] == "123 Main St, Springfield"
    assert body["description"] == "2 sofas, 1 dresser"


def test_build_event_body_uses_datetime_when_time_slot_present():
    from app.services.calendar_service import _build_event_body

    lead = _make_lead(appointment_time_slot="14:30")
    body = _build_event_body(lead, ["crew@gmail.com"])

    assert body["start"] == {
        "dateTime": "2026-05-10T14:30:00",
        "timeZone": "America/Chicago",
    }
    assert body["end"] == {
        "dateTime": "2026-05-10T15:30:00",
        "timeZone": "America/Chicago",
    }


def test_build_event_body_uses_estimated_duration_when_present():
    from app.services.calendar_service import _build_event_body

    lead = _make_lead(appointment_time_slot="14:30", estimated_job_duration_minutes=150)
    body = _build_event_body(lead, ["crew@gmail.com"])

    assert body["end"] == {
        "dateTime": "2026-05-10T17:00:00",
        "timeZone": "America/Chicago",
    }


def test_build_event_body_null_date_uses_tomorrow():
    from app.services.calendar_service import _build_event_body

    lead = _make_lead(job_date_requested=None)
    body = _build_event_body(lead, ["crew@gmail.com"])
    tomorrow = (date.today() + timedelta(days=1)).isoformat()

    assert body["start"] == {"date": tomorrow}


def test_build_event_body_omits_missing_location_and_notes():
    from app.services.calendar_service import _build_event_body

    lead = _make_lead(job_address=None, job_location=None, scope_notes=None)
    body = _build_event_body(lead, ["crew@gmail.com"])

    assert "location" not in body
    assert "description" not in body


def test_build_event_body_falls_back_to_job_location():
    from app.services.calendar_service import _build_event_body

    lead = _make_lead(job_address=None, job_location="Springfield, IL")
    body = _build_event_body(lead, ["crew@gmail.com"])

    assert body["location"] == "Springfield, IL"


def test_build_event_body_fallback_name_and_service():
    from app.services.calendar_service import _build_event_body

    lead = _make_lead(customer_name=None, service_type=None)
    body = _build_event_body(lead, ["crew@gmail.com"])

    assert body["summary"] == "Job - Customer"


@pytest.mark.asyncio
async def test_create_event_no_credentials_returns_none(db):
    from app.services import calendar_service

    lead = _make_lead()
    result = await calendar_service.create_event(db, lead, ["crew@gmail.com"])

    assert result is None


@pytest.mark.asyncio
async def test_create_event_empty_emails_returns_none(db):
    from app.services import calendar_service

    db.add(AppSetting(key="google_refresh_token", value="fake-token"))
    await db.commit()
    lead = _make_lead()
    result = await calendar_service.create_event(db, lead, [])

    assert result is None


@pytest.mark.asyncio
async def test_create_event_with_mocked_google(db):
    from app.services import calendar_service

    db.add(AppSetting(key="google_refresh_token", value="fake-token"))
    await db.commit()
    lead = _make_lead()

    mock_creds = MagicMock()
    mock_service = MagicMock()
    mock_service.events.return_value.insert.return_value.execute.return_value = {"id": "gcal-event-123"}

    async def fake_get_credentials(_db):
        return mock_creds

    with patch("app.services.calendar_service._get_credentials", side_effect=fake_get_credentials):
        with patch("app.services.calendar_service.Request"):
            with patch("app.services.calendar_service.build", return_value=mock_service):
                result = await calendar_service.create_event(db, lead, ["crew@gmail.com"])

    assert result == "gcal-event-123"


@pytest.mark.asyncio
async def test_update_event_no_credentials_is_silent(db):
    from app.services import calendar_service

    lead = _make_lead()
    await calendar_service.update_event(db, "event-id", lead, ["crew@gmail.com"])


@pytest.mark.asyncio
async def test_update_event_with_mocked_google(db):
    from app.services import calendar_service

    db.add(AppSetting(key="google_refresh_token", value="fake-token"))
    await db.commit()
    lead = _make_lead()

    mock_creds = MagicMock()
    mock_service = MagicMock()

    async def fake_get_credentials(_db):
        return mock_creds

    with patch("app.services.calendar_service._get_credentials", side_effect=fake_get_credentials):
        with patch("app.services.calendar_service.Request"):
            with patch("app.services.calendar_service.build", return_value=mock_service):
                await calendar_service.update_event(db, "gcal-event-123", lead, ["crew@gmail.com"])

    mock_service.events.return_value.update.return_value.execute.assert_called_once()


@pytest.mark.asyncio
async def test_delete_event_no_credentials_is_silent(db):
    from app.services import calendar_service

    await calendar_service.delete_event(db, "event-id")


@pytest.mark.asyncio
async def test_delete_event_with_mocked_google(db):
    from app.services import calendar_service

    db.add(AppSetting(key="google_refresh_token", value="fake-token"))
    await db.commit()

    mock_creds = MagicMock()
    mock_service = MagicMock()

    async def fake_get_credentials(_db):
        return mock_creds

    with patch("app.services.calendar_service._get_credentials", side_effect=fake_get_credentials):
        with patch("app.services.calendar_service.Request"):
            with patch("app.services.calendar_service.build", return_value=mock_service):
                result = await calendar_service.delete_event(db, "gcal-event-123")

    assert result is True
    mock_service.events.return_value.delete.return_value.execute.assert_called_once()
