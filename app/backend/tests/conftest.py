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
