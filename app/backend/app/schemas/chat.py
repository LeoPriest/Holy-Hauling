from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class ChatRequest(BaseModel):
    message: str
    ai_review_id: Optional[str] = None


class ChatMessageOut(BaseModel):
    id: str
    lead_id: str
    ai_review_id: Optional[str]
    role: str
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatResponse(BaseModel):
    messages: list[ChatMessageOut]
    quote_context_update: Optional[str] = None
