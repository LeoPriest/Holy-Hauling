"""Period-level weekly availability — migration tests (standalone engine)."""

from __future__ import annotations

import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from main import _migrate_weekly_availability_add_period


@pytest_asyncio.fixture
async def raw_conn():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        yield conn
    await engine.dispose()


async def _old_table_with_row(conn):
    await conn.execute(text("""
        CREATE TABLE user_weekly_availability (
            id VARCHAR NOT NULL PRIMARY KEY,
            user_id VARCHAR NOT NULL,
            weekday VARCHAR NOT NULL,
            created_at DATETIME NOT NULL,
            CONSTRAINT uq_user_weekly_availability_user_weekday UNIQUE (user_id, weekday)
        )
    """))
    # The OLD model declared user_id with index=True, so production's table carries this
    # named index. It must be reproduced here or the migration's index handling goes untested
    # (this exact index-name collision crashed startup in prod).
    await conn.execute(text(
        "CREATE INDEX ix_user_weekly_availability_user_id ON user_weekly_availability (user_id)"
    ))
    await conn.execute(text(
        "INSERT INTO user_weekly_availability (id, user_id, weekday, created_at) "
        "VALUES ('row1', 'user-1', 'sunday', '2026-01-01 00:00:00')"
    ))


async def test_migration_expands_existing_block_to_three_periods(raw_conn):
    await _old_table_with_row(raw_conn)
    await _migrate_weekly_availability_add_period(raw_conn)

    rows = (await raw_conn.execute(text(
        "SELECT weekday, period FROM user_weekly_availability WHERE user_id = 'user-1' ORDER BY period"
    ))).fetchall()
    periods = sorted(r[1] for r in rows)
    assert {r[0] for r in rows} == {"sunday"}
    assert periods == ["afternoon", "evening", "morning"]


async def test_migration_is_idempotent(raw_conn):
    await _old_table_with_row(raw_conn)
    await _migrate_weekly_availability_add_period(raw_conn)
    await _migrate_weekly_availability_add_period(raw_conn)
    count = (await raw_conn.execute(text("SELECT COUNT(*) FROM user_weekly_availability"))).scalar_one()
    assert count == 3


async def test_migration_noop_when_table_absent(raw_conn):
    await _migrate_weekly_availability_add_period(raw_conn)


# ── endpoint + admin rollup (shared client/db_session fixtures) ──

async def test_put_and_get_blocks_roundtrip(client):
    r = await client.put("/users/me/weekly-availability", json={
        "blocks": {"monday": ["morning"], "sunday": ["morning", "afternoon", "evening"]},
    })
    assert r.status_code == 200, r.text
    body = r.json()["blocks"]
    assert body["monday"] == ["morning"]
    assert body["sunday"] == ["morning", "afternoon", "evening"]

    got = (await client.get("/users/me/weekly-availability")).json()["blocks"]
    assert got["monday"] == ["morning"]
    assert sorted(got["sunday"]) == ["afternoon", "evening", "morning"]


async def test_put_replaces_previous(client):
    await client.put("/users/me/weekly-availability", json={"blocks": {"monday": ["morning", "evening"]}})
    await client.put("/users/me/weekly-availability", json={"blocks": {"monday": ["afternoon"]}})
    got = (await client.get("/users/me/weekly-availability")).json()["blocks"]
    assert got == {"monday": ["afternoon"]}


async def test_put_empty_clears(client):
    await client.put("/users/me/weekly-availability", json={"blocks": {"monday": ["morning"]}})
    await client.put("/users/me/weekly-availability", json={"blocks": {}})
    assert (await client.get("/users/me/weekly-availability")).json()["blocks"] == {}


async def test_put_rejects_bad_weekday_or_period(client):
    r1 = await client.put("/users/me/weekly-availability", json={"blocks": {"funday": ["morning"]}})
    assert r1.status_code == 422
    r2 = await client.put("/users/me/weekly-availability", json={"blocks": {"monday": ["midnight"]}})
    assert r2.status_code == 422


async def test_admin_rollup_full_day_only(client, db_session):
    import uuid
    from datetime import datetime, timezone
    from app.models.user import User
    from app.models.user_weekly_availability import UserWeeklyAvailability

    uid = str(uuid.uuid4())
    db_session.add(User(
        id=uid, username="rollup-crew", credential_hash="x", role="crew",
        city_id="st-louis", is_active=True, created_at=datetime.now(timezone.utc),
    ))
    for period in ("morning", "afternoon", "evening"):
        db_session.add(UserWeeklyAvailability(user_id=uid, weekday="monday", period=period))
    db_session.add(UserWeeklyAvailability(user_id=uid, weekday="tuesday", period="morning"))
    await db_session.commit()

    users = (await client.get("/users")).json()
    me = next(u for u in users if u["username"] == "rollup-crew")
    assert "monday" in me["unavailable_weekdays"]
    assert "tuesday" not in me["unavailable_weekdays"]
