from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel

JobStatus = Literal["en_route", "started", "completed"]


class JobOut(BaseModel):
    id: str
    customer_name: Optional[str] = None
    service_type: Optional[str] = None
    job_location: Optional[str] = None
    job_date_requested: Optional[str] = None
    scope_notes: Optional[str] = None
    assigned_to: Optional[str] = None
    customer_phone: Optional[str] = None
    quote_context: Optional[str] = None

    model_config = {"from_attributes": True}


class JobStatusUpdate(BaseModel):
    status: JobStatus
