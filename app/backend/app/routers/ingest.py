from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.lead import LeadSourceType
from app.schemas.ingest import IngestResult, ThumbTackWebhookPayload, WebhookIngestResult
from app.services import ingest_service

router = APIRouter(prefix="/ingest", tags=["ingest"])


@router.post("/screenshot", response_model=IngestResult, status_code=201)
async def ingest_screenshot(
    file: UploadFile = File(...),
    source_type: str = Form("thumbtack_screenshot"),
    actor: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Primary intake path. Upload a screenshot to create a lead stub, run OCR,
    and auto-apply high-confidence extracted fields — all in one request.
    Returns the lead and extraction result for facilitator review.
    """
    try:
        src = LeadSourceType(source_type)
    except ValueError:
        from fastapi import HTTPException
        raise HTTPException(400, f"Invalid source_type: {source_type}")
    return await ingest_service.ingest_screenshot(db, file, src, actor=actor)


@router.post("/webhook/thumbtack", response_model=WebhookIngestResult)
async def webhook_thumbtack(
    payload: ThumbTackWebhookPayload,
    db: AsyncSession = Depends(get_db),
):
    """
    Thumbtack webhook receiver. Normalizes lead.created events into the lead queue.
    Duplicate leadIDs are returned without creating a new record (idempotent).
    Non-lead events return 200 with no lead created.
    TODO: enforce HMAC signature verification before production use.
    """
    return await ingest_service.ingest_thumbtack_webhook(db, payload)
