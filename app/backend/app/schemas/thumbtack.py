from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

Business = Literal["holy_hauling", "holy_handy"]


class ConnectionCreate(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    city_id: str
    business: Business


class ConnectionPatch(BaseModel):
    is_active: Optional[bool] = None


class ConnectionOut(BaseModel):
    """Safe to return anywhere. Carries no secret and no hash."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    label: str
    city_id: str
    business: str
    business_id: Optional[str] = None
    url_token: str
    auth_username: Optional[str] = None
    is_active: bool
    last_event_at: Optional[datetime] = None
    last_error_at: Optional[datetime] = None
    created_at: datetime


class ConnectionCreated(ConnectionOut):
    """Returned exactly once, from the create call. The only time the plaintext
    secret exists outside Thumbtack's configuration."""

    webhook_url: str
    auth_secret: str


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    connection_id: str
    kind: str
    external_id: Optional[str] = None
    raw_body: str
    status: str
    error: Optional[str] = None
    lead_id: Optional[str] = None
    received_at: datetime
    processed_at: Optional[datetime] = None
