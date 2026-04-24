from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel

JobStatus = Literal["dispatched", "en_route", "arrived", "started", "completed", "reset"]


class JobOut(BaseModel):
    id: str
    customer_name: Optional[str] = None
    service_type: Optional[str] = None
    job_location: Optional[str] = None
    job_address: Optional[str] = None
    job_date_requested: Optional[str] = None
    scope_notes: Optional[str] = None
    crew: list[str] = []
    customer_phone: Optional[str] = None
    quote_context: Optional[str] = None
    job_phase: Optional[str] = None   # "dispatched"|"en_route"|"arrived"|"started"|None
    dispatched_at: Optional[str] = None  # ISO datetime
    en_route_at: Optional[str] = None
    arrived_at: Optional[str] = None
    started_at: Optional[str] = None

    model_config = {"from_attributes": True}


class JobStatusUpdate(BaseModel):
    status: JobStatus


class JobAssignmentCreate(BaseModel):
    user_id: str
