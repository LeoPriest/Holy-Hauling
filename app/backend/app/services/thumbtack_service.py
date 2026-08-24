from __future__ import annotations

import base64
import binascii
import hmac
import logging
import secrets
from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.thumbtack import ThumbtackConnection, ThumbtackWebhookEvent
from app.services import auth_service

logger = logging.getLogger(__name__)

# Thumbtack lead payloads carry attachment metadata, not the files themselves,
# so a legitimate body is small. 1 MB is generous.
MAX_BODY_BYTES = 1_000_000


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
