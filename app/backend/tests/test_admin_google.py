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
async def test_connect_returns_503_when_env_not_set(client, monkeypatch):
    ac, _ = client
    monkeypatch.delenv("GOOGLE_OAUTH_CLIENT_ID", raising=False)
    monkeypatch.delenv("GOOGLE_OAUTH_CLIENT_SECRET", raising=False)
    r = await ac.get("/admin/google/connect")
    assert r.status_code == 503


@pytest.mark.asyncio
async def test_connect_returns_url_when_configured(client, monkeypatch):
    ac, factory = client
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "fake-client-id")
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_SECRET", "fake-client-secret")
    monkeypatch.setenv("GOOGLE_OAUTH_REDIRECT_URI", "http://localhost:8000/admin/google/callback")
    r = await ac.get("/admin/google/connect")
    assert r.status_code == 200
    assert "url" in r.json()
    assert "accounts.google.com" in r.json()["url"]
    # State must be persisted in DB for callback CSRF check
    async with factory() as s:
        from sqlalchemy import select as _sel
        from app.models.app_setting import AppSetting as _AS
        row = (await s.execute(_sel(_AS).where(_AS.key == "google_oauth_state"))).scalar_one_or_none()
        assert row is not None and row.value


@pytest.mark.asyncio
async def test_callback_rejects_invalid_state(client, monkeypatch):
    ac, factory = client
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "fake-client-id")
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_SECRET", "fake-client-secret")
    async with factory() as s:
        s.add(AppSetting(key="google_oauth_state", value="correct-state"))
        await s.commit()
    r = await ac.get("/admin/google/callback?code=somecode&state=wrong-state")
    assert r.status_code == 400
    assert "state" in r.json()["detail"].lower()
