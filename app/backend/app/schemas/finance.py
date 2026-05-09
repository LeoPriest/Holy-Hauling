from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

TransactionType = Literal["income", "expense"]


class FinanceTransactionBase(BaseModel):
    city_id: str | None = None
    occurred_on: date
    transaction_type: TransactionType
    category: str = Field(min_length=1, max_length=80)
    amount_cents: int = Field(gt=0)
    payment_method: str | None = Field(default=None, max_length=80)
    vendor_customer: str | None = Field(default=None, max_length=120)
    description: str | None = None
    lead_id: str | None = None


class FinanceTransactionCreate(FinanceTransactionBase):
    pass


class FinanceTransactionPatch(BaseModel):
    city_id: str | None = None
    occurred_on: date | None = None
    transaction_type: TransactionType | None = None
    category: str | None = Field(default=None, min_length=1, max_length=80)
    amount_cents: int | None = Field(default=None, gt=0)
    payment_method: str | None = Field(default=None, max_length=80)
    vendor_customer: str | None = Field(default=None, max_length=120)
    description: str | None = None
    lead_id: str | None = None


class FinanceTransactionOut(FinanceTransactionBase):
    id: str
    city_id: str
    city_name: str | None = None
    city_slug: str | None = None
    created_by: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class FinanceCategorySummary(BaseModel):
    category: str
    income_cents: int = 0
    expense_cents: int = 0
    net_cents: int = 0


class FinanceSummary(BaseModel):
    income_cents: int = 0
    expense_cents: int = 0
    net_cents: int = 0
    transaction_count: int = 0
    categories: list[FinanceCategorySummary] = Field(default_factory=list)
