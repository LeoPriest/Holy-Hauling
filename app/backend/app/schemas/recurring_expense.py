# app/backend/app/schemas/recurring_expense.py
from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

IntervalUnit = Literal["days", "weeks", "months"]


class RecurringExpenseCreate(BaseModel):
    city_id: str | None = None
    name: str = Field(min_length=1, max_length=120)
    category: str = Field(min_length=1, max_length=80)
    amount_cents: int = Field(gt=0)
    payment_method: str | None = Field(default=None, max_length=80)
    vendor_customer: str | None = Field(default=None, max_length=120)
    description: str | None = None
    interval_value: int = Field(gt=0)
    interval_unit: IntervalUnit
    next_due_date: date


class RecurringExpensePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    category: str | None = Field(default=None, min_length=1, max_length=80)
    amount_cents: int | None = Field(default=None, gt=0)
    payment_method: str | None = None
    vendor_customer: str | None = None
    description: str | None = None
    interval_value: int | None = Field(default=None, gt=0)
    interval_unit: IntervalUnit | None = None
    next_due_date: date | None = None
    is_active: bool | None = None


class RecurringExpenseOut(BaseModel):
    id: str
    city_id: str
    name: str
    category: str
    amount_cents: int
    payment_method: str | None
    vendor_customer: str | None
    description: str | None
    interval_value: int
    interval_unit: IntervalUnit
    next_due_date: date
    google_calendar_event_id: str | None
    is_active: bool
    created_by: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
