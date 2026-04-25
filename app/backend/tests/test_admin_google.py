import os

os.environ.setdefault("JWT_SECRET", "test-secret-32-characters-long!!!")

from datetime import datetime, timezone

import pytest
import pytest_asyncio
from google_auth_oauthlib.flow import Flow
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base, get_db
from app.dependencies import require_auth
from app.models.app_setting import AppSetting
from app.models.user import User

TEST_DB = "sqlite+aiosqlite:///:memory:"


def _mock_admin():
    return User(
        id="admin-id",
        username="admin",
        credential_hash="x",
        role="admin",
        is_active=True,
        created_at=datetime.now(timezone.utc),
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
async def test_status_not_configured(client, monkeypatch):
    ac, _ = client
    monkeypatch.delenv("GOOGLE_OAUTH_CLIENT_ID", raising=False)
    monkeypatch.delenv("GOOGLE_OAUTH_CLIENT_SECRET", raising=False)

    r = await ac.get("/admin/google/status")

    assert r.status_code == 200
    assert r.json() == {
        "configured": False,
        "connected": False,
        "missing": ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"],
        "detail": (
            "Google OAuth is not configured. Add GOOGLE_OAUTH_CLIENT_ID, "
            "GOOGLE_OAUTH_CLIENT_SECRET to app/backend/.env and restart the backend."
        ),
        "redirect_uri": "http://localhost:8000/admin/google/callback",
    }


@pytest.mark.asyncio
async def test_status_configured_not_connected(client, monkeypatch):
    ac, _ = client
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "test-client-id.apps.googleusercontent.com")
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_SECRET", "test-client-secret")

    r = await ac.get("/admin/google/status")

    assert r.status_code == 200
    assert r.json() == {
        "configured": True,
        "connected": False,
        "missing": [],
        "detail": None,
        "redirect_uri": "http://localhost:8000/admin/google/callback",
    }


@pytest.mark.asyncio
async def test_status_connected(client, monkeypatch):
    ac, factory = client
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "test-client-id.apps.googleusercontent.com")
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_SECRET", "test-client-secret")
    async with factory() as s:
        s.add(AppSetting(key="google_refresh_token", value="some-token"))
        await s.commit()

    r = await ac.get("/admin/google/status")

    assert r.status_code == 200
    assert r.json() == {
        "configured": True,
        "connected": True,
        "missing": [],
        "detail": None,
        "redirect_uri": "http://localhost:8000/admin/google/callback",
    }


@pytest.mark.asyncio
async def test_connect_returns_503_with_explicit_detail_when_env_not_set(client, monkeypatch):
    ac, _ = client
    monkeypatch.delenv("GOOGLE_OAUTH_CLIENT_ID", raising=False)
    monkeypatch.delenv("GOOGLE_OAUTH_CLIENT_SECRET", raising=False)

    r = await ac.get("/admin/google/connect")

    assert r.status_code == 503
    assert r.json()["detail"] == (
        "Google OAuth is not configured. Add GOOGLE_OAUTH_CLIENT_ID, "
        "GOOGLE_OAUTH_CLIENT_SECRET to app/backend/.env and restart the backend."
    )


@pytest.mark.asyncio
async def test_connect_returns_url_when_configured(client, monkeypatch):
    ac, factory = client
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "fake-client-id.apps.googleusercontent.com")
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_SECRET", "fake-client-secret")
    monkeypatch.setenv("GOOGLE_OAUTH_REDIRECT_URI", "http://localhost:8000/admin/google/callback")

    r = await ac.get("/admin/google/connect")

    assert r.status_code == 200
    assert "url" in r.json()
    assert "accounts.google.com" in r.json()["url"]

    async with factory() as s:
        from sqlalchemy import select as _select
        from app.models.app_setting import AppSetting as _AppSetting

        state_row = (
            await s.execute(_select(_AppSetting).where(_AppSetting.key == "google_oauth_state"))
        ).scalar_one_or_none()
        verifier_row = (
            await s.execute(_select(_AppSetting).where(_AppSetting.key == "google_oauth_code_verifier"))
        ).scalar_one_or_none()
        assert state_row is not None and state_row.value
        assert verifier_row is not None and verifier_row.value


@pytest.mark.asyncio
async def test_callback_rejects_invalid_state(client, monkeypatch):
    ac, factory = client
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "fake-client-id.apps.googleusercontent.com")
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_SECRET", "fake-client-secret")
    async with factory() as s:
        s.add(AppSetting(key="google_oauth_state", value="correct-state"))
        await s.commit()

    r = await ac.get("/admin/google/callback?code=somecode&state=wrong-state")

    assert r.status_code == 400
    assert "state" in r.json()["detail"].lower()


@pytest.mark.asyncio
async def test_callback_surfaces_token_exchange_errors(client, monkeypatch):
    ac, factory = client
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "fake-client-id.apps.googleusercontent.com")
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_SECRET", "fake-client-secret")
    monkeypatch.setenv("GOOGLE_OAUTH_REDIRECT_URI", "http://localhost:8000/admin/google/callback")

    async with factory() as s:
        s.add(AppSetting(key="google_oauth_state", value="correct-state"))
        await s.commit()

    def _raise_invalid_client(self, code):
        raise Exception("invalid_client")

    monkeypatch.setattr(Flow, "fetch_token", _raise_invalid_client)

    r = await ac.get("/admin/google/callback?code=somecode&state=correct-state")

    assert r.status_code == 400
    assert "OAuth client credentials" in r.json()["detail"]


@pytest.mark.asyncio
async def test_callback_restores_stored_code_verifier(client, monkeypatch):
    ac, factory = client
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "fake-client-id.apps.googleusercontent.com")
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_SECRET", "fake-client-secret")
    monkeypatch.setenv("GOOGLE_OAUTH_REDIRECT_URI", "http://localhost:8000/admin/google/callback")

    async with factory() as s:
        s.add(AppSetting(key="google_oauth_state", value="correct-state"))
        s.add(AppSetting(key="google_oauth_code_verifier", value="stored-code-verifier"))
        await s.commit()

    captured: dict[str, str | None] = {}

    def _capture_code_verifier(self, code):
        captured["code_verifier"] = self.code_verifier
        raise Exception("invalid_client")

    monkeypatch.setattr(Flow, "fetch_token", _capture_code_verifier)

    r = await ac.get("/admin/google/callback?code=somecode&state=correct-state")

    assert r.status_code == 400
    assert captured["code_verifier"] == "stored-code-verifier"


@pytest.mark.asyncio
async def test_status_invalid_when_oauth_values_look_swapped(client, monkeypatch):
    ac, _ = client
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "Holy Hauling App")
    monkeypatch.setenv(
        "GOOGLE_OAUTH_CLIENT_SECRET",
        "1234567890-example.apps.googleusercontent.com",
    )

    r = await ac.get("/admin/google/status")

    assert r.status_code == 200
    data = r.json()
    assert data["configured"] is False
    assert data["connected"] is False
    assert data["missing"] == []
    assert "GOOGLE_OAUTH_CLIENT_ID must be the Google OAuth client ID" in data["detail"]
    assert "GOOGLE_OAUTH_CLIENT_SECRET looks like a Google client ID" in data["detail"]


@pytest.mark.asyncio
async def test_connect_returns_503_when_oauth_values_look_swapped(client, monkeypatch):
    ac, _ = client
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "Holy Hauling App")
    monkeypatch.setenv(
        "GOOGLE_OAUTH_CLIENT_SECRET",
        "1234567890-example.apps.googleusercontent.com",
    )

    r = await ac.get("/admin/google/connect")

    assert r.status_code == 503
    assert "config looks invalid" in r.json()["detail"]
