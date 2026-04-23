# Alert Ladder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a configurable in-app + SMS/email alert ladder that surfaces stale leads visually in the queue and escalates to a backup handler after a configurable idle window.

**Architecture:** The backend adds two new models (`AppSetting`, `LeadAlert`), a settings service/router, and an `alert_service` with an APScheduler job that checks for stale leads every 5 minutes. The frontend derives staleness purely from existing lead data (`updated_at`) and settings, requiring no new polling endpoints. A new `/settings` route hosts the settings form.

**Tech Stack:** APScheduler (AsyncIOScheduler), Twilio (optional SMS, lazy import), Python smtplib (SMTP email), TanStack Query, React Router, localStorage for snooze state.

---

## File Map

**Create — Backend**
- `app/backend/app/models/app_setting.py` — AppSetting ORM (key-value table)
- `app/backend/app/models/lead_alert.py` — LeadAlert ORM (dedup + audit log)
- `app/backend/app/schemas/settings.py` — SettingsOut, SettingsPatch, TestAlertRequest, TestAlertResult
- `app/backend/app/services/settings_service.py` — get_settings(), patch_settings()
- `app/backend/app/services/alert_service.py` — scheduler, _process_stale_leads(), send helpers, fire_test_alert()
- `app/backend/app/routers/settings.py` — GET/PATCH /settings, POST /settings/test-alert
- `app/backend/tests/test_settings.py` — settings CRUD tests
- `app/backend/tests/test_alert_service.py` — stale lead detection + dedup + auto-escalation tests

**Modify — Backend**
- `app/backend/requirements.txt` — add APScheduler + Twilio
- `app/backend/main.py` — import new models, register settings router, start/stop scheduler

**Create — Frontend**
- `app/frontend/src/hooks/useSettings.ts` — useSettings(), usePatchSettings(), useTestAlert()
- `app/frontend/src/hooks/useStaleLeads.ts` — derives T1/T2 stale sets + snooze state
- `app/frontend/src/components/StaleLeadBanner.tsx` — banner with snooze button
- `app/frontend/src/screens/SettingsScreen.tsx` — full settings form

**Modify — Frontend**
- `app/frontend/src/types/lead.ts` — add Settings, SettingsPatch, TestAlertRequest, TestAlertResult
- `app/frontend/src/services/api.ts` — add fetchSettings(), patchSettings(), testAlert()
- `app/frontend/src/App.tsx` — add /settings route
- `app/frontend/src/screens/LeadQueue.tsx` — add StaleLeadBanner + gear icon
- `app/frontend/src/components/LeadCard.tsx` — add staleness prop + border/chip

---

## Task 1: Backend models — AppSetting + LeadAlert

**Files:**
- Create: `app/backend/app/models/app_setting.py`
- Create: `app/backend/app/models/lead_alert.py`
- Modify: `app/backend/requirements.txt`

- [ ] **Step 1: Add APScheduler and Twilio to requirements**

In `app/backend/requirements.txt`, add two lines after the existing entries:
```
apscheduler>=3.10.0
twilio>=9.0.0
```

- [ ] **Step 2: Install new packages**

Run from `app/backend/`:
```bash
pip install apscheduler twilio
```

- [ ] **Step 3: Write the failing test**

Create `app/backend/tests/test_settings.py`:

```python
import pytest

pytestmark = pytest.mark.asyncio


async def test_get_settings_returns_defaults(client):
    r = await client.get("/settings")
    assert r.status_code == 200
    d = r.json()
    assert d["t1_minutes"] == 15
    assert d["t2_minutes"] == 30
    assert d["quiet_hours_enabled"] is False
    assert d["primary_sms"] == ""
    assert d["backup_name"] == ""
```

- [ ] **Step 4: Run test to confirm it fails**

```bash
cd app/backend && pytest tests/test_settings.py::test_get_settings_returns_defaults -v
```
Expected: FAIL — `GET /settings` returns 404 (route doesn't exist yet)

- [ ] **Step 5: Create AppSetting model**

Create `app/backend/app/models/app_setting.py`:

```python
from __future__ import annotations

from sqlalchemy import Column, String

from app.database import Base


class AppSetting(Base):
    __tablename__ = "app_settings"

    key = Column(String, primary_key=True)
    value = Column(String, nullable=True)
```

- [ ] **Step 6: Create LeadAlert model**

Create `app/backend/app/models/lead_alert.py`:

```python
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String

from app.database import Base


class LeadAlert(Base):
    __tablename__ = "lead_alerts"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    lead_id = Column(String, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False)
    tier = Column(Integer, nullable=False)        # 1 or 2
    channel = Column(String, nullable=False)      # 'sms' | 'email'
    sent_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    suppressed = Column(Boolean, nullable=False, default=False)
    lead_updated_at_snapshot = Column(DateTime, nullable=False)  # updated_at at send time
```

- [ ] **Step 7: Commit**

```bash
git add app/backend/app/models/app_setting.py app/backend/app/models/lead_alert.py app/backend/requirements.txt app/backend/tests/test_settings.py
git commit -m "feat: add AppSetting and LeadAlert models, add apscheduler+twilio deps"
```

---

## Task 2: Backend settings schemas + settings_service

**Files:**
- Create: `app/backend/app/schemas/settings.py`
- Create: `app/backend/app/services/settings_service.py`

- [ ] **Step 1: Create settings schemas**

Create `app/backend/app/schemas/settings.py`:

```python
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel

_DEFAULTS: dict[str, str] = {
    "t1_minutes": "15",
    "t2_minutes": "30",
    "quiet_hours_start": "22:00",
    "quiet_hours_end": "07:00",
    "quiet_hours_enabled": "false",
    "primary_sms": "",
    "primary_email": "",
    "backup_name": "",
    "backup_sms": "",
    "backup_email": "",
}


class SettingsOut(BaseModel):
    t1_minutes: int = 15
    t2_minutes: int = 30
    quiet_hours_start: str = "22:00"
    quiet_hours_end: str = "07:00"
    quiet_hours_enabled: bool = False
    primary_sms: str = ""
    primary_email: str = ""
    backup_name: str = ""
    backup_sms: str = ""
    backup_email: str = ""


class SettingsPatch(BaseModel):
    t1_minutes: Optional[int] = None
    t2_minutes: Optional[int] = None
    quiet_hours_start: Optional[str] = None
    quiet_hours_end: Optional[str] = None
    quiet_hours_enabled: Optional[bool] = None
    primary_sms: Optional[str] = None
    primary_email: Optional[str] = None
    backup_name: Optional[str] = None
    backup_sms: Optional[str] = None
    backup_email: Optional[str] = None


class TestAlertRequest(BaseModel):
    channel: str    # 'sms' | 'email'
    recipient: str  # 'primary' | 'backup'


class TestAlertResult(BaseModel):
    sent: bool
    reason: Optional[str] = None
```

- [ ] **Step 2: Create settings_service**

Create `app/backend/app/services/settings_service.py`:

```python
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_setting import AppSetting
from app.schemas.settings import SettingsOut, _DEFAULTS


async def get_settings(db: AsyncSession) -> SettingsOut:
    result = await db.execute(select(AppSetting))
    stored = {row.key: row.value for row in result.scalars().all() if row.value is not None}
    merged = {**_DEFAULTS, **stored}
    return SettingsOut(
        t1_minutes=int(merged["t1_minutes"]),
        t2_minutes=int(merged["t2_minutes"]),
        quiet_hours_start=merged["quiet_hours_start"],
        quiet_hours_end=merged["quiet_hours_end"],
        quiet_hours_enabled=merged["quiet_hours_enabled"].lower() == "true",
        primary_sms=merged["primary_sms"],
        primary_email=merged["primary_email"],
        backup_name=merged["backup_name"],
        backup_sms=merged["backup_sms"],
        backup_email=merged["backup_email"],
    )


async def patch_settings(db: AsyncSession, updates: dict) -> SettingsOut:
    for key, val in updates.items():
        result = await db.execute(select(AppSetting).where(AppSetting.key == key))
        row = result.scalar_one_or_none()
        if row:
            row.value = str(val).lower() if isinstance(val, bool) else str(val)
        else:
            str_val = str(val).lower() if isinstance(val, bool) else str(val)
            db.add(AppSetting(key=key, value=str_val))
    await db.commit()
    return await get_settings(db)
```

- [ ] **Step 3: Commit**

```bash
git add app/backend/app/schemas/settings.py app/backend/app/services/settings_service.py
git commit -m "feat: add settings schemas and settings_service"
```

---

## Task 3: Backend settings router + register + tests

**Files:**
- Create: `app/backend/app/routers/settings.py`
- Modify: `app/backend/main.py`
- Modify: `app/backend/tests/test_settings.py`

- [ ] **Step 1: Write additional failing tests**

Add to `app/backend/tests/test_settings.py`:

```python
async def test_patch_settings_updates_values(client):
    r = await client.patch("/settings", json={"t1_minutes": 20, "primary_sms": "+15551234567"})
    assert r.status_code == 200
    d = r.json()
    assert d["t1_minutes"] == 20
    assert d["primary_sms"] == "+15551234567"
    assert d["t2_minutes"] == 30  # unchanged default


async def test_patch_settings_persists(client):
    await client.patch("/settings", json={"backup_name": "Jordan"})
    r = await client.get("/settings")
    assert r.json()["backup_name"] == "Jordan"


async def test_patch_quiet_hours_enabled(client):
    r = await client.patch("/settings", json={"quiet_hours_enabled": True, "quiet_hours_start": "21:00"})
    assert r.status_code == 200
    d = r.json()
    assert d["quiet_hours_enabled"] is True
    assert d["quiet_hours_start"] == "21:00"
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd app/backend && pytest tests/test_settings.py -v
```
Expected: all FAIL — route doesn't exist

- [ ] **Step 3: Create settings router**

Create `app/backend/app/routers/settings.py`:

```python
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.settings import SettingsOut, SettingsPatch, TestAlertRequest, TestAlertResult
from app.services import alert_service, settings_service

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=SettingsOut)
async def get_settings(db: AsyncSession = Depends(get_db)):
    return await settings_service.get_settings(db)


@router.patch("", response_model=SettingsOut)
async def patch_settings(data: SettingsPatch, db: AsyncSession = Depends(get_db)):
    updates = data.model_dump(exclude_unset=True)
    return await settings_service.patch_settings(db, updates)


@router.post("/test-alert", response_model=TestAlertResult)
async def test_alert(data: TestAlertRequest, db: AsyncSession = Depends(get_db)):
    settings = await settings_service.get_settings(db)
    return await alert_service.fire_test_alert(settings, data.channel, data.recipient)
```

- [ ] **Step 4: Register models and router in main.py**

In `app/backend/main.py`, add these imports after the existing model imports:

```python
import app.models.app_setting   # noqa: F401
import app.models.lead_alert    # noqa: F401
```

Add the settings router to the existing router import line:

```python
from app.routers import chat, ingest, leads, settings as settings_router
```

Add the router registration after `app.include_router(chat.router)`:

```python
app.include_router(settings_router.router)
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd app/backend && pytest tests/test_settings.py -v
```
Expected: all 4 tests PASS (note: test_alert endpoint will 500 until alert_service exists — that test is in Task 5)

- [ ] **Step 6: Commit**

```bash
git add app/backend/app/routers/settings.py app/backend/main.py app/backend/tests/test_settings.py
git commit -m "feat: add settings router, register models and router in main"
```

---

## Task 4: Backend alert_service — send helpers + fire_test_alert

**Files:**
- Create: `app/backend/app/services/alert_service.py`

- [ ] **Step 1: Write the test for fire_test_alert with no credentials**

Create `app/backend/tests/test_alert_service.py`:

```python
import pytest
from unittest.mock import patch, MagicMock

from app.schemas.settings import SettingsOut

pytestmark = pytest.mark.asyncio

_EMPTY_SETTINGS = SettingsOut()  # all defaults, no contact info configured


async def test_fire_test_alert_sms_no_credentials():
    result = await __import__('app.services.alert_service', fromlist=['fire_test_alert']).fire_test_alert(
        _EMPTY_SETTINGS, "sms", "primary"
    )
    assert result.sent is False
    assert result.reason is not None


async def test_fire_test_alert_email_no_credentials():
    from app.services.alert_service import fire_test_alert
    result = await fire_test_alert(_EMPTY_SETTINGS, "email", "backup")
    assert result.sent is False
    assert result.reason is not None
```

- [ ] **Step 2: Run to confirm failing**

```bash
cd app/backend && pytest tests/test_alert_service.py -v
```
Expected: ImportError — alert_service doesn't exist yet

- [ ] **Step 3: Create alert_service with send helpers and fire_test_alert**

Create `app/backend/app/services/alert_service.py`:

```python
from __future__ import annotations

import os
import smtplib
import uuid
from datetime import datetime, time, timedelta, timezone
from email.mime.text import MIMEText
from typing import Optional

from app.schemas.settings import SettingsOut, TestAlertResult


# ── quiet hours ───────────────────────────────────────────────────────────────

def _is_quiet_now(settings: SettingsOut) -> bool:
    if not settings.quiet_hours_enabled:
        return False
    try:
        now_t = datetime.now().time()
        start = time.fromisoformat(settings.quiet_hours_start)
        end = time.fromisoformat(settings.quiet_hours_end)
        if start <= end:
            return start <= now_t < end
        # Overnight range (e.g. 22:00–07:00)
        return now_t >= start or now_t < end
    except ValueError:
        return False


# ── send helpers ─────────────────────────────────────────────────────────────

def _send_sms(to: str, body: str) -> Optional[str]:
    """Send via Twilio. Returns error string on failure, None on success."""
    sid = os.environ.get("TWILIO_ACCOUNT_SID", "")
    token = os.environ.get("TWILIO_AUTH_TOKEN", "")
    from_num = os.environ.get("TWILIO_FROM_NUMBER", "")
    if not all([sid, token, from_num]):
        return "Twilio credentials not configured"
    if not to:
        return "No recipient phone number configured"
    try:
        from twilio.rest import Client  # lazy — optional dep
        Client(sid, token).messages.create(body=body, from_=from_num, to=to)
        return None
    except ImportError:
        return "twilio package not installed (pip install twilio)"
    except Exception as exc:
        return str(exc)


def _send_email(to: str, subject: str, body: str) -> Optional[str]:
    """Send via SMTP. Returns error string on failure, None on success."""
    host = os.environ.get("SMTP_HOST", "")
    user = os.environ.get("SMTP_USER", "")
    password = os.environ.get("SMTP_PASS", "")
    from_addr = os.environ.get("SMTP_FROM", "")
    if not all([host, user, password, from_addr]):
        return "SMTP credentials not configured"
    if not to:
        return "No recipient email address configured"
    try:
        msg = MIMEText(body)
        msg["Subject"] = subject
        msg["From"] = from_addr
        msg["To"] = to
        with smtplib.SMTP(host, 587) as server:
            server.starttls()
            server.login(user, password)
            server.send_message(msg)
        return None
    except Exception as exc:
        return str(exc)


# ── test send ─────────────────────────────────────────────────────────────────

async def fire_test_alert(
    settings: SettingsOut,
    channel: str,
    recipient: str,
) -> TestAlertResult:
    """Send a test message, bypassing quiet hours and dedup."""
    if recipient == "primary":
        sms_to = settings.primary_sms
        email_to = settings.primary_email
    else:
        sms_to = settings.backup_sms
        email_to = settings.backup_email

    if channel == "sms":
        err = _send_sms(sms_to, "Holy Hauling test alert — SMS notifications are working correctly.")
    else:
        err = _send_email(
            email_to,
            "[Holy Hauling] Test alert",
            "This is a test alert from Holy Hauling. Email notifications are working correctly.",
        )

    if err:
        return TestAlertResult(sent=False, reason=err)
    return TestAlertResult(sent=True)
```

- [ ] **Step 4: Run tests**

```bash
cd app/backend && pytest tests/test_alert_service.py -v
```
Expected: both tests PASS (no credentials configured → sent=False)

- [ ] **Step 5: Run full suite to confirm nothing broken**

```bash
cd app/backend && pytest -x -q
```
Expected: all existing tests pass + 2 new pass

- [ ] **Step 6: Commit**

```bash
git add app/backend/app/services/alert_service.py app/backend/tests/test_alert_service.py
git commit -m "feat: add alert_service with send helpers and fire_test_alert"
```

---

## Task 5: Backend alert_service — stale lead checker + scheduler wiring + tests

**Files:**
- Modify: `app/backend/app/services/alert_service.py`
- Modify: `app/backend/main.py`
- Modify: `app/backend/tests/test_alert_service.py`

- [ ] **Step 1: Write failing tests for stale lead detection**

Add to `app/backend/tests/test_alert_service.py`:

```python
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from app.services.alert_service import _process_stale_leads, _is_quiet_now
from app.schemas.settings import SettingsOut

_BASE_LEAD = {
    "source_type": "manual",
    "customer_name": "Test User",
    "service_type": "moving",
}

_SETTINGS_15_30 = SettingsOut(t1_minutes=15, t2_minutes=30)


async def _make_stale_lead(client, db_session, minutes_ago: int) -> str:
    r = await client.post("/leads", json=_BASE_LEAD)
    assert r.status_code == 201
    lead_id = r.json()["id"]
    stale_time = datetime.utcnow() - timedelta(minutes=minutes_ago)
    await db_session.execute(
        text("UPDATE leads SET updated_at = :t WHERE id = :id"),
        {"t": stale_time, "id": lead_id},
    )
    await db_session.commit()
    return lead_id


async def test_fresh_lead_not_alerted(client, db_session):
    await client.post("/leads", json=_BASE_LEAD)
    with patch("app.services.alert_service._send_sms") as mock_sms, \
         patch("app.services.alert_service._send_email") as mock_email:
        await _process_stale_leads(db_session, _SETTINGS_15_30)
    mock_sms.assert_not_called()
    mock_email.assert_not_called()


async def test_t1_lead_fires_alert(client, db_session):
    lead_id = await _make_stale_lead(client, db_session, minutes_ago=20)
    settings = SettingsOut(t1_minutes=15, t2_minutes=30, primary_sms="+15550001111", primary_email="p@test.com")
    with patch("app.services.alert_service._send_sms") as mock_sms, \
         patch("app.services.alert_service._send_email") as mock_email:
        await _process_stale_leads(db_session, settings)
    mock_sms.assert_called_once()
    mock_email.assert_called_once()
    assert lead_id in mock_sms.call_args[0][1] or lead_id in str(mock_sms.call_args)


async def test_t1_alert_not_sent_twice(client, db_session):
    lead_id = await _make_stale_lead(client, db_session, minutes_ago=20)
    settings = SettingsOut(t1_minutes=15, t2_minutes=30, primary_sms="+15550001111")
    with patch("app.services.alert_service._send_sms") as mock_sms, \
         patch("app.services.alert_service._send_email"):
        await _process_stale_leads(db_session, settings)
        await _process_stale_leads(db_session, settings)
    assert mock_sms.call_count == 1  # dedup prevents second send


async def test_t2_escalates_lead_status(client, db_session):
    lead_id = await _make_stale_lead(client, db_session, minutes_ago=35)
    settings = SettingsOut(t1_minutes=15, t2_minutes=30)
    with patch("app.services.alert_service._send_sms"), \
         patch("app.services.alert_service._send_email"):
        await _process_stale_leads(db_session, settings)
    r = await client.get(f"/leads/{lead_id}")
    assert r.json()["status"] == "escalated"


async def test_quiet_hours_suppresses_sms(client, db_session):
    lead_id = await _make_stale_lead(client, db_session, minutes_ago=20)
    settings = SettingsOut(
        t1_minutes=15, t2_minutes=30,
        primary_sms="+15550001111",
        quiet_hours_enabled=True,
        quiet_hours_start="00:00",  # always quiet for test
        quiet_hours_end="23:59",
    )
    with patch("app.services.alert_service._send_sms") as mock_sms, \
         patch("app.services.alert_service._send_email") as mock_email:
        await _process_stale_leads(db_session, settings)
    mock_sms.assert_not_called()
    mock_email.assert_not_called()


def test_is_quiet_now_overnight():
    settings = SettingsOut(quiet_hours_enabled=True, quiet_hours_start="22:00", quiet_hours_end="07:00")
    # Always quiet when start > end and we patch time — test the range logic only
    settings_always_quiet = SettingsOut(quiet_hours_enabled=True, quiet_hours_start="00:00", quiet_hours_end="23:59")
    assert _is_quiet_now(settings_always_quiet) is True

    settings_never_quiet = SettingsOut(quiet_hours_enabled=False, quiet_hours_start="00:00", quiet_hours_end="23:59")
    assert _is_quiet_now(settings_never_quiet) is False
```

Note: `db_session` is a new fixture. Add to `conftest.py` (see Step 2).

- [ ] **Step 2: Add db_session fixture to conftest.py**

In `app/backend/tests/conftest.py`, add a `db_session` fixture that yields the test session so alert tests can use it directly. Add after the `client` fixture:

```python
@pytest_asyncio.fixture
async def db_session(client, tmp_path):
    """Yields the underlying AsyncSession used by the test client."""
    from app.database import Base, get_db
    from main import app

    engine = create_async_engine(TEST_DB)
    TestSession = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async def override():
        async with TestSession() as s:
            yield s

    app.dependency_overrides[get_db] = override
    async with TestSession() as session:
        yield session
```

Wait — the `client` fixture already sets up an in-memory DB and overrides `get_db`. The `db_session` fixture needs to share the same in-memory DB engine as `client`. Replace the conftest approach:

The cleanest approach: store the test engine on the app so `db_session` can reuse it. Instead, restructure `conftest.py` as follows — replace the entire file:

```python
import os

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

TEST_DB = "sqlite+aiosqlite:///:memory:"


@pytest_asyncio.fixture
async def client(tmp_path):
    import app.services.lead_service as svc
    svc.SCREENSHOTS_DIR = str(tmp_path / "screenshots")
    os.makedirs(svc.SCREENSHOTS_DIR, exist_ok=True)

    from app.database import Base, get_db
    from main import app

    engine = create_async_engine(TEST_DB)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    TestSession = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async def override_get_db():
        async with TestSession() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    app.state.test_session_factory = TestSession  # expose for db_session fixture

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(client):
    """Yields a session sharing the same in-memory DB as the test client."""
    from main import app
    factory = app.state.test_session_factory
    async with factory() as session:
        yield session
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
cd app/backend && pytest tests/test_alert_service.py -v
```
Expected: FAIL — `_process_stale_leads` not defined yet

- [ ] **Step 4: Implement _process_stale_leads and check_stale_leads in alert_service.py**

Add to the bottom of `app/backend/app/services/alert_service.py` (keep all existing code, add these):

```python
import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models.lead import Lead, LeadStatus
from app.models.lead_alert import LeadAlert
from app.models.lead_event import LeadEvent

_ACTIVE_STATUSES = {
    LeadStatus.new,
    LeadStatus.in_review,
    LeadStatus.waiting_on_customer,
    LeadStatus.ready_for_quote,
    LeadStatus.ready_for_booking,
}


async def _alert_channel(
    db: AsyncSession,
    lead: Lead,
    tier: int,
    channel: str,
    to: str,
    msg: str,
    subject: str,
    quiet: bool,
    snapshot: datetime,
) -> None:
    """Send one channel alert, respecting dedup and quiet hours."""
    # Check for already-sent (non-suppressed) record → skip
    sent = await db.execute(
        select(LeadAlert).where(
            LeadAlert.lead_id == lead.id,
            LeadAlert.tier == tier,
            LeadAlert.channel == channel,
            LeadAlert.lead_updated_at_snapshot == snapshot,
            LeadAlert.suppressed.is_(False),
        ).limit(1)
    )
    if sent.scalar_one_or_none():
        return

    if quiet:
        # Log suppressed once for audit (skip if already logged)
        existing = await db.execute(
            select(LeadAlert).where(
                LeadAlert.lead_id == lead.id,
                LeadAlert.tier == tier,
                LeadAlert.channel == channel,
                LeadAlert.lead_updated_at_snapshot == snapshot,
            ).limit(1)
        )
        if not existing.scalar_one_or_none():
            db.add(LeadAlert(
                id=str(uuid.uuid4()),
                lead_id=lead.id,
                tier=tier,
                channel=channel,
                sent_at=datetime.now(timezone.utc),
                suppressed=True,
                lead_updated_at_snapshot=snapshot,
            ))
            await db.commit()
        return

    # Send
    if channel == "sms":
        _send_sms(to, msg)
    else:
        _send_email(to, subject, msg)

    db.add(LeadAlert(
        id=str(uuid.uuid4()),
        lead_id=lead.id,
        tier=tier,
        channel=channel,
        sent_at=datetime.now(timezone.utc),
        suppressed=False,
        lead_updated_at_snapshot=snapshot,
    ))
    await db.commit()


async def _process_stale_leads(db: AsyncSession, settings: SettingsOut) -> None:
    """Core check logic — accepts a session so tests can inject the test DB."""
    now_naive = datetime.utcnow()
    t1_cutoff = now_naive - timedelta(minutes=settings.t1_minutes)
    t2_cutoff = now_naive - timedelta(minutes=settings.t2_minutes)
    quiet = _is_quiet_now(settings)

    result = await db.execute(
        select(Lead).where(
            Lead.status.in_(_ACTIVE_STATUSES),
            Lead.updated_at < t1_cutoff,
        )
    )
    stale_leads = result.scalars().all()

    for lead in stale_leads:
        snapshot = lead.updated_at  # naive UTC datetime from SQLite
        idle_minutes = int((now_naive - snapshot).total_seconds() / 60)
        is_t2 = snapshot < t2_cutoff
        tier = 2 if is_t2 else 1

        name = lead.customer_name or "Unknown"
        base_msg = (
            f'Holy Hauling Alert: Lead "{name}" has been idle for {idle_minutes}m. '
            f"Status: {lead.status.value}. Open the app to take action."
        )
        if is_t2:
            base_msg += " Escalated — backup handler also notified."
        subject = f"[Holy Hauling] Lead idle {idle_minutes}m — action needed"

        recipients: list[tuple[str, str]] = [(settings.primary_sms, settings.primary_email)]
        if is_t2:
            recipients.append((settings.backup_sms, settings.backup_email))

        for sms_to, email_to in recipients:
            await _alert_channel(db, lead, tier, "sms", sms_to, base_msg, subject, quiet, snapshot)
            await _alert_channel(db, lead, tier, "email", email_to, base_msg, subject, quiet, snapshot)

        # T2: auto-advance to escalated and write audit event
        if is_t2 and lead.status != LeadStatus.escalated:
            old_status = lead.status.value
            lead.status = LeadStatus.escalated
            lead.updated_at = now_naive
            db.add(LeadEvent(
                id=str(uuid.uuid4()),
                lead_id=lead.id,
                event_type="status_changed",
                from_status=old_status,
                to_status=LeadStatus.escalated.value,
                actor="alert_scheduler",
            ))
            await db.commit()


async def check_stale_leads() -> None:
    """Entry point for the scheduler — opens its own session."""
    from app.services import settings_service
    try:
        async with AsyncSessionLocal() as db:
            settings = await settings_service.get_settings(db)
            await _process_stale_leads(db, settings)
    except Exception as exc:
        print(f"[alert_scheduler] Error: {exc}")
```

- [ ] **Step 5: Wire scheduler into main.py lifespan**

In `app/backend/main.py`, add the APScheduler import after the existing imports:

```python
from apscheduler.schedulers.asyncio import AsyncIOScheduler

_scheduler = AsyncIOScheduler()
```

Update the `lifespan` function to start/stop the scheduler:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    _validate_grounding_file()
    async with engine.begin() as conn:
        await _migrate_customer_name_nullable(conn)
        await _migrate_screenshots_add_ocr_status(conn)
        await _migrate_leads_add_v7_columns(conn)
        await _migrate_leads_add_v8_columns(conn)
        await _migrate_leads_add_quote_context(conn)
        await _migrate_screenshots_add_screenshot_type(conn)
        await conn.run_sync(Base.metadata.create_all)

    from app.services.alert_service import check_stale_leads
    _scheduler.add_job(check_stale_leads, "interval", minutes=5, id="check_stale_leads", replace_existing=True)
    _scheduler.start()

    yield

    _scheduler.shutdown(wait=False)
```

- [ ] **Step 6: Run alert service tests**

```bash
cd app/backend && pytest tests/test_alert_service.py -v
```
Expected: all 7 tests PASS

- [ ] **Step 7: Run full suite**

```bash
cd app/backend && pytest -x -q
```
Expected: all tests pass (108+ passing)

- [ ] **Step 8: Commit**

```bash
git add app/backend/app/services/alert_service.py app/backend/main.py app/backend/tests/conftest.py app/backend/tests/test_alert_service.py
git commit -m "feat: implement check_stale_leads, scheduler wiring, alert dedup and T2 auto-escalation"
```

---

## Task 6: Frontend settings types + api.ts + useSettings hook

**Files:**
- Modify: `app/frontend/src/types/lead.ts`
- Modify: `app/frontend/src/services/api.ts`
- Create: `app/frontend/src/hooks/useSettings.ts`

- [ ] **Step 1: Add Settings types to lead.ts**

At the bottom of `app/frontend/src/types/lead.ts`, add:

```typescript
export interface Settings {
  t1_minutes: number
  t2_minutes: number
  quiet_hours_start: string
  quiet_hours_end: string
  quiet_hours_enabled: boolean
  primary_sms: string
  primary_email: string
  backup_name: string
  backup_sms: string
  backup_email: string
}

export interface SettingsPatch {
  t1_minutes?: number
  t2_minutes?: number
  quiet_hours_start?: string
  quiet_hours_end?: string
  quiet_hours_enabled?: boolean
  primary_sms?: string
  primary_email?: string
  backup_name?: string
  backup_sms?: string
  backup_email?: string
}

export interface TestAlertRequest {
  channel: 'sms' | 'email'
  recipient: 'primary' | 'backup'
}

export interface TestAlertResult {
  sent: boolean
  reason?: string | null
}
```

- [ ] **Step 2: Add settings functions to api.ts**

In `app/frontend/src/services/api.ts`, update the import line to include the new types:

```typescript
import type { ..., Settings, SettingsPatch, TestAlertRequest, TestAlertResult } from '../types/lead'
```

Then add at the bottom of the file:

```typescript
export async function fetchSettings(): Promise<Settings> {
  const r = await fetch('/settings')
  if (!r.ok) throw new Error('Failed to fetch settings')
  return r.json()
}

export async function patchSettings(data: SettingsPatch): Promise<Settings> {
  const r = await fetch('/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!r.ok) throw new Error('Failed to save settings')
  return r.json()
}

export async function testAlert(data: TestAlertRequest): Promise<TestAlertResult> {
  const r = await fetch('/settings/test-alert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!r.ok) throw new Error('Test alert request failed')
  return r.json()
}
```

- [ ] **Step 3: Create useSettings.ts**

Create `app/frontend/src/hooks/useSettings.ts`:

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchSettings, patchSettings, testAlert } from '../services/api'
import type { SettingsPatch, TestAlertRequest } from '../types/lead'

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
    staleTime: 60_000,
  })
}

export function usePatchSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: SettingsPatch) => patchSettings(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  })
}

export function useTestAlert() {
  return useMutation({
    mutationFn: (data: TestAlertRequest) => testAlert(data),
  })
}
```

- [ ] **Step 4: Commit**

```bash
git add app/frontend/src/types/lead.ts app/frontend/src/services/api.ts app/frontend/src/hooks/useSettings.ts
git commit -m "feat: add settings types, api functions, and useSettings hook"
```

---

## Task 7: Frontend useStaleLeads hook

**Files:**
- Create: `app/frontend/src/hooks/useStaleLeads.ts`

- [ ] **Step 1: Create useStaleLeads.ts**

Create `app/frontend/src/hooks/useStaleLeads.ts`:

```typescript
import { useEffect, useMemo, useState } from 'react'
import type { Lead, Settings } from '../types/lead'

const SNOOZE_KEY = 'hh_banner_snooze_until'
const SNOOZE_MS = 10 * 60 * 1000  // 10 minutes

const ACTIVE_STATUSES = new Set([
  'new', 'in_review', 'waiting_on_customer', 'ready_for_quote', 'ready_for_booking',
])

function getSnoozed(): boolean {
  const val = localStorage.getItem(SNOOZE_KEY)
  return val ? Date.now() < Number(val) : false
}

export function useStaleLeads(leads: Lead[], settings: Settings | undefined) {
  const [now, setNow] = useState(() => Date.now())
  const [isSnoozed, setIsSnoozed] = useState(getSnoozed)

  // Refresh every 60s so stale indicators update without page reload
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now())
      setIsSnoozed(getSnoozed())
    }, 60_000)
    return () => clearInterval(id)
  }, [])

  const snooze = () => {
    const until = Date.now() + SNOOZE_MS
    localStorage.setItem(SNOOZE_KEY, String(until))
    setIsSnoozed(true)
  }

  const { t1Ids, t2Ids } = useMemo(() => {
    if (!settings) return { t1Ids: new Set<string>(), t2Ids: new Set<string>() }
    const t1Ms = settings.t1_minutes * 60_000
    const t2Ms = settings.t2_minutes * 60_000
    const t1Ids = new Set<string>()
    const t2Ids = new Set<string>()
    for (const lead of leads) {
      if (!ACTIVE_STATUSES.has(lead.status)) continue
      const idleMs = now - new Date(lead.updated_at).getTime()
      if (idleMs >= t2Ms) {
        t2Ids.add(lead.id)
      } else if (idleMs >= t1Ms) {
        t1Ids.add(lead.id)
      }
    }
    return { t1Ids, t2Ids }
  }, [leads, settings, now])

  return { t1Ids, t2Ids, isSnoozed, snooze }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/frontend/src/hooks/useStaleLeads.ts
git commit -m "feat: add useStaleLeads hook with T1/T2 sets and snooze state"
```

---

## Task 8: Frontend StaleLeadBanner + LeadCard staleness indicators

**Files:**
- Create: `app/frontend/src/components/StaleLeadBanner.tsx`
- Modify: `app/frontend/src/components/LeadCard.tsx`

- [ ] **Step 1: Create StaleLeadBanner**

Create `app/frontend/src/components/StaleLeadBanner.tsx`:

```typescript
interface Props {
  t1Count: number
  t2Count: number
  isSnoozed: boolean
  onSnooze: () => void
}

export function StaleLeadBanner({ t1Count, t2Count, isSnoozed, onSnooze }: Props) {
  const total = t1Count + t2Count
  if (total === 0 || isSnoozed) return null

  const isEscalated = t2Count > 0
  const message = isEscalated
    ? `${t2Count} lead${t2Count !== 1 ? 's' : ''} escalated — backup notified`
    : `${t1Count} lead${t1Count !== 1 ? 's' : ''} need${t1Count === 1 ? 's' : ''} attention`

  return (
    <div
      className={`flex items-center justify-between px-4 py-2.5 text-sm font-medium ${
        isEscalated ? 'bg-red-600 text-white' : 'bg-amber-500 text-white'
      }`}
    >
      <span>{isEscalated ? '🔴' : '⚠️'} {message}</span>
      <button
        onClick={onSnooze}
        className="text-xs bg-white/20 rounded px-2.5 py-1 hover:bg-white/30 shrink-0 ml-3"
      >
        Snooze 10m
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Update LeadCard to accept staleness prop**

In `app/frontend/src/components/LeadCard.tsx`, update the `Props` interface and component:

```typescript
import type { Lead } from '../types/lead'
import { AgeIndicator } from './AgeIndicator'
import { SourceBadge } from './SourceBadge'
import { StatusBadge } from './StatusBadge'

interface Props {
  lead: Lead
  onClick: (id: string) => void
  staleness?: 't1' | 't2' | null
}

export function LeadCard({ lead, onClick, staleness }: Props) {
  const staleLeftBorder =
    staleness === 't2' ? 'border-l-4 border-l-red-500' :
    staleness === 't1' ? 'border-l-4 border-l-amber-400' :
    lead.urgency_flag ? 'border-l-4 border-l-orange-500' : 'border-gray-200'

  return (
    <div
      onClick={() => onClick(lead.id)}
      className={[
        'bg-white rounded-lg border p-4 cursor-pointer transition-colors hover:border-blue-400',
        staleLeftBorder,
        !lead.acknowledged_at ? 'ring-1 ring-red-200' : '',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            {staleness === 't2' && (
              <span className="text-xs font-bold text-red-600 uppercase tracking-wide">Escalated</span>
            )}
            {staleness === 't1' && (
              <span className="text-xs font-bold text-amber-600 uppercase tracking-wide">⚠ Idle</span>
            )}
            {lead.urgency_flag && (
              <span className="text-xs font-bold text-orange-500 uppercase tracking-wide">Urgent</span>
            )}
            {!lead.acknowledged_at && (
              <span className="text-xs font-bold text-red-500 uppercase tracking-wide">Unacked</span>
            )}
            <StatusBadge status={lead.status} />
            <SourceBadge source={lead.source_type} />
          </div>
          {lead.customer_name
            ? <p className="font-semibold text-gray-900 truncate">{lead.customer_name}</p>
            : <p className="font-semibold text-gray-400 truncate italic">No name yet</p>
          }
          {lead.customer_phone && (
            <p className="text-sm text-gray-500">{lead.customer_phone}</p>
          )}
          {lead.job_location && (
            <p className="text-xs text-gray-400 truncate mt-0.5">{lead.job_location}</p>
          )}
        </div>
        <AgeIndicator createdAt={lead.created_at} />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add app/frontend/src/components/StaleLeadBanner.tsx app/frontend/src/components/LeadCard.tsx
git commit -m "feat: add StaleLeadBanner and LeadCard staleness indicators"
```

---

## Task 9: Frontend SettingsScreen

**Files:**
- Create: `app/frontend/src/screens/SettingsScreen.tsx`

- [ ] **Step 1: Create SettingsScreen**

Create `app/frontend/src/screens/SettingsScreen.tsx`:

```typescript
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSettings, usePatchSettings, useTestAlert } from '../hooks/useSettings'
import type { SettingsPatch, TestAlertRequest } from '../types/lead'

type TestKey = `${TestAlertRequest['channel']}_${TestAlertRequest['recipient']}`
type TestState = { sent: boolean; reason?: string | null }

export function SettingsScreen() {
  const navigate = useNavigate()
  const { data: settings, isLoading } = useSettings()
  const patch = usePatchSettings()
  const testAlert = useTestAlert()

  const [form, setForm] = useState<SettingsPatch>({})
  const [saved, setSaved] = useState(false)
  const [testResults, setTestResults] = useState<Partial<Record<TestKey, TestState>>>({})

  useEffect(() => {
    if (settings) {
      setForm({
        t1_minutes: settings.t1_minutes,
        t2_minutes: settings.t2_minutes,
        quiet_hours_start: settings.quiet_hours_start,
        quiet_hours_end: settings.quiet_hours_end,
        quiet_hours_enabled: settings.quiet_hours_enabled,
        primary_sms: settings.primary_sms,
        primary_email: settings.primary_email,
        backup_name: settings.backup_name,
        backup_sms: settings.backup_sms,
        backup_email: settings.backup_email,
      })
    }
  }, [settings])

  const set = (key: keyof SettingsPatch, value: unknown) =>
    setForm(prev => ({ ...prev, [key]: value }))

  const handleSave = () => {
    patch.mutate(form, {
      onSuccess: () => {
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      },
    })
  }

  const handleTestAlert = (channel: TestAlertRequest['channel'], recipient: TestAlertRequest['recipient']) => {
    const key: TestKey = `${channel}_${recipient}`
    testAlert.mutate({ channel, recipient }, {
      onSuccess: result => setTestResults(prev => ({ ...prev, [key]: result })),
      onError: () => setTestResults(prev => ({ ...prev, [key]: { sent: false, reason: 'Request failed' } })),
    })
  }

  if (isLoading) return <div className="p-6 text-gray-400">Loading…</div>

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate('/')} className="text-gray-500 hover:text-gray-800 text-lg">←</button>
        <h1 className="font-bold text-gray-900 text-lg">Settings</h1>
      </header>

      <div className="p-4 space-y-6 pb-20">

        {/* Alert Thresholds */}
        <section className="bg-white rounded-xl border p-4 space-y-3">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Alert Thresholds</h2>
          <FieldRow label="T1 warning (minutes)">
            <input
              type="number" min={1} max={120}
              className="border rounded-lg px-3 py-1.5 text-sm w-20 text-right"
              value={form.t1_minutes ?? ''}
              onChange={e => set('t1_minutes', Number(e.target.value))}
            />
          </FieldRow>
          <FieldRow label="T2 escalation (minutes)">
            <input
              type="number" min={1} max={240}
              className="border rounded-lg px-3 py-1.5 text-sm w-20 text-right"
              value={form.t2_minutes ?? ''}
              onChange={e => set('t2_minutes', Number(e.target.value))}
            />
          </FieldRow>
        </section>

        {/* Quiet Hours */}
        <section className="bg-white rounded-xl border p-4 space-y-3">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Quiet Hours</h2>
          <FieldRow label="Enable quiet hours">
            <input
              type="checkbox"
              className="w-4 h-4"
              checked={form.quiet_hours_enabled ?? false}
              onChange={e => set('quiet_hours_enabled', e.target.checked)}
            />
          </FieldRow>
          <FieldRow label="Start (HH:MM)">
            <input
              type="time"
              className="border rounded-lg px-3 py-1.5 text-sm"
              value={form.quiet_hours_start ?? '22:00'}
              onChange={e => set('quiet_hours_start', e.target.value)}
            />
          </FieldRow>
          <FieldRow label="End (HH:MM)">
            <input
              type="time"
              className="border rounded-lg px-3 py-1.5 text-sm"
              value={form.quiet_hours_end ?? '07:00'}
              onChange={e => set('quiet_hours_end', e.target.value)}
            />
          </FieldRow>
        </section>

        {/* Primary Facilitator */}
        <section className="bg-white rounded-xl border p-4 space-y-3">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Primary Facilitator</h2>
          <FieldRow label="SMS number">
            <input
              type="tel"
              className="border rounded-lg px-3 py-1.5 text-sm flex-1"
              placeholder="+15551234567"
              value={form.primary_sms ?? ''}
              onChange={e => set('primary_sms', e.target.value)}
            />
          </FieldRow>
          <FieldRow label="Email">
            <input
              type="email"
              className="border rounded-lg px-3 py-1.5 text-sm flex-1"
              placeholder="you@example.com"
              value={form.primary_email ?? ''}
              onChange={e => set('primary_email', e.target.value)}
            />
          </FieldRow>
        </section>

        {/* Backup Handler */}
        <section className="bg-white rounded-xl border p-4 space-y-3">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Backup Handler</h2>
          <FieldRow label="Name">
            <input
              type="text"
              className="border rounded-lg px-3 py-1.5 text-sm flex-1"
              placeholder="Jordan"
              value={form.backup_name ?? ''}
              onChange={e => set('backup_name', e.target.value)}
            />
          </FieldRow>
          <FieldRow label="SMS number">
            <input
              type="tel"
              className="border rounded-lg px-3 py-1.5 text-sm flex-1"
              placeholder="+15559876543"
              value={form.backup_sms ?? ''}
              onChange={e => set('backup_sms', e.target.value)}
            />
          </FieldRow>
          <FieldRow label="Email">
            <input
              type="email"
              className="border rounded-lg px-3 py-1.5 text-sm flex-1"
              placeholder="backup@example.com"
              value={form.backup_email ?? ''}
              onChange={e => set('backup_email', e.target.value)}
            />
          </FieldRow>
        </section>

        {/* Test Alerts */}
        <section className="bg-white rounded-xl border p-4 space-y-3">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Test Alerts</h2>
          {(['sms', 'email'] as const).flatMap(channel =>
            (['primary', 'backup'] as const).map(recipient => {
              const key: TestKey = `${channel}_${recipient}`
              const result = testResults[key]
              return (
                <div key={key} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-gray-600 capitalize">
                    {channel.toUpperCase()} → {recipient}
                  </span>
                  <div className="flex items-center gap-2">
                    {result && (
                      <span className={`text-xs ${result.sent ? 'text-emerald-600' : 'text-red-600'}`}>
                        {result.sent ? '✓ Sent' : `✗ ${result.reason ?? 'Failed'}`}
                      </span>
                    )}
                    <button
                      onClick={() => handleTestAlert(channel, recipient)}
                      disabled={testAlert.isPending}
                      className="text-xs border rounded-lg px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Send test
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </section>

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={patch.isPending}
          className={`w-full py-3 rounded-xl text-sm font-semibold transition-colors ${
            saved
              ? 'bg-emerald-600 text-white'
              : 'bg-gray-900 text-white hover:bg-gray-700'
          } disabled:opacity-50`}
        >
          {patch.isPending ? 'Saving…' : saved ? '✓ Saved' : 'Save Settings'}
        </button>
      </div>
    </div>
  )
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-gray-600 shrink-0">{label}</span>
      {children}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/frontend/src/screens/SettingsScreen.tsx
git commit -m "feat: add SettingsScreen with thresholds, quiet hours, contacts, and test alert buttons"
```

---

## Task 10: Frontend wiring — App.tsx + LeadQueue

**Files:**
- Modify: `app/frontend/src/App.tsx`
- Modify: `app/frontend/src/screens/LeadQueue.tsx`

- [ ] **Step 1: Add /settings route to App.tsx**

Replace `app/frontend/src/App.tsx` with:

```typescript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { LeadCommandCenter } from './screens/LeadCommandCenter'
import { LeadQueue } from './screens/LeadQueue'
import { SettingsScreen } from './screens/SettingsScreen'

const queryClient = new QueryClient()

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Routes>
        <Route path="/" element={<LeadQueue />} />
        <Route path="/leads/:id" element={<LeadCommandCenter />} />
        <Route path="/settings" element={<SettingsScreen />} />
      </Routes>
    </QueryClientProvider>
  )
}
```

- [ ] **Step 2: Update LeadQueue to wire banner, gear icon, and card staleness**

Replace `app/frontend/src/screens/LeadQueue.tsx` with:

```typescript
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LeadCard } from '../components/LeadCard'
import { IngestProgressFlow } from '../components/IngestProgressFlow'
import { StaleLeadBanner } from '../components/StaleLeadBanner'
import { useLeads } from '../hooks/useLeads'
import { useSettings } from '../hooks/useSettings'
import { useStaleLeads } from '../hooks/useStaleLeads'
import { LeadCreate } from './LeadCreate'
import type { LeadSourceType, LeadStatus } from '../types/lead'

export function LeadQueue() {
  const navigate = useNavigate()
  const [statusFilter, setStatusFilter] = useState<LeadStatus | ''>('')
  const [sourceFilter, setSourceFilter] = useState<LeadSourceType | ''>('')
  const [assignedFilter, setAssignedFilter] = useState('')
  const [showIngest, setShowIngest] = useState(false)
  const [showManual, setShowManual] = useState(false)

  const { data: leads = [], isLoading, error } = useLeads({
    status: statusFilter || undefined,
    source_type: sourceFilter || undefined,
    assigned_to: assignedFilter.trim() || undefined,
  })

  const { data: settings } = useSettings()
  const { t1Ids, t2Ids, isSnoozed, snooze } = useStaleLeads(leads, settings)

  const unackedCount = leads.filter(l => !l.acknowledged_at).length

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <header className="bg-white border-b px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div>
          <h1 className="font-bold text-gray-900 text-lg leading-tight">Lead Queue</h1>
          {unackedCount > 0 && (
            <p className="text-xs text-red-500 font-medium">{unackedCount} unacknowledged</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/settings')}
            className="text-gray-400 hover:text-gray-700 text-xl px-1"
            title="Settings"
          >
            ⚙
          </button>
          <button
            onClick={() => setShowManual(true)}
            className="text-sm text-gray-500 hover:text-gray-700 font-medium px-2 py-1"
          >
            Manual
          </button>
          <button
            onClick={() => setShowIngest(true)}
            className="bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-indigo-700 active:bg-indigo-800"
          >
            📷 New from Screenshot
          </button>
        </div>
      </header>

      {/* Stale lead banner */}
      <StaleLeadBanner
        t1Count={t1Ids.size}
        t2Count={t2Ids.size}
        isSnoozed={isSnoozed}
        onSnooze={snooze}
      />

      {/* Filters */}
      <div className="px-4 py-3 flex gap-2 flex-wrap border-b bg-white">
        <select
          className="border rounded-lg px-3 py-1.5 text-sm bg-white"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as LeadStatus | '')}
        >
          <option value="">All Statuses</option>
          <option value="new">New</option>
          <option value="in_review">In Review</option>
          <option value="waiting_on_customer">Waiting</option>
          <option value="ready_for_quote">Ready to Quote</option>
          <option value="ready_for_booking">Ready to Book</option>
          <option value="escalated">Escalated</option>
          <option value="booked">Booked</option>
          <option value="released">Released</option>
        </select>

        <select
          className="border rounded-lg px-3 py-1.5 text-sm bg-white"
          value={sourceFilter}
          onChange={e => setSourceFilter(e.target.value as LeadSourceType | '')}
        >
          <option value="">All Sources</option>
          <option value="thumbtack_api">Thumbtack API</option>
          <option value="thumbtack_screenshot">Thumbtack OCR</option>
          <option value="yelp_screenshot">Yelp OCR</option>
          <option value="google_screenshot">Google OCR</option>
          <option value="website_form">Website</option>
          <option value="manual">Manual</option>
        </select>

        <input
          type="text"
          className="border rounded-lg px-3 py-1.5 text-sm bg-white w-32"
          placeholder="Handler…"
          value={assignedFilter}
          onChange={e => setAssignedFilter(e.target.value)}
        />
      </div>

      {/* Count */}
      <div className="px-4 pt-3 pb-1">
        <p className="text-xs text-gray-400">{leads.length} lead{leads.length !== 1 ? 's' : ''}</p>
      </div>

      {/* List */}
      <main className="px-4 pb-10 space-y-3">
        {isLoading && (
          <p className="text-sm text-gray-400 text-center py-10">Loading…</p>
        )}
        {!isLoading && error && (
          <p className="text-sm text-red-500 text-center py-10">Could not load leads. Is the backend running?</p>
        )}
        {!isLoading && !error && leads.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-10">No leads. Tap 📷 New from Screenshot to add one.</p>
        )}
        {leads.map(lead => (
          <LeadCard
            key={lead.id}
            lead={lead}
            onClick={id => navigate(`/leads/${id}`)}
            staleness={t2Ids.has(lead.id) ? 't2' : t1Ids.has(lead.id) ? 't1' : null}
          />
        ))}
      </main>

      {showIngest && <IngestProgressFlow onClose={() => setShowIngest(false)} />}
      {showManual && <LeadCreate onClose={() => setShowManual(false)} />}
    </div>
  )
}
```

- [ ] **Step 3: Run full backend test suite**

```bash
cd app/backend && pytest -x -q
```
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add app/frontend/src/App.tsx app/frontend/src/screens/LeadQueue.tsx
git commit -m "feat: wire /settings route, stale banner, gear icon, and card staleness into LeadQueue"
```

---

## Self-Review

**Spec coverage:**
- ✅ In-app T1/T2 indicators on lead cards (Task 8)
- ✅ Queue banner with snooze (Task 8, 10)
- ✅ Backend scheduler every 5 min (Task 5)
- ✅ T1 → primary; T2 → primary + backup (Task 5)
- ✅ T2 auto-advance to escalated + audit event (Task 5)
- ✅ Quiet hours suppression (Task 4, 5)
- ✅ Dedup per idle window (Task 5)
- ✅ SMS via Twilio, graceful no-op (Task 4)
- ✅ Email via SMTP, graceful no-op (Task 4)
- ✅ Configurable thresholds (Task 2, 6, 9)
- ✅ Settings screen with all fields (Task 9)
- ✅ Test send buttons (Task 4, 9)
- ✅ Gear icon in queue header (Task 10)
- ✅ /settings route (Task 10)

**Type consistency:** `SettingsOut` (Python) ↔ `Settings` (TypeScript) — same field names throughout. `_process_stale_leads` signature consistent between definition and test calls. `LeadCard.staleness` prop type `'t1' | 't2' | null` consistent between definition and usage.

**No placeholders found.**
