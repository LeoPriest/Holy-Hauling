from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import city_for_create, city_scope, require_active_city, require_auth, require_role
from app.models.city import City
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
from app.schemas.followup import FollowupCreate, FollowupOut
from app.schemas.ocr import OcrApply, OcrResultOut
from app.services import ai_review_service, followup_service, lead_service, ocr_service

router = APIRouter(prefix="/leads", tags=["leads"])


async def _attach_city_names(db: AsyncSession, leads):
    result = await db.execute(select(City))
    cities = {city.id: city for city in result.scalars().all()}
    rows = leads if isinstance(leads, list) else [leads]
    for lead in rows:
        city = cities.get(lead.city_id)
        setattr(lead, "city_name", city.name if city else None)
        setattr(lead, "city_slug", city.slug if city else None)
    return leads


async def _attach_followups(db: AsyncSession, leads):
    from app.models.lead_followup import LeadFollowup as LF
    rows = leads if isinstance(leads, list) else [leads]
    lead_ids = [l.id for l in rows]
    if not lead_ids:
        return leads
    fu_result = await db.execute(
        select(LF).where(LF.lead_id.in_(lead_ids), LF.fired == False)
    )
    fu_map = {fu.lead_id: fu for fu in fu_result.scalars().all()}
    for lead in rows:
        setattr(lead, "active_followup", fu_map.get(lead.id))
    return leads


async def _enrich(db: AsyncSession, leads):
    await _attach_city_names(db, leads)
    await _attach_followups(db, leads)
    return leads


@router.post("", response_model=LeadOut, status_code=201)
async def create_lead(
    data: LeadCreate,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    data.city_id = city_for_create(current_user, data.city_id)
    await require_active_city(db, data.city_id)
    lead = await lead_service.create_lead(db, data, actor=current_user.username)
    return await _enrich(db, lead)


@router.get("", response_model=list[LeadOut])
async def list_leads(
    status: Optional[LeadStatus] = Query(None),
    source_type: Optional[LeadSourceType] = Query(None),
    assigned_to: Optional[str] = Query(None),
    city_id: Optional[str] = Query(None),
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    leads = await lead_service.list_leads(
        db,
        status=status,
        source_type=source_type,
        assigned_to=assigned_to,
        city_id=city_scope(current_user, city_id),
    )
    return await _enrich(db, leads)


@router.get("/{lead_id}", response_model=LeadDetailOut)
async def get_lead(
    lead_id: str,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    lead = await lead_service.get_lead(db, lead_id, detailed=True, city_id=city_scope(current_user))
    return await _enrich(db, lead)


@router.delete("/{lead_id}", status_code=204)
async def delete_lead(
    lead_id: str,
    current_user: User = Depends(require_role("admin", "facilitator")),
    db: AsyncSession = Depends(get_db),
):
    await lead_service.delete_lead(db, lead_id, city_id=city_scope(current_user))
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
    lead = await lead_service.update_lead(db, lead_id, data, actor=effective_actor, city_id=city_scope(current_user))
    return await _enrich(db, lead)


@router.patch("/{lead_id}/status", response_model=LeadOut)
async def update_status(
    lead_id: str,
    data: LeadStatusUpdate,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    lead = await lead_service.update_lead_status(db, lead_id, data, city_id=city_scope(current_user))
    return await _enrich(db, lead)


@router.post("/{lead_id}/acknowledge", response_model=LeadOut)
async def acknowledge_lead(
    lead_id: str,
    actor: Optional[str] = Query(None),
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    lead = await lead_service.acknowledge_lead(db, lead_id, actor=actor or current_user.username, city_id=city_scope(current_user))
    return await _enrich(db, lead)


@router.post("/{lead_id}/notes", response_model=LeadEventOut, status_code=201)
async def add_note(
    lead_id: str,
    data: NoteCreate,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    return await lead_service.add_note(db, lead_id, data, city_id=city_scope(current_user))


@router.post("/{lead_id}/screenshots", response_model=ScreenshotOut, status_code=201)
async def upload_screenshot(
    lead_id: str,
    file: UploadFile = File(...),
    screenshot_type: str = Form("intake"),
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    return await lead_service.upload_screenshot(db, lead_id, file, screenshot_type=screenshot_type, city_id=city_scope(current_user))


@router.get("/{lead_id}/screenshots", response_model=list[ScreenshotOut])
async def list_screenshots(
    lead_id: str,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    return await lead_service.list_screenshots(db, lead_id, city_id=city_scope(current_user))


@router.get("/{lead_id}/events", response_model=list[LeadEventOut])
async def get_lead_events(
    lead_id: str,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    return await lead_service.get_lead_events(db, lead_id, city_id=city_scope(current_user))


# ── screenshot extraction ─────────────────────────────────────────────────────

@router.post("/{lead_id}/screenshots/{screenshot_id}/extract", response_model=OcrResultOut)
async def trigger_extraction(
    lead_id: str,
    screenshot_id: str,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    await lead_service.get_lead(db, lead_id, city_id=city_scope(current_user))
    return await ocr_service.trigger_extraction(db, lead_id, screenshot_id)


@router.get("/{lead_id}/screenshots/{screenshot_id}/extract", response_model=OcrResultOut)
async def get_extraction_result(
    lead_id: str,
    screenshot_id: str,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    await lead_service.get_lead(db, lead_id, city_id=city_scope(current_user))
    return await ocr_service.get_extraction_result(db, lead_id, screenshot_id)


@router.post("/{lead_id}/screenshots/{screenshot_id}/apply", response_model=LeadOut)
async def apply_extraction_fields(
    lead_id: str,
    screenshot_id: str,
    data: OcrApply,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    await lead_service.get_lead(db, lead_id, city_id=city_scope(current_user))
    lead = await ocr_service.apply_ocr_fields(db, lead_id, screenshot_id, data)
    return await _enrich(db, lead)


# ── AI review ─────────────────────────────────────────────────────────────────

@router.post("/{lead_id}/ai-review", response_model=AiReviewOut, status_code=201)
async def trigger_ai_review(
    lead_id: str,
    actor: Optional[str] = Query(None),
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    await lead_service.get_lead(db, lead_id, city_id=city_scope(current_user))
    return await ai_review_service.trigger_review(db, lead_id, actor=actor or current_user.username)


@router.get("/{lead_id}/ai-review", response_model=AiReviewOut)
async def get_latest_ai_review(
    lead_id: str,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    await lead_service.get_lead(db, lead_id, city_id=city_scope(current_user))
    return await ai_review_service.get_latest_review(db, lead_id)


# ── Follow-up scheduler ───────────────────────────────────────────────────────

@router.get("/{lead_id}/followup", response_model=FollowupOut | None)
async def get_followup(
    lead_id: str,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    await lead_service.get_lead(db, lead_id, city_id=city_scope(current_user))
    return await followup_service.get_active_followup(db, lead_id)


@router.put("/{lead_id}/followup", response_model=FollowupOut, status_code=200)
async def upsert_followup(
    lead_id: str,
    payload: FollowupCreate,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    await lead_service.get_lead(db, lead_id, city_id=city_scope(current_user))
    return await followup_service.upsert_followup(
        db,
        lead_id=lead_id,
        scheduled_at=payload.scheduled_at,
        note=payload.note,
        created_by=current_user.username,
    )


@router.delete("/{lead_id}/followup", status_code=204)
async def cancel_followup(
    lead_id: str,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    await lead_service.get_lead(db, lead_id, city_id=city_scope(current_user))
    await followup_service.cancel_followup(db, lead_id)
    return Response(status_code=204)
