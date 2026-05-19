from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import city_scope, require_auth, require_role
from app.models.lead import Lead
from app.models.truck_rental import TruckRental
from app.models.user import User
from app.schemas.truck_rental import TruckRentalOut, TruckRentalUpsert

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_UPLOAD_DIR = os.environ.get("UPLOADS_DIR") or os.path.join(_BASE_DIR, "..", "..", "uploads")
RECEIPTS_DIR = os.path.join(_UPLOAD_DIR, "receipts")

router = APIRouter(tags=["truck-rental"])


async def _get_lead_or_404(db: AsyncSession, lead_id: str) -> Lead:
    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead


async def _get_rental_or_404(db: AsyncSession, lead_id: str) -> TruckRental:
    result = await db.execute(select(TruckRental).where(TruckRental.lead_id == lead_id))
    rental = result.scalar_one_or_none()
    if rental is None:
        raise HTTPException(status_code=404, detail="No truck rental for this lead")
    return rental


def _rental_out(rental: TruckRental) -> TruckRentalOut:
    lead = rental.lead
    return TruckRentalOut.model_validate(rental).model_copy(update={
        "lead_customer_name": lead.customer_name if lead else None,
        "lead_job_date_requested": lead.job_date_requested if lead else None,
    })


# -- Per-lead endpoints -------------------------------------------------------

lead_router = APIRouter(prefix="/leads/{lead_id}/rental")


@lead_router.get("", response_model=TruckRentalOut)
async def get_rental(
    lead_id: str,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(require_auth),
):
    result = await db.execute(
        select(TruckRental)
        .options(selectinload(TruckRental.lead))
        .where(TruckRental.lead_id == lead_id)
    )
    rental = result.scalar_one_or_none()
    if rental is None:
        raise HTTPException(status_code=404, detail="No truck rental for this lead")
    return _rental_out(rental)


@lead_router.post("", response_model=TruckRentalOut)
async def upsert_rental(
    lead_id: str,
    data: TruckRentalUpsert,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(require_auth),
):
    await _get_lead_or_404(db, lead_id)
    result = await db.execute(
        select(TruckRental)
        .options(selectinload(TruckRental.lead))
        .where(TruckRental.lead_id == lead_id)
    )
    rental = result.scalar_one_or_none()
    if rental is None:
        rental = TruckRental(lead_id=lead_id)
        db.add(rental)
    for field, value in data.model_dump().items():
        setattr(rental, field, value)
    rental.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(rental)
    # Re-fetch with lead relationship loaded
    result = await db.execute(
        select(TruckRental)
        .options(selectinload(TruckRental.lead))
        .where(TruckRental.id == rental.id)
    )
    rental = result.scalar_one()
    return _rental_out(rental)


@lead_router.delete("", status_code=200)
async def delete_rental(
    lead_id: str,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(require_auth),
):
    rental = await _get_rental_or_404(db, lead_id)
    # Delete receipt file if present
    if rental.receipt_url:
        receipt_path = Path(RECEIPTS_DIR).parent / rental.receipt_url
        receipt_path.unlink(missing_ok=True)
    await db.delete(rental)
    await db.commit()
    return {"deleted": True}


@lead_router.post("/receipt", response_model=TruckRentalOut)
async def upload_receipt(
    lead_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(require_auth),
):
    result = await db.execute(
        select(TruckRental)
        .options(selectinload(TruckRental.lead))
        .where(TruckRental.lead_id == lead_id)
    )
    rental = result.scalar_one_or_none()
    if rental is None:
        raise HTTPException(status_code=404, detail="No truck rental for this lead")
    # Delete old receipt if present
    if rental.receipt_url:
        old_path = Path(RECEIPTS_DIR).parent / rental.receipt_url
        old_path.unlink(missing_ok=True)
    ext = Path(file.filename or "receipt").suffix or ".jpg"
    filename = f"{uuid.uuid4()}{ext}"
    dest = Path(RECEIPTS_DIR) / filename
    os.makedirs(RECEIPTS_DIR, exist_ok=True)
    content = await file.read()
    dest.write_bytes(content)
    rental.receipt_url = f"receipts/{filename}"
    rental.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(rental)
    result = await db.execute(
        select(TruckRental)
        .options(selectinload(TruckRental.lead))
        .where(TruckRental.id == rental.id)
    )
    rental = result.scalar_one()
    return _rental_out(rental)


@lead_router.delete("/receipt", response_model=TruckRentalOut)
async def delete_receipt(
    lead_id: str,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(require_auth),
):
    result = await db.execute(
        select(TruckRental)
        .options(selectinload(TruckRental.lead))
        .where(TruckRental.lead_id == lead_id)
    )
    rental = result.scalar_one_or_none()
    if rental is None:
        raise HTTPException(status_code=404, detail="No truck rental for this lead")
    if rental.receipt_url:
        receipt_path = Path(RECEIPTS_DIR).parent / rental.receipt_url
        receipt_path.unlink(missing_ok=True)
        rental.receipt_url = None
        rental.updated_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(rental)
        result = await db.execute(
            select(TruckRental)
            .options(selectinload(TruckRental.lead))
            .where(TruckRental.id == rental.id)
        )
        rental = result.scalar_one()
    return _rental_out(rental)


# -- Admin list endpoint ------------------------------------------------------

admin_rental_router = APIRouter(prefix="/admin/rentals")


@admin_rental_router.get("", response_model=list[TruckRentalOut])
async def list_rentals(
    status: str | None = None,
    city_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    from app.models.truck_rental import TruckRentalStatus
    effective_city_id = city_scope(current_user, city_id)
    stmt = (
        select(TruckRental)
        .options(selectinload(TruckRental.lead))
        .join(Lead, TruckRental.lead_id == Lead.id)
        .order_by(TruckRental.created_at.desc())
    )
    if status:
        try:
            stmt = stmt.where(TruckRental.status == TruckRentalStatus(status))
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Invalid status: {status}")
    if effective_city_id:
        stmt = stmt.where(Lead.city_id == effective_city_id)
    result = await db.execute(stmt)
    return [_rental_out(r) for r in result.scalars().all()]


# Combine both sub-routers into one export
router.include_router(lead_router)
router.include_router(admin_rental_router)
