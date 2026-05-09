from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import city_for_create, require_active_city, require_auth
from app.models.lead import LeadSourceType
from app.models.user import User
from app.schemas.ingest import IngestResult, ThumbTackWebhookPayload, WebhookIngestResult
from app.services import ingest_service

router = APIRouter(prefix="/ingest", tags=["ingest"])


@router.post("/screenshot", response_model=IngestResult, status_code=201)
async def ingest_screenshot(
    file: UploadFile = File(...),
    source_type: str = Form("thumbtack_screenshot"),
    city_id: Optional[str] = Form(None),
    actor: Optional[str] = Form(None),
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    try:
        src = LeadSourceType(source_type)
    except ValueError:
        raise HTTPException(400, f"Invalid source_type: {source_type}")
    resolved_city_id = city_for_create(current_user, city_id)
    await require_active_city(db, resolved_city_id)
    return await ingest_service.ingest_screenshot(
        db,
        file,
        src,
        actor=actor or current_user.username,
        actor_role=current_user.role,
        city_id=resolved_city_id,
    )


@router.post("/webhook/thumbtack", response_model=WebhookIngestResult)
async def webhook_thumbtack(
    payload: ThumbTackWebhookPayload,
    city_id: Optional[str] = None,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """
    Thumbtack webhook receiver. Normalizes lead.created events into the lead queue.
    Duplicate leadIDs are returned without creating a new record (idempotent).
    Non-lead events return 200 with no lead created.
    TODO: enforce HMAC signature verification before production use.
    """
    resolved_city_id = city_for_create(current_user, city_id)
    await require_active_city(db, resolved_city_id)
    return await ingest_service.ingest_thumbtack_webhook(db, payload, city_id=resolved_city_id)
