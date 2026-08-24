# Thumbtack Webhooks — Phase 1 (Connect and Capture) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Thumbtack webhook receiver that accepts real deliveries, stores every raw body, and never loses one — plus an admin screen where Ron creates a connection and copies the URL and credentials into `thumbtack.com/pro/webhooks/create`.

**Architecture:** A `thumbtack_connections` record is created in the app and identified by an unguessable `url_token` in the endpoint path. The public route resolves the connection, optionally verifies HTTP Basic credentials, writes a `thumbtack_webhook_events` row with the verbatim body, commits, and returns 200 — *then* classifies. Nothing is mapped onto leads in this phase. The point of Phase 1 is to turn the unconfirmed payload shape into observed fact before Phase 2 writes any mapping against it.

**Tech Stack:** Python 3, FastAPI, SQLAlchemy async + aiosqlite, bcrypt (via `app.services.auth_service`), pytest + pytest-asyncio + httpx `AsyncClient`; React 18 + TypeScript + Vite + Tailwind + TanStack Query.

**Spec:** `docs/superpowers/specs/2026-08-24-thumbtack-webhook-integration-design.md`

**Branch:** `feat/thumbtack-webhooks` (already created off `main`)

## Global Constraints

- **Test baseline is 392 collected tests** (`python -m pytest --collect-only -q`, 2026-08-24). Do not regress it. `CLAUDE.md` claims 108; it is stale — ignore it.
- **New tables only.** Phase 1 adds no columns to `leads` and rebuilds no table. `Base.metadata.create_all` at startup creates the new tables. There is no `ALTER` in this phase, therefore no startup-migration outage risk.
- **The receiver must never return a non-2xx for a body it could not understand.** Only unknown/invalid credentials (401) and oversized bodies (413) may be rejected. Everything else is stored and answered 200.
- **The raw body is committed before any parsing happens.** Parsing runs after the commit and can never turn a delivered event into a lost one.
- **Secrets are stored hashed** using `auth_service.hash_pin` / `verify_pin` (bcrypt). The plaintext secret is returned exactly once, in the create response, and never again by any endpoint.
- **Raw bodies contain customer PII** (name, phone, address). Never log them at `info` level.
- Backend business logic lives in services; routers own only HTTP. This is a repo rule from `CLAUDE.md`.
- Frontend state goes in React Query hooks, not component local state, for anything server-owned.
- Touch-first: every interactive control is at least 44px on its smallest dimension, and nothing depends on hover.
- Every write action ships all three states in the same pass: in-progress indicator, success confirmation, recoverable failure.

## Decisions made while planning (deviations from the spec, deliberate)

1. **Classification ships in Phase 1.** The spec says "nothing is parsed; every event lands as `unknown`." Classifying by body shape costs nothing, creates no lead or message records, and immediately answers the open question of whether Thumbtack sends leads and messages to one URL. Events are classified but never mapped.
2. **No retry button in Phase 1.** The spec lists a retry action on failed rows. In Phase 1 there is no parser to re-run, so retry would be a dead control. It ships with Phase 2.
3. **Basic auth is verified only if present ("verify-if-present").** We do not yet know whether the self-serve form can send credentials. Requiring them could make every delivery fail; ignoring a supplied-but-wrong credential would be sloppy. So: a correct `url_token` authorizes, and if an `Authorization` header *is* sent it must be valid or the request is rejected. The `url_token` is 32 bytes from `secrets.token_urlsafe` and functions as a bearer secret in the path. Phase 2 can add a strict mode once the form's capability is known.
4. **The existing broken route at `POST /ingest/webhook/thumbtack` is left untouched.** Removing it would delete 7 passing tests whose mapping logic Phase 2 will reuse. It stays out of scope. Note for the record: those 7 tests pass only because `tests/conftest.py` overrides `require_auth` with a mock admin — which is exactly why the auth defect was never caught. The new admin screen only ever displays the new URL, so there is no way to paste the wrong one into Thumbtack.

## File Structure

**Backend — create**

| File | Responsibility |
|---|---|
| `app/backend/app/models/thumbtack.py` | `ThumbtackConnection` + `ThumbtackWebhookEvent`. They change together, so they live together. |
| `app/backend/app/schemas/thumbtack.py` | Request/response shapes. Enforces that the secret hash never leaves the server. |
| `app/backend/app/services/thumbtack_service.py` | All logic: credential generation and verification, connection CRUD, classification, event recording, pruning. |
| `app/backend/app/routers/thumbtack.py` | HTTP only: the public webhook route and the admin CRUD routes. |
| `app/backend/tests/test_thumbtack_webhook.py` | Full Phase 1 coverage. |

**Backend — modify**

| File | Change |
|---|---|
| `app/backend/main.py` | Register the new models with `Base` before `create_all`; add the router to the imports and `include_router`. |

**Frontend — create**

| File | Responsibility |
|---|---|
| `app/frontend/src/types/thumbtack.ts` | Types mirroring the API schemas. |
| `app/frontend/src/hooks/useThumbtack.ts` | React Query hooks. |
| `app/frontend/src/screens/AdminThumbtackScreen.tsx` | The connections screen. |

**Frontend — modify**

| File | Change |
|---|---|
| `app/frontend/src/App.tsx` | Add the `/admin/thumbtack` route, admin-only. |
| `app/frontend/src/screens/AdminScreen.tsx` | Add the Thumbtack card to `CARDS`. |

---

### Task 1: Models and startup registration

**Files:**
- Create: `app/backend/app/models/thumbtack.py`
- Modify: `app/backend/main.py` (model import block, ~line 45)
- Test: `app/backend/tests/test_thumbtack_webhook.py`

**Interfaces:**
- Consumes: `app.database.Base`
- Produces: `ThumbtackConnection`, `ThumbtackWebhookEvent` — table names `thumbtack_connections`, `thumbtack_webhook_events`

- [ ] **Step 1: Write the failing test**

Create `app/backend/tests/test_thumbtack_webhook.py`:

```python
import json

import pytest
from sqlalchemy import select


@pytest.mark.asyncio
async def test_connection_table_exists_with_defaults(client, db_session):
    from app.models.thumbtack import ThumbtackConnection

    conn = ThumbtackConnection(
        label="Holy Hauling — St. Louis",
        city_id="st-louis",
        business="holy_hauling",
        url_token="tok_test_1",
    )
    db_session.add(conn)
    await db_session.commit()
    await db_session.refresh(conn)

    assert conn.id is not None
    assert conn.is_active is True
    assert conn.created_at is not None
    assert conn.last_event_at is None


@pytest.mark.asyncio
async def test_event_table_stores_raw_body_verbatim(client, db_session):
    from app.models.thumbtack import ThumbtackConnection, ThumbtackWebhookEvent

    conn = ThumbtackConnection(
        label="Holy Handy — Chicago",
        city_id="chicago",
        business="holy_handy",
        url_token="tok_test_2",
    )
    db_session.add(conn)
    await db_session.commit()

    body = '{"leadID":"abc","request":{"category":"Junk Removal"}}'
    event = ThumbtackWebhookEvent(
        connection_id=conn.id,
        kind="lead",
        external_id="abc",
        raw_body=body,
        status="received",
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)

    assert event.raw_body == body
    assert json.loads(event.raw_body)["leadID"] == "abc"
    assert event.status == "received"
    assert event.processed_at is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/backend && python -m pytest tests/test_thumbtack_webhook.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.models.thumbtack'`

- [ ] **Step 3: Write the models**

Create `app/backend/app/models/thumbtack.py`:

```python
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, Text

from app.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ThumbtackConnection(Base):
    """One row per webhook created in the Thumbtack pro dashboard."""

    __tablename__ = "thumbtack_connections"

    id = Column(String, primary_key=True, default=_uuid)
    label = Column(String, nullable=False)
    # The pin: every event from this connection belongs to this city.
    city_id = Column(String, ForeignKey("cities.id"), nullable=False)
    business = Column(String, nullable=False)        # 'holy_hauling' | 'holy_handy'
    # Learned from the first payload's business.businessID; not known at create time.
    business_id = Column(String, nullable=True)
    # Basic-auth username Thumbtack sends, when it can send one.
    auth_username = Column(String, nullable=True, unique=True)
    auth_secret_hash = Column(String, nullable=True)
    # Unguessable path segment. This is the primary identifier for an inbound request.
    url_token = Column(String, nullable=False, unique=True)
    is_active = Column(Boolean, nullable=False, default=True)
    last_event_at = Column(DateTime, nullable=True)
    last_error_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=_now)


class ThumbtackWebhookEvent(Base):
    """Capture-first ledger. Every accepted request lands here before it is parsed."""

    __tablename__ = "thumbtack_webhook_events"

    id = Column(String, primary_key=True, default=_uuid)
    connection_id = Column(
        String, ForeignKey("thumbtack_connections.id", ondelete="CASCADE"), nullable=False
    )
    kind = Column(String, nullable=False)            # lead | message | review | unknown
    external_id = Column(String, nullable=True)      # leadID / messageID / reviewID
    raw_body = Column(Text, nullable=False)          # verbatim request body
    # received | processed | duplicate | orphaned | failed | ignored
    status = Column(String, nullable=False, default="received")
    error = Column(Text, nullable=True)
    lead_id = Column(String, ForeignKey("leads.id", ondelete="SET NULL"), nullable=True)
    received_at = Column(DateTime, nullable=False, default=_now)
    processed_at = Column(DateTime, nullable=True)
```

- [ ] **Step 4: Register the models at startup**

In `app/backend/main.py`, in the block of `import app.models.*  # noqa: F401` lines (ends around line 45 with `import app.models.lead_checklist_item`), add:

```python
import app.models.thumbtack  # noqa: F401
```

This is what makes `create_all` build both tables. Without it the tables silently do not exist.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd app/backend && python -m pytest tests/test_thumbtack_webhook.py -v`
Expected: 2 passed

- [ ] **Step 6: Run the full suite to confirm no regression**

Run: `cd app/backend && python -m pytest -q 2>&1 | tail -5`
Expected: 394 passed (392 baseline + 2 new)

- [ ] **Step 7: Commit**

```bash
git add app/backend/app/models/thumbtack.py app/backend/main.py app/backend/tests/test_thumbtack_webhook.py
git commit -m "feat(thumbtack): connection and webhook-event models"
```

---

### Task 2: Credentials and connection CRUD

**Files:**
- Create: `app/backend/app/services/thumbtack_service.py`
- Test: `app/backend/tests/test_thumbtack_webhook.py` (append)

**Interfaces:**
- Consumes: `ThumbtackConnection` from Task 1; `auth_service.hash_pin(str) -> str`, `auth_service.verify_pin(str, str) -> bool`
- Produces:
  - `generate_credentials() -> tuple[str, str, str]` — `(url_token, auth_username, auth_secret_plain)`
  - `async create_connection(db, *, label: str, city_id: str, business: str) -> tuple[ThumbtackConnection, str]` — returns the row and the **plaintext secret**
  - `async list_connections(db) -> list[ThumbtackConnection]`
  - `async get_by_url_token(db, url_token: str) -> ThumbtackConnection | None`
  - `async set_active(db, connection_id: str, is_active: bool) -> ThumbtackConnection | None`
  - `async delete_connection(db, connection_id: str) -> bool`
  - `verify_basic_header(authorization: str | None, conn: ThumbtackConnection) -> bool`

- [ ] **Step 1: Write the failing test**

Append to `app/backend/tests/test_thumbtack_webhook.py`:

```python
@pytest.mark.asyncio
async def test_create_connection_returns_plaintext_secret_once(client, db_session):
    from app.services import thumbtack_service

    conn, secret = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_hauling"
    )

    assert secret
    assert len(secret) >= 20
    # The plaintext is never persisted.
    assert conn.auth_secret_hash != secret
    assert conn.url_token
    assert conn.auth_username


@pytest.mark.asyncio
async def test_generated_tokens_are_unique(client, db_session):
    from app.services import thumbtack_service

    a, _ = await thumbtack_service.create_connection(
        db_session, label="A", city_id="st-louis", business="holy_hauling"
    )
    b, _ = await thumbtack_service.create_connection(
        db_session, label="B", city_id="chicago", business="holy_handy"
    )

    assert a.url_token != b.url_token
    assert a.auth_username != b.auth_username


@pytest.mark.asyncio
async def test_get_by_url_token_finds_the_connection(client, db_session):
    from app.services import thumbtack_service

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_hauling"
    )

    found = await thumbtack_service.get_by_url_token(db_session, conn.url_token)
    assert found is not None
    assert found.id == conn.id

    assert await thumbtack_service.get_by_url_token(db_session, "nope") is None


@pytest.mark.asyncio
async def test_verify_basic_header(client, db_session):
    import base64

    from app.services import thumbtack_service

    conn, secret = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_hauling"
    )

    def header(user: str, password: str) -> str:
        raw = base64.b64encode(f"{user}:{password}".encode()).decode()
        return f"Basic {raw}"

    assert thumbtack_service.verify_basic_header(header(conn.auth_username, secret), conn) is True
    assert thumbtack_service.verify_basic_header(header(conn.auth_username, "wrong"), conn) is False
    assert thumbtack_service.verify_basic_header(header("wrong", secret), conn) is False
    assert thumbtack_service.verify_basic_header("Bearer abc", conn) is False
    assert thumbtack_service.verify_basic_header("Basic !!!not-base64!!!", conn) is False
    # No header at all is not a *failed* verification — the caller decides. See the route.
    assert thumbtack_service.verify_basic_header(None, conn) is False


@pytest.mark.asyncio
async def test_set_active_and_delete(client, db_session):
    from app.services import thumbtack_service

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_hauling"
    )

    disabled = await thumbtack_service.set_active(db_session, conn.id, False)
    assert disabled is not None and disabled.is_active is False

    assert await thumbtack_service.delete_connection(db_session, conn.id) is True
    assert await thumbtack_service.get_by_url_token(db_session, conn.url_token) is None
    assert await thumbtack_service.delete_connection(db_session, "missing") is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/backend && python -m pytest tests/test_thumbtack_webhook.py -v`
Expected: FAIL with `ImportError: cannot import name 'thumbtack_service'`

- [ ] **Step 3: Write the service**

Create `app/backend/app/services/thumbtack_service.py`:

```python
from __future__ import annotations

import base64
import binascii
import hmac
import logging
import secrets
from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.thumbtack import ThumbtackConnection, ThumbtackWebhookEvent
from app.services import auth_service

logger = logging.getLogger(__name__)

# Thumbtack lead payloads carry attachment metadata, not the files themselves,
# so a legitimate body is small. 1 MB is generous.
MAX_BODY_BYTES = 1_000_000


def _now() -> datetime:
    return datetime.now(timezone.utc)


def generate_credentials() -> tuple[str, str, str]:
    """Return (url_token, auth_username, auth_secret_plain)."""
    return (
        secrets.token_urlsafe(32),
        f"tt_{secrets.token_hex(8)}",
        secrets.token_urlsafe(24),
    )


async def create_connection(
    db: AsyncSession, *, label: str, city_id: str, business: str
) -> tuple[ThumbtackConnection, str]:
    """Create a connection. Returns the row and the plaintext secret, which is
    the only time the secret is ever available."""
    url_token, username, secret = generate_credentials()
    conn = ThumbtackConnection(
        label=label,
        city_id=city_id,
        business=business,
        auth_username=username,
        auth_secret_hash=auth_service.hash_pin(secret),
        url_token=url_token,
        is_active=True,
    )
    db.add(conn)
    await db.commit()
    await db.refresh(conn)
    return conn, secret


async def list_connections(db: AsyncSession) -> list[ThumbtackConnection]:
    result = await db.execute(
        select(ThumbtackConnection).order_by(ThumbtackConnection.created_at.desc())
    )
    return list(result.scalars().all())


async def get_by_url_token(db: AsyncSession, url_token: str) -> ThumbtackConnection | None:
    result = await db.execute(
        select(ThumbtackConnection).where(ThumbtackConnection.url_token == url_token).limit(1)
    )
    return result.scalar_one_or_none()


async def get_by_id(db: AsyncSession, connection_id: str) -> ThumbtackConnection | None:
    result = await db.execute(
        select(ThumbtackConnection).where(ThumbtackConnection.id == connection_id).limit(1)
    )
    return result.scalar_one_or_none()


async def set_active(
    db: AsyncSession, connection_id: str, is_active: bool
) -> ThumbtackConnection | None:
    conn = await get_by_id(db, connection_id)
    if conn is None:
        return None
    conn.is_active = is_active
    await db.commit()
    await db.refresh(conn)
    return conn


async def delete_connection(db: AsyncSession, connection_id: str) -> bool:
    conn = await get_by_id(db, connection_id)
    if conn is None:
        return False
    # SQLite does not enforce ON DELETE CASCADE unless pragma foreign_keys is on,
    # so remove the child rows explicitly rather than relying on it.
    await db.execute(
        delete(ThumbtackWebhookEvent).where(
            ThumbtackWebhookEvent.connection_id == connection_id
        )
    )
    await db.delete(conn)
    await db.commit()
    return True


def verify_basic_header(authorization: str | None, conn: ThumbtackConnection) -> bool:
    """True only when the header carries valid Basic credentials for this connection.

    A missing header returns False. Whether a missing header is acceptable is the
    route's decision, not this function's — see the verify-if-present rule.
    """
    if not authorization or not authorization.lower().startswith("basic "):
        return False
    if not conn.auth_username or not conn.auth_secret_hash:
        return False
    try:
        decoded = base64.b64decode(authorization[6:].strip(), validate=True).decode()
    except (binascii.Error, UnicodeDecodeError, ValueError):
        return False
    username, _, password = decoded.partition(":")
    if not hmac.compare_digest(username, conn.auth_username):
        return False
    try:
        return auth_service.verify_pin(password, conn.auth_secret_hash)
    except ValueError:
        return False
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app/backend && python -m pytest tests/test_thumbtack_webhook.py -v`
Expected: 7 passed

- [ ] **Step 5: Commit**

```bash
git add app/backend/app/services/thumbtack_service.py app/backend/tests/test_thumbtack_webhook.py
git commit -m "feat(thumbtack): connection credentials and CRUD service"
```

---

### Task 3: Classification, event recording, and pruning

**Files:**
- Modify: `app/backend/app/services/thumbtack_service.py`
- Modify: `app/backend/main.py` (scheduler job registration, ~line 689)
- Test: `app/backend/tests/test_thumbtack_webhook.py` (append)

**Interfaces:**
- Consumes: everything from Task 2
- Produces:
  - `classify(body: object) -> tuple[str, str | None]` — `(kind, external_id)`, kind in `lead | message | review | unknown`
  - `async record_event(db, conn: ThumbtackConnection, raw_body: bytes) -> ThumbtackWebhookEvent`
  - `async list_events(db, *, connection_id: str | None = None, limit: int = 50) -> list[ThumbtackWebhookEvent]`
  - `async prune_events(db, *, older_than_days: int = 90) -> int`

- [ ] **Step 1: Write the failing test**

Append to `app/backend/tests/test_thumbtack_webhook.py`:

```python
LEAD_BODY = {
    "leadID": "lead-123",
    "createTimestamp": "1756000000",
    "leadPrice": "31.50",
    "chargeState": "CHARGED",
    "request": {
        "requestID": "req-1",
        "category": "Junk Removal",
        "title": "Garage cleanout",
        "description": "Old couch and boxes",
        "location": {"city": "St. Louis", "state": "MO", "zipCode": "63101"},
        "details": [{"question": "How many items?", "answer": "About 10"}],
    },
    "customer": {"customerID": "cust-1", "name": "Jane D", "phone": "3145551212"},
    "business": {"businessID": "biz-1", "name": "Holy Hauling"},
}

MESSAGE_BODY = {
    "leadID": "lead-123",
    "customerID": "cust-1",
    "businessID": "biz-1",
    "message": {
        "messageID": "msg-9",
        "createTimestamp": "1756000100",
        "text": "Can you come Saturday?",
    },
}

REVIEW_BODY = {
    "review": {
        "reviewID": "rev-5",
        "businessID": "biz-1",
        "leadID": "lead-123",
        "rating": "5",
        "verified": True,
    },
    "reviewEventType": "REVIEW_ADDED",
}


def test_classify_lead():
    from app.services import thumbtack_service

    assert thumbtack_service.classify(LEAD_BODY) == ("lead", "lead-123")


def test_classify_message():
    from app.services import thumbtack_service

    assert thumbtack_service.classify(MESSAGE_BODY) == ("message", "msg-9")


def test_classify_review():
    from app.services import thumbtack_service

    assert thumbtack_service.classify(REVIEW_BODY) == ("review", "rev-5")


def test_classify_unknown_shapes():
    from app.services import thumbtack_service

    assert thumbtack_service.classify({"hello": "world"}) == ("unknown", None)
    assert thumbtack_service.classify([]) == ("unknown", None)
    assert thumbtack_service.classify("a string") == ("unknown", None)
    # A leadID without a request object is not a lead payload we recognise.
    assert thumbtack_service.classify({"leadID": "x"}) == ("unknown", None)


@pytest.mark.asyncio
async def test_record_event_stores_lead_and_marks_received(client, db_session):
    from app.services import thumbtack_service

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_hauling"
    )
    raw = json.dumps(LEAD_BODY).encode()

    event = await thumbtack_service.record_event(db_session, conn, raw)

    assert event.kind == "lead"
    assert event.external_id == "lead-123"
    assert event.status == "received"
    assert event.error is None
    assert json.loads(event.raw_body) == LEAD_BODY

    await db_session.refresh(conn)
    assert conn.last_event_at is not None


@pytest.mark.asyncio
async def test_record_event_marks_reviews_ignored(client, db_session):
    from app.services import thumbtack_service

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_hauling"
    )

    event = await thumbtack_service.record_event(
        db_session, conn, json.dumps(REVIEW_BODY).encode()
    )

    assert event.kind == "review"
    assert event.status == "ignored"


@pytest.mark.asyncio
async def test_record_event_keeps_unparseable_body_and_flags_it(client, db_session):
    from app.services import thumbtack_service

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_hauling"
    )

    event = await thumbtack_service.record_event(db_session, conn, b"{not json at all")

    assert event.status == "failed"
    assert event.kind == "unknown"
    assert event.error
    # The body survives verbatim — this is the whole point of capture-first.
    assert event.raw_body == "{not json at all"

    await db_session.refresh(conn)
    assert conn.last_error_at is not None


@pytest.mark.asyncio
async def test_record_event_handles_undecodable_bytes(client, db_session):
    from app.services import thumbtack_service

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_hauling"
    )

    event = await thumbtack_service.record_event(db_session, conn, b"\xff\xfe\x00binary")

    assert event.status == "failed"
    assert event.raw_body  # stored lossily rather than crashing


@pytest.mark.asyncio
async def test_list_events_newest_first_and_respects_limit(client, db_session):
    from app.services import thumbtack_service

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_hauling"
    )
    for i in range(3):
        body = {**LEAD_BODY, "leadID": f"lead-{i}"}
        await thumbtack_service.record_event(db_session, conn, json.dumps(body).encode())

    events = await thumbtack_service.list_events(db_session, connection_id=conn.id, limit=2)

    assert len(events) == 2
    assert events[0].external_id == "lead-2"


@pytest.mark.asyncio
async def test_prune_events_removes_only_old_rows(client, db_session):
    from datetime import timedelta

    from app.services import thumbtack_service

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_hauling"
    )
    fresh = await thumbtack_service.record_event(
        db_session, conn, json.dumps(LEAD_BODY).encode()
    )
    stale = await thumbtack_service.record_event(
        db_session, conn, json.dumps({**LEAD_BODY, "leadID": "old"}).encode()
    )
    stale.received_at = thumbtack_service._now() - timedelta(days=120)
    await db_session.commit()

    removed = await thumbtack_service.prune_events(db_session, older_than_days=90)

    assert removed == 1
    remaining = await thumbtack_service.list_events(db_session, connection_id=conn.id)
    assert [e.id for e in remaining] == [fresh.id]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/backend && python -m pytest tests/test_thumbtack_webhook.py -v`
Expected: FAIL with `AttributeError: module 'app.services.thumbtack_service' has no attribute 'classify'`

- [ ] **Step 3: Add classification, recording, listing, and pruning**

Append to `app/backend/app/services/thumbtack_service.py`:

```python
import json
from datetime import timedelta


def classify(body: object) -> tuple[str, str | None]:
    """Identify an event by body shape and return (kind, external_id).

    The Thumbtack form sends every checked event type to one URL, so shape is
    the only discriminator available. Anything unrecognised is 'unknown' and is
    kept for inspection rather than rejected.
    """
    if not isinstance(body, dict):
        return "unknown", None

    message = body.get("message")
    if isinstance(message, dict):
        return "message", message.get("messageID")

    review = body.get("review")
    if "reviewEventType" in body or isinstance(review, dict):
        review_obj = review if isinstance(review, dict) else {}
        return "review", review_obj.get("reviewID")

    if body.get("leadID") and isinstance(body.get("request"), dict):
        return "lead", body.get("leadID")

    return "unknown", None


async def record_event(
    db: AsyncSession, conn: ThumbtackConnection, raw_body: bytes
) -> ThumbtackWebhookEvent:
    """Persist a delivery verbatim, then classify it. Never raises for a bad body."""
    try:
        text = raw_body.decode("utf-8")
    except UnicodeDecodeError:
        text = raw_body.decode("utf-8", errors="replace")

    kind = "unknown"
    external_id = None
    status = "received"
    error = None

    try:
        parsed = json.loads(text)
        kind, external_id = classify(parsed)
        if kind == "review":
            # Reviews are out of scope this phase; recorded, not acted on.
            status = "ignored"
    except (json.JSONDecodeError, ValueError) as exc:
        status = "failed"
        error = f"Body is not valid JSON: {exc}"

    event = ThumbtackWebhookEvent(
        connection_id=conn.id,
        kind=kind,
        external_id=external_id,
        raw_body=text,
        status=status,
        error=error,
    )
    db.add(event)

    if status == "failed":
        conn.last_error_at = _now()
    else:
        conn.last_event_at = _now()

    await db.commit()
    await db.refresh(event)
    # Deliberately not logging the body: it carries customer name, phone, and address.
    logger.info(
        "thumbtack webhook recorded connection=%s kind=%s status=%s",
        conn.id, kind, status,
    )
    return event


async def list_events(
    db: AsyncSession, *, connection_id: str | None = None, limit: int = 50
) -> list[ThumbtackWebhookEvent]:
    stmt = select(ThumbtackWebhookEvent).order_by(ThumbtackWebhookEvent.received_at.desc())
    if connection_id:
        stmt = stmt.where(ThumbtackWebhookEvent.connection_id == connection_id)
    result = await db.execute(stmt.limit(limit))
    return list(result.scalars().all())


async def prune_events(db: AsyncSession, *, older_than_days: int = 90) -> int:
    """Raw bodies carry customer PII, so the ledger is not kept indefinitely."""
    cutoff = _now() - timedelta(days=older_than_days)
    result = await db.execute(
        delete(ThumbtackWebhookEvent).where(ThumbtackWebhookEvent.received_at < cutoff)
    )
    await db.commit()
    return result.rowcount or 0
```

Move the `import json` and `from datetime import timedelta` lines up into the module's existing import block rather than leaving them mid-file.

- [ ] **Step 3b: Give pruning a caller**

A prune function nothing calls is dead code. Add a zero-argument scheduler entry
point at the end of `app/backend/app/services/thumbtack_service.py`, mirroring
`alert_service.check_stale_leads`:

```python
async def prune_old_events() -> None:
    """Entry point for the scheduler — opens its own session."""
    from app.database import AsyncSessionLocal

    try:
        async with AsyncSessionLocal() as db:
            removed = await prune_events(db, older_than_days=90)
            if removed:
                print(f"[thumbtack] pruned {removed} webhook events older than 90 days")
    except Exception as exc:
        print(f"[thumbtack] prune error: {exc}")
```

Then register it in `app/backend/main.py` beside the existing jobs (around line 689),
before `_scheduler.start()`:

```python
    _scheduler.add_job(thumbtack_service.prune_old_events, "interval", hours=24, id="prune_thumbtack_events", replace_existing=True)
```

Import it with the other scheduler job imports in that startup function:

```python
    from app.services import thumbtack_service
```

Confirm `AsyncSessionLocal` is the actual export name in `app/database.py` before
using it — `alert_service` imports it from there, so it exists, but check the exact
spelling rather than assuming.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app/backend && python -m pytest tests/test_thumbtack_webhook.py -v`
Expected: 17 passed

If `test_prune_events_removes_only_old_rows` fails on a timezone comparison, it is because SQLite returns naive datetimes. Fix by comparing against a naive cutoff: `cutoff = (_now() - timedelta(days=older_than_days)).replace(tzinfo=None)`. Do not change the test.

- [ ] **Step 5: Commit**

```bash
git add app/backend/app/services/thumbtack_service.py app/backend/main.py app/backend/tests/test_thumbtack_webhook.py
git commit -m "feat(thumbtack): classify, record, list, and prune webhook events"
```

---

### Task 4: The public webhook route

**Files:**
- Create: `app/backend/app/routers/thumbtack.py`
- Modify: `app/backend/main.py` (router import line ~47, and the `include_router` block)
- Test: `app/backend/tests/test_thumbtack_webhook.py` (append)

**Interfaces:**
- Consumes: `thumbtack_service.get_by_url_token`, `verify_basic_header`, `record_event`, `MAX_BODY_BYTES`
- Produces: `POST /ingest/webhook/thumbtack/{url_token}` — 200 on accept, 401 unknown/inactive/bad-credential, 413 oversized

- [ ] **Step 1: Write the failing test**

Append to `app/backend/tests/test_thumbtack_webhook.py`:

```python
async def _make_connection(db_session, city_id="st-louis", business="holy_hauling"):
    from app.services import thumbtack_service

    return await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id=city_id, business=business
    )


def _basic(user: str, password: str) -> dict:
    import base64

    raw = base64.b64encode(f"{user}:{password}".encode()).decode()
    return {"Authorization": f"Basic {raw}"}


@pytest.mark.asyncio
async def test_webhook_accepts_valid_token_without_auth_header(client, db_session):
    from app.services import thumbtack_service

    conn, _ = await _make_connection(db_session)

    r = await client.post(f"/ingest/webhook/thumbtack/{conn.url_token}", json=LEAD_BODY)

    assert r.status_code == 200
    events = await thumbtack_service.list_events(db_session, connection_id=conn.id)
    assert len(events) == 1
    assert events[0].kind == "lead"


@pytest.mark.asyncio
async def test_webhook_accepts_correct_basic_credentials(client, db_session):
    conn, secret = await _make_connection(db_session)

    r = await client.post(
        f"/ingest/webhook/thumbtack/{conn.url_token}",
        json=LEAD_BODY,
        headers=_basic(conn.auth_username, secret),
    )

    assert r.status_code == 200


@pytest.mark.asyncio
async def test_webhook_rejects_wrong_password_and_stores_nothing(client, db_session):
    from app.services import thumbtack_service

    conn, _ = await _make_connection(db_session)

    r = await client.post(
        f"/ingest/webhook/thumbtack/{conn.url_token}",
        json=LEAD_BODY,
        headers=_basic(conn.auth_username, "wrong-secret"),
    )

    assert r.status_code == 401
    assert await thumbtack_service.list_events(db_session, connection_id=conn.id) == []


@pytest.mark.asyncio
async def test_webhook_rejects_unknown_token(client, db_session):
    r = await client.post("/ingest/webhook/thumbtack/not-a-real-token", json=LEAD_BODY)
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_webhook_rejects_disabled_connection(client, db_session):
    from app.services import thumbtack_service

    conn, _ = await _make_connection(db_session)
    await thumbtack_service.set_active(db_session, conn.id, False)

    r = await client.post(f"/ingest/webhook/thumbtack/{conn.url_token}", json=LEAD_BODY)

    assert r.status_code == 401
    assert await thumbtack_service.list_events(db_session, connection_id=conn.id) == []


@pytest.mark.asyncio
async def test_webhook_returns_200_for_unparseable_body(client, db_session):
    from app.services import thumbtack_service

    conn, _ = await _make_connection(db_session)

    r = await client.post(
        f"/ingest/webhook/thumbtack/{conn.url_token}",
        content=b"{not json",
        headers={"Content-Type": "application/json"},
    )

    # Thumbtack must never see a failure for a body we could not parse.
    assert r.status_code == 200
    events = await thumbtack_service.list_events(db_session, connection_id=conn.id)
    assert len(events) == 1
    assert events[0].status == "failed"
    assert events[0].raw_body == "{not json"


@pytest.mark.asyncio
async def test_webhook_returns_200_for_unrecognised_shape(client, db_session):
    from app.services import thumbtack_service

    conn, _ = await _make_connection(db_session)

    r = await client.post(
        f"/ingest/webhook/thumbtack/{conn.url_token}", json={"something": "new"}
    )

    assert r.status_code == 200
    events = await thumbtack_service.list_events(db_session, connection_id=conn.id)
    assert events[0].kind == "unknown"


@pytest.mark.asyncio
async def test_webhook_records_message_and_review_at_the_same_url(client, db_session):
    from app.services import thumbtack_service

    conn, _ = await _make_connection(db_session)
    url = f"/ingest/webhook/thumbtack/{conn.url_token}"

    assert (await client.post(url, json=MESSAGE_BODY)).status_code == 200
    assert (await client.post(url, json=REVIEW_BODY)).status_code == 200

    events = await thumbtack_service.list_events(db_session, connection_id=conn.id)
    kinds = {e.kind for e in events}
    assert kinds == {"message", "review"}


@pytest.mark.asyncio
async def test_webhook_rejects_oversized_body(client, db_session):
    from app.services import thumbtack_service

    conn, _ = await _make_connection(db_session)
    huge = b'{"a":"' + b"x" * (thumbtack_service.MAX_BODY_BYTES + 10) + b'"}'

    r = await client.post(
        f"/ingest/webhook/thumbtack/{conn.url_token}",
        content=huge,
        headers={"Content-Type": "application/json"},
    )

    assert r.status_code == 413
    assert await thumbtack_service.list_events(db_session, connection_id=conn.id) == []


@pytest.mark.asyncio
async def test_webhook_creates_no_leads(client, db_session):
    from sqlalchemy import func, select as sa_select

    from app.models.lead import Lead

    conn, _ = await _make_connection(db_session)
    await client.post(f"/ingest/webhook/thumbtack/{conn.url_token}", json=LEAD_BODY)

    count = await db_session.execute(sa_select(func.count()).select_from(Lead))
    # Phase 1 captures only. Mapping arrives in Phase 2.
    assert count.scalar() == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/backend && python -m pytest tests/test_thumbtack_webhook.py -v -k webhook_`
Expected: FAIL — the new-style URLs return 404, since the router does not exist yet

- [ ] **Step 3: Write the route**

Create `app/backend/app/routers/thumbtack.py`:

```python
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services import thumbtack_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["thumbtack"])


# ── Public receiver (Thumbtack calls this) ────────────────────────────────
#
# No `require_auth`. Thumbtack sends an unauthenticated server-to-server POST;
# the unguessable url_token in the path is the bearer secret. If Thumbtack is
# configured to send Basic credentials we verify them, but we do not require
# them — see the verify-if-present rule in the plan.

@router.post("/ingest/webhook/thumbtack/{url_token}", include_in_schema=False)
async def thumbtack_webhook(
    url_token: str,
    request: Request,
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > thumbtack_service.MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Body too large")

    body = await request.body()
    if len(body) > thumbtack_service.MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Body too large")

    conn = await thumbtack_service.get_by_url_token(db, url_token)
    if conn is None or not conn.is_active:
        # Do not distinguish unknown from disabled — both are 401, nothing stored.
        logger.warning("thumbtack webhook rejected: unknown or inactive token")
        raise HTTPException(status_code=401, detail="Unknown webhook")

    if authorization is not None:
        if not thumbtack_service.verify_basic_header(authorization, conn):
            logger.warning(
                "thumbtack webhook rejected: bad credentials connection=%s", conn.id
            )
            raise HTTPException(status_code=401, detail="Invalid credentials")

    await thumbtack_service.record_event(db, conn, body)
    return Response(status_code=200)
```

- [ ] **Step 4: Register the router**

In `app/backend/main.py`, extend the routers import (around line 47) by adding `thumbtack` to the alphabetical list:

```python
from app.routers import admin_cities, admin_google, admin_metrics, admin_users, auth as auth_router, chat, checklist, eval as eval_router, escalation, finance, ingest, jobs, leads, outcomes, payroll, push, recurring_expenses, settings as settings_router, square_router, thumbtack, truck_rental, users
```

Then add it alongside the other `include_router` calls:

```python
app.include_router(thumbtack.router)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd app/backend && python -m pytest tests/test_thumbtack_webhook.py -v`
Expected: 27 passed

- [ ] **Step 6: Run the full suite**

Run: `cd app/backend && python -m pytest -q 2>&1 | tail -5`
Expected: 419 passed. If any pre-existing test fails, stop and report it rather than editing that test.

- [ ] **Step 7: Commit**

```bash
git add app/backend/app/routers/thumbtack.py app/backend/main.py app/backend/tests/test_thumbtack_webhook.py
git commit -m "feat(thumbtack): capture-first public webhook receiver"
```

---

### Task 5: Admin API for connections and events

**Files:**
- Create: `app/backend/app/schemas/thumbtack.py`
- Modify: `app/backend/app/routers/thumbtack.py`
- Test: `app/backend/tests/test_thumbtack_webhook.py` (append)

**Interfaces:**
- Consumes: `thumbtack_service` CRUD from Task 2, `list_events` from Task 3, `app.dependencies.require_role`
- Produces:
  - `GET /admin/thumbtack/connections` → `list[ConnectionOut]`
  - `POST /admin/thumbtack/connections` → `ConnectionCreated` (201)
  - `PATCH /admin/thumbtack/connections/{id}` → `ConnectionOut`
  - `DELETE /admin/thumbtack/connections/{id}` → 204
  - `GET /admin/thumbtack/events?connection_id=&limit=` → `list[EventOut]`

- [ ] **Step 1: Write the failing test**

Append to `app/backend/tests/test_thumbtack_webhook.py`:

```python
@pytest.mark.asyncio
async def test_admin_create_connection_returns_url_and_credentials(client):
    r = await client.post(
        "/admin/thumbtack/connections",
        json={"label": "Holy Hauling — St. Louis", "city_id": "st-louis", "business": "holy_hauling"},
    )

    assert r.status_code == 201
    data = r.json()
    assert data["label"] == "Holy Hauling — St. Louis"
    assert data["city_id"] == "st-louis"
    assert data["business"] == "holy_hauling"
    assert data["webhook_url"].endswith(f"/ingest/webhook/thumbtack/{data['url_token']}")
    assert data["auth_username"]
    assert data["auth_secret"]


@pytest.mark.asyncio
async def test_admin_list_never_exposes_the_secret(client):
    create = await client.post(
        "/admin/thumbtack/connections",
        json={"label": "HH STL", "city_id": "st-louis", "business": "holy_hauling"},
    )
    secret = create.json()["auth_secret"]

    r = await client.get("/admin/thumbtack/connections")

    assert r.status_code == 200
    body = r.text
    assert secret not in body
    assert "auth_secret_hash" not in body
    row = r.json()[0]
    assert "auth_secret" not in row
    assert row["is_active"] is True
    assert row["last_event_at"] is None


@pytest.mark.asyncio
async def test_admin_rejects_unknown_business_and_city(client):
    bad_business = await client.post(
        "/admin/thumbtack/connections",
        json={"label": "X", "city_id": "st-louis", "business": "not_a_business"},
    )
    assert bad_business.status_code == 422

    bad_city = await client.post(
        "/admin/thumbtack/connections",
        json={"label": "X", "city_id": "atlantis", "business": "holy_hauling"},
    )
    assert bad_city.status_code == 422


@pytest.mark.asyncio
async def test_admin_disable_and_delete_connection(client):
    created = (await client.post(
        "/admin/thumbtack/connections",
        json={"label": "HH STL", "city_id": "st-louis", "business": "holy_hauling"},
    )).json()

    patched = await client.patch(
        f"/admin/thumbtack/connections/{created['id']}", json={"is_active": False}
    )
    assert patched.status_code == 200
    assert patched.json()["is_active"] is False

    deleted = await client.delete(f"/admin/thumbtack/connections/{created['id']}")
    assert deleted.status_code == 204

    assert (await client.get("/admin/thumbtack/connections")).json() == []

    assert (await client.delete(f"/admin/thumbtack/connections/{created['id']}")).status_code == 404


@pytest.mark.asyncio
async def test_admin_events_endpoint_shows_captured_bodies(client):
    created = (await client.post(
        "/admin/thumbtack/connections",
        json={"label": "HH STL", "city_id": "st-louis", "business": "holy_hauling"},
    )).json()

    await client.post(f"/ingest/webhook/thumbtack/{created['url_token']}", json=LEAD_BODY)

    r = await client.get(f"/admin/thumbtack/events?connection_id={created['id']}")

    assert r.status_code == 200
    events = r.json()
    assert len(events) == 1
    assert events[0]["kind"] == "lead"
    assert events[0]["status"] == "received"
    assert json.loads(events[0]["raw_body"])["leadID"] == "lead-123"


@pytest.mark.asyncio
async def test_admin_deleting_a_connection_removes_its_events(client):
    created = (await client.post(
        "/admin/thumbtack/connections",
        json={"label": "HH STL", "city_id": "st-louis", "business": "holy_hauling"},
    )).json()
    await client.post(f"/ingest/webhook/thumbtack/{created['url_token']}", json=LEAD_BODY)

    await client.delete(f"/admin/thumbtack/connections/{created['id']}")

    r = await client.get("/admin/thumbtack/events")
    assert r.json() == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/backend && python -m pytest tests/test_thumbtack_webhook.py -v -k admin_`
Expected: FAIL with 404s — the admin routes do not exist

- [ ] **Step 3: Write the schemas**

Create `app/backend/app/schemas/thumbtack.py`:

```python
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

Business = Literal["holy_hauling", "holy_handy"]


class ConnectionCreate(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    city_id: str
    business: Business


class ConnectionPatch(BaseModel):
    is_active: Optional[bool] = None


class ConnectionOut(BaseModel):
    """Safe to return anywhere. Carries no secret and no hash."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    label: str
    city_id: str
    business: str
    business_id: Optional[str] = None
    url_token: str
    auth_username: Optional[str] = None
    is_active: bool
    last_event_at: Optional[datetime] = None
    last_error_at: Optional[datetime] = None
    created_at: datetime


class ConnectionCreated(ConnectionOut):
    """Returned exactly once, from the create call. The only time the plaintext
    secret exists outside Thumbtack's configuration."""

    webhook_url: str
    auth_secret: str


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    connection_id: str
    kind: str
    external_id: Optional[str] = None
    raw_body: str
    status: str
    error: Optional[str] = None
    lead_id: Optional[str] = None
    received_at: datetime
    processed_at: Optional[datetime] = None
```

- [ ] **Step 4: Add the admin routes**

Append to `app/backend/app/routers/thumbtack.py`. Add these imports at the top of the file:

```python
import os

from sqlalchemy import select

from app.dependencies import require_role
from app.models.city import City
from app.models.user import User
from app.schemas.thumbtack import (
    ConnectionCreate,
    ConnectionCreated,
    ConnectionOut,
    ConnectionPatch,
    EventOut,
)
```

Then the routes:

```python
# ── Admin surface ─────────────────────────────────────────────────────────

def _webhook_url(request: Request, url_token: str) -> str:
    """Build the URL Ron pastes into Thumbtack.

    Derived from the live request by default so it is always correct for the
    environment actually serving it. PUBLIC_BASE_URL overrides that for setups
    behind a proxy that rewrites the host.
    """
    base = (os.environ.get("PUBLIC_BASE_URL") or str(request.base_url)).rstrip("/")
    return f"{base}/ingest/webhook/thumbtack/{url_token}"


@router.get("/admin/thumbtack/connections", response_model=list[ConnectionOut])
async def list_connections(
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    return await thumbtack_service.list_connections(db)


@router.post("/admin/thumbtack/connections", response_model=ConnectionCreated, status_code=201)
async def create_connection(
    payload: ConnectionCreate,
    request: Request,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    city = await db.execute(select(City).where(City.id == payload.city_id).limit(1))
    if city.scalar_one_or_none() is None:
        raise HTTPException(status_code=422, detail=f"Unknown city: {payload.city_id}")

    conn, secret = await thumbtack_service.create_connection(
        db, label=payload.label, city_id=payload.city_id, business=payload.business
    )
    return ConnectionCreated(
        **ConnectionOut.model_validate(conn).model_dump(),
        webhook_url=_webhook_url(request, conn.url_token),
        auth_secret=secret,
    )


@router.patch("/admin/thumbtack/connections/{connection_id}", response_model=ConnectionOut)
async def patch_connection(
    connection_id: str,
    payload: ConnectionPatch,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    if payload.is_active is None:
        raise HTTPException(status_code=422, detail="Nothing to update")
    conn = await thumbtack_service.set_active(db, connection_id, payload.is_active)
    if conn is None:
        raise HTTPException(status_code=404, detail="Connection not found")
    return conn


@router.delete("/admin/thumbtack/connections/{connection_id}", status_code=204)
async def delete_connection(
    connection_id: str,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    if not await thumbtack_service.delete_connection(db, connection_id):
        raise HTTPException(status_code=404, detail="Connection not found")
    return Response(status_code=204)


@router.get("/admin/thumbtack/events", response_model=list[EventOut])
async def list_events(
    connection_id: Optional[str] = None,
    limit: int = 50,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    return await thumbtack_service.list_events(
        db, connection_id=connection_id, limit=min(limit, 200)
    )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd app/backend && python -m pytest tests/test_thumbtack_webhook.py -v`
Expected: 33 passed

- [ ] **Step 6: Run the full suite**

Run: `cd app/backend && python -m pytest -q 2>&1 | tail -5`
Expected: 425 passed

- [ ] **Step 7: Commit**

```bash
git add app/backend/app/schemas/thumbtack.py app/backend/app/routers/thumbtack.py app/backend/tests/test_thumbtack_webhook.py
git commit -m "feat(thumbtack): admin API for connections and captured events"
```

---

### Task 6: Frontend types and hooks

**Files:**
- Create: `app/frontend/src/types/thumbtack.ts`
- Create: `app/frontend/src/hooks/useThumbtack.ts`

**Interfaces:**
- Consumes: `apiFetch` from `../services/api`; the Task 5 endpoints
- Produces: `useThumbtackConnections()`, `useThumbtackEvents(connectionId?)`, `useCreateThumbtackConnection()`, `useSetThumbtackConnectionActive()`, `useDeleteThumbtackConnection()`; types `ThumbtackConnection`, `ThumbtackConnectionCreated`, `ThumbtackEvent`, `ThumbtackBusiness`

- [ ] **Step 1: Write the types**

Create `app/frontend/src/types/thumbtack.ts`:

```ts
export type ThumbtackBusiness = 'holy_hauling' | 'holy_handy'

export interface ThumbtackConnection {
  id: string
  label: string
  city_id: string
  business: ThumbtackBusiness
  business_id: string | null
  url_token: string
  auth_username: string | null
  is_active: boolean
  last_event_at: string | null
  last_error_at: string | null
  created_at: string
}

/** Only ever returned by the create call — the secret is never fetchable again. */
export interface ThumbtackConnectionCreated extends ThumbtackConnection {
  webhook_url: string
  auth_secret: string
}

export interface ThumbtackEvent {
  id: string
  connection_id: string
  kind: 'lead' | 'message' | 'review' | 'unknown'
  external_id: string | null
  raw_body: string
  status: string
  error: string | null
  lead_id: string | null
  received_at: string
  processed_at: string | null
}

export interface ThumbtackConnectionCreate {
  label: string
  city_id: string
  business: ThumbtackBusiness
}
```

- [ ] **Step 2: Write the hooks**

Create `app/frontend/src/hooks/useThumbtack.ts`, following the shape of `useCities.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../services/api'
import type {
  ThumbtackConnection,
  ThumbtackConnectionCreate,
  ThumbtackConnectionCreated,
  ThumbtackEvent,
} from '../types/thumbtack'

const CONNECTIONS_KEY = ['thumbtack-connections']

async function detail(r: Response, fallback: string): Promise<string> {
  const err = await r.json().catch(() => ({}))
  return (err as { detail?: string }).detail ?? fallback
}

export function useThumbtackConnections() {
  return useQuery<ThumbtackConnection[]>({
    queryKey: CONNECTIONS_KEY,
    queryFn: async () => {
      const r = await apiFetch('/admin/thumbtack/connections')
      if (!r.ok) throw new Error('Failed to load Thumbtack connections')
      return r.json()
    },
  })
}

export function useThumbtackEvents(connectionId?: string) {
  return useQuery<ThumbtackEvent[]>({
    queryKey: ['thumbtack-events', connectionId ?? 'all'],
    // Deliveries arrive while the screen is open; keep it live without a manual refresh.
    refetchInterval: 15000,
    queryFn: async () => {
      const q = connectionId ? `?connection_id=${encodeURIComponent(connectionId)}` : ''
      const r = await apiFetch(`/admin/thumbtack/events${q}`)
      if (!r.ok) throw new Error('Failed to load Thumbtack events')
      return r.json()
    },
  })
}

export function useCreateThumbtackConnection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: ThumbtackConnectionCreate) => {
      const r = await apiFetch('/admin/thumbtack/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error(await detail(r, 'Failed to create connection'))
      return r.json() as Promise<ThumbtackConnectionCreated>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CONNECTIONS_KEY }),
  })
}

export function useSetThumbtackConnectionActive() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const r = await apiFetch(`/admin/thumbtack/connections/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: isActive }),
      })
      if (!r.ok) throw new Error(await detail(r, 'Failed to update connection'))
      return r.json() as Promise<ThumbtackConnection>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CONNECTIONS_KEY }),
  })
}

export function useDeleteThumbtackConnection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const r = await apiFetch(`/admin/thumbtack/connections/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(await detail(r, 'Failed to delete connection'))
      return id
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CONNECTIONS_KEY })
      void qc.invalidateQueries({ queryKey: ['thumbtack-events'] })
    },
  })
}
```

- [ ] **Step 3: Verify it type-checks**

Run: `cd app/frontend && npx tsc --noEmit`
Expected: no errors from `types/thumbtack.ts` or `hooks/useThumbtack.ts`. Pre-existing errors elsewhere are not yours to fix — report them if present, do not change unrelated files.

- [ ] **Step 4: Commit**

```bash
git add app/frontend/src/types/thumbtack.ts app/frontend/src/hooks/useThumbtack.ts
git commit -m "feat(thumbtack): frontend types and query hooks"
```

---

### Task 7: The connections screen

**Files:**
- Create: `app/frontend/src/screens/AdminThumbtackScreen.tsx`
- Modify: `app/frontend/src/App.tsx` (import block ~line 17; routes ~line 59)
- Modify: `app/frontend/src/screens/AdminScreen.tsx` (`CARDS` array, ends ~line 104)

**Interfaces:**
- Consumes: all hooks from Task 6; `useCities` from `../hooks/useCities`; `BottomNav` from `../components/BottomNav`
- Produces: route `/admin/thumbtack`, admin-only

**Behaviour requirements (all three action states, per Global Constraints):**

| Action | In-progress | Success | Failure |
|---|---|---|---|
| Create connection | Button reads "Creating…" and is disabled | Credentials panel appears with URL, username, secret, and copy buttons, plus a warning that the secret is shown once | Red message above the form, form values retained so nothing is retyped |
| Disable / enable | Toggle disabled while pending | Row re-renders with the new state and a muted style when inactive | Red message on the row, state unchanged |
| Delete | Confirm step first, then "Deleting…" | Row disappears from the list | Red message on the row, row stays |

- [ ] **Step 1: Write the screen**

Create `app/frontend/src/screens/AdminThumbtackScreen.tsx`:

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BottomNav } from '../components/BottomNav'
import { useCities } from '../hooks/useCities'
import {
  useCreateThumbtackConnection,
  useDeleteThumbtackConnection,
  useSetThumbtackConnectionActive,
  useThumbtackConnections,
  useThumbtackEvents,
} from '../hooks/useThumbtack'
import type {
  ThumbtackBusiness,
  ThumbtackConnection,
  ThumbtackConnectionCreated,
} from '../types/thumbtack'

const BUSINESSES: { value: ThumbtackBusiness; label: string }[] = [
  { value: 'holy_hauling', label: 'Holy Hauling' },
  { value: 'holy_handy', label: 'Holy Handy' },
]

// 44px minimum touch target — tablet is the primary surface.
const TOUCH = 'min-h-[44px]'

function relativeTime(iso: string | null): string {
  if (!iso) return 'never'
  const then = new Date(iso).getTime()
  const mins = Math.floor((Date.now() - then) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-800 dark:bg-gray-900 dark:text-gray-200">
          {value}
        </code>
        <button
          onClick={() => {
            void navigator.clipboard.writeText(value)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          }}
          className={`${TOUCH} shrink-0 rounded-lg bg-gray-200 px-4 text-sm font-medium text-gray-800 dark:bg-gray-700 dark:text-gray-100`}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}

export function AdminThumbtackScreen() {
  const navigate = useNavigate()
  const { data: cities = [] } = useCities()
  const { data: connections = [], isLoading } = useThumbtackConnections()
  const createConnection = useCreateThumbtackConnection()

  const [label, setLabel] = useState('')
  const [cityId, setCityId] = useState('')
  const [business, setBusiness] = useState<ThumbtackBusiness>('holy_hauling')
  const [error, setError] = useState('')
  const [created, setCreated] = useState<ThumbtackConnectionCreated | null>(null)

  const effectiveCityId = cityId || cities[0]?.id || ''

  async function handleCreate() {
    setError('')
    try {
      const result = await createConnection.mutateAsync({
        label: label.trim(),
        city_id: effectiveCityId,
        business,
      })
      setCreated(result)
      setLabel('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create connection')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-16 dark:bg-gray-900">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
        <button
          onClick={() => navigate('/admin')}
          className={`${TOUCH} text-sm font-medium text-gray-500 dark:text-gray-400`}
        >
          Back
        </button>
        <h1 className="text-lg font-bold text-gray-900 dark:text-white">Thumbtack</h1>
      </header>

      <main className="space-y-4 p-4 pb-12">
        <section className="rounded-xl border bg-white p-4 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
          <p>
            Create a connection here, then paste its URL and credentials into{' '}
            <span className="font-medium">thumbtack.com/pro/webhooks/create</span>. Tick
            Lead details and Messages, and choose the matching business profile.
          </p>
          <p className="mt-2">
            One connection per city. Leads from a connection are treated as belonging to
            that city.
          </p>
        </section>

        <section className="rounded-xl border bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
            Add connection
          </h2>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <input
              className={`${TOUCH} rounded-lg border px-3 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white`}
              placeholder="Label, e.g. Holy Hauling — St. Louis"
              value={label}
              onChange={event => setLabel(event.target.value)}
            />
            <select
              className={`${TOUCH} rounded-lg border px-3 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white`}
              value={effectiveCityId}
              onChange={event => setCityId(event.target.value)}
            >
              {cities.map(city => (
                <option key={city.id} value={city.id}>{city.name}</option>
              ))}
            </select>
            <select
              className={`${TOUCH} rounded-lg border px-3 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white`}
              value={business}
              onChange={event => setBusiness(event.target.value as ThumbtackBusiness)}
            >
              {BUSINESSES.map(b => (
                <option key={b.value} value={b.value}>{b.label}</option>
              ))}
            </select>
            <button
              onClick={() => void handleCreate()}
              disabled={!label.trim() || !effectiveCityId || createConnection.isPending}
              className={`${TOUCH} rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white disabled:opacity-40`}
            >
              {createConnection.isPending ? 'Creating…' : 'Create'}
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        </section>

        {created && (
          <section className="space-y-3 rounded-xl border-2 border-amber-400 bg-amber-50 p-4 dark:border-amber-500 dark:bg-amber-900/20">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-amber-900 dark:text-amber-200">
                  Paste these into Thumbtack now
                </h2>
                <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                  The password is shown once and cannot be retrieved. If you lose it,
                  delete this connection and create another.
                </p>
              </div>
              <button
                onClick={() => setCreated(null)}
                className={`${TOUCH} shrink-0 rounded-lg px-3 text-sm font-medium text-amber-900 dark:text-amber-200`}
              >
                Done
              </button>
            </div>
            <CopyRow label="Endpoint URL" value={created.webhook_url} />
            <CopyRow label="Username" value={created.auth_username ?? ''} />
            <CopyRow label="Password" value={created.auth_secret} />
          </section>
        )}

        <section className="space-y-3">
          {isLoading && <p className="py-8 text-center text-sm text-gray-400">Loading…</p>}
          {!isLoading && connections.length === 0 && (
            <p className="py-8 text-center text-sm text-gray-400">
              No connections yet. Create one above to start receiving Thumbtack leads.
            </p>
          )}
          {connections.map(conn => (
            <ConnectionRow key={conn.id} conn={conn} />
          ))}
        </section>

        <EventsFeed />
      </main>
      <BottomNav />
    </div>
  )
}

function ConnectionRow({ conn }: { conn: ThumbtackConnection }) {
  const setActive = useSetThumbtackConnectionActive()
  const deleteConnection = useDeleteThumbtackConnection()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [error, setError] = useState('')

  const healthy = Boolean(conn.last_event_at)
  const dot = !conn.is_active
    ? 'bg-gray-400'
    : healthy
      ? 'bg-green-500'
      : 'bg-amber-400'

  async function run(action: () => Promise<unknown>, fallback: string) {
    setError('')
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback)
    }
  }

  return (
    <div
      className={`rounded-xl border bg-white p-4 dark:border-gray-700 dark:bg-gray-800 ${
        conn.is_active ? '' : 'opacity-60'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={`h-3 w-3 shrink-0 rounded-full ${dot}`} />
          <div>
            <p className="font-medium text-gray-900 dark:text-white">{conn.label}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {conn.business === 'holy_hauling' ? 'Holy Hauling' : 'Holy Handy'} ·{' '}
              {conn.city_id} · last received {relativeTime(conn.last_event_at)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() =>
              void run(
                () => setActive.mutateAsync({ id: conn.id, isActive: !conn.is_active }),
                'Failed to update connection',
              )
            }
            disabled={setActive.isPending}
            className={`${TOUCH} rounded-lg bg-gray-200 px-4 text-sm font-medium text-gray-800 disabled:opacity-40 dark:bg-gray-700 dark:text-gray-100`}
          >
            {setActive.isPending ? '…' : conn.is_active ? 'Disable' : 'Enable'}
          </button>

          {confirmingDelete ? (
            <>
              <button
                onClick={() =>
                  void run(
                    () => deleteConnection.mutateAsync(conn.id),
                    'Failed to delete connection',
                  )
                }
                disabled={deleteConnection.isPending}
                className={`${TOUCH} rounded-lg bg-red-600 px-4 text-sm font-medium text-white disabled:opacity-40`}
              >
                {deleteConnection.isPending ? 'Deleting…' : 'Confirm delete'}
              </button>
              <button
                onClick={() => setConfirmingDelete(false)}
                className={`${TOUCH} rounded-lg px-3 text-sm font-medium text-gray-500 dark:text-gray-400`}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirmingDelete(true)}
              className={`${TOUCH} rounded-lg px-4 text-sm font-medium text-red-600 dark:text-red-400`}
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {conn.is_active && !healthy && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
          Nothing received yet. Check the URL is saved and enabled in Thumbtack.
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}

function EventsFeed() {
  const { data: events = [] } = useThumbtackEvents()
  const [expanded, setExpanded] = useState<string | null>(null)

  if (events.length === 0) return null

  return (
    <section className="rounded-xl border bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
        Recent deliveries
      </h2>
      <div className="space-y-2">
        {events.map(event => (
          <div key={event.id} className="rounded-lg border p-3 dark:border-gray-700">
            <button
              onClick={() => setExpanded(expanded === event.id ? null : event.id)}
              className={`${TOUCH} flex w-full items-center justify-between gap-3 text-left`}
            >
              <span className="text-sm text-gray-900 dark:text-white">
                {event.kind}
                {event.external_id ? ` · ${event.external_id}` : ''}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {event.status} · {relativeTime(event.received_at)}
              </span>
            </button>
            {event.error && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">{event.error}</p>
            )}
            {expanded === event.id && (
              <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-gray-100 p-3 text-xs text-gray-800 dark:bg-gray-900 dark:text-gray-200">
                {event.raw_body}
              </pre>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Add the route**

In `app/frontend/src/App.tsx`, add the import next to the other admin screens (~line 17):

```tsx
import { AdminThumbtackScreen } from './screens/AdminThumbtackScreen'
```

And the route next to `/admin/cities` (~line 59):

```tsx
<Route path="/admin/thumbtack" element={<AuthGuard><RoleGuard roles={['admin']}><AdminThumbtackScreen /></RoleGuard></AuthGuard>} />
```

- [ ] **Step 3: Add the admin card**

In `app/frontend/src/screens/AdminScreen.tsx`, append this entry to the end of the `CARDS` array:

```tsx
  {
    path: '/admin/thumbtack',
    label: 'Thumbtack',
    description: 'Webhook connections and incoming lead deliveries',
    color: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
        <path d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
      </svg>
    ),
  },
```

- [ ] **Step 4: Verify it type-checks and builds**

Run: `cd app/frontend && npx tsc --noEmit && npm run build`
Expected: clean type-check, successful build

- [ ] **Step 5: Commit**

```bash
git add app/frontend/src/screens/AdminThumbtackScreen.tsx app/frontend/src/App.tsx app/frontend/src/screens/AdminScreen.tsx
git commit -m "feat(thumbtack): admin connections screen with delivery feed"
```

---

### Task 8: Documentation and Phase 1 close-out

**Files:**
- Modify: `CAPABILITIES.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Run the full backend suite one final time**

Run: `cd app/backend && python -m pytest -q 2>&1 | tail -5`
Expected: 425 passed. Record the actual number — do not assert a count you have not seen.

- [ ] **Step 2: Update `CAPABILITIES.md`**

Under the built-and-working section, add:

```markdown
### Thumbtack webhooks — Phase 1 (connect and capture)

- Admin screen at `/admin/thumbtack`: create a connection (label, city, business),
  copy the endpoint URL and Basic credentials into thumbtack.com/pro/webhooks/create,
  disable or delete a connection, and watch incoming deliveries.
- Public receiver `POST /ingest/webhook/thumbtack/{url_token}`: identifies the
  connection by an unguessable path token, verifies Basic credentials if the caller
  sends any, stores the raw body, and returns 200. Unknown or disabled tokens and bad
  credentials get 401; oversized bodies get 413.
- Deliveries are classified by body shape (lead / message / review / unknown) and kept
  in a ledger with the verbatim body for 90 days.
- **No leads, messages, or reviews are created yet.** Phase 1 captures only; mapping
  arrives in Phase 2 once the real payload shape is confirmed.

**Known limitation:** the older `POST /ingest/webhook/thumbtack` route is unusable in
production — it requires a logged-in user and expects a payload shape Thumbtack does
not send. Phase 2 replaces it. Do not point Thumbtack at it.
```

- [ ] **Step 3: Update `CHANGELOG.md`**

Add an entry at the top following the existing format, summarising the phase and naming the spec and plan files.

- [ ] **Step 4: Commit**

```bash
git add CAPABILITIES.md CHANGELOG.md
git commit -m "docs(thumbtack): record Phase 1 capabilities and changelog"
```

- [ ] **Step 5: Hand back to Ron for the live step**

Phase 1 is not complete until a real delivery is observed. Report to Ron:

1. Deploy the branch (Railway auto-deploys on push).
2. Open `/admin/thumbtack`, create a connection for one business and city.
3. Paste the URL, username, and password into `thumbtack.com/pro/webhooks/create`, tick **Lead details** and **Messages**, select the matching profile, save.
4. Report back what the Authorization dropdown actually offers — this confirms or replaces the verify-if-present assumption.
5. Report whether the profile dropdown lists one entry per metro or a single entry covering both — this settles the open city-pinning risk in the spec.
6. When a real lead arrives, open the delivery feed, expand the raw body, and paste it back. **That body is the input to Phase 2.**

---

## Phase 1 exit criteria

- [ ] A real Thumbtack delivery is visible in the deliveries feed with its raw body
- [ ] The connection shows a recent "last received" time
- [ ] The full backend suite passes with no regression from 392
- [ ] The frontend type-checks and builds
- [ ] The Authorization dropdown's real options are recorded
- [ ] Whether one Thumbtack profile covers both metros is recorded

## Not in this plan

Phase 2 (lead mapping, business tag, proxy phone, lead cost and finance sync), Phase 3 (photo download), and Phase 4 (messages, notifications, conversation UI) are deliberately excluded. Each is planned separately once Phase 1 produces a confirmed payload. Reviews remain deferred; the ledger already records them as `ignored`, so enabling them later is a handler, not a redesign.
