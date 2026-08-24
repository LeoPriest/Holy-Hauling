from __future__ import annotations

import logging
import os
from typing import Optional
from urllib.parse import urlsplit, urlunsplit

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_role
from app.models.city import City
from app.models.user import User
from app.schemas.thumbtack import (
    ConnectionCreate,
    ConnectionCreated,
    ConnectionOut,
    ConnectionPatch,
    EventOut,
)
from app.services import thumbtack_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["thumbtack"])


# ── Public receiver (Thumbtack calls this) ────────────────────────────────
#
# No `require_auth`. Thumbtack sends an unauthenticated server-to-server POST;
# the unguessable url_token in the path is the bearer secret. If Thumbtack is
# configured to send Basic credentials we verify them, but we do not require
# them — see the verify-if-present rule in the plan.

# Stop iterating a body stream past this point. Draining a rejected request is
# a courtesy so the client sees a response instead of a reset connection; it is
# not an obligation to read an endless one.
_DRAIN_LIMIT_BYTES = thumbtack_service.MAX_BODY_BYTES * 4


async def _read_body_capped(request: Request, cap: int) -> tuple[bytes, bool]:
    """Buffer at most ``cap`` bytes of the request body, draining the rest.

    ``await request.body()`` accumulates the whole stream, so a chunked POST with
    no Content-Length could exhaust container memory before any auth check ran.
    This iterates instead and stops buffering at the cap, while still consuming
    the remainder (up to _DRAIN_LIMIT_BYTES) so a rejected sender gets a clean
    HTTP response.

    Returns ``(buffered_bytes, overflowed)``.
    """
    chunks: list[bytes] = []
    buffered = 0
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        room = cap - buffered
        if room > 0:
            taken = chunk[:room]
            chunks.append(taken)
            buffered += len(taken)
        if total > _DRAIN_LIMIT_BYTES:
            break
    return b"".join(chunks), total > cap


@router.post("/ingest/webhook/thumbtack/{url_token}", include_in_schema=False)
async def thumbtack_webhook(
    url_token: str,
    request: Request,
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    # Resolve the connection before touching the body. An oversized delivery to a
    # known connection has to leave a trace — capture-first is the whole point of
    # this receiver — and that is impossible if we reject before we know who sent it.
    conn = await thumbtack_service.get_by_url_token(db, url_token)
    if conn is None or not conn.is_active:
        # Do not distinguish unknown from disabled — both are 401, nothing stored.
        # Consume the body first so the sender sees the 401 rather than a reset.
        await _read_body_capped(request, 0)
        logger.warning("thumbtack webhook rejected: unknown or inactive token")
        raise HTTPException(status_code=401, detail="Unknown webhook")

    if authorization is not None:
        if not thumbtack_service.verify_basic_header(authorization, conn):
            await _read_body_capped(request, 0)
            logger.warning(
                "thumbtack webhook rejected: bad credentials connection=%s", conn.id
            )
            raise HTTPException(status_code=401, detail="Invalid credentials")

    # Cheap early rejection: a declared oversize means we never buffer more than a
    # short prefix, which is all the operator needs to recognise what arrived.
    declared_raw = request.headers.get("content-length")
    declared = int(declared_raw) if declared_raw and declared_raw.isdigit() else None
    declared_too_large = declared is not None and declared > thumbtack_service.MAX_BODY_BYTES

    cap = (
        thumbtack_service.OVERSIZE_PREFIX_BYTES
        if declared_too_large
        else thumbtack_service.MAX_BODY_BYTES
    )
    body, overflowed = await _read_body_capped(request, cap)

    if declared_too_large or overflowed:
        try:
            await thumbtack_service.record_oversize(db, conn, body, declared=declared)
        except Exception:
            logger.exception(
                "thumbtack webhook oversize could not be recorded connection=%s", conn.id
            )
        raise HTTPException(status_code=413, detail="Body too large")

    record_failed = False
    try:
        await thumbtack_service.record_event(db, conn, body)
    except Exception:
        # Never log the body — it carries customer name, phone, and address.
        logger.exception(
            "thumbtack webhook record_event failed connection=%s", conn.id
        )
        record_failed = True

    if record_failed:
        # 503 so Thumbtack retries the delivery rather than believing a lost
        # write succeeded. A lead cannot be re-derived the way a Square
        # payment status can, so we do not swallow this the way square_router
        # does.
        raise HTTPException(status_code=503, detail="Could not record event")

    return Response(status_code=200)


# ── Admin surface ─────────────────────────────────────────────────────────

_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "0.0.0.0"}


def _webhook_url(request: Request, url_token: str) -> str:
    """Build the URL Ron pastes into Thumbtack.

    Derived from the live request by default so it is always correct for the
    environment actually serving it. PUBLIC_BASE_URL overrides that outright, for
    setups behind a proxy that rewrites the host.
    """
    override = os.environ.get("PUBLIC_BASE_URL")
    if override:
        return f"{override.rstrip('/')}/ingest/webhook/thumbtack/{url_token}"

    base = str(request.base_url).rstrip("/")
    parsed = urlsplit(base)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" and host not in _LOCAL_HOSTS:
        # Behind a TLS terminator the app can still see scheme "http". This URL is
        # the bearer secret for the endpoint, so handing out a cleartext one is
        # worse than being opinionated: a public webhook is never legitimately http.
        base = urlunsplit(("https", parsed.netloc, parsed.path, "", ""))
    return f"{base}/ingest/webhook/thumbtack/{url_token}"


@router.get("/admin/thumbtack/connections", response_model=list[ConnectionOut])
async def list_connections(
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    return await thumbtack_service.list_connections(db)


@router.post("/admin/thumbtack/connections", response_model=ConnectionCreated, status_code=201)
async def create_connection(
    payload: ConnectionCreate,
    request: Request,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    city = await db.execute(select(City).where(City.id == payload.city_id).limit(1))
    if city.scalar_one_or_none() is None:
        raise HTTPException(status_code=422, detail=f"Unknown city: {payload.city_id}")

    conn, secret = await thumbtack_service.create_connection(
        db, label=payload.label, city_id=payload.city_id, business=payload.business
    )
    return ConnectionCreated(
        **ConnectionOut.model_validate(conn).model_dump(),
        webhook_url=_webhook_url(request, conn.url_token),
        auth_secret=secret,
    )


@router.patch("/admin/thumbtack/connections/{connection_id}", response_model=ConnectionOut)
async def patch_connection(
    connection_id: str,
    payload: ConnectionPatch,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    if payload.is_active is None:
        raise HTTPException(status_code=422, detail="Nothing to update")
    conn = await thumbtack_service.set_active(db, connection_id, payload.is_active)
    if conn is None:
        raise HTTPException(status_code=404, detail="Connection not found")
    return conn


@router.delete("/admin/thumbtack/connections/{connection_id}", status_code=204)
async def delete_connection(
    connection_id: str,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    if not await thumbtack_service.delete_connection(db, connection_id):
        raise HTTPException(status_code=404, detail="Connection not found")
    return Response(status_code=204)


@router.get("/admin/thumbtack/events", response_model=list[EventOut])
async def list_events(
    connection_id: Optional[str] = None,
    limit: int = Query(default=50, ge=1, le=200),
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    return await thumbtack_service.list_events(
        db, connection_id=connection_id, limit=limit
    )
