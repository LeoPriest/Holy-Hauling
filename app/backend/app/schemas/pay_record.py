from __future__ import annotations

from datetime import date

from pydantic import BaseModel

from app.models.pay_record import PayType


class PayRecordUpsert(BaseModel):
    user_id: str
    pay_type: PayType
    hours_worked: float | None = None
    override_amount_cents: int | None = None
    note: str | None = None


class PayRecordOut(BaseModel):
    id: str
    lead_id: str
    user_id: str
    user_username: str
    user_hourly_rate_cents: int | None
    pay_type: PayType
    hours_worked: float | None
    override_amount_cents: int | None
    amount_cents: int
    note: str | None
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}


class PayrollJobEntry(BaseModel):
    lead_id: str
    customer_name: str | None
    job_date_requested: date | None
    amount_cents: int
    pay_type: PayType


class PayrollUserSummary(BaseModel):
    user_id: str
    username: str
    total_amount_cents: int
    record_count: int
    jobs: list[PayrollJobEntry]


class MyPayEntry(BaseModel):
    lead_id: str
    customer_name: str | None
    job_date: date | None
    pay_type: PayType
    hours_worked: float | None
    amount_cents: int


class MyPayOut(BaseModel):
    total_earnings_cents: int
    total_hours: float
    job_count: int
    entries: list[MyPayEntry]
