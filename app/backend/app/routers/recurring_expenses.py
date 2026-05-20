# app/backend/app/routers/recurring_expenses.py
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone

from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import city_scope, require_role
from app.models.finance import FinanceTransaction, FinanceTransactionType
from app.models.recurring_expense import RecurringExpense
from app.models.user import User
from app.schemas.recurring_expense import RecurringExpenseCreate, RecurringExpenseOut, RecurringExpensePatch
from app.services import calendar_service

router = APIRouter(prefix="/admin/recurring-expenses", tags=["recurring-expenses"])
_log = logging.getLogger(__name__)

_DUE_WINDOW_DAYS = 7


def _advance_date(current: date, interval_value: int, interval_unit: str) -> date:
    if interval_unit == "days":
        return current + timedelta(days=interval_value)
    if interval_unit == "weeks":
        return current + timedelta(weeks=interval_value)
    return (datetime.combine(current, datetime.min.time()) + relativedelta(months=interval_value)).date()


def _out(rec: RecurringExpense) -> RecurringExpenseOut:
    return RecurringExpenseOut.model_validate(rec)


@router.get("", response_model=list[RecurringExpenseOut])
async def list_recurring_expenses(
    city_id: str | None = None,
    is_active: bool | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    effective_city_id = city_scope(current_user, city_id)
    stmt = select(RecurringExpense).order_by(
        RecurringExpense.is_active.desc(), RecurringExpense.name
    )
    if effective_city_id:
        stmt = stmt.where(RecurringExpense.city_id == effective_city_id)
    if is_active is not None:
        stmt = stmt.where(RecurringExpense.is_active == is_active)
    rows = (await db.execute(stmt)).scalars().all()
    return [_out(r) for r in rows]


@router.get("/due", response_model=list[RecurringExpenseOut])
async def list_due_recurring_expenses(
    city_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    effective_city_id = city_scope(current_user, city_id)
    cutoff = date.today() + timedelta(days=_DUE_WINDOW_DAYS)
    stmt = (
        select(RecurringExpense)
        .where(RecurringExpense.is_active == True)  # noqa: E712
        .where(RecurringExpense.next_due_date <= cutoff)
        .order_by(RecurringExpense.next_due_date)
    )
    if effective_city_id:
        stmt = stmt.where(RecurringExpense.city_id == effective_city_id)
    rows = (await db.execute(stmt)).scalars().all()
    return [_out(r) for r in rows]


@router.post("", response_model=RecurringExpenseOut, status_code=201)
async def create_recurring_expense(
    data: RecurringExpenseCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    city_id = data.city_id or current_user.city_id or ""
    rec = RecurringExpense(
        city_id=city_id,
        name=data.name,
        category=data.category,
        amount_cents=data.amount_cents,
        payment_method=data.payment_method,
        vendor_customer=data.vendor_customer,
        description=data.description,
        interval_value=data.interval_value,
        interval_unit=data.interval_unit,
        next_due_date=data.next_due_date,
        created_by=current_user.id,
    )
    db.add(rec)
    await db.commit()
    await db.refresh(rec)
    # GCal — non-fatal
    event_id = await calendar_service.create_recurring_expense_event(
        db, city_id, rec.name, rec.amount_cents, rec.category, rec.next_due_date
    )
    if event_id:
        rec.google_calendar_event_id = event_id
        await db.commit()
        await db.refresh(rec)
    return _out(rec)


@router.patch("/{rec_id}", response_model=RecurringExpenseOut)
async def patch_recurring_expense(
    rec_id: str,
    data: RecurringExpensePatch,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    result = await db.execute(select(RecurringExpense).where(RecurringExpense.id == rec_id))
    rec = result.scalar_one_or_none()
    if rec is None:
        raise HTTPException(status_code=404, detail="Recurring expense not found")

    name_changed = data.name is not None and data.name != rec.name
    date_changed = data.next_due_date is not None and data.next_due_date != rec.next_due_date
    was_active = rec.is_active
    going_inactive = data.is_active is False and was_active
    going_active = data.is_active is True and not was_active

    for field in data.model_fields_set:
        setattr(rec, field, getattr(data, field))
    rec.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(rec)

    # GCal sync — non-fatal
    if going_inactive and rec.google_calendar_event_id:
        await calendar_service.delete_event(db, rec.google_calendar_event_id, rec.city_id)
        rec.google_calendar_event_id = None
        await db.commit()
        await db.refresh(rec)
    elif going_active:
        event_id = await calendar_service.create_recurring_expense_event(
            db, rec.city_id, rec.name, rec.amount_cents, rec.category, rec.next_due_date
        )
        if event_id:
            rec.google_calendar_event_id = event_id
            await db.commit()
            await db.refresh(rec)
    elif (name_changed or date_changed) and rec.google_calendar_event_id:
        await calendar_service.update_recurring_expense_event(
            db, rec.google_calendar_event_id, rec.city_id, rec.name, rec.amount_cents, rec.category, rec.next_due_date
        )

    return _out(rec)


@router.delete("/{rec_id}", status_code=200)
async def delete_recurring_expense(
    rec_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    result = await db.execute(select(RecurringExpense).where(RecurringExpense.id == rec_id))
    rec = result.scalar_one_or_none()
    if rec is None:
        raise HTTPException(status_code=404, detail="Recurring expense not found")
    if rec.google_calendar_event_id:
        await calendar_service.delete_event(db, rec.google_calendar_event_id, rec.city_id)
    await db.delete(rec)
    await db.commit()
    return {"deleted": True}


@router.post("/{rec_id}/log", response_model=dict)
async def log_recurring_expense(
    rec_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    result = await db.execute(select(RecurringExpense).where(RecurringExpense.id == rec_id))
    rec = result.scalar_one_or_none()
    if rec is None:
        raise HTTPException(status_code=404, detail="Recurring expense not found")

    # 1. Create FinanceTransaction
    tx = FinanceTransaction(
        city_id=rec.city_id,
        occurred_on=rec.next_due_date,
        transaction_type=FinanceTransactionType.expense,
        category=rec.category,
        amount_cents=rec.amount_cents,
        payment_method=rec.payment_method,
        vendor_customer=rec.vendor_customer,
        description=rec.description,
        created_by=current_user.id,
    )
    db.add(tx)

    # 2. Advance next_due_date
    old_event_id = rec.google_calendar_event_id
    rec.next_due_date = _advance_date(rec.next_due_date, rec.interval_value, rec.interval_unit)
    rec.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(tx)
    await db.refresh(rec)

    # 3. Move GCal event — non-fatal
    gcal_warning: str | None = None
    if old_event_id:
        deleted = await calendar_service.delete_event(db, old_event_id, rec.city_id)
        if not deleted:
            gcal_warning = "Google Calendar event could not be updated"
    new_event_id = await calendar_service.create_recurring_expense_event(
        db, rec.city_id, rec.name, rec.amount_cents, rec.category, rec.next_due_date
    )
    if new_event_id:
        rec.google_calendar_event_id = new_event_id
        await db.commit()
        await db.refresh(rec)

    return {
        "transaction_id": tx.id,
        "next_due_date": rec.next_due_date.isoformat(),
        "gcal_warning": gcal_warning,
    }
