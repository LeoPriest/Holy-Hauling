from __future__ import annotations

import logging
import os
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
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

@router.post("/ingest/webhook/thumbtack/{url_token}", include_in_schema=False)
async def thumbtack_webhook(
    url_token: str,
    request: Request,
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > thumbtack_service.MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Body too large")

    body = await request.body()
    if len(body) > thumbtack_service.MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Body too large")

    conn = await thumbtack_service.get_by_url_token(db, url_token)
    if conn is None or not conn.is_active:
        # Do not distinguish unknown from disabled — both are 401, nothing stored.
        logger.warning("thumbtack webhook rejected: unknown or inactive token")
        raise HTTPException(status_code=401, detail="Unknown webhook")

    if authorization is not None:
        if not thumbtack_service.verify_basic_header(authorization, conn):
            logger.warning(
                "thumbtack webhook rejected: bad credentials connection=%s", conn.id
            )
            raise HTTPException(status_code=401, detail="Invalid credentials")

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

def _webhook_url(request: Request, url_token: str) -> str:
    """Build the URL Ron pastes into Thumbtack.

    Derived from the live request by default so it is always correct for the
    environment actually serving it. PUBLIC_BASE_URL overrides that for setups
    behind a proxy that rewrites the host.
    """
    base = (os.environ.get("PUBLIC_BASE_URL") or str(request.base_url)).rstrip("/")
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
    limit: int = 50,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    return await thumbtack_service.list_events(
        db, connection_id=connection_id, limit=min(limit, 200)
    )
