import os
os.environ.setdefault("JWT_SECRET", "test-secret-32-characters-long!!!")

import pytest
import pytest_asyncio
from datetime import datetime, timezone
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from unittest.mock import patch, AsyncMock

from app.database import Base, get_db
from app.dependencies import require_auth
from app.models.push_subscription import PushSubscription
from app.models.user import User

TEST_DB = "sqlite+aiosqlite:///:memory:"


def _mock_user(role="crew"):
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

    async with factory() as s:
        result = await s.execute(select(PushSubscription))
        subs = result.scalars().all()
    assert len(subs) == 1
    assert subs[0].endpoint == "https://example.com/push/abc"


@pytest.mark.asyncio
async def test_push_fires_on_booked_lead(push_client):
    client, factory = push_client

    with patch("app.services.push_service.send_push_to_roles", new_callable=AsyncMock) as mock_push:
        from app.dependencies import require_auth as _ra
        from main import app
        admin_user = User(
            id="admin-id", username="admin", credential_hash="x",
            role="admin", is_active=True, created_at=datetime.now(timezone.utc),
        )
        app.dependency_overrides[_ra] = lambda: admin_user

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
        roles_arg = mock_push.call_args.args[1]
        assert "supervisor" in roles_arg
