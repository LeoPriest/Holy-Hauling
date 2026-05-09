from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import city_scope, require_auth
from app.models.user import User
from app.schemas.chat import ChatMessageOut, ChatRequest, ChatResponse
from app.services import chat_service, lead_service

router = APIRouter(prefix="/leads", tags=["chat"])


@router.get("/{lead_id}/chat", response_model=list[ChatMessageOut])
async def get_chat(
    lead_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_auth),
):
    await lead_service.get_lead(db, lead_id, city_id=city_scope(current_user))
    return await chat_service.get_messages(db, lead_id)


@router.post("/{lead_id}/chat", response_model=ChatResponse)
async def send_message(
    lead_id: str,
    data: ChatRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_auth),
):
    await lead_service.get_lead(db, lead_id, city_id=city_scope(current_user))
    messages, quote_context_update = await chat_service.send_message(
        db, lead_id, data.message, data.ai_review_id
    )
    return ChatResponse(messages=messages, quote_context_update=quote_context_update)
