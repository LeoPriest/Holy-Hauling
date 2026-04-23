# Google Calendar Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically create, update, and delete Google Calendar events when crew are assigned to booked jobs, keeping every crew member's personal calendar accurate as job details change.

**Architecture:** OAuth 2.0 offline refresh token stored in `app_settings` table. One event per job — all assigned crew are attendees. A new `calendar_service.py` owns all Google API logic; `jobs.py` and `lead_service.py` call `sync_job_calendar` as fire-and-forget after DB commits.

**Tech Stack:** `google-auth-oauthlib>=1.2.0`, `google-api-python-client>=2.100.0` (new); FastAPI, SQLAlchemy async, React + TanStack Query (existing).

---

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Modify | `app/backend/requirements.txt` | Add Google packages |
| Modify | `app/backend/app/models/user.py` | Add `email` column |
| Modify | `app/backend/app/models/lead.py` | Add `google_calendar_event_id` column |
| Modify | `app/backend/main.py` | Add two startup migrations; import admin_google router |
| Modify | `app/backend/app/schemas/user.py` | Add `email` to UserCreate, UserPatch, UserListItem |
| Modify | `app/backend/app/schemas/auth.py` | Add `email` to UserOut |
| Modify | `app/backend/app/routers/admin_users.py` | Persist email in create/patch |
| **Create** | `app/backend/app/services/calendar_service.py` | All Google Calendar API logic |
| **Create** | `app/backend/app/routers/admin_google.py` | OAuth connect/callback/status endpoints |
| Modify | `app/backend/app/routers/jobs.py` | Call `sync_job_calendar` after assignment changes |
| Modify | `app/backend/app/services/lead_service.py` | Call `sync_job_calendar` when relevant fields change |
| Modify | `app/frontend/src/hooks/useUsers.ts` | Add `email` to `TeamMember` interface |
| Modify | `app/frontend/src/screens/AdminUsersScreen.tsx` | Add email field to Add/Edit modals |
| Modify | `app/frontend/src/screens/SettingsScreen.tsx` | Add Google Calendar connection section |
| **Create** | `app/backend/tests/test_calendar_service.py` | Unit tests for calendar_service |
| **Create** | `app/backend/tests/test_admin_google.py` | Tests for OAuth status/connect endpoints |
| Modify | `app/backend/tests/test_admin_users.py` | Add email field tests |
| Modify | `app/backend/tests/test_jobs.py` | Add calendar sync integration tests |

---

## Task 1: Install Google packages and add DB columns

**Files:**
- Modify: `app/backend/requirements.txt`
- Modify: `app/backend/app/models/user.py`
- Modify: `app/backend/app/models/lead.py`
- Modify: `app/backend/main.py` (migrations only)

- [ ] **Step 1: Write the failing model attribute tests**

Create `app/backend/tests/test_google_calendar_models.py`:

```python
def test_user_has_email_column():
    from app.models.user import User
    assert hasattr(User, 'email')


def test_lead_has_google_calendar_event_id_column():
    from app.models.lead import Lead
    assert hasattr(Lead, 'google_calendar_event_id')
```

- [ ] **Step 2: Run tests to verify they fail**

```
cd app/backend
pytest tests/test_google_calendar_models.py -v
```
Expected: FAIL — `AssertionError`

- [ ] **Step 3: Add packages to requirements.txt**

In `app/backend/requirements.txt`, add after the last line:
```
google-auth-oauthlib>=1.2.0
google-api-python-client>=2.100.0
```

- [ ] **Step 4: Install packages**

```
cd app/backend
pip install -r requirements.txt
```
Expected: Successfully installed google-auth-oauthlib and google-api-python-client (plus transitive deps).

- [ ] **Step 5: Add `email` column to User model**

In `app/backend/app/models/user.py`, add after `created_by`:
```python
    email = Column(String, nullable=True)
```

- [ ] **Step 6: Add `google_calendar_event_id` column to Lead model**

In `app/backend/app/models/lead.py`, add after `started_at`:
```python
    google_calendar_event_id = Column(String, nullable=True)
```

- [ ] **Step 7: Add two startup migration functions in main.py**

In `app/backend/main.py`, add these two functions after `_migrate_leads_add_job_timing_columns`:

```python
async def _migrate_users_add_email(conn) -> None:
    """Add email column to users for Google Calendar invite addresses."""
    result = await conn.execute(text("PRAGMA table_info(users)"))
    rows = result.fetchall()
    if not rows:
        return
    if "email" in _existing_columns(rows):
        return
    await conn.execute(text("ALTER TABLE users ADD COLUMN email VARCHAR"))
    print("[startup] users: added email column")


async def _migrate_leads_add_calendar_event_id(conn) -> None:
    """Add google_calendar_event_id column to leads."""
    result = await conn.execute(text("PRAGMA table_info(leads)"))
    rows = result.fetchall()
    if not rows:
        return
    if "google_calendar_event_id" in _existing_columns(rows):
        return
    await conn.execute(text("ALTER TABLE leads ADD COLUMN google_calendar_event_id VARCHAR"))
    print("[startup] leads: added google_calendar_event_id column")
```

- [ ] **Step 8: Call the migrations in the lifespan function**

In `main.py`, inside the `lifespan` function, add both calls after `_migrate_leads_add_job_address`:

```python
        await _migrate_users_add_email(conn)
        await _migrate_leads_add_calendar_event_id(conn)
```

- [ ] **Step 9: Run tests to verify they pass**

```
cd app/backend
pytest tests/test_google_calendar_models.py -v
```
Expected: PASS (2 tests)

- [ ] **Step 10: Run full suite to verify no regressions**

```
cd app/backend
pytest -v
```
Expected: All previously passing tests still pass.

- [ ] **Step 11: Commit**

```bash
git add app/backend/requirements.txt app/backend/app/models/user.py app/backend/app/models/lead.py app/backend/main.py app/backend/tests/test_google_calendar_models.py
git commit -m "feat: add google packages, user.email, leads.google_calendar_event_id"
```

---

## Task 2: User email field — schemas and admin router

**Files:**
- Modify: `app/backend/app/schemas/user.py`
- Modify: `app/backend/app/schemas/auth.py`
- Modify: `app/backend/app/routers/admin_users.py`
- Test: `app/backend/tests/test_admin_users.py`

- [ ] **Step 1: Write the failing tests**

Add to the bottom of `app/backend/tests/test_admin_users.py`:

```python
@pytest.mark.asyncio
async def test_create_user_with_email(admin_client):
    client, _ = admin_client
    r = await client.post("/admin/users", json={
        "username": "emailuser", "pin": "2222", "role": "crew",
        "email": "emailuser@gmail.com"
    })
    assert r.status_code == 201
    r2 = await client.get("/admin/users")
    user = next(u for u in r2.json() if u["username"] == "emailuser")
    assert user["email"] == "emailuser@gmail.com"


@pytest.mark.asyncio
async def test_patch_user_email(admin_client):
    client, factory = admin_client
    user = await _seed_user(factory, username="grace", role="crew")
    r = await client.patch(f"/admin/users/{user.id}", json={"email": "grace@gmail.com"})
    assert r.status_code == 200
    r2 = await client.get("/admin/users")
    u = next(x for x in r2.json() if x["username"] == "grace")
    assert u["email"] == "grace@gmail.com"


@pytest.mark.asyncio
async def test_create_user_email_optional(admin_client):
    client, _ = admin_client
    r = await client.post("/admin/users", json={"username": "noemail", "pin": "3333", "role": "crew"})
    assert r.status_code == 201
    r2 = await client.get("/admin/users")
    user = next(u for u in r2.json() if u["username"] == "noemail")
    assert user["email"] is None
```

- [ ] **Step 2: Run tests to verify they fail**

```
cd app/backend
pytest tests/test_admin_users.py::test_create_user_with_email tests/test_admin_users.py::test_patch_user_email tests/test_admin_users.py::test_create_user_email_optional -v
```
Expected: FAIL — `email` key not found in response or validation error.

- [ ] **Step 3: Update UserCreate, UserPatch, UserListItem in user.py**

Replace the full content of `app/backend/app/schemas/user.py` with:

```python
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

UserRole = Literal["admin", "facilitator", "supervisor", "crew"]


class UserCreate(BaseModel):
    username: str
    pin: str = Field(min_length=4, max_length=4)
    role: UserRole
    email: Optional[str] = None


class UserPatch(BaseModel):
    role: Optional[UserRole] = None
    pin: Optional[str] = Field(default=None, min_length=4, max_length=4)
    is_active: Optional[bool] = None
    email: Optional[str] = None


class UserListItem(BaseModel):
    id: str
    username: str
    role: str
    is_active: bool
    email: Optional[str] = None

    model_config = {"from_attributes": True}
```

- [ ] **Step 4: Add `email` to UserOut in auth.py**

In `app/backend/app/schemas/auth.py`, update `UserOut`:

```python
class UserOut(BaseModel):
    id: str
    username: str
    role: str
    is_active: bool
    email: Optional[str] = None

    model_config = {"from_attributes": True}
```

Also add `from typing import Optional` at the top of `auth.py`.

- [ ] **Step 5: Update create_user in admin_users.py to persist email**

In `app/backend/app/routers/admin_users.py`, update the `User(...)` constructor inside `create_user`:

```python
    user = User(
        username=data.username,
        credential_hash=hash_pin(data.pin),
        role=data.role,
        email=data.email,
        created_at=datetime.now(timezone.utc),
        created_by=current_user.id,
    )
```

- [ ] **Step 6: Update patch_user in admin_users.py to handle email**

In `app/backend/app/routers/admin_users.py`, inside `patch_user`, add after `if data.is_active is not None:`:

```python
    if data.email is not None:
        user.email = data.email
```

- [ ] **Step 7: Run the new tests to verify they pass**

```
cd app/backend
pytest tests/test_admin_users.py -v
```
Expected: All tests in this file PASS.

- [ ] **Step 8: Run the full suite**

```
cd app/backend
pytest -v
```
Expected: All tests pass.

- [ ] **Step 9: Commit**

```bash
git add app/backend/app/schemas/user.py app/backend/app/schemas/auth.py app/backend/app/routers/admin_users.py app/backend/tests/test_admin_users.py
git commit -m "feat: add optional email field to users for Google Calendar invites"
```

---

## Task 3: calendar_service.py

**Files:**
- Create: `app/backend/app/services/calendar_service.py`
- Create: `app/backend/tests/test_calendar_service.py`

- [ ] **Step 1: Write the failing tests**

Create `app/backend/tests/test_calendar_service.py`:

```python
import os
os.environ.setdefault("JWT_SECRET", "test-secret-32-characters-long!!!")
os.environ.setdefault("GOOGLE_OAUTH_CLIENT_ID", "test-client-id")
os.environ.setdefault("GOOGLE_OAUTH_CLIENT_SECRET", "test-client-secret")

import pytest
import pytest_asyncio
from datetime import date, datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock, patch
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.app_setting import AppSetting
from app.models.lead import Lead, LeadSourceType, LeadStatus, ServiceType

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


# ── _build_event_body ──────────────────────────────────────────────────────────

def test_build_event_body_fields():
    from app.services.calendar_service import _build_event_body
    lead = _make_lead()
    body = _build_event_body(lead, ["crew@gmail.com"])
    assert body["summary"] == "Hauling — Jane Doe"
    assert body["start"] == {"date": "2026-05-10"}
    assert body["end"] == {"date": "2026-05-10"}
    assert {"email": "crew@gmail.com"} in body["attendees"]
    assert body["location"] == "123 Main St, Springfield"
    assert body["description"] == "2 sofas, 1 dresser"


def test_build_event_body_null_date_uses_tomorrow():
    from app.services.calendar_service import _build_event_body
    lead = _make_lead(job_date_requested=None)
    body = _build_event_body(lead, ["crew@gmail.com"])
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    assert body["start"] == {"date": tomorrow}


def test_build_event_body_omits_missing_location_and_notes():
    from app.services.calendar_service import _build_event_body
    lead = _make_lead(job_address=None, scope_notes=None)
    body = _build_event_body(lead, ["crew@gmail.com"])
    assert "location" not in body
    assert "description" not in body


def test_build_event_body_fallback_name_and_service():
    from app.services.calendar_service import _build_event_body
    lead = _make_lead(customer_name=None, service_type=None)
    body = _build_event_body(lead, ["crew@gmail.com"])
    assert body["summary"] == "Job — Customer"


# ── create_event ──────────────────────────────────────────────────────────────

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

    async def fake_get_credentials(db):
        return mock_creds

    with patch("app.services.calendar_service._get_credentials", side_effect=fake_get_credentials):
        with patch("app.services.calendar_service.Request"):
            with patch("app.services.calendar_service.build", return_value=mock_service):
                result = await calendar_service.create_event(db, lead, ["crew@gmail.com"])

    assert result == "gcal-event-123"


# ── update_event ──────────────────────────────────────────────────────────────

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

    async def fake_get_credentials(db):
        return mock_creds

    with patch("app.services.calendar_service._get_credentials", side_effect=fake_get_credentials):
        with patch("app.services.calendar_service.Request"):
            with patch("app.services.calendar_service.build", return_value=mock_service):
                await calendar_service.update_event(db, "gcal-event-123", lead, ["crew@gmail.com"])

    mock_service.events.return_value.update.return_value.execute.assert_called_once()


# ── delete_event ──────────────────────────────────────────────────────────────

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

    async def fake_get_credentials(db):
        return mock_creds

    with patch("app.services.calendar_service._get_credentials", side_effect=fake_get_credentials):
        with patch("app.services.calendar_service.Request"):
            with patch("app.services.calendar_service.build", return_value=mock_service):
                await calendar_service.delete_event(db, "gcal-event-123")

    mock_service.events.return_value.delete.return_value.execute.assert_called_once()
```

- [ ] **Step 2: Run tests to verify they fail**

```
cd app/backend
pytest tests/test_calendar_service.py -v
```
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.calendar_service'`

- [ ] **Step 3: Create calendar_service.py**

Create `app/backend/app/services/calendar_service.py`:

```python
from __future__ import annotations

import logging
import os
from datetime import date, timedelta

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_setting import AppSetting
from app.models.lead import Lead

_log = logging.getLogger(__name__)
_SCOPES = ["https://www.googleapis.com/auth/calendar.events"]
_TOKEN_URI = "https://oauth2.googleapis.com/token"


async def _get_credentials(db: AsyncSession) -> Credentials | None:
    """Return refreshable credentials from app_settings, or None if not configured."""
    client_id = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "")
    client_secret = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", "")
    if not client_id or not client_secret:
        return None
    result = await db.execute(
        select(AppSetting).where(AppSetting.key == "google_refresh_token")
    )
    row = result.scalar_one_or_none()
    if row is None or not row.value:
        return None
    return Credentials(
        token=None,
        refresh_token=row.value,
        token_uri=_TOKEN_URI,
        client_id=client_id,
        client_secret=client_secret,
        scopes=_SCOPES,
    )


def _build_event_body(lead: Lead, crew_emails: list[str]) -> dict:
    service_name = lead.service_type.value.title() if lead.service_type else "Job"
    customer = lead.customer_name or "Customer"
    if lead.job_date_requested:
        event_date = lead.job_date_requested.isoformat()
    else:
        event_date = (date.today() + timedelta(days=1)).isoformat()
    body: dict = {
        "summary": f"{service_name} — {customer}",
        "start": {"date": event_date},
        "end": {"date": event_date},
        "attendees": [{"email": addr} for addr in crew_emails],
    }
    if lead.job_address:
        body["location"] = lead.job_address
    if lead.scope_notes:
        body["description"] = lead.scope_notes
    return body


async def get_crew_emails(db: AsyncSession, lead_id: str) -> list[str]:
    """Return Google email addresses for all crew assigned to a job."""
    from app.models.job_assignment import JobAssignment
    from app.models.user import User as _User
    result = await db.execute(
        select(_User.email)
        .join(JobAssignment, _User.id == JobAssignment.user_id)
        .where(JobAssignment.lead_id == lead_id, _User.email.isnot(None))
    )
    return [row[0] for row in result.fetchall() if row[0]]


async def create_event(db: AsyncSession, lead: Lead, crew_emails: list[str]) -> str | None:
    """Create a Calendar event and return its Google event ID, or None on failure."""
    if not crew_emails:
        return None
    credentials = await _get_credentials(db)
    if credentials is None:
        return None
    try:
        credentials.refresh(Request())
        service = build("calendar", "v3", credentials=credentials)
        event = service.events().insert(
            calendarId="primary",
            body=_build_event_body(lead, crew_emails),
            sendUpdates="all",
        ).execute()
        return event.get("id")
    except Exception as exc:
        _log.error("calendar create_event failed: %s", exc)
        return None


async def update_event(
    db: AsyncSession, event_id: str, lead: Lead, crew_emails: list[str]
) -> None:
    """Update an existing Calendar event's details and attendees."""
    credentials = await _get_credentials(db)
    if credentials is None:
        return
    try:
        credentials.refresh(Request())
        service = build("calendar", "v3", credentials=credentials)
        service.events().update(
            calendarId="primary",
            eventId=event_id,
            body=_build_event_body(lead, crew_emails),
            sendUpdates="all",
        ).execute()
    except Exception as exc:
        _log.error("calendar update_event failed: %s", exc)


async def delete_event(db: AsyncSession, event_id: str) -> None:
    """Delete a Calendar event and notify attendees."""
    credentials = await _get_credentials(db)
    if credentials is None:
        return
    try:
        credentials.refresh(Request())
        service = build("calendar", "v3", credentials=credentials)
        service.events().delete(
            calendarId="primary",
            eventId=event_id,
            sendUpdates="all",
        ).execute()
    except Exception as exc:
        _log.error("calendar delete_event failed: %s", exc)


async def sync_job_calendar(db: AsyncSession, lead_id: str) -> None:
    """Create, update, or delete the Calendar event for a job based on current state.

    Fire-and-forget: errors are logged but never propagated to callers.
    One event per job; all assigned crew with emails are attendees.
    """
    try:
        result = await db.execute(select(Lead).where(Lead.id == lead_id))
        lead = result.scalar_one_or_none()
        if lead is None:
            return
        crew_emails = await get_crew_emails(db, lead_id)
        if lead.google_calendar_event_id:
            if crew_emails:
                await update_event(db, lead.google_calendar_event_id, lead, crew_emails)
            else:
                await delete_event(db, lead.google_calendar_event_id)
                lead.google_calendar_event_id = None
                await db.commit()
        else:
            if crew_emails:
                event_id = await create_event(db, lead, crew_emails)
                if event_id:
                    lead.google_calendar_event_id = event_id
                    await db.commit()
    except Exception as exc:
        _log.error("sync_job_calendar failed for lead %s: %s", lead_id, exc)
```

- [ ] **Step 4: Run tests to verify they pass**

```
cd app/backend
pytest tests/test_calendar_service.py -v
```
Expected: All tests PASS.

- [ ] **Step 5: Run the full suite**

```
cd app/backend
pytest -v
```
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/backend/app/services/calendar_service.py app/backend/tests/test_calendar_service.py
git commit -m "feat: add calendar_service with create/update/delete/sync_job_calendar"
```

---

## Task 4: admin_google router — OAuth connect/callback/status

**Files:**
- Create: `app/backend/app/routers/admin_google.py`
- Modify: `app/backend/main.py` (import + register router)
- Create: `app/backend/tests/test_admin_google.py`

- [ ] **Step 1: Write the failing tests**

Create `app/backend/tests/test_admin_google.py`:

```python
import os
os.environ.setdefault("JWT_SECRET", "test-secret-32-characters-long!!!")

import pytest
import pytest_asyncio
from datetime import datetime, timezone
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base, get_db
from app.dependencies import require_auth
from app.models.user import User
from app.models.app_setting import AppSetting

TEST_DB = "sqlite+aiosqlite:///:memory:"


def _mock_admin():
    return User(
        id="admin-id", username="admin", credential_hash="x",
        role="admin", is_active=True, created_at=datetime.now(timezone.utc),
    )


@pytest_asyncio.fixture
async def client():
    from main import app
    engine = create_async_engine(TEST_DB)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async def override_get_db():
        async with Factory() as s:
            yield s

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[require_auth] = _mock_admin

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac, Factory

    app.dependency_overrides.clear()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest.mark.asyncio
async def test_status_not_connected(client):
    ac, _ = client
    r = await ac.get("/admin/google/status")
    assert r.status_code == 200
    assert r.json() == {"connected": False}


@pytest.mark.asyncio
async def test_status_connected(client):
    ac, factory = client
    async with factory() as s:
        s.add(AppSetting(key="google_refresh_token", value="some-token"))
        await s.commit()
    r = await ac.get("/admin/google/status")
    assert r.status_code == 200
    assert r.json() == {"connected": True}


@pytest.mark.asyncio
async def test_connect_returns_503_when_env_not_set(client):
    ac, _ = client
    # GOOGLE_OAUTH_CLIENT_ID and SECRET are not set in this test environment
    r = await ac.get("/admin/google/connect")
    assert r.status_code == 503


@pytest.mark.asyncio
async def test_connect_returns_url_when_configured(client, monkeypatch):
    ac, _ = client
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "fake-client-id")
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_SECRET", "fake-client-secret")
    monkeypatch.setenv("GOOGLE_OAUTH_REDIRECT_URI", "http://localhost:8000/admin/google/callback")
    r = await ac.get("/admin/google/connect")
    assert r.status_code == 200
    assert "url" in r.json()
    assert "accounts.google.com" in r.json()["url"]
```

- [ ] **Step 2: Run tests to verify they fail**

```
cd app/backend
pytest tests/test_admin_google.py -v
```
Expected: FAIL with 404 (routes not registered yet).

- [ ] **Step 3: Create admin_google.py**

Create `app/backend/app/routers/admin_google.py`:

```python
from __future__ import annotations

import os

from fastapi import APIRouter, Depends, HTTPException
from google_auth_oauthlib.flow import Flow
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_role
from app.models.app_setting import AppSetting
from app.models.user import User

router = APIRouter(prefix="/admin/google", tags=["admin-google"])

_SCOPES = ["https://www.googleapis.com/auth/calendar.events"]


def _make_flow() -> Flow:
    client_id = os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "")
    client_secret = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", "")
    redirect_uri = os.environ.get(
        "GOOGLE_OAUTH_REDIRECT_URI",
        "http://localhost:8000/admin/google/callback",
    )
    if not client_id or not client_secret:
        raise HTTPException(
            status_code=503,
            detail="Google OAuth not configured — set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET",
        )
    return Flow.from_client_config(
        {
            "web": {
                "client_id": client_id,
                "client_secret": client_secret,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [redirect_uri],
            }
        },
        scopes=_SCOPES,
        redirect_uri=redirect_uri,
    )


@router.get("/connect")
async def google_connect(
    current_user: User = Depends(require_role("admin")),
):
    """Return the Google OAuth consent URL for the admin to open."""
    flow = _make_flow()
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )
    return {"url": auth_url}


@router.get("/callback")
async def google_callback(
    code: str,
    db: AsyncSession = Depends(get_db),
):
    """Exchange the OAuth code for a refresh token and persist it.

    Called by Google's redirect — no JWT required on this endpoint since
    the code itself is the short-lived credential from Google.
    """
    flow = _make_flow()
    flow.fetch_token(code=code)
    refresh_token = flow.credentials.refresh_token
    if not refresh_token:
        raise HTTPException(
            status_code=400,
            detail="No refresh token returned. Revoke this app's access in your Google account and try again.",
        )
    result = await db.execute(
        select(AppSetting).where(AppSetting.key == "google_refresh_token")
    )
    row = result.scalar_one_or_none()
    if row:
        row.value = refresh_token
    else:
        db.add(AppSetting(key="google_refresh_token", value=refresh_token))
    await db.commit()
    return {"connected": True, "message": "Google Calendar connected. You can close this tab."}


@router.get("/status")
async def google_status(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """Return whether a Google refresh token is currently stored."""
    result = await db.execute(
        select(AppSetting).where(AppSetting.key == "google_refresh_token")
    )
    row = result.scalar_one_or_none()
    return {"connected": bool(row and row.value)}
```

- [ ] **Step 4: Register the router in main.py**

In `app/backend/main.py`, update the import line:

```python
from app.routers import admin_google, admin_users, auth as auth_router, chat, ingest, jobs, leads, push, settings as settings_router, users
```

And add the router registration after `app.include_router(admin_users.router)`:

```python
app.include_router(admin_google.router)
```

- [ ] **Step 5: Add env vars to .env.example**

In `app/backend/.env.example`, add:

```
# Google Calendar OAuth (admin setup via /admin/google/connect)
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:8000/admin/google/callback
```

- [ ] **Step 6: Run new tests to verify they pass**

```
cd app/backend
pytest tests/test_admin_google.py -v
```
Expected: All 4 tests PASS.

- [ ] **Step 7: Run the full suite**

```
cd app/backend
pytest -v
```
Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add app/backend/app/routers/admin_google.py app/backend/main.py app/backend/tests/test_admin_google.py app/backend/.env.example
git commit -m "feat: add /admin/google OAuth connect/callback/status endpoints"
```

---

## Task 5: Calendar triggers in jobs.py

**Files:**
- Modify: `app/backend/app/routers/jobs.py`
- Test: `app/backend/tests/test_jobs.py`

- [ ] **Step 1: Update `_seed_user` in test_jobs.py to support email**

In `app/backend/tests/test_jobs.py`, replace the `_seed_user` function:

```python
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
```

- [ ] **Step 2: Write the failing calendar sync tests**

Add to the bottom of `app/backend/tests/test_jobs.py`:

```python
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
async def test_remove_assignment_clears_calendar_event_id_when_crew_empty(supervisor_client):
    """Removing the last crew member should delete the event and clear the event ID."""
    from unittest.mock import AsyncMock, patch
    from sqlalchemy import select as _select
    from app.models.lead import Lead as _Lead
    from app.models.job_assignment import JobAssignment

    client, factory = supervisor_client
    lead = await _seed_lead(factory, status="booked")
    crew_user = await _seed_user(factory, username="only-crew", email="only@gmail.com")
    await _seed_assignment(factory, lead_id=lead.id, user_id=crew_user.id)

    # Seed a fake event ID on the lead
    async with factory() as s:
        result = await s.execute(_select(_Lead).where(_Lead.id == lead.id))
        db_lead = result.scalar_one()
        db_lead.google_calendar_event_id = "gcal-existing"
        await s.commit()

    with patch("app.services.calendar_service.delete_event", new=AsyncMock()) as mock_delete:
        r = await client.delete(f"/jobs/{lead.id}/assignments/{crew_user.id}")

    assert r.status_code == 200
    mock_delete.assert_called_once_with(unittest.mock.ANY, "gcal-existing")
    async with factory() as s:
        result = await s.execute(_select(_Lead).where(_Lead.id == lead.id))
        db_lead = result.scalar_one()
        assert db_lead.google_calendar_event_id is None
```

Also add `import unittest.mock` at the top of `test_jobs.py`.

- [ ] **Step 3: Run tests to verify they fail**

```
cd app/backend
pytest tests/test_jobs.py::test_add_assignment_stores_calendar_event_id tests/test_jobs.py::test_add_assignment_no_email_skips_calendar_create tests/test_jobs.py::test_remove_assignment_clears_calendar_event_id_when_crew_empty -v
```
Expected: FAIL

- [ ] **Step 4: Update jobs.py to call sync_job_calendar**

Replace the full content of `app/backend/app/routers/jobs.py`:

```python
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_auth, require_role
from app.models.job_assignment import JobAssignment
from app.models.lead import Lead, LeadStatus
from app.models.user import User
from app.schemas.jobs import JobAssignmentCreate, JobOut, JobStatusUpdate
from app.services import calendar_service, lead_service

_log = logging.getLogger(__name__)
router = APIRouter(prefix="/jobs", tags=["jobs"])


async def _get_crew(db: AsyncSession, lead_id: str) -> list[str]:
    result = await db.execute(
        select(User.username)
        .join(JobAssignment, User.id == JobAssignment.user_id)
        .where(JobAssignment.lead_id == lead_id)
    )
    return [row[0] for row in result.fetchall()]


def _job_phase(lead: Lead) -> str | None:
    if lead.started_at:
        return "started"
    if lead.arrived_at:
        return "arrived"
    if lead.en_route_at:
        return "en_route"
    if lead.dispatched_at:
        return "dispatched"
    return None


def _iso(dt) -> str | None:
    return dt.isoformat() if dt else None


async def _to_job_out(db: AsyncSession, lead: Lead, role: str) -> JobOut:
    crew = await _get_crew(db, lead.id)
    date_str = lead.job_date_requested.isoformat() if lead.job_date_requested else None
    return JobOut(
        id=lead.id,
        customer_name=lead.customer_name,
        service_type=lead.service_type.value if lead.service_type is not None else None,
        job_location=lead.job_location,
        job_address=lead.job_address,
        job_date_requested=date_str,
        scope_notes=lead.scope_notes,
        crew=crew,
        customer_phone=lead.customer_phone if role != "crew" else None,
        quote_context=lead.quote_context if role != "crew" else None,
        job_phase=_job_phase(lead),
        dispatched_at=_iso(lead.dispatched_at),
        en_route_at=_iso(lead.en_route_at),
        arrived_at=_iso(lead.arrived_at),
        started_at=_iso(lead.started_at),
    )


@router.get("", response_model=list[JobOut])
async def get_jobs(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_auth),
):
    if current_user.role in ("supervisor", "admin", "facilitator"):
        result = await db.execute(select(Lead).where(Lead.status == LeadStatus.booked))
    else:
        result = await db.execute(
            select(Lead)
            .join(JobAssignment, Lead.id == JobAssignment.lead_id)
            .where(Lead.status == LeadStatus.booked, JobAssignment.user_id == current_user.id)
        )
    leads = result.scalars().all()
    return [await _to_job_out(db, lead, current_user.role) for lead in leads]


@router.patch("/{lead_id}/status", response_model=JobOut)
async def patch_job_status(
    lead_id: str,
    data: JobStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("supervisor", "admin")),
):
    lead = await lead_service.update_job_status(db, lead_id, data.status, actor=current_user.username)
    return await _to_job_out(db, lead, current_user.role)


@router.post("/{lead_id}/assignments", response_model=JobOut, status_code=201)
async def add_assignment(
    lead_id: str,
    data: JobAssignmentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("supervisor", "admin", "facilitator")),
):
    result = await db.execute(select(Lead).where(Lead.id == lead_id, Lead.status == LeadStatus.booked))
    lead = result.scalar_one_or_none()
    if lead is None:
        raise HTTPException(status_code=404, detail="Job not found")
    result = await db.execute(select(User).where(User.id == data.user_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="User not found")
    result = await db.execute(
        select(JobAssignment).where(JobAssignment.lead_id == lead_id, JobAssignment.user_id == data.user_id)
    )
    if result.scalar_one_or_none() is None:
        db.add(JobAssignment(lead_id=lead_id, user_id=data.user_id, assigned_by=current_user.username))
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()

    await calendar_service.sync_job_calendar(db, lead_id)

    return await _to_job_out(db, lead, current_user.role)


@router.delete("/{lead_id}/assignments/{user_id}", response_model=JobOut)
async def remove_assignment(
    lead_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("supervisor", "admin", "facilitator")),
):
    result = await db.execute(
        select(JobAssignment).where(JobAssignment.lead_id == lead_id, JobAssignment.user_id == user_id)
    )
    assignment = result.scalar_one_or_none()
    if assignment is None:
        raise HTTPException(status_code=404, detail="Assignment not found")
    lead_result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = lead_result.scalar_one_or_none()
    if lead is None:
        raise HTTPException(status_code=404, detail="Job not found")
    await db.delete(assignment)
    await db.commit()

    await calendar_service.sync_job_calendar(db, lead_id)

    return await _to_job_out(db, lead, current_user.role)
```

- [ ] **Step 5: Run the new tests to verify they pass**

```
cd app/backend
pytest tests/test_jobs.py::test_add_assignment_stores_calendar_event_id tests/test_jobs.py::test_add_assignment_no_email_skips_calendar_create tests/test_jobs.py::test_remove_assignment_clears_calendar_event_id_when_crew_empty -v
```
Expected: All 3 PASS.

- [ ] **Step 6: Run the full test suite**

```
cd app/backend
pytest -v
```
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add app/backend/app/routers/jobs.py app/backend/tests/test_jobs.py
git commit -m "feat: trigger calendar sync on crew assignment changes"
```

---

## Task 6: Calendar update trigger in lead_service.py

**Files:**
- Modify: `app/backend/app/services/lead_service.py`

The trigger: after `update_lead` commits, if any of `job_date_requested`, `job_address`, `scope_notes`, or `customer_name` changed AND the lead has a `google_calendar_event_id`, call `calendar_service.sync_job_calendar`.

- [ ] **Step 1: Write the failing test**

Add to the bottom of `app/backend/tests/test_leads.py` (or create a new section if the file already has many tests):

```python
@pytest.mark.asyncio
async def test_update_lead_triggers_calendar_sync_when_event_exists(client, db_session):
    """Changing job_address on a booked lead that has a calendar event should sync."""
    from unittest.mock import AsyncMock, patch
    from app.models.lead import Lead, LeadSourceType, LeadStatus, ServiceType
    from datetime import datetime, timezone

    lead = Lead(
        source_type=LeadSourceType.manual,
        status=LeadStatus.booked,
        service_type=ServiceType.hauling,
        urgency_flag=False,
        google_calendar_event_id="gcal-to-update",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db_session.add(lead)
    await db_session.commit()
    await db_session.refresh(lead)

    with patch("app.services.calendar_service.sync_job_calendar", new=AsyncMock()) as mock_sync:
        r = await client.patch(f"/leads/{lead.id}", json={"job_address": "456 Oak Ave"})

    assert r.status_code == 200
    mock_sync.assert_called_once()


@pytest.mark.asyncio
async def test_update_lead_no_calendar_sync_when_no_event(client, db_session):
    """Changing job_address on a lead without a calendar event should not call sync."""
    from unittest.mock import AsyncMock, patch
    from app.models.lead import Lead, LeadSourceType, LeadStatus, ServiceType
    from datetime import datetime, timezone

    lead = Lead(
        source_type=LeadSourceType.manual,
        status=LeadStatus.booked,
        service_type=ServiceType.hauling,
        urgency_flag=False,
        google_calendar_event_id=None,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db_session.add(lead)
    await db_session.commit()
    await db_session.refresh(lead)

    with patch("app.services.calendar_service.sync_job_calendar", new=AsyncMock()) as mock_sync:
        r = await client.patch(f"/leads/{lead.id}", json={"job_address": "789 Pine Rd"})

    assert r.status_code == 200
    mock_sync.assert_not_called()
```

- [ ] **Step 2: Run tests to verify they fail**

```
cd app/backend
pytest tests/test_leads.py::test_update_lead_triggers_calendar_sync_when_event_exists tests/test_leads.py::test_update_lead_no_calendar_sync_when_no_event -v
```
Expected: FAIL

- [ ] **Step 3: Add the calendar sync trigger in lead_service.py**

In `app/backend/app/services/lead_service.py`, find the `update_lead` function. After `await db.refresh(lead)` (the last line of the `if changed:` block), add:

```python
        # Calendar sync: if a booked job's event-relevant fields changed, update the event
        _CALENDAR_FIELDS = {"job_date_requested", "job_address", "scope_notes", "customer_name"}
        if lead.google_calendar_event_id and any(f in _CALENDAR_FIELDS for f in changed):
            import logging as _logging
            from app.services import calendar_service as _cal
            _log = _logging.getLogger(__name__)
            try:
                await _cal.sync_job_calendar(db, lead_id)
            except Exception as exc:
                _log.error("calendar sync on lead update failed: %s", exc)
```

- [ ] **Step 4: Run the new tests to verify they pass**

```
cd app/backend
pytest tests/test_leads.py::test_update_lead_triggers_calendar_sync_when_event_exists tests/test_leads.py::test_update_lead_no_calendar_sync_when_no_event -v
```
Expected: PASS

- [ ] **Step 5: Run the full suite**

```
cd app/backend
pytest -v
```
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/backend/app/services/lead_service.py app/backend/tests/test_leads.py
git commit -m "feat: sync Google Calendar event when job date/address/notes change"
```

---

## Task 7: Frontend — email field in AdminUsersScreen

**Files:**
- Modify: `app/frontend/src/hooks/useUsers.ts`
- Modify: `app/frontend/src/screens/AdminUsersScreen.tsx`

- [ ] **Step 1: Add `email` to the TeamMember interface in useUsers.ts**

In `app/frontend/src/hooks/useUsers.ts`, update `TeamMember`:

```typescript
export interface TeamMember {
  id: string
  username: string
  role: string
  is_active: boolean
  email: string | null
}
```

- [ ] **Step 2: Add email state variables to AdminUsersScreen.tsx**

In `app/frontend/src/screens/AdminUsersScreen.tsx`, in the state block (after `const [newRole, setNewRole] = useState<Role>('crew')`), add:

```typescript
  const [newEmail, setNewEmail] = useState('')
```

And after `const [editPin, setEditPin] = useState('')`, add:

```typescript
  const [editEmail, setEditEmail] = useState('')
```

- [ ] **Step 3: Include email in the createMutation call**

In `handleCreate`, replace:
```typescript
      await createMutation.mutateAsync({ username: newUsername.trim(), pin: newPin, role: newRole })
      setShowAdd(false)
      setNewUsername('')
      setNewPin('')
      setNewRole('crew')
```
With:
```typescript
      await createMutation.mutateAsync({ username: newUsername.trim(), pin: newPin, role: newRole, email: newEmail.trim() || null })
      setShowAdd(false)
      setNewUsername('')
      setNewPin('')
      setNewRole('crew')
      setNewEmail('')
```

Also update `createMutation`'s `mutationFn` type:
```typescript
  const createMutation = useMutation({
    mutationFn: async (body: { username: string; pin: string; role: string; email: string | null }) => {
```

- [ ] **Step 4: Include email in the patchMutation call**

In `handlePatch`, replace:
```typescript
      const body: Record<string, unknown> = { role: editRole, is_active: editActive }
      if (editPin) body.pin = editPin
      await patchMutation.mutateAsync({ id: editUser.id, body })
      setEditUser(null)
```
With:
```typescript
      const body: Record<string, unknown> = { role: editRole, is_active: editActive }
      if (editPin) body.pin = editPin
      if (editEmail !== (editUser.email ?? '')) body.email = editEmail || null
      await patchMutation.mutateAsync({ id: editUser.id, body })
      setEditUser(null)
      setEditEmail('')
```

- [ ] **Step 5: Pre-populate editEmail when opening the edit modal**

Find the Edit button's `onClick`:
```typescript
onClick={() => { setEditUser(u); setEditRole(u.role as Role); setEditActive(u.is_active); setEditPin('') }}
```
Replace with:
```typescript
onClick={() => { setEditUser(u); setEditRole(u.role as Role); setEditActive(u.is_active); setEditPin(''); setEditEmail(u.email ?? '') }}
```

- [ ] **Step 6: Add the Google email input to the Add User modal**

In the Add User modal, after the `<select>` for role and before `{createError && ...}`, add:

```tsx
            <input
              className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 mb-4 text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Google email (optional, for calendar invites)"
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              type="email"
              inputMode="email"
            />
```

- [ ] **Step 7: Add the Google email input to the Edit User modal**

In the Edit User modal, after the Active checkbox label and before `{editError && ...}`, add:

```tsx
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 mt-3">Google email (for calendar invites)</label>
            <input
              className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 mb-4 text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="name@gmail.com"
              value={editEmail}
              onChange={e => setEditEmail(e.target.value)}
              type="email"
              inputMode="email"
            />
```

- [ ] **Step 8: Show the crew member's email address in the user list**

In the user list, inside the user card's `<div>` that contains the username and role badge, add below the role badge:

```tsx
              {u.email && (
                <span className="text-xs text-gray-400 dark:text-gray-500">{u.email}</span>
              )}
```

- [ ] **Step 9: Type-check the frontend**

```
cd app/frontend
npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 10: Commit**

```bash
git add app/frontend/src/hooks/useUsers.ts app/frontend/src/screens/AdminUsersScreen.tsx
git commit -m "feat: add Google email field to user create/edit forms"
```

---

## Task 8: Frontend — Google Calendar section in SettingsScreen

**Files:**
- Modify: `app/frontend/src/screens/SettingsScreen.tsx`

- [ ] **Step 1: Add Google Calendar status query and connect handler**

In `app/frontend/src/screens/SettingsScreen.tsx`, add these imports after the existing imports:

```typescript
import { useQuery } from '@tanstack/react-query'
```

(Note: `useQuery` is likely already imported via `useSettings` hook — verify. If `useQuery` is already imported from `@tanstack/react-query`, skip this step.)

- [ ] **Step 2: Add the Google Calendar query inside SettingsScreen**

In `SettingsScreen`, after the existing hook calls at the top of the component body, add:

```typescript
  const { data: calendarStatus, refetch: refetchCalendarStatus } = useQuery<{ connected: boolean }>({
    queryKey: ['google-calendar-status'],
    queryFn: async () => {
      const r = await apiFetch('/admin/google/status')
      if (!r.ok) return { connected: false }
      return r.json()
    },
    enabled: user?.role === 'admin',
  })

  async function handleGoogleConnect() {
    const r = await apiFetch('/admin/google/connect')
    if (!r.ok) return
    const { url } = await r.json()
    window.open(url, '_blank')
  }
```

- [ ] **Step 3: Add the Google Calendar section to the JSX**

In the `SettingsScreen` JSX, add a new `<section>` block after the Appearance section and before Alert Thresholds. Only render this section for admins:

```tsx
        {user?.role === 'admin' && (
          <section className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4 space-y-3">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Google Calendar</h2>
            <FieldRow label="Status">
              <span className={`text-sm font-medium ${calendarStatus?.connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-gray-500'}`}>
                {calendarStatus?.connected ? 'Connected' : 'Not connected'}
              </span>
            </FieldRow>
            <div className="flex gap-2">
              <button
                onClick={handleGoogleConnect}
                className="text-xs border dark:border-gray-600 rounded-lg px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300"
              >
                {calendarStatus?.connected ? 'Reconnect' : 'Connect Google Calendar'}
              </button>
              <button
                onClick={() => refetchCalendarStatus()}
                className="text-xs border dark:border-gray-600 rounded-lg px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300"
              >
                Refresh status
              </button>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              After connecting, add Google emails to crew profiles so they receive job invites.
            </p>
          </section>
        )}
```

- [ ] **Step 4: Type-check the frontend**

```
cd app/frontend
npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add app/frontend/src/screens/SettingsScreen.tsx
git commit -m "feat: add Google Calendar connect button and status to settings"
```

---

## Setup Instructions (for the operator after deployment)

1. Go to [Google Cloud Console](https://console.cloud.google.com), create a project, enable **Google Calendar API**.
2. Create OAuth 2.0 credentials (type: **Web application**). Add `http://localhost:8000/admin/google/callback` as an authorized redirect URI.
3. Copy the Client ID and Client Secret into `app/backend/.env`:
   ```
   GOOGLE_OAUTH_CLIENT_ID=<your-client-id>
   GOOGLE_OAUTH_CLIENT_SECRET=<your-client-secret>
   GOOGLE_OAUTH_REDIRECT_URI=http://localhost:8000/admin/google/callback
   ```
4. Restart the backend (`python run.py`).
5. Open the app → Settings → click **Connect Google Calendar** → complete the Google consent flow.
6. In Team (admin panel), add each crew member's Gmail address to their profile.
7. Book a job and assign a crew member — they will receive a Google Calendar invite.
