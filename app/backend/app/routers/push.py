from __future__ import annotations

import os

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_auth
from app.models.user import User
from app.schemas.push import PushSubscribeRequest, PushTestResult, PushUnsubscribeRequest
from app.services import push_service

router = APIRouter(prefix="/push", tags=["push"])


@router.get("/vapid-public-key")
async def get_vapid_public_key():
    return {"publicKey": os.getenv("VAPID_PUBLIC_KEY", "")}


@router.post("/subscribe", status_code=201)
async def subscribe(
    data: PushSubscribeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_auth),
):
    sub = await push_service.save_subscription(
        db, current_user.id, data.endpoint, data.p256dh, data.auth
    )
    return {"id": sub.id}


@router.post("/unsubscribe")
async def unsubscribe(
    data: PushUnsubscribeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_auth),
):
    removed = await push_service.delete_subscription(db, current_user.id, data.endpoint)
    return {"removed": removed}


@router.post("/test", response_model=PushTestResult)
async def test_push(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_auth),
):
    status = push_service.web_push_status()
    if not bool(status["configured"]):
        return PushTestResult(sent=False, reason=str(status["detail"]))
    if await push_service.user_subscription_count(db, current_user.id) == 0:
        return PushTestResult(sent=False, reason="No browser push subscription saved for this user.")
    sent = await push_service.send_push_to_user(
        db,
        current_user.id,
        "Holy Hauling test push - browser notifications are working.",
    )
    if sent == 0:
        return PushTestResult(sent=False, reason="Push delivery failed for the saved subscription.")
    return PushTestResult(sent=True)
