from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_auth, require_role
from app.models.lead import LeadSourceType, LeadStatus
from app.models.user import User
from app.schemas.lead import (
    LeadCreate,
    LeadDetailOut,
    LeadEventOut,
    LeadOut,
    LeadStatusUpdate,
    LeadUpdate,
    NoteCreate,
    ScreenshotOut,
)
from app.schemas.ai_review import AiReviewOut
from app.schemas.ocr import OcrApply, OcrResultOut
from app.services import ai_review_service, lead_service, ocr_service

router = APIRouter(prefix="/leads", tags=["leads"])


@router.post("", response_model=LeadOut, status_code=201)
async def create_lead(
    data: LeadCreate,
    _: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    return await lead_service.create_lead(db, data)


@router.get("", response_model=list[LeadOut])
async def list_leads(
    status: Optional[LeadStatus] = Query(None),
    source_type: Optional[LeadSourceType] = Query(None),
    assigned_to: Optional[str] = Query(None),
    _: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    return await lead_service.list_leads(db, status=status, source_type=source_type, assigned_to=assigned_to)


@router.get("/{lead_id}", response_model=LeadDetailOut)
async def get_lead(
    lead_id: str,
    _: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    return await lead_service.get_lead(db, lead_id, detailed=True)


@router.delete("/{lead_id}", status_code=204)
async def delete_lead(
    lead_id: str,
    _: User = Depends(require_role("admin", "facilitator")),
    db: AsyncSession = Depends(get_db),
):
    await lead_service.delete_lead(db, lead_id)
    return Response(status_code=204)


@router.patch("/{lead_id}", response_model=LeadOut)
async def update_lead(
    lead_id: str,
    data: LeadUpdate,
    actor: Optional[str] = Query(None),
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    effective_actor = actor or current_user.username
    return await lead_service.update_lead(db, lead_id, data, actor=effective_actor)


@router.patch("/{lead_id}/status", response_model=LeadOut)
async def update_status(
    lead_id: str,
    data: LeadStatusUpdate,
    _: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    return await lead_service.update_lead_status(db, lead_id, data)


@router.post("/{lead_id}/acknowledge", response_model=LeadOut)
async def acknowledge_lead(
    lead_id: str,
    actor: Optional[str] = Query(None),
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    return await lead_service.acknowledge_lead(db, lead_id, actor=actor or current_user.username)


@router.post("/{lead_id}/notes", response_model=LeadEventOut, status_code=201)
async def add_note(
    lead_id: str,
    data: NoteCreate,
    _: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    return await lead_service.add_note(db, lead_id, data)


@router.post("/{lead_id}/screenshots", response_model=ScreenshotOut, status_code=201)
async def upload_screenshot(
    lead_id: str,
    file: UploadFile = File(...),
    _: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    return await lead_service.upload_screenshot(db, lead_id, file)


@router.get("/{lead_id}/screenshots", response_model=list[ScreenshotOut])
async def list_screenshots(
    lead_id: str,
    _: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    return await lead_service.list_screenshots(db, lead_id)


@router.get("/{lead_id}/events", response_model=list[LeadEventOut])
async def get_lead_events(
    lead_id: str,
    _: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    return await lead_service.get_lead_events(db, lead_id)


# ── screenshot extraction ─────────────────────────────────────────────────────

@router.post("/{lead_id}/screenshots/{screenshot_id}/extract", response_model=OcrResultOut)
async def trigger_extraction(
    lead_id: str,
    screenshot_id: str,
    _: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    return await ocr_service.trigger_extraction(db, lead_id, screenshot_id)


@router.get("/{lead_id}/screenshots/{screenshot_id}/extract", response_model=OcrResultOut)
async def get_extraction_result(
    lead_id: str,
    screenshot_id: str,
    _: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    return await ocr_service.get_extraction_result(db, lead_id, screenshot_id)


@router.post("/{lead_id}/screenshots/{screenshot_id}/apply", response_model=LeadOut)
async def apply_extraction_fields(
    lead_id: str,
    screenshot_id: str,
    data: OcrApply,
    _: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    return await ocr_service.apply_ocr_fields(db, lead_id, screenshot_id, data)


# ── AI review ─────────────────────────────────────────────────────────────────

@router.post("/{lead_id}/ai-review", response_model=AiReviewOut, status_code=201)
async def trigger_ai_review(
    lead_id: str,
    actor: Optional[str] = Query(None),
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    return await ai_review_service.trigger_review(db, lead_id, actor=actor or current_user.username)


@router.get("/{lead_id}/ai-review", response_model=AiReviewOut)
async def get_latest_ai_review(
    lead_id: str,
    _: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    return await ai_review_service.get_latest_review(db, lead_id)
