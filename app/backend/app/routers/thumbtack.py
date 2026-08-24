from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
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
