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
