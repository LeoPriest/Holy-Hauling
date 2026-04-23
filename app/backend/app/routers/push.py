from __future__ import annotations

import os

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_auth
from app.models.user import User
from app.schemas.push import PushSubscribeRequest
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
