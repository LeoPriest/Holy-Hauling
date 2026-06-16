from __future__ import annotations

import base64
import json
import os
import uuid
from datetime import date, datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import city_scope, require_auth, require_role
from app.models.finance import FinanceTransaction, FinanceTransactionType
from app.models.lead import Lead
from app.models.truck_rental import TruckRental, TruckRentalStatus
from app.models.user import User
from app.schemas.truck_rental import RentalConfirmationExtract, TruckRentalOut, TruckRentalUpsert
from app.services import ocr_service

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_UPLOAD_DIR = os.environ.get("UPLOADS_DIR") or os.path.join(_BASE_DIR, "..", "..", "uploads")
RECEIPTS_DIR = os.path.join(_UPLOAD_DIR, "receipts")
CONFIRMATIONS_DIR = os.path.join(_UPLOAD_DIR, "confirmations")

_CONFIRMATION_PROMPT = """
You are reading a U-Haul (or similar truck rental) booking confirmation screenshot.
Extract the rental details. Return ONLY a JSON object — no markdown, no extra text:
{
  "confirmation_number": "<booking/confirmation/order number, or null>",
  "truck_size": "10ft|15ft|20ft|26ft, or null",
  "rental_cost": <total cost in dollars as a number, or null>,
  "pickup_location": "<pickup branch address, or null>",
  "dropoff_location": "<return branch address if shown and different from pickup, or null>",
  "pickup_datetime": "YYYY-MM-DDTHH:MM, or null",
  "dropoff_datetime": "YYYY-MM-DDTHH:MM, or null",
  "one_way": true or false,
  "estimated_miles": <number, or null>
}
Use null for anything you cannot read. Output only the JSON object.
""".strip()

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".pdf", ".webp"}
MAX_RECEIPT_BYTES = 10 * 1024 * 1024  # 10 MB

router = APIRouter(tags=["truck-rental"])


async def _get_lead_or_404(db: AsyncSession, lead_id: str) -> Lead:
    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead


async def _get_rental_or_404(db: AsyncSession, lead_id: str) -> TruckRental:
    result = await db.execute(
        select(TruckRental)
        .options(selectinload(TruckRental.lead))
        .where(TruckRental.lead_id == lead_id)
    )
    rental = result.scalar_one_or_none()
    if rental is None:
        raise HTTPException(status_code=404, detail="No truck rental for this lead")
    return rental


def _receipt_disk_path(receipt_url: str) -> Path:
    """Resolve the absolute disk path for a stored receipt_url."""
    return Path(RECEIPTS_DIR) / Path(receipt_url).name


def _confirmation_disk_path(confirmation_url: str) -> Path:
    """Resolve the absolute disk path for a stored confirmation_url."""
    return Path(CONFIRMATIONS_DIR) / Path(confirmation_url).name


async def _sync_rental_expense(db: AsyncSession, rental: TruckRental, lead: Lead) -> None:
    """Keep a single lead-linked 'Truck Rental' finance expense in sync with the rental cost."""
    cost = rental.rental_cost_cents

    async def _load_tx() -> FinanceTransaction | None:
        if not rental.finance_transaction_id:
            return None
        res = await db.execute(
            select(FinanceTransaction).where(FinanceTransaction.id == rental.finance_transaction_id)
        )
        return res.scalar_one_or_none()

    # No (or zero) cost -> drop any linked expense
    if not cost or cost <= 0:
        tx = await _load_tx()
        if tx is not None:
            await db.delete(tx)
        rental.finance_transaction_id = None
        return

    occurred = rental.pickup_datetime.date() if rental.pickup_datetime else date.today()
    description = " · ".join(p for p in (rental.truck_size, rental.confirmation_number) if p) or None

    tx = await _load_tx()
    if tx is None:
        tx = FinanceTransaction(
            city_id=lead.city_id,
            transaction_type=FinanceTransactionType.expense,
            category="Truck Rental",
            lead_id=lead.id,
            amount_cents=cost,
            occurred_on=occurred,
            vendor_customer="U-Haul",
            description=description,
        )
        db.add(tx)
        await db.flush()  # assign tx.id
        rental.finance_transaction_id = tx.id
    else:
        tx.amount_cents = cost
        tx.occurred_on = occurred
        tx.vendor_customer = "U-Haul"
        tx.description = description
        tx.updated_at = datetime.now(timezone.utc)


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
    lead = await _get_lead_or_404(db, lead_id)
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
    await _sync_rental_expense(db, rental, lead)
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
    # Remove the linked finance expense, if any
    if rental.finance_transaction_id:
        tx_result = await db.execute(
            select(FinanceTransaction).where(FinanceTransaction.id == rental.finance_transaction_id)
        )
        tx = tx_result.scalar_one_or_none()
        if tx is not None:
            await db.delete(tx)
    # Delete uploaded files if present
    if rental.receipt_url:
        _receipt_disk_path(rental.receipt_url).unlink(missing_ok=True)
    if rental.confirmation_url:
        _confirmation_disk_path(rental.confirmation_url).unlink(missing_ok=True)
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
        _receipt_disk_path(rental.receipt_url).unlink(missing_ok=True)
    raw_ext = Path(file.filename or "").suffix.lower()
    ext = raw_ext if raw_ext in ALLOWED_EXTENSIONS else ".jpg"
    filename = f"{uuid.uuid4()}{ext}"
    dest = Path(RECEIPTS_DIR) / filename
    content = await file.read(MAX_RECEIPT_BYTES + 1)
    if len(content) > MAX_RECEIPT_BYTES:
        raise HTTPException(status_code=413, detail="Receipt file too large (max 10 MB)")
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
        _receipt_disk_path(rental.receipt_url).unlink(missing_ok=True)
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


# -- Confirmation screenshot + OCR -------------------------------------------

@lead_router.post("/confirmation", response_model=TruckRentalOut)
async def upload_confirmation(
    lead_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(require_auth),
):
    rental = await _get_rental_or_404(db, lead_id)
    os.makedirs(CONFIRMATIONS_DIR, exist_ok=True)
    if rental.confirmation_url:
        _confirmation_disk_path(rental.confirmation_url).unlink(missing_ok=True)
    raw_ext = Path(file.filename or "").suffix.lower()
    ext = raw_ext if raw_ext in ALLOWED_EXTENSIONS else ".jpg"
    filename = f"{uuid.uuid4()}{ext}"
    dest = Path(CONFIRMATIONS_DIR) / filename
    content = await file.read(MAX_RECEIPT_BYTES + 1)
    if len(content) > MAX_RECEIPT_BYTES:
        raise HTTPException(status_code=413, detail="Confirmation file too large (max 10 MB)")
    dest.write_bytes(content)
    rental.confirmation_url = f"confirmations/{filename}"
    rental.updated_at = datetime.now(timezone.utc)
    await db.commit()
    result = await db.execute(
        select(TruckRental).options(selectinload(TruckRental.lead)).where(TruckRental.id == rental.id)
    )
    return _rental_out(result.scalar_one())


@lead_router.post("/confirmation/extract", response_model=RentalConfirmationExtract)
async def extract_confirmation(
    lead_id: str,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(require_auth),
):
    rental = await _get_rental_or_404(db, lead_id)
    if not rental.confirmation_url:
        raise HTTPException(status_code=400, detail="No confirmation screenshot to extract from")
    api_key = ocr_service._require_api_key()
    model = ocr_service._require_model()
    image_path = _confirmation_disk_path(rental.confirmation_url)
    if not image_path.exists():
        raise HTTPException(status_code=422, detail="Confirmation image not found on disk")
    media_type = ocr_service._EXT_TO_MEDIA_TYPE.get(image_path.suffix.lower(), "image/jpeg")
    b64 = base64.standard_b64encode(image_path.read_bytes()).decode()
    try:
        client = ocr_service._make_client(api_key)
        response = await client.messages.create(
            model=model,
            max_tokens=800,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}},
                    {"type": "text", "text": _CONFIRMATION_PROMPT},
                ],
            }],
        )
        raw = ocr_service._strip_fence(response.content[0].text)
        parsed = json.loads(raw)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Confirmation extraction failed: {exc}") from exc

    if not isinstance(parsed, dict):
        raise HTTPException(status_code=502, detail="AI returned an unexpected shape")

    cost = parsed.get("rental_cost")
    cents = round(cost * 100) if isinstance(cost, (int, float)) else None
    payload = {
        "confirmation_number": parsed.get("confirmation_number"),
        "truck_size": parsed.get("truck_size"),
        "rental_cost_cents": cents,
        "pickup_location": parsed.get("pickup_location"),
        "dropoff_location": parsed.get("dropoff_location"),
        "pickup_datetime": parsed.get("pickup_datetime"),
        "dropoff_datetime": parsed.get("dropoff_datetime"),
        "one_way": parsed.get("one_way"),
        "estimated_miles": parsed.get("estimated_miles"),
    }
    try:
        return RentalConfirmationExtract.model_validate(payload)
    except ValidationError as exc:
        raise HTTPException(status_code=502, detail=f"AI returned invalid rental fields: {exc}") from exc


@lead_router.delete("/confirmation", response_model=TruckRentalOut)
async def delete_confirmation(
    lead_id: str,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(require_auth),
):
    rental = await _get_rental_or_404(db, lead_id)
    if rental.confirmation_url:
        _confirmation_disk_path(rental.confirmation_url).unlink(missing_ok=True)
        rental.confirmation_url = None
        rental.updated_at = datetime.now(timezone.utc)
        await db.commit()
    result = await db.execute(
        select(TruckRental).options(selectinload(TruckRental.lead)).where(TruckRental.id == rental.id)
    )
    return _rental_out(result.scalar_one())


# -- Admin list endpoint ------------------------------------------------------

admin_rental_router = APIRouter(prefix="/admin/rentals")


@admin_rental_router.get("", response_model=list[TruckRentalOut])
async def list_rentals(
    status: str | None = None,
    city_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin", "facilitator")),
):
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
