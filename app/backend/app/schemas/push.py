from __future__ import annotations

from pydantic import BaseModel


class PushSubscribeRequest(BaseModel):
    endpoint: str
    p256dh: str
    auth: str
