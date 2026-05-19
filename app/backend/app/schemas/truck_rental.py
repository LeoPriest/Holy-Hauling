# app/backend/app/schemas/truck_rental.py
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

TruckRentalStatusLiteral = Literal["reserved", "confirmed", "completed"]
TRUCK_SIZES = ("10ft", "15ft", "20ft", "26ft")


class TruckRentalUpsert(BaseModel):
    status: TruckRentalStatusLiteral = "reserved"
    confirmation_number: str | None = None
    truck_size: str | None = Field(default=None)
    pickup_location: str | None = None
    pickup_datetime: datetime | None = None
    dropoff_datetime: datetime | None = None
    rental_cost_cents: int | None = Field(default=None, ge=0)
    one_way: bool = False
    estimated_miles: float | None = Field(default=None, ge=0)
    actual_miles: float | None = Field(default=None, ge=0)
    notes: str | None = None


class TruckRentalOut(TruckRentalUpsert):
    id: str
    lead_id: str
    receipt_url: str | None = None
    lead_customer_name: str | None = None
    lead_job_date_requested: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
