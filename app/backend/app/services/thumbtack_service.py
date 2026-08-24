from __future__ import annotations

import base64
import binascii
import hmac
import json
import logging
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.thumbtack import ThumbtackConnection, ThumbtackWebhookEvent
from app.services import auth_service

logger = logging.getLogger(__name__)

# Thumbtack lead payloads carry attachment metadata, not the files themselves,
# so a legitimate body is small. 1 MB is generous.
MAX_BODY_BYTES = 1_000_000

# How much of a rejected oversized body to keep. Enough for the operator to
# recognise what arrived, small enough that a flood of them cannot bloat the DB.
OVERSIZE_PREFIX_BYTES = 2_048


def _now() -> datetime:
    return datetime.now(timezone.utc)


def generate_credentials() -> tuple[str, str, str]:
    """Return (url_token, auth_username, auth_secret_plain)."""
    return (
        secrets.token_urlsafe(32),
        f"tt_{secrets.token_hex(8)}",
        secrets.token_urlsafe(24),
    )


async def create_connection(
    db: AsyncSession, *, label: str, city_id: str, business: str
) -> tuple[ThumbtackConnection, str]:
    """Create a connection. Returns the row and the plaintext secret, which is
    the only time the secret is ever available."""
    url_token, username, secret = generate_credentials()
    conn = ThumbtackConnection(
        label=label,
        city_id=city_id,
        business=business,
        auth_username=username,
        auth_secret_hash=auth_service.hash_pin(secret),
        url_token=url_token,
        is_active=True,
    )
    db.add(conn)
    await db.commit()
    await db.refresh(conn)
    return conn, secret


async def list_connections(db: AsyncSession) -> list[ThumbtackConnection]:
    result = await db.execute(
        select(ThumbtackConnection).order_by(ThumbtackConnection.created_at.desc())
    )
    return list(result.scalars().all())


async def get_by_url_token(db: AsyncSession, url_token: str) -> ThumbtackConnection | None:
    result = await db.execute(
        select(ThumbtackConnection).where(ThumbtackConnection.url_token == url_token).limit(1)
    )
    return result.scalar_one_or_none()


async def get_by_id(db: AsyncSession, connection_id: str) -> ThumbtackConnection | None:
    result = await db.execute(
        select(ThumbtackConnection).where(ThumbtackConnection.id == connection_id).limit(1)
    )
    return result.scalar_one_or_none()


async def set_active(
    db: AsyncSession, connection_id: str, is_active: bool
) -> ThumbtackConnection | None:
    conn = await get_by_id(db, connection_id)
    if conn is None:
        return None
    conn.is_active = is_active
    await db.commit()
    await db.refresh(conn)
    return conn


async def delete_connection(db: AsyncSession, connection_id: str) -> bool:
    conn = await get_by_id(db, connection_id)
    if conn is None:
        return False
    # SQLite does not enforce ON DELETE CASCADE unless pragma foreign_keys is on,
    # so remove the child rows explicitly rather than relying on it.
    await db.execute(
        delete(ThumbtackWebhookEvent).where(
            ThumbtackWebhookEvent.connection_id == connection_id
        )
    )
    await db.delete(conn)
    await db.commit()
    return True


def verify_basic_header(authorization: str | None, conn: ThumbtackConnection) -> bool:
    """True only when the header carries valid Basic credentials for this connection.

    A missing header returns False. Whether a missing header is acceptable is the
    route's decision, not this function's — see the verify-if-present rule.
    """
    if not authorization or not authorization.lower().startswith("basic "):
        return False
    if not conn.auth_username or not conn.auth_secret_hash:
        return False
    try:
        decoded = base64.b64decode(authorization[6:].strip(), validate=True).decode()
    except (binascii.Error, UnicodeDecodeError, ValueError):
        return False
    username, _, password = decoded.partition(":")
    if not hmac.compare_digest(username, conn.auth_username):
        return False
    try:
        return auth_service.verify_pin(password, conn.auth_secret_hash)
    except ValueError:
        return False


def classify(body: object) -> tuple[str, str | None]:
    """Identify an event by body shape and return (kind, external_id).

    The Thumbtack form sends every checked event type to one URL, so shape is
    the only discriminator available. Anything unrecognised is 'unknown' and is
    kept for inspection rather than rejected.
    """
    if not isinstance(body, dict):
        return "unknown", None

    message = body.get("message")
    if isinstance(message, dict):
        return "message", message.get("messageID")

    review = body.get("review")
    if "reviewEventType" in body or isinstance(review, dict):
        review_obj = review if isinstance(review, dict) else {}
        return "review", review_obj.get("reviewID")

    if body.get("leadID") and isinstance(body.get("request"), dict):
        return "lead", body.get("leadID")

    return "unknown", None


async def record_event(
    db: AsyncSession, conn: ThumbtackConnection, raw_body: bytes
) -> ThumbtackWebhookEvent:
    """Persist a delivery verbatim, then classify it. Never raises for a bad body."""
    try:
        text = raw_body.decode("utf-8")
    except UnicodeDecodeError:
        text = raw_body.decode("utf-8", errors="replace")

    kind = "unknown"
    external_id = None
    status = "received"
    error = None

    try:
        parsed = json.loads(text)
        kind, external_id = classify(parsed)
        if kind == "review":
            # Reviews are out of scope this phase; recorded, not acted on.
            status = "ignored"
    except (json.JSONDecodeError, ValueError) as exc:
        status = "failed"
        error = f"Body is not valid JSON: {exc}"

    event = ThumbtackWebhookEvent(
        connection_id=conn.id,
        kind=kind,
        external_id=external_id,
        raw_body=text,
        status=status,
        error=error,
    )
    db.add(event)

    if status == "failed":
        conn.last_error_at = _now()
    else:
        conn.last_event_at = _now()

    await db.commit()
    await db.refresh(event)
    # Deliberately not logging the body: it carries customer name, phone, and address.
    logger.info(
        "thumbtack webhook recorded connection=%s kind=%s status=%s",
        conn.id, kind, status,
    )
    return event


async def record_oversize(
    db: AsyncSession,
    conn: ThumbtackConnection,
    raw_prefix: bytes,
    *,
    declared: int | None = None,
) -> ThumbtackWebhookEvent:
    """Record a delivery that was refused for being too large.

    A rejected delivery that leaves no trace is a silent loss, which is exactly
    what a capture-first receiver exists to prevent. The operator needs to see
    that Thumbtack tried and what it looked like, even though we would not store
    the whole thing.
    """
    prefix = raw_prefix[:OVERSIZE_PREFIX_BYTES].decode("utf-8", errors="replace")
    size = f"{declared} bytes declared" if declared is not None else "size not declared"
    event = ThumbtackWebhookEvent(
        connection_id=conn.id,
        kind="unknown",
        external_id=None,
        raw_body=prefix,
        status="failed",
        error=(
            f"Delivery rejected: body exceeds the {MAX_BODY_BYTES} byte limit "
            f"({size}). Only the first {len(prefix)} characters were captured."
        ),
    )
    db.add(event)
    conn.last_error_at = _now()
    await db.commit()
    await db.refresh(event)
    # Deliberately not logging the prefix: it may carry customer PII.
    logger.warning(
        "thumbtack webhook rejected as oversized connection=%s declared=%s",
        conn.id, declared,
    )
    return event


async def list_events(
    db: AsyncSession, *, connection_id: str | None = None, limit: int = 50
) -> list[ThumbtackWebhookEvent]:
    stmt = select(ThumbtackWebhookEvent).order_by(ThumbtackWebhookEvent.received_at.desc())
    if connection_id:
        stmt = stmt.where(ThumbtackWebhookEvent.connection_id == connection_id)
    result = await db.execute(stmt.limit(limit))
    return list(result.scalars().all())


async def prune_events(db: AsyncSession, *, older_than_days: int = 90) -> int:
    """Raw bodies carry customer PII, so the ledger is not kept indefinitely."""
    # received_at round-trips through SQLite as a naive value (see the model's
    # _now() default landing in a plain DateTime column — the house pattern from
    # screenshot.py), so the cutoff must be naive to match what's actually stored.
    cutoff = (_now() - timedelta(days=older_than_days)).replace(tzinfo=None)
    result = await db.execute(
        delete(ThumbtackWebhookEvent)
        .where(ThumbtackWebhookEvent.received_at < cutoff)
        # "evaluate" (the default) re-checks the WHERE clause in Python against
        # objects already in the session's identity map to keep it in sync. That
        # breaks here: a freshly-refreshed row's received_at comes back naive,
        # while a row mutated in-memory by a caller (e.g. a test backdating it)
        # keeps whatever tzinfo it was assigned, so the same query can compare
        # naive and aware datetimes in the same pass. "fetch" sidesteps the
        # in-memory comparison by selecting matching PKs before deleting.
        .execution_options(synchronize_session="fetch")
    )
    await db.commit()
    return result.rowcount or 0


async def prune_old_events() -> None:
    """Entry point for the scheduler — opens its own session."""
    from app.database import AsyncSessionLocal

    try:
        async with AsyncSessionLocal() as db:
            removed = await prune_events(db, older_than_days=90)
            if removed:
                print(f"[thumbtack] pruned {removed} webhook events older than 90 days")
    except Exception as exc:
        print(f"[thumbtack] prune error: {exc}")
