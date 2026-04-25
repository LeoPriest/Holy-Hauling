from __future__ import annotations

from pydantic import BaseModel


class PushSubscribeRequest(BaseModel):
    endpoint: str
    p256dh: str
    auth: str


class PushUnsubscribeRequest(BaseModel):
    endpoint: str


class PushTestResult(BaseModel):
    sent: bool
    reason: str | None = None
