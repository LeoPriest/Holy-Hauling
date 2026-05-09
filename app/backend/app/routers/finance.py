from __future__ import annotations

from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import city_for_create, city_scope, require_active_city, require_role
from app.models.city import City
from app.models.finance import FinanceTransaction, FinanceTransactionType
from app.models.user import User
from app.schemas.finance import (
    FinanceCategorySummary,
    FinanceSummary,
    FinanceTransactionCreate,
    FinanceTransactionOut,
    FinanceTransactionPatch,
)

router = APIRouter(prefix="/admin/finances", tags=["admin-finances"])


def _clean_category(value: str) -> str:
    category = value.strip()
    if not category:
        raise HTTPException(status_code=422, detail="Category is required")
    return category


def _apply_filters(
    stmt: Select[tuple[FinanceTransaction]],
    start_date: date | None,
    end_date: date | None,
    transaction_type: FinanceTransactionType | None,
    city_id: str | None = None,
) -> Select[tuple[FinanceTransaction]]:
    if city_id is not None:
        stmt = stmt.where(FinanceTransaction.city_id == city_id)
    if start_date is not None:
        stmt = stmt.where(FinanceTransaction.occurred_on >= start_date)
    if end_date is not None:
        stmt = stmt.where(FinanceTransaction.occurred_on <= end_date)
    if transaction_type is not None:
        stmt = stmt.where(FinanceTransaction.transaction_type == transaction_type)
    return stmt


async def _city_map(db: AsyncSession) -> dict[str, City]:
    result = await db.execute(select(City))
    return {city.id: city for city in result.scalars().all()}


def _transaction_out(row: FinanceTransaction, cities: dict[str, City]) -> FinanceTransactionOut:
    city = cities.get(row.city_id)
    return FinanceTransactionOut.model_validate(row).model_copy(update={
        "city_name": city.name if city else None,
        "city_slug": city.slug if city else None,
    })


@router.get("", response_model=list[FinanceTransactionOut])
async def list_transactions(
    start_date: date | None = None,
    end_date: date | None = None,
    transaction_type: FinanceTransactionType | None = Query(default=None),
    city_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    effective_city_id = city_scope(current_user, city_id)
    stmt = select(FinanceTransaction)
    stmt = _apply_filters(stmt, start_date, end_date, transaction_type, effective_city_id)
    stmt = stmt.order_by(FinanceTransaction.occurred_on.desc(), FinanceTransaction.created_at.desc())
    result = await db.execute(stmt)
    cities = await _city_map(db)
    return [_transaction_out(row, cities) for row in result.scalars().all()]


@router.get("/summary", response_model=FinanceSummary)
async def finance_summary(
    start_date: date | None = None,
    end_date: date | None = None,
    city_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    effective_city_id = city_scope(current_user, city_id)
    stmt = select(FinanceTransaction)
    stmt = _apply_filters(stmt, start_date, end_date, None, effective_city_id)
    result = await db.execute(stmt)
    rows = list(result.scalars().all())

    income = sum(row.amount_cents for row in rows if row.transaction_type == FinanceTransactionType.income)
    expenses = sum(row.amount_cents for row in rows if row.transaction_type == FinanceTransactionType.expense)

    category_map: dict[str, FinanceCategorySummary] = {}
    for row in rows:
        category = row.category.strip() or "Uncategorized"
        summary = category_map.setdefault(category, FinanceCategorySummary(category=category))
        if row.transaction_type == FinanceTransactionType.income:
            summary.income_cents += row.amount_cents
        else:
            summary.expense_cents += row.amount_cents
        summary.net_cents = summary.income_cents - summary.expense_cents

    categories = sorted(
        category_map.values(),
        key=lambda item: max(item.income_cents, item.expense_cents),
        reverse=True,
    )
    return FinanceSummary(
        income_cents=income,
        expense_cents=expenses,
        net_cents=income - expenses,
        transaction_count=len(rows),
        categories=categories,
    )


@router.post("", response_model=FinanceTransactionOut, status_code=201)
async def create_transaction(
    data: FinanceTransactionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    resolved_city_id = city_for_create(current_user, data.city_id)
    await require_active_city(db, resolved_city_id)
    transaction = FinanceTransaction(
        city_id=resolved_city_id,
        occurred_on=data.occurred_on,
        transaction_type=data.transaction_type,
        category=_clean_category(data.category),
        amount_cents=data.amount_cents,
        payment_method=(data.payment_method or "").strip() or None,
        vendor_customer=(data.vendor_customer or "").strip() or None,
        description=(data.description or "").strip() or None,
        lead_id=data.lead_id,
        created_by=current_user.id,
    )
    db.add(transaction)
    await db.commit()
    await db.refresh(transaction)
    return _transaction_out(transaction, await _city_map(db))


@router.patch("/{transaction_id}", response_model=FinanceTransactionOut)
async def patch_transaction(
    transaction_id: str,
    data: FinanceTransactionPatch,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    result = await db.execute(select(FinanceTransaction).where(FinanceTransaction.id == transaction_id))
    transaction = result.scalar_one_or_none()
    if transaction is None:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if current_user.role != "admin" and transaction.city_id != current_user.city_id:
        raise HTTPException(status_code=404, detail="Transaction not found")

    if "city_id" in data.model_fields_set and data.city_id is not None:
        resolved_city_id = city_for_create(current_user, data.city_id)
        await require_active_city(db, resolved_city_id)
        transaction.city_id = resolved_city_id
    for field in ("occurred_on", "transaction_type", "amount_cents", "lead_id"):
        if field in data.model_fields_set:
            setattr(transaction, field, getattr(data, field))
    if "category" in data.model_fields_set and data.category is not None:
        transaction.category = _clean_category(data.category)
    if "payment_method" in data.model_fields_set:
        transaction.payment_method = (data.payment_method or "").strip() or None
    if "vendor_customer" in data.model_fields_set:
        transaction.vendor_customer = (data.vendor_customer or "").strip() or None
    if "description" in data.model_fields_set:
        transaction.description = (data.description or "").strip() or None
    transaction.updated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(transaction)
    return _transaction_out(transaction, await _city_map(db))


@router.delete("/{transaction_id}")
async def delete_transaction(
    transaction_id: str,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(require_role("admin")),
):
    result = await db.execute(select(FinanceTransaction).where(FinanceTransaction.id == transaction_id))
    transaction = result.scalar_one_or_none()
    if transaction is None:
        raise HTTPException(status_code=404, detail="Transaction not found")
    await db.delete(transaction)
    await db.commit()
    return {"deleted": True}
