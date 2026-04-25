import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from dotenv import load_dotenv

# Explicit path so the .env is found regardless of working directory
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"), override=True)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.database import Base, engine

_scheduler = AsyncIOScheduler()

# Register all models with Base before create_all
import app.models.lead  # noqa: F401
import app.models.lead_event  # noqa: F401
import app.models.screenshot  # noqa: F401
import app.models.ocr_result  # noqa: F401
import app.models.ai_review  # noqa: F401
import app.models.lead_chat_message  # noqa: F401
import app.models.app_setting   # noqa: F401
import app.models.lead_alert    # noqa: F401
import app.models.user  # noqa: F401
import app.models.user_availability  # noqa: F401
import app.models.user_weekly_availability  # noqa: F401
import app.models.push_subscription  # noqa: F401
import app.models.job_assignment  # noqa: F401

from app.routers import admin_google, admin_users, auth as auth_router, chat, ingest, jobs, leads, push, settings as settings_router, users

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_UPLOADS_DIR = os.environ.get("UPLOADS_DIR") or os.path.join(_BASE_DIR, "uploads")
os.makedirs(os.path.join(_UPLOADS_DIR, "screenshots"), exist_ok=True)


def _existing_columns(rows) -> set[str]:
    """Return column names from PRAGMA table_info result rows."""
    return {row[1] for row in rows}


async def _migrate_customer_name_nullable(conn) -> None:
    """
    SQLite cannot ALTER COLUMN to drop NOT NULL. If the existing DB was created
    before Slice 5 (when customer_name was non-nullable), screenshot ingest fails
    at the DB level with a constraint error. Fix it via rename-recreate-copy-drop.
    """
    result = await conn.execute(text("PRAGMA table_info(leads)"))
    rows = result.fetchall()
    if not rows:
        return  # table doesn't exist yet; create_all will handle it

    # PRAGMA table_info columns: (cid, name, type, notnull, dflt_value, pk)
    needs_fix = any(row[1] == "customer_name" and row[3] == 1 for row in rows)
    if not needs_fix:
        return

    print("[startup] migrating leads.customer_name → nullable")
    await conn.execute(text("PRAGMA foreign_keys=off"))
    await conn.execute(text("ALTER TABLE leads RENAME TO _leads_old"))
    await conn.execute(text("""
        CREATE TABLE leads (
            id VARCHAR NOT NULL PRIMARY KEY,
            source_type VARCHAR(20) NOT NULL,
            source_reference_id VARCHAR,
            raw_payload TEXT,
            status VARCHAR(19) NOT NULL,
            urgency_flag BOOLEAN NOT NULL,
            customer_name VARCHAR,
            customer_phone VARCHAR,
            service_type VARCHAR(7) NOT NULL,
            job_location VARCHAR,
            job_date_requested DATE,
            notes TEXT,
            assigned_to VARCHAR,
            created_at DATETIME NOT NULL,
            acknowledged_at DATETIME,
            updated_at DATETIME NOT NULL
        )
    """))
    await conn.execute(text("INSERT INTO leads SELECT * FROM _leads_old"))
    await conn.execute(text("DROP TABLE _leads_old"))
    await conn.execute(text("PRAGMA foreign_keys=on"))
    print("[startup] leads migration complete")


async def _migrate_leads_add_v7_columns(conn) -> None:
    """Add Slice 7 columns to the leads table if not already present."""
    result = await conn.execute(text("PRAGMA table_info(leads)"))
    rows = result.fetchall()
    if not rows:
        return  # table doesn't exist yet; create_all will handle it
    existing = _existing_columns(rows)
    new_cols = [
        ("job_origin",      "VARCHAR"),
        ("job_destination", "VARCHAR"),
        ("scope_notes",     "TEXT"),
        ("field_sources",   "TEXT"),
    ]
    added = []
    for col, typedef in new_cols:
        if col not in existing:
            await conn.execute(text(f"ALTER TABLE leads ADD COLUMN {col} {typedef}"))
            added.append(col)
    if added:
        print(f"[startup] leads v7 columns added: {', '.join(added)}")


async def _migrate_screenshots_add_screenshot_type(conn) -> None:
    """Add screenshot_type column if not present."""
    result = await conn.execute(text("PRAGMA table_info(screenshots)"))
    rows = result.fetchall()
    if not rows:
        return
    if "screenshot_type" in _existing_columns(rows):
        return
    await conn.execute(text("ALTER TABLE screenshots ADD COLUMN screenshot_type VARCHAR NOT NULL DEFAULT 'intake'"))
    print("[startup] screenshots: added screenshot_type column")


async def _migrate_leads_add_quote_context(conn) -> None:
    """Add quote_context column if not present."""
    result = await conn.execute(text("PRAGMA table_info(leads)"))
    rows = result.fetchall()
    if not rows:
        return
    if "quote_context" in _existing_columns(rows):
        return
    await conn.execute(text("ALTER TABLE leads ADD COLUMN quote_context TEXT"))
    print("[startup] leads: added quote_context column")


async def _migrate_leads_add_quote_fields(conn) -> None:
    """Add quoted price storage columns if not present."""
    result = await conn.execute(text("PRAGMA table_info(leads)"))
    rows = result.fetchall()
    if not rows:
        return
    existing = _existing_columns(rows)
    added = []
    if "quoted_price_total" not in existing:
        await conn.execute(text("ALTER TABLE leads ADD COLUMN quoted_price_total FLOAT"))
        added.append("quoted_price_total")
    if "quote_modifiers" not in existing:
        await conn.execute(text("ALTER TABLE leads ADD COLUMN quote_modifiers TEXT"))
        added.append("quote_modifiers")
    if added:
        print(f"[startup] leads: added quote fields: {', '.join(added)}")


async def _migrate_leads_add_v8_columns(conn) -> None:
    """Add Slice 8 columns to the leads table if not already present."""
    result = await conn.execute(text("PRAGMA table_info(leads)"))
    rows = result.fetchall()
    if not rows:
        return
    existing = _existing_columns(rows)
    new_cols = [
        ("move_distance_miles", "FLOAT"),
        ("load_stairs",         "INTEGER"),
        ("unload_stairs",       "INTEGER"),
        ("move_size_label",     "VARCHAR"),
        ("move_type",           "VARCHAR"),
        ("move_date_options",   "TEXT"),
        ("accept_and_pay",      "BOOLEAN DEFAULT 0"),
        ("contact_status",      "VARCHAR DEFAULT 'locked'"),
        ("acknowledgment_sent", "BOOLEAN DEFAULT 0"),
    ]
    added = []
    for col, typedef in new_cols:
        if col not in existing:
            await conn.execute(text(f"ALTER TABLE leads ADD COLUMN {col} {typedef}"))
            added.append(col)
    if added:
        print(f"[startup] leads v8 columns added: {', '.join(added)}")


async def _migrate_leads_add_job_address(conn) -> None:
    """Add job_address column for confirmed physical address."""
    result = await conn.execute(text("PRAGMA table_info(leads)"))
    rows = result.fetchall()
    if not rows:
        return
    if "job_address" in _existing_columns(rows):
        return
    await conn.execute(text("ALTER TABLE leads ADD COLUMN job_address VARCHAR"))
    print("[startup] leads: added job_address column")


async def _migrate_leads_add_appointment_time_slot(conn) -> None:
    """Add appointment_time_slot column for confirmed job start times."""
    result = await conn.execute(text("PRAGMA table_info(leads)"))
    rows = result.fetchall()
    if not rows:
        return
    if "appointment_time_slot" in _existing_columns(rows):
        return
    await conn.execute(text("ALTER TABLE leads ADD COLUMN appointment_time_slot VARCHAR"))
    print("[startup] leads: added appointment_time_slot column")


async def _migrate_leads_add_estimated_duration(conn) -> None:
    """Add estimated_job_duration_minutes column for Google Calendar event lengths."""
    result = await conn.execute(text("PRAGMA table_info(leads)"))
    rows = result.fetchall()
    if not rows:
        return
    if "estimated_job_duration_minutes" in _existing_columns(rows):
        return
    await conn.execute(text("ALTER TABLE leads ADD COLUMN estimated_job_duration_minutes INTEGER"))
    print("[startup] leads: added estimated_job_duration_minutes column")


async def _migrate_leads_add_job_timing_columns(conn) -> None:
    """Add all job phase timestamp columns."""
    result = await conn.execute(text("PRAGMA table_info(leads)"))
    rows = result.fetchall()
    if not rows:
        return
    existing = _existing_columns(rows)
    added = []
    for col in ("dispatched_at", "en_route_at", "arrived_at", "started_at"):
        if col not in existing:
            await conn.execute(text(f"ALTER TABLE leads ADD COLUMN {col} DATETIME"))
            added.append(col)
    if added:
        print(f"[startup] leads: added job timing columns: {', '.join(added)}")


async def _migrate_users_add_email(conn) -> None:
    """Add email column to users for Google Calendar invite addresses."""
    result = await conn.execute(text("PRAGMA table_info(users)"))
    rows = result.fetchall()
    if not rows:
        return
    if "email" in _existing_columns(rows):
        return
    await conn.execute(text("ALTER TABLE users ADD COLUMN email VARCHAR"))
    print("[startup] users: added email column")


async def _migrate_leads_add_calendar_event_id(conn) -> None:
    """Add google_calendar_event_id column to leads."""
    result = await conn.execute(text("PRAGMA table_info(leads)"))
    rows = result.fetchall()
    if not rows:
        return
    if "google_calendar_event_id" in _existing_columns(rows):
        return
    await conn.execute(text("ALTER TABLE leads ADD COLUMN google_calendar_event_id VARCHAR"))
    print("[startup] leads: added google_calendar_event_id column")


async def _migrate_leads_add_ingested_by(conn) -> None:
    """Add ingested_by column and backfill it from the lead created event when available."""
    result = await conn.execute(text("PRAGMA table_info(leads)"))
    rows = result.fetchall()
    if not rows:
        return
    existing = _existing_columns(rows)
    if "ingested_by" not in existing:
        await conn.execute(text("ALTER TABLE leads ADD COLUMN ingested_by VARCHAR"))
        print("[startup] leads: added ingested_by column")

    await conn.execute(text("""
        UPDATE leads
        SET ingested_by = (
            SELECT actor
            FROM lead_events
            WHERE lead_events.lead_id = leads.id
              AND lead_events.event_type = 'created'
            ORDER BY lead_events.created_at ASC
            LIMIT 1
        )
        WHERE ingested_by IS NULL
    """))


async def _migrate_screenshots_add_ocr_status(conn) -> None:
    """Add ocr_status column added in Slice 3 to existing screenshots tables."""
    result = await conn.execute(text("PRAGMA table_info(screenshots)"))
    rows = result.fetchall()
    if not rows:
        return  # table doesn't exist yet; create_all will handle it
    if "ocr_status" in _existing_columns(rows):
        return
    print("[startup] migrating screenshots: adding ocr_status column")
    await conn.execute(text("ALTER TABLE screenshots ADD COLUMN ocr_status VARCHAR"))
    print("[startup] screenshots migration complete")


def _validate_grounding_file() -> None:
    """Warn at startup if AI_GROUNDING_FILE is set but the file can't be opened."""
    path = os.environ.get("AI_GROUNDING_FILE", "")
    if not path:
        return
    try:
        open(path, encoding="utf-8").close()
        print(f"[startup] grounding file OK: {path}")
    except OSError as exc:
        print(f"[startup] WARNING — AI_GROUNDING_FILE cannot be read: {exc}")
        print("[startup] AI review will return 503 until this is fixed.")


def _validate_google_oauth_config() -> None:
    """Warn at startup when Google OAuth is missing or invalid."""
    status = admin_google.google_oauth_config_status()
    if bool(status["configured"]):
        return
    print("[startup] WARNING - " + str(status["detail"]))
    print("[startup] /admin/google/connect will return 503 until this is fixed.")


async def _seed_default_admin(conn) -> None:
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    _validate_grounding_file()
    _validate_google_oauth_config()
    async with engine.begin() as conn:
        await _migrate_customer_name_nullable(conn)
        await _migrate_screenshots_add_ocr_status(conn)
        await _migrate_leads_add_v7_columns(conn)
        await _migrate_leads_add_v8_columns(conn)
        await _migrate_leads_add_quote_context(conn)
        await _migrate_leads_add_quote_fields(conn)
        await _migrate_leads_add_job_timing_columns(conn)
        await _migrate_leads_add_job_address(conn)
        await _migrate_leads_add_appointment_time_slot(conn)
        await _migrate_leads_add_estimated_duration(conn)
        await _migrate_screenshots_add_screenshot_type(conn)
        await _migrate_users_add_email(conn)
        await _migrate_leads_add_calendar_event_id(conn)
        await _migrate_leads_add_ingested_by(conn)
        await conn.run_sync(Base.metadata.create_all)
        await _seed_default_admin(conn)

    from app.services.alert_service import check_stale_leads
    _scheduler.add_job(check_stale_leads, "interval", minutes=5, id="check_stale_leads", replace_existing=True)
    _scheduler.start()

    yield

    _scheduler.shutdown(wait=False)


app = FastAPI(title="Holy Hauling API", lifespan=lifespan)

_CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(admin_users.router)
app.include_router(admin_google.router)
app.include_router(users.router)
app.include_router(leads.router)
app.include_router(ingest.router)
app.include_router(chat.router)
app.include_router(settings_router.router)
app.include_router(jobs.router)
app.include_router(push.router)
app.mount("/uploads", StaticFiles(directory=_UPLOADS_DIR), name="uploads")


@app.get("/health")
async def health():
    return {"status": "ok"}
