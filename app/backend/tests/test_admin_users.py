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
from app.models.user import User
from app.services.auth_service import hash_pin

TEST_DB = "sqlite+aiosqlite:///:memory:"


def _mock_user(role="admin"):
    return User(
        id="mock-id",
        username="mock-admin",
        credential_hash="x",
        role=role,
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )


async def _make_fixture(role):
    from main import app
    engine = create_async_engine(TEST_DB)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async def override_get_db():
        async with Factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[require_auth] = lambda: _mock_user(role)
    return engine, Factory


@pytest_asyncio.fixture
async def admin_client():
    from main import app
    engine, Factory = await _make_fixture("admin")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac, Factory
    app.dependency_overrides.clear()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture
async def facilitator_client():
    from main import app
    engine, Factory = await _make_fixture("facilitator")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac, Factory
    app.dependency_overrides.clear()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture
async def crew_client():
    from main import app
    engine, Factory = await _make_fixture("crew")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac, Factory
    app.dependency_overrides.clear()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


async def _seed_user(factory, username="alice", role="crew", is_active=True):
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
async def test_get_users_active_only(admin_client):
    client, factory = admin_client
    await _seed_user(factory, username="active_crew", role="crew", is_active=True)
    await _seed_user(factory, username="inactive_crew", role="crew", is_active=False)
    r = await client.get("/users")
    assert r.status_code == 200
    names = [u["username"] for u in r.json()]
    assert "active_crew" in names
    assert "inactive_crew" not in names


@pytest.mark.asyncio
async def test_get_users_as_crew_forbidden(crew_client):
    client, _ = crew_client
    r = await client.get("/users")
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_patch_self_forbidden(admin_client):
    client, _ = admin_client
    # mock admin has id="mock-id"
    r = await client.patch("/admin/users/mock-id", json={"role": "crew"})
    assert r.status_code == 400
