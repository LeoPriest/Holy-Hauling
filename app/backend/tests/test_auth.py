import os
os.environ.setdefault("JWT_SECRET", "test-secret-32-characters-long!!!")

import pytest
import pytest_asyncio
from datetime import datetime, timezone
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base, get_db
from app.models.user import User
from app.services.auth_service import hash_pin

TEST_DB = "sqlite+aiosqlite:///:memory:"


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
    async with factory() as s:
        result = await s.execute(select(User).where(User.id == user.id))
        u = result.scalar_one()
        u.is_active = False
        await s.commit()
    r = await client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_require_role_allows_matching_role(auth_client):
    client, factory = auth_client
    await _seed_user(factory, username="alice", pin="1234", role="facilitator")
    login_r = await client.post("/auth/login", json={"username": "alice", "pin": "1234"})
    token = login_r.json()["token"]
    # /auth/me uses require_auth only; test the dependency directly
    from app.dependencies import require_role
    from app.models.user import User as UserModel
    user = UserModel(id="x", username="alice", credential_hash="x", role="facilitator",
                     is_active=True, created_at=datetime.now(timezone.utc))
    dep = require_role("facilitator", "admin")
    # dep is an async function that takes current_user; call it directly
    result = await dep(current_user=user)
    assert result.username == "alice"


@pytest.mark.asyncio
async def test_require_role_rejects_wrong_role(auth_client):
    from fastapi import HTTPException
    from app.dependencies import require_role
    from app.models.user import User as UserModel
    user = UserModel(id="x", username="crew1", credential_hash="x", role="crew",
                     is_active=True, created_at=datetime.now(timezone.utc))
    dep = require_role("admin")
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user=user)
    assert exc_info.value.status_code == 403
