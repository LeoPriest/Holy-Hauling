from __future__ import annotations

import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_auth
from app.models.lead import Lead
from app.models.lead_payment import LeadPayment
from app.models.user import User
from app.schemas.payment import PaymentOut, PaymentRequestCreate
from app.services import square_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["payments"])


# ── Webhook (public — Square calls this) ───────────────────────────────────

@router.post("/square/webhook", include_in_schema=False)
async def square_webhook(
    request: Request,
    x_square_hmacsha256_signature: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    body = await request.body()

    if not square_service.verify_webhook_signature(
        body, x_square_hmacsha256_signature or ""
    ):
        raise HTTPException(status_code=400, detail="Invalid Square signature")

    try:
        event = json.loads(body)
        await square_service.handle_payment_event(db, event)
    except Exception:
        logger.exception("Error processing Square webhook")
        # Always return 200 to Square so it does not retry indefinitely
    return Response(status_code=200)


# ── Payment request (authenticated) ───────────────────────────────────────

@router.post("/leads/{lead_id}/payment-request", response_model=PaymentOut, status_code=201)
async def request_payment(
    lead_id: str,
    payload: PaymentRequestCreate,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Lead).where(Lead.id == lead_id).limit(1))
    lead = result.scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    # Determine amount
    if payload.amount_override_cents is not None:
        amount_cents = payload.amount_override_cents
    elif lead.quoted_price_total is not None:
        amount_cents = round(lead.quoted_price_total * 100)
    else:
        raise HTTPException(
            status_code=422,
            detail="No quote amount set on this lead. Set a quoted price first.",
        )

    phone = payload.phone_override or lead.customer_phone
    if not phone:
        raise HTTPException(
            status_code=422,
            detail="No customer phone number on this lead.",
        )

    if not square_service.is_configured():
        raise HTTPException(
            status_code=503,
            detail=(
                "Square is not configured. Add SQUARE_ACCESS_TOKEN, "
                "SQUARE_LOCATION_ID, and SQUARE_ENVIRONMENT to your .env file."
            ),
        )

    payment = await square_service.request_payment(
        db=db,
        lead_id=lead_id,
        amount_cents=amount_cents,
        payment_type=payload.payment_type,
        customer_name=lead.customer_name,
        phone=phone,
        created_by=current_user.username,
    )
    return payment


# ── Payment status (authenticated) ────────────────────────────────────────

@router.get("/leads/{lead_id}/payment", response_model=PaymentOut | None)
async def get_payment(
    lead_id: str,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(LeadPayment)
        .where(LeadPayment.lead_id == lead_id)
        .order_by(LeadPayment.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


# ── Cancel / void a pending payment link ──────────────────────────────────

@router.delete("/leads/{lead_id}/payment", status_code=204)
async def cancel_payment(
    lead_id: str,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(LeadPayment)
        .where(LeadPayment.lead_id == lead_id, LeadPayment.status == "pending")
        .limit(1)
    )
    payment = result.scalar_one_or_none()
    if payment:
        payment.status = "cancelled"
        await db.commit()
    return Response(status_code=204)
