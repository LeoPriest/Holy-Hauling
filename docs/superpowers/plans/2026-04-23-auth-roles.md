# Auth + Roles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add username + 4-digit PIN login, JWT session management, 4 user roles (admin/facilitator/supervisor/crew), role-gated API and UI, push notifications, and dark mode to the Holy Hauling App.

**Architecture:** New `users` and `push_subscriptions` DB tables; FastAPI `require_auth` / `require_role` dependency chain applied to all routes; React `AuthContext` wraps the app and gates routing; existing tests stay green via a conftest `require_auth` mock override.

**Tech Stack:** python-jose[cryptography] (JWT), bcrypt (PIN hashing), pywebpush (Web Push), React context + localStorage, Tailwind `darkMode: 'class'`

---

## File Structure

**New backend files:**
```
app/backend/app/models/user.py
app/backend/app/models/push_subscription.py
app/backend/app/schemas/auth.py
app/backend/app/schemas/user.py
app/backend/app/schemas/jobs.py
app/backend/app/schemas/push.py
app/backend/app/services/auth_service.py
app/backend/app/services/push_service.py
app/backend/app/routers/auth.py
app/backend/app/routers/admin_users.py
app/backend/app/routers/users.py
app/backend/app/routers/jobs.py
app/backend/app/routers/push.py
app/backend/app/dependencies.py
app/backend/tests/test_auth.py
app/backend/tests/test_admin_users.py
app/backend/tests/test_jobs.py
app/backend/tests/test_push.py
```

**Modified backend files:**
```
app/backend/requirements.txt          -- add python-jose, bcrypt, pywebpush
app/backend/main.py                   -- register models + routers; seed default admin
app/backend/app/routers/leads.py      -- add require_auth to all routes; require_role on DELETE
app/backend/app/routers/ingest.py     -- add require_auth
app/backend/app/routers/settings.py   -- add require_auth to GET; require_role("admin") to PATCH
app/backend/app/services/lead_service.py  -- add update_job_status; fire push on booked/escalated
app/backend/tests/conftest.py         -- add require_auth mock override
```

**New frontend files:**
```
app/frontend/src/context/AuthContext.tsx
app/frontend/src/screens/LoginScreen.tsx
app/frontend/src/screens/JobsScreen.tsx
app/frontend/src/screens/AdminUsersScreen.tsx
app/frontend/src/hooks/useAuth.ts
app/frontend/src/hooks/useUsers.ts
app/frontend/src/hooks/useJobs.ts
app/frontend/public/service-worker.js
```

**Modified frontend files:**
```
app/frontend/vite.config.ts           -- add /auth, /admin, /users, /push, /jobs proxies
app/frontend/tailwind.config.js       -- add darkMode: 'class'
app/frontend/src/App.tsx              -- wrap with AuthProvider, add routes + auth guard
app/frontend/src/services/api.ts      -- replace fetch() with apiFetch() (injects Authorization header)
app/frontend/src/screens/LeadQueue.tsx       -- handler filter → dropdown; dark mode toggle in header
app/frontend/src/screens/panels/BriefPanel.tsx  -- add assigned_to dropdown
app/frontend/src/screens/SettingsScreen.tsx     -- disable Save button for facilitator role
```

---

### Task 1: Backend dependencies + User and PushSubscription models

**Files:**
- Modify: `app/backend/requirements.txt`
- Create: `app/backend/app/models/user.py`
- Create: `app/backend/app/models/push_subscription.py`
- Modify: `app/backend/main.py`

- [ ] **Step 1: Install new Python packages**

```bash
cd "app/backend"
pip install "python-jose[cryptography]" bcrypt pywebpush
```

- [ ] **Step 2: Update requirements.txt**

Add three lines after `twilio>=9.0.0`:

```
python-jose[cryptography]>=3.3.0
bcrypt>=4.0.0
pywebpush>=2.0.0
```

- [ ] **Step 3: Create `app/backend/app/models/user.py`**

```python
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, String
from sqlalchemy.orm import relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    username = Column(String, nullable=False, unique=True)
    credential_hash = Column(String, nullable=False)  # bcrypt hash; generic name allows password upgrade later
    role = Column(String, nullable=False)  # admin | facilitator | supervisor | crew
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    created_by = Column(String, nullable=True)  # user_id of admin who created this user

    push_subscriptions = relationship(
        "PushSubscription", back_populates="user", cascade="all, delete-orphan"
    )
```

- [ ] **Step 4: Create `app/backend/app/models/push_subscription.py`**

```python
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import relationship

from app.database import Base


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    endpoint = Column(Text, nullable=False)
    p256dh = Column(Text, nullable=False)
    auth = Column(Text, nullable=False)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="push_subscriptions")
```

- [ ] **Step 5: Register models in `app/backend/main.py`**

Add two import lines after the existing model imports (around line 26):

```python
import app.models.user  # noqa: F401
import app.models.push_subscription  # noqa: F401
```

- [ ] **Step 6: Verify models import without error**

```bash
cd "app/backend"
python -c "from app.models.user import User; from app.models.push_subscription import PushSubscription; print('OK')"
```

Expected output: `OK`

- [ ] **Step 7: Commit**

```bash
git add app/backend/requirements.txt app/backend/app/models/user.py app/backend/app/models/push_subscription.py app/backend/main.py
git commit -m "feat: add User and PushSubscription models, add auth/push deps"
```

---

### Task 2: Auth schemas + auth_service

**Files:**
- Create: `app/backend/app/schemas/auth.py`
- Create: `app/backend/app/schemas/user.py`
- Create: `app/backend/app/schemas/push.py`
- Create: `app/backend/app/schemas/jobs.py`
- Create: `app/backend/app/services/auth_service.py`
- Create: `app/backend/tests/test_auth_service.py`

- [ ] **Step 1: Write the failing tests for auth_service**

Create `app/backend/tests/test_auth_service.py`:

```python
import os
os.environ.setdefault("JWT_SECRET", "test-secret-32-characters-long!!!")

import pytest
from app.services.auth_service import create_token, decode_token, hash_pin, verify_pin
from app.models.user import User
from datetime import datetime, timezone


def _make_user(**kwargs) -> User:
    defaults = dict(
        id="user-1",
        username="testuser",
        credential_hash="placeholder",
        role="admin",
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )
    defaults.update(kwargs)
    user = User(**defaults)
    return user


def test_hash_and_verify_pin_correct():
    h = hash_pin("1234")
    assert h != "1234"
    assert verify_pin("1234", h) is True


def test_verify_pin_wrong():
    h = hash_pin("1234")
    assert verify_pin("9999", h) is False


def test_create_and_decode_token():
    user = _make_user(id="abc", username="alice", role="facilitator")
    token = create_token(user)
    assert isinstance(token, str)
    payload = decode_token(token)
    assert payload["sub"] == "alice"
    assert payload["user_id"] == "abc"
    assert payload["role"] == "facilitator"


def test_decode_invalid_token_raises():
    from jose import JWTError
    with pytest.raises(JWTError):
        decode_token("not.a.valid.token")
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd "app/backend"
pytest tests/test_auth_service.py -v
```

Expected: FAIL with `ModuleNotFoundError` or `ImportError` (auth_service doesn't exist yet)

- [ ] **Step 3: Create `app/backend/app/services/auth_service.py`**

```python
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import bcrypt
from jose import jwt

_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
_EXPIRE_DAYS = int(os.getenv("JWT_EXPIRE_DAYS", "30"))


def hash_pin(pin: str) -> str:
    return bcrypt.hashpw(pin.encode(), bcrypt.gensalt()).decode()


def verify_pin(pin: str, credential_hash: str) -> bool:
    return bcrypt.checkpw(pin.encode(), credential_hash.encode())


def create_token(user) -> str:  # user: User — avoid circular import by using duck typing
    secret = os.environ["JWT_SECRET"]
    payload = {
        "sub": user.username,
        "user_id": user.id,
        "role": user.role,
        "exp": datetime.now(timezone.utc) + timedelta(days=_EXPIRE_DAYS),
    }
    return jwt.encode(payload, secret, algorithm=_ALGORITHM)


def decode_token(token: str) -> dict:
    secret = os.environ["JWT_SECRET"]
    return jwt.decode(token, secret, algorithms=[_ALGORITHM])
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
cd "app/backend"
pytest tests/test_auth_service.py -v
```

Expected: 4 tests PASS

- [ ] **Step 5: Create `app/backend/app/schemas/auth.py`**

```python
from __future__ import annotations

from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str
    pin: str


class UserOut(BaseModel):
    id: str
    username: str
    role: str
    is_active: bool

    model_config = {"from_attributes": True}


class TokenOut(BaseModel):
    token: str
    user: UserOut
```

- [ ] **Step 6: Create `app/backend/app/schemas/user.py`**

```python
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class UserCreate(BaseModel):
    username: str
    pin: str
    role: str


class UserPatch(BaseModel):
    role: Optional[str] = None
    pin: Optional[str] = None
    is_active: Optional[bool] = None


class UserListItem(BaseModel):
    id: str
    username: str
    role: str
    is_active: bool

    model_config = {"from_attributes": True}
```

- [ ] **Step 7: Create `app/backend/app/schemas/push.py`**

```python
from __future__ import annotations

from pydantic import BaseModel


class PushSubscribeRequest(BaseModel):
    endpoint: str
    p256dh: str
    auth: str
```

- [ ] **Step 8: Create `app/backend/app/schemas/jobs.py`**

```python
from __future__ import annotations

from datetime import date
from typing import Optional

from pydantic import BaseModel


class JobOut(BaseModel):
    id: str
    customer_name: Optional[str] = None
    service_type: str
    job_location: Optional[str] = None
    job_date_requested: Optional[date] = None
    scope_notes: Optional[str] = None
    assigned_to: Optional[str] = None
    customer_phone: Optional[str] = None   # None for crew role
    quote_context: Optional[str] = None    # None for crew role

    model_config = {"from_attributes": True}


class JobStatusUpdate(BaseModel):
    status: str  # en_route | started | completed
```

- [ ] **Step 9: Commit**

```bash
git add app/backend/app/schemas/auth.py app/backend/app/schemas/user.py app/backend/app/schemas/push.py app/backend/app/schemas/jobs.py app/backend/app/services/auth_service.py app/backend/tests/test_auth_service.py
git commit -m "feat: add auth schemas, user schemas, push/job schemas, auth_service"
```

---

### Task 3: dependencies.py + /auth router + auth route tests

**Files:**
- Create: `app/backend/app/dependencies.py`
- Create: `app/backend/app/routers/auth.py`
- Modify: `app/backend/main.py` (register auth router)
- Create: `app/backend/tests/test_auth.py`

- [ ] **Step 1: Write the failing tests for auth routes**

Create `app/backend/tests/test_auth.py`:

```python
import os
os.environ.setdefault("JWT_SECRET", "test-secret-32-characters-long!!!")

import pytest
import pytest_asyncio
from datetime import datetime, timezone
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base, get_db

TEST_DB = "sqlite+aiosqlite:///:memory:"


async def _make_db_session(factory):
    async with factory() as s:
        yield s


@pytest_asyncio.fixture
async def auth_client():
    """Test client with real auth (no require_auth override)."""
    from main import app

    engine = create_async_engine(TEST_DB)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    Factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async def override_get_db():
        async with Factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac, Factory

    app.dependency_overrides.clear()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


async def _seed_user(factory, username="admin", pin="0000", role="admin", is_active=True):
    from app.models.user import User
    from app.services.auth_service import hash_pin
    async with factory() as s:
        user = User(
            username=username,
            credential_hash=hash_pin(pin),
            role=role,
            is_active=is_active,
            created_at=datetime.now(timezone.utc),
        )
        s.add(user)
        await s.commit()
        await s.refresh(user)
        return user


@pytest.mark.asyncio
async def test_login_correct_pin(auth_client):
    client, factory = auth_client
    await _seed_user(factory)
    r = await client.post("/auth/login", json={"username": "admin", "pin": "0000"})
    assert r.status_code == 200
    body = r.json()
    assert "token" in body
    assert body["user"]["username"] == "admin"
    assert body["user"]["role"] == "admin"


@pytest.mark.asyncio
async def test_login_wrong_pin(auth_client):
    client, factory = auth_client
    await _seed_user(factory)
    r = await client.post("/auth/login", json={"username": "admin", "pin": "9999"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_login_deactivated_user(auth_client):
    client, factory = auth_client
    await _seed_user(factory, is_active=False)
    r = await client.post("/auth/login", json={"username": "admin", "pin": "0000"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_login_unknown_user(auth_client):
    client, _ = auth_client
    r = await client.post("/auth/login", json={"username": "nobody", "pin": "0000"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_get_me_valid_token(auth_client):
    client, factory = auth_client
    await _seed_user(factory, username="alice", pin="1234", role="facilitator")
    login_r = await client.post("/auth/login", json={"username": "alice", "pin": "1234"})
    token = login_r.json()["token"]
    r = await client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["username"] == "alice"


@pytest.mark.asyncio
async def test_get_me_no_token(auth_client):
    client, _ = auth_client
    r = await client.get("/auth/me")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_get_me_deactivated_rejects_token(auth_client):
    """Token is valid but user has been deactivated since it was issued."""
    client, factory = auth_client
    user = await _seed_user(factory, username="bob", pin="5678", role="crew")
    login_r = await client.post("/auth/login", json={"username": "bob", "pin": "5678"})
    token = login_r.json()["token"]
    # Deactivate the user
    async with factory() as s:
        from sqlalchemy import select
        from app.models.user import User
        result = await s.execute(select(User).where(User.id == user.id))
        u = result.scalar_one()
        u.is_active = False
        await s.commit()
    r = await client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd "app/backend"
pytest tests/test_auth.py -v
```

Expected: ImportError or 404 errors (routes don't exist yet)

- [ ] **Step 3: Create `app/backend/app/dependencies.py`**

```python
from __future__ import annotations

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.services import auth_service

_bearer = HTTPBearer(auto_error=False)


async def require_auth(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = auth_service.decode_token(credentials.credentials)
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    result = await db.execute(select(User).where(User.id == payload["user_id"]))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or deactivated")
    return user


def require_role(*roles: str):
    """Returns a FastAPI dependency that enforces one of the given roles."""
    async def _check(current_user: User = Depends(require_auth)) -> User:
        if current_user.role not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return current_user
    return _check
```

- [ ] **Step 4: Create `app/backend/app/routers/auth.py`**

```python
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_auth
from app.models.user import User
from app.schemas.auth import LoginRequest, TokenOut, UserOut
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenOut)
async def login(data: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.username == data.username))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not auth_service.verify_pin(data.pin, user.credential_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = auth_service.create_token(user)
    return TokenOut(token=token, user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
async def me(current_user: User = Depends(require_auth)):
    return UserOut.model_validate(current_user)
```

- [ ] **Step 5: Register auth router in `app/backend/main.py`**

In main.py, add the auth router import alongside existing router imports:

```python
from app.routers import auth as auth_router, chat, ingest, leads, settings as settings_router
```

And add the router registration after existing `app.include_router` calls:

```python
app.include_router(auth_router.router)
```

- [ ] **Step 6: Run auth tests to confirm they pass**

```bash
cd "app/backend"
pytest tests/test_auth.py -v
```

Expected: 7 tests PASS

- [ ] **Step 7: Commit**

```bash
git add app/backend/app/dependencies.py app/backend/app/routers/auth.py app/backend/main.py app/backend/tests/test_auth.py
git commit -m "feat: add require_auth dependency, /auth/login and /auth/me routes"
```

---

### Task 4: /admin/users router + GET /users + seed default admin + tests

**Files:**
- Create: `app/backend/app/routers/admin_users.py`
- Create: `app/backend/app/routers/users.py`
- Modify: `app/backend/main.py` (register routers + seed admin)
- Create: `app/backend/tests/test_admin_users.py`

- [ ] **Step 1: Write the failing tests**

Create `app/backend/tests/test_admin_users.py`:

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

TEST_DB = "sqlite+aiosqlite:///:memory:"


def _mock_user(role="admin"):
    from app.models.user import User
    return User(
        id="mock-id",
        username="mock-admin",
        credential_hash="x",
        role=role,
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )


@pytest_asyncio.fixture
async def admin_client():
    from main import app
    engine = create_async_engine(TEST_DB)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async def override_get_db():
        async with Factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[require_auth] = lambda: _mock_user("admin")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac, Factory

    app.dependency_overrides.clear()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture
async def facilitator_client():
    from main import app
    engine = create_async_engine(TEST_DB)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async def override_get_db():
        async with Factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[require_auth] = lambda: _mock_user("facilitator")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac, Factory

    app.dependency_overrides.clear()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


async def _seed_user(factory, username="alice", role="crew", is_active=True):
    from app.models.user import User
    from app.services.auth_service import hash_pin
    async with factory() as s:
        user = User(
            username=username,
            credential_hash=hash_pin("1234"),
            role=role,
            is_active=is_active,
            created_at=datetime.now(timezone.utc),
        )
        s.add(user)
        await s.commit()
        await s.refresh(user)
        return user


@pytest.mark.asyncio
async def test_list_users_as_admin(admin_client):
    client, factory = admin_client
    await _seed_user(factory, username="alice", role="crew")
    r = await client.get("/admin/users")
    assert r.status_code == 200
    names = [u["username"] for u in r.json()]
    assert "alice" in names


@pytest.mark.asyncio
async def test_list_users_as_facilitator_forbidden(facilitator_client):
    client, _ = facilitator_client
    r = await client.get("/admin/users")
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_create_user_as_admin(admin_client):
    client, _ = admin_client
    r = await client.post("/admin/users", json={"username": "bob", "pin": "1111", "role": "crew"})
    assert r.status_code == 201
    assert r.json()["username"] == "bob"
    assert r.json()["role"] == "crew"


@pytest.mark.asyncio
async def test_create_duplicate_username(admin_client):
    client, factory = admin_client
    await _seed_user(factory, username="dup")
    r = await client.post("/admin/users", json={"username": "dup", "pin": "1111", "role": "crew"})
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_patch_user_role(admin_client):
    client, factory = admin_client
    user = await _seed_user(factory, username="eve", role="crew")
    r = await client.patch(f"/admin/users/{user.id}", json={"role": "supervisor"})
    assert r.status_code == 200
    assert r.json()["role"] == "supervisor"


@pytest.mark.asyncio
async def test_patch_user_deactivate(admin_client):
    client, factory = admin_client
    user = await _seed_user(factory, username="frank")
    r = await client.patch(f"/admin/users/{user.id}", json={"is_active": False})
    assert r.status_code == 200
    assert r.json()["is_active"] is False


@pytest.mark.asyncio
async def test_get_users_as_admin(admin_client):
    client, factory = admin_client
    await _seed_user(factory, username="active_crew", role="crew", is_active=True)
    await _seed_user(factory, username="inactive_crew", role="crew", is_active=False)
    r = await client.get("/users")
    assert r.status_code == 200
    names = [u["username"] for u in r.json()]
    assert "active_crew" in names
    assert "inactive_crew" not in names


@pytest.mark.asyncio
async def test_get_users_as_crew_forbidden(facilitator_client):
    """Re-uses facilitator_client but overrides role to crew."""
    from main import app
    from app.models.user import User
    crew_user = User(
        id="crew-id", username="crew", credential_hash="x",
        role="crew", is_active=True, created_at=datetime.now(timezone.utc)
    )
    # Temporarily override with crew user for this test
    old = app.dependency_overrides.get(require_auth)
    app.dependency_overrides[require_auth] = lambda: crew_user
    client, _ = facilitator_client
    r = await client.get("/users")
    app.dependency_overrides[require_auth] = old
    assert r.status_code == 403
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd "app/backend"
pytest tests/test_admin_users.py -v
```

Expected: FAIL (routes don't exist)

- [ ] **Step 3: Create `app/backend/app/routers/admin_users.py`**

```python
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_role
from app.models.user import User
from app.schemas.auth import UserOut
from app.schemas.user import UserCreate, UserListItem, UserPatch
from app.services.auth_service import hash_pin

router = APIRouter(prefix="/admin/users", tags=["admin-users"])


@router.get("", response_model=list[UserListItem], dependencies=[Depends(require_role("admin"))])
async def list_users(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).order_by(User.created_at))
    return result.scalars().all()


@router.post("", response_model=UserOut, status_code=201)
async def create_user(
    data: UserCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    existing = await db.execute(select(User).where(User.username == data.username))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Username already exists")
    user = User(
        username=data.username,
        credential_hash=hash_pin(data.pin),
        role=data.role,
        created_at=datetime.now(timezone.utc),
        created_by=current_user.id,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return UserOut.model_validate(user)


@router.patch("/{user_id}", response_model=UserOut)
async def patch_user(
    user_id: str,
    data: UserPatch,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if data.role is not None:
        user.role = data.role
    if data.pin is not None:
        user.credential_hash = hash_pin(data.pin)
    if data.is_active is not None:
        user.is_active = data.is_active
    await db.commit()
    await db.refresh(user)
    return UserOut.model_validate(user)
```

- [ ] **Step 4: Create `app/backend/app/routers/users.py`**

```python
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_role
from app.models.user import User
from app.schemas.user import UserListItem

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserListItem], dependencies=[Depends(require_role("admin", "facilitator"))])
async def list_active_users(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(User).where(User.is_active == True).order_by(User.role, User.username)
    )
    return result.scalars().all()
```

- [ ] **Step 5: Add seed default admin + register new routers in `app/backend/main.py`**

Add a seeding helper function before the lifespan function:

```python
async def _seed_default_admin(conn) -> None:
    """Seed admin/0000 on first boot if users table is empty."""
    import uuid as _uuid
    from app.services.auth_service import hash_pin as _hash_pin
    result = await conn.execute(text("SELECT COUNT(*) FROM users"))
    count = result.scalar()
    if count == 0:
        now = datetime.now(timezone.utc).isoformat()
        await conn.execute(text(
            "INSERT INTO users (id, username, credential_hash, role, is_active, created_at) "
            "VALUES (:id, :username, :hash, :role, 1, :now)"
        ), {
            "id": str(_uuid.uuid4()),
            "username": "admin",
            "hash": _hash_pin("0000"),
            "role": "admin",
            "now": now,
        })
        print("[startup] default admin seeded (username: admin, PIN: 0000 — change immediately)")
```

Add `from datetime import datetime, timezone` at the top of main.py if not present.

Call the seeder in the lifespan, after `Base.metadata.create_all`:

```python
        await conn.run_sync(Base.metadata.create_all)
        await _seed_default_admin(conn)
```

Add new router imports alongside existing ones:

```python
from app.routers import admin_users, auth as auth_router, chat, ingest, leads, settings as settings_router, users
```

Register the new routers:

```python
app.include_router(admin_users.router)
app.include_router(users.router)
```

- [ ] **Step 6: Run tests to confirm they pass**

```bash
cd "app/backend"
pytest tests/test_admin_users.py -v
```

Expected: 8 tests PASS

- [ ] **Step 7: Commit**

```bash
git add app/backend/app/routers/admin_users.py app/backend/app/routers/users.py app/backend/main.py app/backend/tests/test_admin_users.py
git commit -m "feat: /admin/users CRUD, GET /users, seed default admin on first boot"
```

---

### Task 5: /jobs router + update_job_status in lead_service + tests

**Files:**
- Modify: `app/backend/app/services/lead_service.py` (add `update_job_status`)
- Create: `app/backend/app/routers/jobs.py`
- Modify: `app/backend/main.py` (register jobs router)
- Create: `app/backend/tests/test_jobs.py`

- [ ] **Step 1: Write the failing tests**

Create `app/backend/tests/test_jobs.py`:

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

TEST_DB = "sqlite+aiosqlite:///:memory:"


def _mock_user(role="supervisor"):
    from app.models.user import User
    return User(
        id=f"mock-{role}",
        username=f"mock-{role}",
        credential_hash="x",
        role=role,
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )


@pytest_asyncio.fixture
async def jobs_client(request):
    role = getattr(request, "param", "supervisor")
    from main import app
    engine = create_async_engine(TEST_DB)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async def override_get_db():
        async with Factory() as s:
            yield s

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[require_auth] = lambda: _mock_user(role)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac, Factory

    app.dependency_overrides.clear()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


async def _seed_lead(factory, status="booked", customer_phone="555-123-4567", quote_context="high end"):
    from app.models.lead import Lead, LeadSourceType, LeadStatus, ServiceType
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
async def test_get_jobs_returns_only_booked(jobs_client):
    client, factory = jobs_client
    await _seed_lead(factory, status="booked")
    await _seed_lead(factory, status="new")
    r = await client.get("/jobs")
    assert r.status_code == 200
    jobs = r.json()
    assert len(jobs) == 1  # only the booked lead


@pytest.mark.asyncio
async def test_supervisor_sees_phone_and_quote(jobs_client):
    client, factory = jobs_client
    await _seed_lead(factory, status="booked", customer_phone="555-000-0001", quote_context="$500")
    r = await client.get("/jobs")
    assert r.status_code == 200
    job = r.json()[0]
    assert job["customer_phone"] == "555-000-0001"
    assert job["quote_context"] == "$500"


@pytest.mark.asyncio
@pytest.mark.parametrize("jobs_client", ["crew"], indirect=True)
async def test_crew_omits_phone_and_quote(jobs_client):
    client, factory = jobs_client
    await _seed_lead(factory, status="booked", customer_phone="555-000-0002", quote_context="secret")
    r = await client.get("/jobs")
    assert r.status_code == 200
    job = r.json()[0]
    assert job["customer_phone"] is None
    assert job["quote_context"] is None


@pytest.mark.asyncio
async def test_patch_job_status_as_supervisor(jobs_client):
    client, factory = jobs_client
    lead = await _seed_lead(factory, status="booked")
    r = await client.patch(f"/jobs/{lead.id}/status", json={"status": "en_route"})
    assert r.status_code == 200


@pytest.mark.asyncio
@pytest.mark.parametrize("jobs_client", ["crew"], indirect=True)
async def test_patch_job_status_as_crew_forbidden(jobs_client):
    client, factory = jobs_client
    lead = await _seed_lead(factory, status="booked")
    r = await client.patch(f"/jobs/{lead.id}/status", json={"status": "started"})
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_patch_job_status_completed_releases_lead(jobs_client):
    client, factory = jobs_client
    lead = await _seed_lead(factory, status="booked")
    r = await client.patch(f"/jobs/{lead.id}/status", json={"status": "completed"})
    assert r.status_code == 200
    # Verify lead status changed to released in DB
    from sqlalchemy import select
    from app.models.lead import Lead
    async with factory() as s:
        result = await s.execute(select(Lead).where(Lead.id == lead.id))
        db_lead = result.scalar_one()
        assert db_lead.status.value == "released"
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd "app/backend"
pytest tests/test_jobs.py -v
```

Expected: FAIL (routes don't exist)

- [ ] **Step 3: Add `update_job_status` to `app/backend/app/services/lead_service.py`**

Add this function after `update_lead_status` (around line 203):

```python
_JOB_STATUS_TO_LEAD_STATUS = {
    "completed": LeadStatus.released,
}


async def update_job_status(db: AsyncSession, lead_id: str, job_status: str, actor: str | None = None) -> Lead:
    """Handle supervisor PATCH /jobs/{id}/status. 'completed' advances lead to released."""
    lead = await get_lead(db, lead_id)
    old_status = lead.status
    db.add(LeadEvent(
        id=_id(), lead_id=lead_id,
        event_type="status_changed",
        from_status=old_status.value,
        to_status=job_status,
        actor=actor,
    ))
    new_lead_status = _JOB_STATUS_TO_LEAD_STATUS.get(job_status)
    if new_lead_status:
        lead.status = new_lead_status
        lead.updated_at = _now()
    await db.commit()
    await db.refresh(lead)
    return lead
```

- [ ] **Step 4: Create `app/backend/app/routers/jobs.py`**

```python
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_auth, require_role
from app.models.lead import Lead, LeadStatus
from app.models.user import User
from app.schemas.jobs import JobOut, JobStatusUpdate
from app.services import lead_service

router = APIRouter(prefix="/jobs", tags=["jobs"])


def _to_job_out(lead: Lead, role: str) -> JobOut:
    return JobOut(
        id=lead.id,
        customer_name=lead.customer_name,
        service_type=lead.service_type.value if hasattr(lead.service_type, "value") else str(lead.service_type),
        job_location=lead.job_location,
        job_date_requested=lead.job_date_requested,
        scope_notes=lead.scope_notes,
        assigned_to=lead.assigned_to,
        customer_phone=lead.customer_phone if role != "crew" else None,
        quote_context=lead.quote_context if role != "crew" else None,
    )


@router.get("", response_model=list[JobOut])
async def get_jobs(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_auth),
):
    result = await db.execute(select(Lead).where(Lead.status == LeadStatus.booked))
    leads = result.scalars().all()
    return [_to_job_out(lead, current_user.role) for lead in leads]


@router.patch("/{lead_id}/status", response_model=JobOut)
async def patch_job_status(
    lead_id: str,
    data: JobStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("supervisor")),
):
    lead = await lead_service.update_job_status(db, lead_id, data.status, actor=current_user.username)
    return _to_job_out(lead, current_user.role)
```

- [ ] **Step 5: Register jobs router in `app/backend/main.py`**

Add to the router imports line:

```python
from app.routers import admin_users, auth as auth_router, chat, ingest, jobs, leads, settings as settings_router, users
```

Add registration:

```python
app.include_router(jobs.router)
```

- [ ] **Step 6: Run tests to confirm they pass**

```bash
cd "app/backend"
pytest tests/test_jobs.py -v
```

Expected: 7 tests PASS

- [ ] **Step 7: Commit**

```bash
git add app/backend/app/services/lead_service.py app/backend/app/routers/jobs.py app/backend/main.py app/backend/tests/test_jobs.py
git commit -m "feat: /jobs GET and PATCH /jobs/{id}/status with role-filtered response"
```

---

### Task 6: Gate existing routes + update conftest

**Files:**
- Modify: `app/backend/app/routers/leads.py`
- Modify: `app/backend/app/routers/ingest.py`
- Modify: `app/backend/app/routers/settings.py`
- Modify: `app/backend/tests/conftest.py`

- [ ] **Step 1: Update `app/backend/app/routers/settings.py`**

Add imports at the top:

```python
from app.dependencies import require_auth, require_role
from app.models.user import User
```

Change the `get_settings` route to require any authenticated user:

```python
@router.get("", response_model=SettingsOut)
async def get_settings(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_auth),
):
    return await settings_service.get_settings(db)
```

Change the `patch_settings` route to require admin role:

```python
@router.patch("", response_model=SettingsOut)
async def patch_settings(
    data: SettingsPatch,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("admin")),
):
    updates = data.model_dump(exclude_unset=True)
    return await settings_service.patch_settings(db, updates)
```

Change the `test_alert` route to require admin role:

```python
@router.post("/test-alert", response_model=TestAlertResult)
async def test_alert(
    data: TestAlertRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("admin")),
):
    settings = await settings_service.get_settings(db)
    return await alert_service.fire_test_alert(settings, data.channel, data.recipient)
```

- [ ] **Step 2: Update `app/backend/app/routers/leads.py`**

Add imports at the top of leads.py:

```python
from app.dependencies import require_auth, require_role
from app.models.user import User
```

Add `require_auth` to routes that currently have no auth, and `require_role` to DELETE. The pattern is to add a dependency parameter to each route. For brevity, add a `current_user` param to each route function. Here are the full updated route signatures (the implementations don't change):

```python
@router.post("", response_model=LeadOut, status_code=201)
async def create_lead(
    data: LeadCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_auth),
):

@router.get("", response_model=list[LeadOut])
async def list_leads(
    status: Optional[LeadStatus] = Query(None),
    source_type: Optional[LeadSourceType] = Query(None),
    assigned_to: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_auth),
):

@router.get("/{lead_id}", response_model=LeadDetailOut)
async def get_lead(
    lead_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_auth),
):

@router.delete("/{lead_id}", status_code=204)
async def delete_lead(
    lead_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("admin", "facilitator")),
):

@router.patch("/{lead_id}", response_model=LeadOut)
async def update_lead(
    lead_id: str,
    data: LeadUpdate,
    actor: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_auth),
):
    # Auto-populate actor from JWT if not explicitly provided
    effective_actor = actor or current_user.username
    return await lead_service.update_lead(db, lead_id, data, actor=effective_actor)
```

Apply the same pattern to all remaining routes in leads.py (status, notes, screenshots, ai-review, etc.): add `_: User = Depends(require_auth)` as the last parameter before `db`.

- [ ] **Step 3: Update `app/backend/app/routers/ingest.py`**

Read the file to see its current shape, then add auth import and `_: User = Depends(require_auth)` to each route. Add to imports:

```python
from app.dependencies import require_auth
from app.models.user import User
```

Add `_: User = Depends(require_auth)` as a parameter to `ingest_screenshot` and `thumbtack_webhook` routes.

- [ ] **Step 4: Update `app/backend/tests/conftest.py`**

Replace the entire file with a version that adds the `require_auth` mock override:

```python
import os

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

TEST_DB = "sqlite+aiosqlite:///:memory:"


def _mock_admin():
    from datetime import datetime, timezone
    from app.models.user import User
    return User(
        id="test-admin-id",
        username="test-admin",
        credential_hash="placeholder",
        role="admin",
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )


@pytest_asyncio.fixture
async def client(tmp_path):
    import app.services.lead_service as svc
    svc.SCREENSHOTS_DIR = str(tmp_path / "screenshots")
    os.makedirs(svc.SCREENSHOTS_DIR, exist_ok=True)

    from app.database import Base, get_db
    from app.dependencies import require_auth
    from main import app

    engine = create_async_engine(TEST_DB)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    TestSession = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async def override_get_db():
        async with TestSession() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[require_auth] = _mock_admin  # all existing tests run as admin
    app.state.test_session_factory = TestSession

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

- [ ] **Step 5: Run the full test suite to verify no regressions**

```bash
cd "app/backend"
pytest -v
```

Expected: All previously passing tests still PASS (the count may increase with new tests). Zero failures.

- [ ] **Step 6: Commit**

```bash
git add app/backend/app/routers/leads.py app/backend/app/routers/ingest.py app/backend/app/routers/settings.py app/backend/tests/conftest.py
git commit -m "feat: gate all existing routes with require_auth; admin-only PATCH /settings; auto-populate actor from JWT"
```

---

### Task 7: Push service + /push router + tests

**Files:**
- Create: `app/backend/app/services/push_service.py`
- Create: `app/backend/app/routers/push.py`
- Modify: `app/backend/app/services/lead_service.py` (fire push on booked/escalated)
- Modify: `app/backend/main.py` (register push router)
- Create: `app/backend/tests/test_push.py`

- [ ] **Step 1: Write the failing tests**

Create `app/backend/tests/test_push.py`:

```python
import os
os.environ.setdefault("JWT_SECRET", "test-secret-32-characters-long!!!")

import pytest
import pytest_asyncio
from datetime import datetime, timezone
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from unittest.mock import patch, AsyncMock

from app.database import Base, get_db
from app.dependencies import require_auth

TEST_DB = "sqlite+aiosqlite:///:memory:"


def _mock_user(role="crew"):
    from app.models.user import User
    return User(
        id="mock-user-id",
        username="crew1",
        credential_hash="x",
        role=role,
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )


@pytest_asyncio.fixture
async def push_client():
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


@pytest.mark.asyncio
async def test_subscribe_saves_subscription(push_client):
    client, factory = push_client
    # Need the user in DB (mock_user has id mock-user-id)
    from app.models.user import User
    async with factory() as s:
        u = User(
            id="mock-user-id",
            username="crew1",
            credential_hash="x",
            role="crew",
            is_active=True,
            created_at=datetime.now(timezone.utc),
        )
        s.add(u)
        await s.commit()

    r = await client.post("/push/subscribe", json={
        "endpoint": "https://example.com/push/abc",
        "p256dh": "BNc1PnR_abc",
        "auth": "xyz123",
    })
    assert r.status_code == 201
    assert "id" in r.json()

    # Verify it's in the DB
    from sqlalchemy import select
    from app.models.push_subscription import PushSubscription
    async with factory() as s:
        result = await s.execute(select(PushSubscription))
        subs = result.scalars().all()
    assert len(subs) == 1
    assert subs[0].endpoint == "https://example.com/push/abc"


@pytest.mark.asyncio
async def test_push_fires_on_booked_lead(push_client):
    """When a lead is moved to booked, send_push_to_roles is called."""
    client, factory = push_client

    with patch("app.services.push_service.send_push_to_roles", new_callable=AsyncMock) as mock_push:
        from app.dependencies import require_auth as _ra
        from main import app
        from app.models.user import User
        admin_user = User(
            id="admin-id", username="admin", credential_hash="x",
            role="admin", is_active=True, created_at=datetime.now(timezone.utc)
        )
        app.dependency_overrides[_ra] = lambda: admin_user

        # Create a lead in ready_for_booking status
        from app.models.lead import Lead, LeadSourceType, LeadStatus, ServiceType
        async with factory() as s:
            lead = Lead(
                source_type=LeadSourceType.manual,
                status=LeadStatus.ready_for_booking,
                service_type=ServiceType.hauling,
                urgency_flag=False,
                customer_name="Test",
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
            s.add(lead)
            await s.commit()
            await s.refresh(lead)

        r = await client.patch(f"/leads/{lead.id}/status",
            json={"status": "booked", "actor": "admin"})
        assert r.status_code == 200
        mock_push.assert_called_once()
        call_args = mock_push.call_args
        assert "supervisor" in call_args[0][1] or "supervisor" in call_args.args[1]
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd "app/backend"
pytest tests/test_push.py -v
```

Expected: FAIL (module not found)

- [ ] **Step 3: Create `app/backend/app/services/push_service.py`**

```python
from __future__ import annotations

import json
import logging
import os

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

_VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
_VAPID_CLAIM_EMAIL = os.getenv("VAPID_CLAIM_EMAIL", "mailto:admin@holyhauling.com")


async def save_subscription(
    db: AsyncSession, user_id: str, endpoint: str, p256dh: str, auth: str
):
    from datetime import datetime, timezone
    from app.models.push_subscription import PushSubscription

    sub = PushSubscription(
        user_id=user_id,
        endpoint=endpoint,
        p256dh=p256dh,
        auth=auth,
        created_at=datetime.now(timezone.utc),
    )
    db.add(sub)
    await db.commit()
    await db.refresh(sub)
    return sub


async def send_push_to_roles(db: AsyncSession, roles: list[str], message: str) -> None:
    """Fire push to all active subscriptions for users with the given roles. Fire-and-forget."""
    from app.models.push_subscription import PushSubscription
    from app.models.user import User

    result = await db.execute(
        select(PushSubscription)
        .join(User, PushSubscription.user_id == User.id)
        .where(User.role.in_(roles), User.is_active == True)
    )
    subs = result.scalars().all()
    for sub in subs:
        _send_one(sub, message)


def _send_one(sub, message: str) -> None:
    if not _VAPID_PRIVATE_KEY:
        logger.debug("VAPID_PRIVATE_KEY not set; skipping push delivery")
        return
    try:
        from pywebpush import WebPushException, webpush

        webpush(
            subscription_info={
                "endpoint": sub.endpoint,
                "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
            },
            data=json.dumps({"body": message}),
            vapid_private_key=_VAPID_PRIVATE_KEY,
            vapid_claims={"sub": _VAPID_CLAIM_EMAIL},
        )
    except Exception as exc:
        logger.error("Push failed for subscription %s: %s", sub.id, exc)
```

- [ ] **Step 4: Create `app/backend/app/routers/push.py`**

```python
from __future__ import annotations

import os

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_auth
from app.models.user import User
from app.schemas.push import PushSubscribeRequest
from app.services import push_service

router = APIRouter(prefix="/push", tags=["push"])


@router.get("/vapid-public-key")
async def get_vapid_public_key():
    return {"publicKey": os.getenv("VAPID_PUBLIC_KEY", "")}


@router.post("/subscribe", status_code=201)
async def subscribe(
    data: PushSubscribeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_auth),
):
    sub = await push_service.save_subscription(
        db, current_user.id, data.endpoint, data.p256dh, data.auth
    )
    return {"id": sub.id}
```

- [ ] **Step 5: Add push triggers to `lead_service.update_lead_status`**

In `app/backend/app/services/lead_service.py`, modify `update_lead_status` to fire push after commit:

```python
async def update_lead_status(db: AsyncSession, lead_id: str, data: LeadStatusUpdate) -> Lead:
    lead = await get_lead(db, lead_id)
    old_status = lead.status
    lead.status = data.status
    lead.updated_at = _now()
    db.add(LeadEvent(
        id=_id(), lead_id=lead_id,
        event_type="status_changed",
        from_status=old_status.value, to_status=data.status.value,
        actor=data.actor, note=data.note,
    ))
    await db.commit()
    await db.refresh(lead)

    # Push notification triggers — fire-and-forget
    from app.services.push_service import send_push_to_roles
    customer = lead.customer_name or "customer"
    svc = lead.service_type.value if hasattr(lead.service_type, "value") else str(lead.service_type)
    if data.status == LeadStatus.booked:
        await send_push_to_roles(db, ["supervisor", "crew"],
                                  f"New job assigned: {customer} — {svc}")
    elif data.status == LeadStatus.escalated:
        await send_push_to_roles(db, ["supervisor"],
                                  f"Job escalated: {customer} — action needed")

    return lead
```

- [ ] **Step 6: Register push router in `app/backend/main.py`**

Add `push` to the router import line:

```python
from app.routers import admin_users, auth as auth_router, chat, ingest, jobs, leads, push, settings as settings_router, users
```

Register it:

```python
app.include_router(push.router)
```

- [ ] **Step 7: Run tests to confirm they pass**

```bash
cd "app/backend"
pytest tests/test_push.py -v
```

Expected: 2 tests PASS

- [ ] **Step 8: Run the full test suite**

```bash
cd "app/backend"
pytest -v
```

Expected: All tests PASS

- [ ] **Step 9: Commit**

```bash
git add app/backend/app/services/push_service.py app/backend/app/routers/push.py app/backend/app/services/lead_service.py app/backend/main.py app/backend/tests/test_push.py
git commit -m "feat: push service, /push/subscribe, fire push on booked/escalated leads"
```

---

### Task 8: Frontend auth infrastructure + login screen + App.tsx routing

**Files:**
- Modify: `app/frontend/vite.config.ts`
- Create: `app/frontend/src/context/AuthContext.tsx`
- Create: `app/frontend/src/hooks/useAuth.ts`
- Modify: `app/frontend/src/services/api.ts`
- Create: `app/frontend/src/screens/LoginScreen.tsx`
- Modify: `app/frontend/src/App.tsx`

- [ ] **Step 1: Update `app/frontend/vite.config.ts`**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/leads': 'http://localhost:8000',
      '/ingest': 'http://localhost:8000',
      '/settings': 'http://localhost:8000',
      '/health': 'http://localhost:8000',
      '/uploads': 'http://localhost:8000',
      '/auth': 'http://localhost:8000',
      '/admin': 'http://localhost:8000',
      '/users': 'http://localhost:8000',
      '/push': 'http://localhost:8000',
      '/jobs': 'http://localhost:8000',
    },
  },
})
```

- [ ] **Step 2: Create `app/frontend/src/context/AuthContext.tsx`**

```tsx
import { createContext, useCallback, useContext, useEffect, useState } from 'react'

export interface AuthUser {
  id: string
  username: string
  role: 'admin' | 'facilitator' | 'supervisor' | 'crew'
  is_active: boolean
}

interface AuthContextValue {
  user: AuthUser | null
  token: string | null
  loading: boolean
  login: (token: string, user: AuthUser) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('hh_token'))
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) {
      setLoading(false)
      return
    }
    fetch('/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => {
        if (!r.ok) throw new Error('invalid')
        return r.json() as Promise<AuthUser>
      })
      .then(u => {
        setUser(u)
        setLoading(false)
      })
      .catch(() => {
        localStorage.removeItem('hh_token')
        setToken(null)
        setUser(null)
        setLoading(false)
      })
  }, [token])

  const login = useCallback((newToken: string, newUser: AuthUser) => {
    localStorage.setItem('hh_token', newToken)
    setToken(newToken)
    setUser(newUser)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('hh_token')
    setToken(null)
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
```

- [ ] **Step 3: Create `app/frontend/src/hooks/useAuth.ts`**

```typescript
// Re-export from context for convenience
export { useAuth } from '../context/AuthContext'
export type { AuthUser } from '../context/AuthContext'
```

- [ ] **Step 4: Update `app/frontend/src/services/api.ts`**

Add an `apiFetch` wrapper at the top of the file (after existing imports), then replace all bare `fetch(` calls in the file with `apiFetch(`. Do NOT change the `fetch('/auth/login', ...)` call — login doesn't need an auth header.

Add this helper after the imports:

```typescript
export function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = localStorage.getItem('hh_token')
  const existing = (init.headers as Record<string, string>) ?? {}
  const headers: Record<string, string> = { ...existing }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return fetch(url, { ...init, headers })
}
```

Then in all the existing API functions, replace `fetch(` with `apiFetch(`. For example:

```typescript
// Before:
const r = await fetch(`${BASE}?${q}`)
// After:
const r = await apiFetch(`${BASE}?${q}`)
```

Apply this replacement to every function in api.ts **except** functions that don't need auth (none currently — all routes will require auth after Task 6).

- [ ] **Step 5: Create `app/frontend/src/screens/LoginScreen.tsx`**

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import type { AuthUser } from '../context/AuthContext'

const PAD = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['',  '0', '⌫'],
]

export function LoginScreen() {
  const [username, setUsername] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  function handleDigit(d: string) {
    if (d === '⌫') { setPin(p => p.slice(0, -1)); return }
    if (pin.length < 4) setPin(p => p + d)
  }

  async function handleSubmit() {
    if (!username.trim() || pin.length !== 4) return
    setLoading(true)
    setError('')
    try {
      const r = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), pin }),
      })
      if (!r.ok) {
        setError('Invalid username or PIN')
        setPin('')
        return
      }
      const { token, user } = await r.json() as { token: string; user: AuthUser }
      login(token, user)
      // Register push notifications after login
      registerPush()
      if (user.role === 'admin' || user.role === 'facilitator') navigate('/')
      else navigate('/jobs')
    } catch {
      setError('Connection error — is the server running?')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8 w-full max-w-sm">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6 text-center">Holy Hauling</h1>

        <input
          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 mb-5 text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="Username"
          value={username}
          onChange={e => setUsername(e.target.value)}
          autoComplete="username"
        />

        {/* PIN dots */}
        <div className="flex justify-center gap-3 mb-5">
          {[0, 1, 2, 3].map(i => (
            <div
              key={i}
              className={`w-11 h-11 rounded-full border-2 flex items-center justify-center transition-colors ${
                pin[i]
                  ? 'border-indigo-600 dark:border-indigo-400'
                  : 'border-gray-300 dark:border-gray-600'
              }`}
            >
              {pin[i] && <div className="w-3 h-3 rounded-full bg-indigo-600 dark:bg-indigo-400" />}
            </div>
          ))}
        </div>

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-2 mb-5">
          {PAD.flat().map((d, i) => (
            <button
              key={i}
              onClick={() => d && handleDigit(d)}
              disabled={!d}
              className={`h-12 rounded-xl text-lg font-semibold transition-colors ${
                d
                  ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-200 dark:hover:bg-gray-600 active:bg-gray-300'
                  : 'opacity-0 pointer-events-none'
              }`}
            >
              {d}
            </button>
          ))}
        </div>

        {error && (
          <p className="text-red-600 dark:text-red-400 text-sm mb-4 text-center">{error}</p>
        )}

        <button
          onClick={handleSubmit}
          disabled={!username.trim() || pin.length !== 4 || loading}
          className="w-full py-2.5 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 disabled:opacity-40 transition-colors"
        >
          {loading ? 'Signing in…' : 'Sign In'}
        </button>
      </div>
    </div>
  )
}

async function registerPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
  if (localStorage.getItem('hh_push_declined') === 'true') return
  try {
    const reg = await navigator.serviceWorker.register('/service-worker.js')
    const permission = await Notification.requestPermission()
    if (permission === 'denied') {
      localStorage.setItem('hh_push_declined', 'true')
      return
    }
    const keyResp = await fetch('/push/vapid-public-key')
    const { publicKey } = await keyResp.json()
    if (!publicKey) return
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: publicKey,
    })
    const { endpoint, keys } = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
    const token = localStorage.getItem('hh_token')
    await fetch('/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ endpoint, p256dh: keys.p256dh, auth: keys.auth }),
    })
  } catch (e) {
    console.warn('Push registration failed', e)
  }
}
```

- [ ] **Step 6: Update `app/frontend/src/App.tsx`**

```tsx
import { useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { LoginScreen } from './screens/LoginScreen'
import { LeadCommandCenter } from './screens/LeadCommandCenter'
import { LeadQueue } from './screens/LeadQueue'
import { SettingsScreen } from './screens/SettingsScreen'
import { JobsScreen } from './screens/JobsScreen'
import { AdminUsersScreen } from './screens/AdminUsersScreen'

const queryClient = new QueryClient()

function DarkModeInit() {
  useEffect(() => {
    const theme = localStorage.getItem('hh_theme')
    if (theme === 'dark') document.documentElement.classList.add('dark')
    else document.documentElement.classList.remove('dark')
  }, [])
  return null
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function RoleGuard({ roles, children }: { roles: string[]; children: React.ReactNode }) {
  const { user } = useAuth()
  if (!user || !roles.includes(user.role)) {
    const fallback = user?.role === 'admin' || user?.role === 'facilitator' ? '/' : '/jobs'
    return <Navigate to={fallback} replace />
  }
  return <>{children}</>
}

function AppRoutes() {
  const { user, loading } = useAuth()
  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading…</div>
  const defaultPath = user?.role === 'admin' || user?.role === 'facilitator' ? '/' : '/jobs'
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={defaultPath} replace /> : <LoginScreen />} />
      <Route path="/" element={<AuthGuard><RoleGuard roles={['admin', 'facilitator']}><LeadQueue /></RoleGuard></AuthGuard>} />
      <Route path="/leads/:id" element={<AuthGuard><RoleGuard roles={['admin', 'facilitator']}><LeadCommandCenter /></RoleGuard></AuthGuard>} />
      <Route path="/settings" element={<AuthGuard><RoleGuard roles={['admin', 'facilitator']}><SettingsScreen /></RoleGuard></AuthGuard>} />
      <Route path="/jobs" element={<AuthGuard><RoleGuard roles={['supervisor', 'crew']}><JobsScreen /></RoleGuard></AuthGuard>} />
      <Route path="/admin/users" element={<AuthGuard><RoleGuard roles={['admin']}><AdminUsersScreen /></RoleGuard></AuthGuard>} />
      <Route path="*" element={<Navigate to={user ? defaultPath : '/login'} replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <DarkModeInit />
        <AppRoutes />
      </AuthProvider>
    </QueryClientProvider>
  )
}
```

- [ ] **Step 7: Start the dev server and manually test login**

```bash
# Terminal 1 — backend
cd "app/backend"
python -m uvicorn main:app --reload

# Terminal 2 — frontend
cd "app/frontend"
npm run dev
```

Visit `http://localhost:5173` — should redirect to `/login`. Enter username `admin` and PIN `0000` (seeded on first backend boot). Should redirect to lead queue.

- [ ] **Step 8: Commit**

```bash
git add app/frontend/vite.config.ts app/frontend/src/context/AuthContext.tsx app/frontend/src/hooks/useAuth.ts app/frontend/src/services/api.ts app/frontend/src/screens/LoginScreen.tsx app/frontend/src/App.tsx
git commit -m "feat: AuthContext, LoginScreen, auth-gated routing, apiFetch with Authorization header"
```

---

### Task 9: Frontend Jobs screen

**Files:**
- Create: `app/frontend/src/hooks/useJobs.ts`
- Create: `app/frontend/src/screens/JobsScreen.tsx`

- [ ] **Step 1: Create `app/frontend/src/hooks/useJobs.ts`**

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../services/api'

export interface Job {
  id: string
  customer_name: string | null
  service_type: string
  job_location: string | null
  job_date_requested: string | null
  scope_notes: string | null
  assigned_to: string | null
  customer_phone?: string | null
  quote_context?: string | null
}

export function useJobs() {
  return useQuery<Job[]>({
    queryKey: ['jobs'],
    queryFn: async () => {
      const r = await apiFetch('/jobs')
      if (!r.ok) throw new Error('Failed to fetch jobs')
      return r.json()
    },
  })
}

export function usePatchJobStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const r = await apiFetch(`/jobs/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!r.ok) throw new Error('Failed to update job status')
      return r.json() as Promise<Job>
    },
    onSuccess: (_data, { id, status }) => {
      if (status === 'completed') {
        qc.setQueryData<Job[]>(['jobs'], prev => (prev ?? []).filter(j => j.id !== id))
      } else {
        qc.invalidateQueries({ queryKey: ['jobs'] })
      }
    },
  })
}
```

- [ ] **Step 2: Create `app/frontend/src/screens/JobsScreen.tsx`**

```tsx
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useJobs, usePatchJobStatus } from '../hooks/useJobs'

const STATUS_BUTTONS = [
  { value: 'en_route', label: 'En Route' },
  { value: 'started', label: 'Started' },
  { value: 'completed', label: 'Completed' },
]

export function JobsScreen() {
  const { user, logout } = useAuth()
  const { data: jobs = [], isLoading } = useJobs()
  const patchStatus = usePatchJobStatus()
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <h1 className="font-bold text-gray-900 dark:text-white text-lg">Jobs</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              const next = document.documentElement.classList.toggle('dark') ? 'dark' : 'light'
              localStorage.setItem('hh_theme', next)
            }}
            className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-lg"
            title="Toggle dark mode"
          >
            🌓
          </button>
          <span className="text-xs text-gray-500 dark:text-gray-400">{user?.username}</span>
          <button
            onClick={logout}
            className="text-xs text-red-500 hover:text-red-700 dark:text-red-400"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="p-4 space-y-4 pb-10">
        {isLoading && (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-10">Loading jobs…</p>
        )}
        {!isLoading && jobs.length === 0 && (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-10">No active jobs.</p>
        )}
        {jobs.map(job => (
          <div key={job.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
            <div className="flex justify-between items-start mb-3">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 dark:text-white truncate">
                  {job.customer_name ?? <span className="italic text-gray-400 font-normal">Unnamed</span>}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 capitalize mt-0.5">
                  {job.service_type} · {job.job_location ?? 'No location'}
                </p>
                {job.job_date_requested && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">📅 {job.job_date_requested}</p>
                )}
                {job.scope_notes && (
                  <p className="text-sm text-gray-700 dark:text-gray-300 mt-1 line-clamp-2">{job.scope_notes}</p>
                )}
                {/* Supervisor-only fields */}
                {job.customer_phone && (
                  <a href={`tel:${job.customer_phone}`} className="text-sm text-indigo-600 dark:text-indigo-400 mt-1 block">
                    📞 {job.customer_phone}
                  </a>
                )}
              </div>
              {job.assigned_to && (
                <span className="ml-3 shrink-0 text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200 px-2 py-0.5 rounded-full">
                  {job.assigned_to}
                </span>
              )}
            </div>

            {user?.role === 'supervisor' && (
              <div className="flex gap-2 flex-wrap mt-2">
                {STATUS_BUTTONS.map(btn => (
                  <button
                    key={btn.value}
                    onClick={() => patchStatus.mutate({ id: job.id, status: btn.value })}
                    disabled={patchStatus.isPending}
                    className={`px-3 py-1 text-sm rounded-lg font-medium transition-colors disabled:opacity-50 ${
                      btn.value === 'completed'
                        ? 'bg-green-600 text-white hover:bg-green-700'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </main>
    </div>
  )
}
```

- [ ] **Step 3: Manually verify the Jobs screen**

Log in as supervisor (create one in `/admin/users` first) and verify:
- Job cards appear with address, size, scope
- Phone is visible as a clickable link
- Status buttons appear and work
- Completed jobs disappear from the list

Log in as crew and verify:
- Phone field is hidden
- Status buttons are not shown

- [ ] **Step 4: Commit**

```bash
git add app/frontend/src/hooks/useJobs.ts app/frontend/src/screens/JobsScreen.tsx
git commit -m "feat: JobsScreen with role-filtered job detail and supervisor status actions"
```

---

### Task 10: Admin Users screen + useUsers hook + assigned_to dropdown

**Files:**
- Create: `app/frontend/src/hooks/useUsers.ts`
- Create: `app/frontend/src/screens/AdminUsersScreen.tsx`
- Modify: `app/frontend/src/screens/LeadQueue.tsx` (replace Handler text input with dropdown)
- Modify: `app/frontend/src/screens/panels/BriefPanel.tsx` (add assigned_to dropdown)

- [ ] **Step 1: Create `app/frontend/src/hooks/useUsers.ts`**

```typescript
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../services/api'

export interface TeamMember {
  id: string
  username: string
  role: string
  is_active: boolean
}

export function useUsers() {
  return useQuery<TeamMember[]>({
    queryKey: ['users'],
    queryFn: async () => {
      const r = await apiFetch('/users')
      if (!r.ok) throw new Error('Failed to fetch users')
      return r.json()
    },
  })
}
```

- [ ] **Step 2: Create `app/frontend/src/screens/AdminUsersScreen.tsx`**

```tsx
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../services/api'
import type { TeamMember } from '../hooks/useUsers'

const ROLES = ['admin', 'facilitator', 'supervisor', 'crew'] as const
type Role = (typeof ROLES)[number]

const ROLE_COLORS: Record<Role, string> = {
  admin: 'bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200',
  facilitator: 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200',
  supervisor: 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200',
  crew: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300',
}

export function AdminUsersScreen() {
  const { user: me, logout } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: users = [], isLoading } = useQuery<TeamMember[]>({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const r = await apiFetch('/admin/users')
      if (!r.ok) throw new Error('Failed to fetch users')
      return r.json()
    },
  })

  const createMutation = useMutation({
    mutationFn: async (body: { username: string; pin: string; role: string }) => {
      const r = await apiFetch('/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        throw new Error(err.detail ?? 'Failed to create user')
      }
      return r.json()
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-users'] }); qc.invalidateQueries({ queryKey: ['users'] }) },
  })

  const patchMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Record<string, unknown> }) => {
      const r = await apiFetch(`/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error('Failed to update user')
      return r.json()
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-users'] }); qc.invalidateQueries({ queryKey: ['users'] }) },
  })

  const [showAdd, setShowAdd] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [newPin, setNewPin] = useState('')
  const [newRole, setNewRole] = useState<Role>('crew')
  const [createError, setCreateError] = useState('')

  const [editUser, setEditUser] = useState<TeamMember | null>(null)
  const [editRole, setEditRole] = useState<Role>('crew')
  const [editPin, setEditPin] = useState('')
  const [editActive, setEditActive] = useState(true)

  async function handleCreate() {
    setCreateError('')
    try {
      await createMutation.mutateAsync({ username: newUsername.trim(), pin: newPin, role: newRole })
      setShowAdd(false)
      setNewUsername('')
      setNewPin('')
      setNewRole('crew')
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : 'Error')
    }
  }

  async function handlePatch() {
    if (!editUser) return
    const body: Record<string, unknown> = { role: editRole, is_active: editActive }
    if (editPin) body.pin = editPin
    await patchMutation.mutateAsync({ id: editUser.id, body })
    setEditUser(null)
  }

  if (isLoading) return <div className="p-8 text-gray-400 dark:text-gray-500">Loading…</div>

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-lg">←</button>
          <h1 className="font-bold text-gray-900 dark:text-white text-lg">Team</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              const next = document.documentElement.classList.toggle('dark') ? 'dark' : 'light'
              localStorage.setItem('hh_theme', next)
            }}
            className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-lg"
          >🌓</button>
          <button
            onClick={() => setShowAdd(true)}
            className="bg-indigo-600 text-white rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-indigo-700"
          >
            Add User
          </button>
        </div>
      </header>

      <main className="p-4 space-y-3 pb-10">
        {users.map(u => (
          <div key={u.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 flex justify-between items-center">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <p className="font-semibold text-gray-900 dark:text-white">{u.username}</p>
                {u.id === me?.id && <span className="text-xs text-gray-400">(you)</span>}
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${ROLE_COLORS[u.role as Role] ?? ''}`}>
                  {u.role}
                </span>
                {!u.is_active && <span className="text-xs text-red-500 dark:text-red-400 font-medium">Inactive</span>}
              </div>
            </div>
            <button
              onClick={() => { setEditUser(u); setEditRole(u.role as Role); setEditActive(u.is_active); setEditPin('') }}
              className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Edit
            </button>
          </div>
        ))}
      </main>

      {/* Add user modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-sm">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Add User</h2>
            <input
              className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 mb-3 text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Username"
              value={newUsername}
              onChange={e => setNewUsername(e.target.value)}
            />
            <input
              className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 mb-3 text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="PIN (4 digits)"
              value={newPin}
              onChange={e => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              type="password"
              inputMode="numeric"
            />
            <select
              className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 mb-4 text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={newRole}
              onChange={e => setNewRole(e.target.value as Role)}
            >
              {ROLES.map(r => <option key={r} value={r} className="capitalize">{r}</option>)}
            </select>
            {createError && <p className="text-red-600 dark:text-red-400 text-sm mb-3">{createError}</p>}
            <div className="flex gap-3">
              <button
                onClick={handleCreate}
                disabled={!newUsername.trim() || newPin.length !== 4 || createMutation.isPending}
                className="flex-1 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40"
              >
                Create
              </button>
              <button
                onClick={() => { setShowAdd(false); setCreateError('') }}
                className="flex-1 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-xl text-sm font-semibold"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit user modal */}
      {editUser && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-sm">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Edit {editUser.username}</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">Changes apply immediately.</p>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Role</label>
            <select
              className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 mb-3 text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={editRole}
              onChange={e => setEditRole(e.target.value as Role)}
            >
              {ROLES.map(r => <option key={r} value={r} className="capitalize">{r}</option>)}
            </select>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">New PIN (leave blank to keep current)</label>
            <input
              className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 mb-3 text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="New PIN"
              value={editPin}
              onChange={e => setEditPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              type="password"
              inputMode="numeric"
            />
            <label className="flex items-center gap-2 mb-5 cursor-pointer">
              <input
                type="checkbox"
                className="rounded"
                checked={editActive}
                onChange={e => setEditActive(e.target.checked)}
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">Active</span>
            </label>
            <div className="flex gap-3">
              <button
                onClick={handlePatch}
                disabled={patchMutation.isPending}
                className="flex-1 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40"
              >
                Save
              </button>
              <button
                onClick={() => setEditUser(null)}
                className="flex-1 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-xl text-sm font-semibold"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Replace Handler text input with dropdown in `app/frontend/src/screens/LeadQueue.tsx`**

At the top of LeadQueue.tsx, add the useUsers import:

```typescript
import { useUsers } from '../hooks/useUsers'
```

Inside the component, add after existing hooks:

```typescript
const { data: teamMembers = [] } = useUsers()
```

Replace the Handler text input (currently around line 105-112):

```tsx
{/* Before: */}
<input
  type="text"
  className="border rounded-lg px-3 py-1.5 text-sm bg-white w-32"
  placeholder="Handler…"
  value={assignedFilter}
  onChange={e => setAssignedFilter(e.target.value)}
/>

{/* After: */}
<select
  className="border rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white w-36"
  value={assignedFilter}
  onChange={e => setAssignedFilter(e.target.value)}
>
  <option value="">All handlers</option>
  {(['admin', 'facilitator', 'supervisor', 'crew'] as const).map(role => {
    const members = teamMembers.filter(m => m.role === role)
    if (members.length === 0) return null
    return (
      <optgroup key={role} label={role.charAt(0).toUpperCase() + role.slice(1)}>
        {members.map(m => (
          <option key={m.id} value={m.username}>{m.username}</option>
        ))}
      </optgroup>
    )
  })}
</select>
```

- [ ] **Step 4: Add assigned_to dropdown to BriefPanel**

In `app/frontend/src/screens/panels/BriefPanel.tsx`, add useUsers and usePatchLead imports:

```typescript
import { usePatchLead, useUsers } from '../../../hooks/useLeads'  // usePatchLead already exists in useLeads
import { useUsers } from '../../../hooks/useUsers'
```

Actually, import from correct locations:

```typescript
import { usePatchLead } from '../../hooks/useLeads'
import { useUsers } from '../../hooks/useUsers'
```

Add to the BriefPanel component after existing hooks:

```typescript
const patch = usePatchLead()
const { data: teamMembers = [] } = useUsers()
```

Add an "Assigned To" section in the lead detail area (add after the Contact section):

```tsx
{/* Assigned to */}
<section>
  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Assigned To</h3>
  <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-3">
    <select
      className="w-full text-sm text-gray-900 dark:text-white dark:bg-gray-800 focus:outline-none"
      value={lead.assigned_to ?? ''}
      onChange={e => patch.mutate({ id: lead.id, data: { assigned_to: e.target.value || null } })}
    >
      <option value="">— Unassigned —</option>
      {(['admin', 'facilitator', 'supervisor', 'crew'] as const).map(role => {
        const members = teamMembers.filter(m => m.role === role && m.is_active)
        if (members.length === 0) return null
        return (
          <optgroup key={role} label={role.charAt(0).toUpperCase() + role.slice(1)}>
            {members.map(m => (
              <option key={m.id} value={m.username}>{m.username}</option>
            ))}
          </optgroup>
        )
      })}
    </select>
  </div>
</section>
```

- [ ] **Step 5: Manually verify admin users screen and dropdowns**

1. Navigate to `/admin/users` — verify user list, create a new supervisor user
2. Open a lead in the queue — verify the Assigned To dropdown is populated from `/users`
3. Assign a lead to a team member — verify it persists on refresh
4. Change the Handler filter in the queue — verify it filters correctly

- [ ] **Step 6: Commit**

```bash
git add app/frontend/src/hooks/useUsers.ts app/frontend/src/screens/AdminUsersScreen.tsx app/frontend/src/screens/LeadQueue.tsx app/frontend/src/screens/panels/BriefPanel.tsx
git commit -m "feat: AdminUsersScreen, useUsers hook, role-grouped assigned_to dropdown in queue filter and lead detail"
```

---

### Task 11: Dark mode + settings gating + service worker + nav items

**Files:**
- Modify: `app/frontend/tailwind.config.js`
- Modify: `app/frontend/src/screens/LeadQueue.tsx` (dark mode toggle + Users nav item)
- Modify: `app/frontend/src/screens/SettingsScreen.tsx` (disable Save for facilitator)
- Create: `app/frontend/public/service-worker.js`

- [ ] **Step 1: Update `app/frontend/tailwind.config.js`**

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: { extend: {} },
  plugins: [],
}
```

- [ ] **Step 2: Add dark mode toggle + role-based nav to `app/frontend/src/screens/LeadQueue.tsx`**

Add `useAuth` import at top:

```typescript
import { useAuth } from '../context/AuthContext'
```

Inside the component, add after the existing hooks:

```typescript
const { user, logout } = useAuth()

function toggleDark() {
  const next = document.documentElement.classList.toggle('dark') ? 'dark' : 'light'
  localStorage.setItem('hh_theme', next)
}
```

Update the header area to include:
1. Dark mode toggle button
2. Users nav item (admin only)
3. Sign out button

In the header `<div className="flex items-center gap-2">`, add before the existing settings button:

```tsx
{/* Dark mode toggle */}
<button
  onClick={toggleDark}
  className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-lg px-1"
  title="Toggle dark mode"
>
  🌓
</button>

{/* Users — admin only */}
{user?.role === 'admin' && (
  <button
    onClick={() => navigate('/admin/users')}
    className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-lg px-1"
    title="Team"
  >
    👥
  </button>
)}

{/* Sign out */}
<button
  onClick={logout}
  className="text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 px-1"
  title="Sign out"
>
  Sign out
</button>
```

Also update the container `div` to support dark mode background:

```tsx
<div className="min-h-screen bg-gray-50 dark:bg-gray-900">
```

And update the header itself:

```tsx
<header className="bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
```

- [ ] **Step 3: Gate Save button in `app/frontend/src/screens/SettingsScreen.tsx`**

Add `useAuth` import:

```typescript
import { useAuth } from '../context/AuthContext'
```

Inside the component:

```typescript
const { user } = useAuth()
const isReadOnly = user?.role === 'facilitator'
```

Find the Save button in SettingsScreen.tsx and add the `disabled` condition and a read-only notice:

```tsx
{isReadOnly && (
  <p className="text-xs text-amber-600 dark:text-amber-400 mb-2">
    Settings are read-only for your role. Contact an admin to make changes.
  </p>
)}
<button
  onClick={handleSave}
  disabled={saving || isReadOnly}
  className="bg-indigo-600 text-white rounded-lg px-6 py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-40"
>
  {saving ? 'Saving…' : 'Save Changes'}
</button>
```

- [ ] **Step 4: Create `app/frontend/public/service-worker.js`**

```javascript
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {}
  const title = 'Holy Hauling'
  const options = {
    body: data.body || 'New notification',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil(clients.openWindow('/jobs'))
})
```

- [ ] **Step 5: Add dark-mode-safe Tailwind classes to other existing screens**

In `LeadCommandCenter.tsx`, `BriefPanel.tsx`, `QuotePanel.tsx`, `LogPanel.tsx`, and `SettingsScreen.tsx`, update any hardcoded light-only classes to include `dark:` variants. Key patterns to find and update:

- `bg-white` → `bg-white dark:bg-gray-800`
- `bg-gray-50` → `bg-gray-50 dark:bg-gray-900`
- `text-gray-900` → `text-gray-900 dark:text-white`
- `text-gray-500` → `text-gray-500 dark:text-gray-400`
- `border-gray-200` → `border-gray-200 dark:border-gray-700`
- `bg-gray-100` → `bg-gray-100 dark:bg-gray-700`

This is a best-effort pass — focus on the most prominent backgrounds and text colors. Perfect dark-mode parity is not required in this sub-project.

- [ ] **Step 6: Add `.env.example` entries for new env vars**

Add to `.env.example` (create it if it doesn't exist):

```
JWT_SECRET=<random 32+ character string>
JWT_ALGORITHM=HS256
JWT_EXPIRE_DAYS=30
VAPID_PRIVATE_KEY=<generated with pywebpush keygen>
VAPID_PUBLIC_KEY=<generated with pywebpush keygen>
VAPID_CLAIM_EMAIL=mailto:admin@holyhauling.com
```

- [ ] **Step 7: Manually verify dark mode end-to-end**

1. Click the 🌓 toggle in the Lead Queue header
2. Verify dark mode applies across the queue, cards, modals
3. Refresh the page — dark mode should persist
4. Toggle back to light mode and refresh — light mode should persist

- [ ] **Step 8: Run the full backend test suite one final time**

```bash
cd "app/backend"
pytest -v
```

Expected: All tests PASS, no regressions

- [ ] **Step 9: Commit**

```bash
git add app/frontend/tailwind.config.js app/frontend/src/screens/LeadQueue.tsx app/frontend/src/screens/SettingsScreen.tsx app/frontend/public/service-worker.js
git commit -m "feat: dark mode toggle, tailwind darkMode class, settings read-only for facilitator, service worker for push"
```

---

## Post-Implementation Verification Checklist

### Backend (pytest)

Run `pytest -v` from `app/backend/`. All tests must pass.

Specific behaviors to confirm are covered:
- Login correct PIN → 200 + JWT
- Login wrong PIN → 401
- Login deactivated user → 401
- Request without token → 401
- Facilitator hits `/admin/users` → 403
- Facilitator hits `PATCH /settings` → 403
- Admin hits `PATCH /settings` → 200
- Crew hits `PATCH /jobs/{id}/status` → 403
- `GET /jobs` returns only booked leads
- Crew response omits `customer_phone` and `quote_context`
- Supervisor response includes `customer_phone` and `quote_context`
- Default admin seeded on empty DB
- `GET /users` returns active users only
- Crew cannot call `GET /users` → 403
- `POST /push/subscribe` saves subscription
- Push fires when lead marked booked

### Frontend (manual — dev server)

- No token → login screen shown
- Bad PIN → error message shown
- Admin/facilitator login → lead queue
- Crew/supervisor login → `/jobs`
- Facilitator sees settings read-only (no Save button)
- Admin sees full editable settings form
- Crew job detail hides phone + quote
- Supervisor sees status action buttons (En Route, Started, Completed)
- Admin sees 👥 Users nav item → `/admin/users`
- `assigned_to` shows role-grouped dropdown in BriefPanel
- Queue filter shows team member dropdown
- Dark mode toggle persists on reload
- Expired/missing token → redirect to login
