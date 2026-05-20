from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import city_scope, require_auth, require_role
from app.models.lead import Lead
from app.models.pay_record import PayRecord, PayType
from app.models.user import User
from app.schemas.pay_record import (
    PayRecordOut,
    PayRecordUpsert,
    PayrollJobEntry,
    PayrollUserSummary,
)

router = APIRouter(tags=["payroll"])
lead_router = APIRouter(prefix="/leads/{lead_id}/pay-records")
admin_router = APIRouter(prefix="/admin/payroll")


def _compute_amount(pay_type: PayType, data: PayRecordUpsert, lead: Lead, user: User) -> int:
    if pay_type == PayType.facilitator_pct:
        if lead.quote_cents is None:
            raise HTTPException(
                status_code=422,
                detail="Lead must have quote_cents set to use facilitator_pct pay type",
            )
        return round(lead.quote_cents * 0.10)
    if pay_type == PayType.hourly:
        if user.hourly_rate_cents is None:
            raise HTTPException(
                status_code=422,
                detail="User must have hourly_rate_cents set to use hourly pay type",
            )
        if data.hours_worked is None or data.hours_worked <= 0:
            raise HTTPException(
                status_code=422,
                detail="hours_worked must be > 0 for hourly pay type",
            )
        return round(data.hours_worked * user.hourly_rate_cents)
    # flat
    if data.override_amount_cents is None or data.override_amount_cents < 0:
        raise HTTPException(
            status_code=422,
            detail="override_amount_cents must be >= 0 for flat pay type",
        )
    return data.override_amount_cents


def _record_out(record: PayRecord) -> PayRecordOut:
    user = record.user
    return PayRecordOut.model_validate({
        "id": record.id,
        "lead_id": record.lead_id,
        "user_id": record.user_id,
        "user_username": user.username if user else "",
        "user_hourly_rate_cents": user.hourly_rate_cents if user else None,
        "pay_type": record.pay_type,
        "hours_worked": record.hours_worked,
        "override_amount_cents": record.override_amount_cents,
        "amount_cents": record.amount_cents,
        "note": record.note,
        "created_at": record.created_at.isoformat(),
        "updated_at": record.updated_at.isoformat(),
    })


# -- Per-lead endpoints -------------------------------------------------------

@lead_router.get("", response_model=list[PayRecordOut])
async def list_pay_records(
    lead_id: str,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(require_auth),
):
    result = await db.execute(
        select(PayRecord)
        .options(selectinload(PayRecord.user))
        .where(PayRecord.lead_id == lead_id)
        .order_by(PayRecord.created_at)
    )
    return [_record_out(r) for r in result.scalars().all()]


@lead_router.post("", response_model=PayRecordOut)
async def upsert_pay_record(
    lead_id: str,
    data: PayRecordUpsert,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(require_auth),
):
    lead_result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = lead_result.scalar_one_or_none()
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")

    user_result = await db.execute(select(User).where(User.id == data.user_id))
    user = user_result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    amount = _compute_amount(data.pay_type, data, lead, user)

    existing_result = await db.execute(
        select(PayRecord).where(
            PayRecord.lead_id == lead_id,
            PayRecord.user_id == data.user_id,
        )
    )
    record = existing_result.scalar_one_or_none()

    if record is None:
        record = PayRecord(lead_id=lead_id, user_id=data.user_id)
        db.add(record)

    record.pay_type = data.pay_type
    record.hours_worked = data.hours_worked
    record.override_amount_cents = data.override_amount_cents
    record.amount_cents = amount
    record.note = data.note
    record.updated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(record)

    # Re-fetch with user loaded
    result = await db.execute(
        select(PayRecord)
        .options(selectinload(PayRecord.user))
        .where(PayRecord.id == record.id)
    )
    record = result.scalar_one()
    return _record_out(record)


@lead_router.delete("/{record_id}", status_code=200)
async def delete_pay_record(
    lead_id: str,
    record_id: str,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(require_auth),
):
    result = await db.execute(
        select(PayRecord).where(
            PayRecord.id == record_id,
            PayRecord.lead_id == lead_id,
        )
    )
    record = result.scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="Pay record not found")
    await db.delete(record)
    await db.commit()
    return {"deleted": True}


# -- Admin aggregation endpoint -----------------------------------------------

@admin_router.get("", response_model=list[PayrollUserSummary])
async def admin_payroll_summary(
    city_id: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin", "facilitator")),
):
    effective_city_id = city_scope(current_user, city_id)

    stmt = (
        select(PayRecord)
        .options(selectinload(PayRecord.user), selectinload(PayRecord.lead))
        .join(Lead, PayRecord.lead_id == Lead.id)
        .order_by(PayRecord.user_id, Lead.job_date_requested)
    )

    if effective_city_id:
        stmt = stmt.where(Lead.city_id == effective_city_id)

    if date_from is not None:
        stmt = stmt.where(
            Lead.job_date_requested >= date_from,
            Lead.job_date_requested.isnot(None),
        )
    if date_to is not None:
        stmt = stmt.where(
            Lead.job_date_requested <= date_to,
            Lead.job_date_requested.isnot(None),
        )

    result = await db.execute(stmt)
    records = result.scalars().all()

    # Group by user
    user_map: dict[str, dict] = {}
    for record in records:
        uid = record.user_id
        if uid not in user_map:
            user_map[uid] = {
                "user_id": uid,
                "username": record.user.username if record.user else "",
                "total_amount_cents": 0,
                "record_count": 0,
                "jobs": [],
            }
        user_map[uid]["total_amount_cents"] += record.amount_cents
        user_map[uid]["record_count"] += 1
        lead = record.lead
        user_map[uid]["jobs"].append(PayrollJobEntry(
            lead_id=record.lead_id,
            customer_name=lead.customer_name if lead else None,
            job_date_requested=lead.job_date_requested if lead else None,
            amount_cents=record.amount_cents,
            pay_type=record.pay_type,
        ))

    return [PayrollUserSummary(**v) for v in user_map.values()]


# -- Wire sub-routers ---------------------------------------------------------

router.include_router(lead_router)
router.include_router(admin_router)
