from __future__ import annotations

import hashlib
import hmac
import logging
import os
import uuid
from base64 import b64encode
from datetime import datetime, timezone
from typing import Optional

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.lead_payment import LeadPayment

logger = logging.getLogger(__name__)

# ── Square config ──────────────────────────────────────────────────────────
# Wire these in your .env file:
#
#   SQUARE_ACCESS_TOKEN=<from Square Developer Dashboard>
#   SQUARE_ENVIRONMENT=sandbox          # or "production"
#   SQUARE_LOCATION_ID=<your default location>
#   SQUARE_WEBHOOK_SIGNATURE_KEY=<from Square Developer Dashboard → Webhooks>
#   SQUARE_NOTIFICATION_URL=https://yourserver.com/square/webhook
#
# Per-city location IDs: add square_location_id to the City model and pass
# it here; falls back to SQUARE_LOCATION_ID when not set.

SQUARE_ENVIRONMENTS = {
    "sandbox": "https://connect.squareupsandbox.com",
    "production": "https://connect.squareup.com",
}

SQUARE_API_VERSION = "2024-01-17"


def _base_url() -> str:
    env = os.environ.get("SQUARE_ENVIRONMENT", "sandbox")
    return SQUARE_ENVIRONMENTS.get(env, SQUARE_ENVIRONMENTS["sandbox"])


def _access_token() -> str:
    return os.environ.get("SQUARE_ACCESS_TOKEN", "")


def _location_id(city_location_id: str | None = None) -> str:
    return city_location_id or os.environ.get("SQUARE_LOCATION_ID", "")


def is_configured() -> bool:
    return bool(_access_token() and _location_id())


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {_access_token()}",
        "Square-Version": SQUARE_API_VERSION,
        "Content-Type": "application/json",
    }


# ── Payment link creation ──────────────────────────────────────────────────

async def create_payment_link(
    amount_cents: int,
    description: str,
    city_location_id: str | None = None,
) -> dict:
    """
    Creates a Square payment link.

    Returns:
        {
            "payment_link_id": str,
            "url": str,
            "order_id": str,
        }

    Raises:
        RuntimeError if Square is not configured or the API call fails.
    """
    if not is_configured():
        raise RuntimeError(
            "Square is not configured. Set SQUARE_ACCESS_TOKEN, "
            "SQUARE_LOCATION_ID, and SQUARE_ENVIRONMENT in your .env file."
        )

    location = _location_id(city_location_id)
    idempotency_key = str(uuid.uuid4())

    payload = {
        "idempotency_key": idempotency_key,
        "order": {
            "location_id": location,
            "line_items": [
                {
                    "name": description,
                    "quantity": "1",
                    "base_price_money": {
                        "amount": amount_cents,
                        "currency": "USD",
                    },
                }
            ],
        },
        "checkout_options": {
            "allow_tipping": False,
            "ask_for_shipping_address": False,
        },
    }

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{_base_url()}/v2/online-checkout/payment-links",
            headers=_headers(),
            json=payload,
            timeout=15,
        )

    if not resp.is_success:
        logger.error("Square payment link creation failed: %s %s", resp.status_code, resp.text)
        raise RuntimeError(f"Square API error {resp.status_code}: {resp.text}")

    data = resp.json()
    link = data["payment_link"]
    return {
        "payment_link_id": link["id"],
        "url": link["url"],
        "order_id": link.get("order_id", ""),
    }


# ── Webhook signature verification ────────────────────────────────────────

def verify_webhook_signature(body: bytes, signature_header: str) -> bool:
    """
    Verifies the x-square-hmacsha256-signature header from Square.
    Returns True if the signature is valid.
    """
    sig_key = os.environ.get("SQUARE_WEBHOOK_SIGNATURE_KEY", "")
    notification_url = os.environ.get("SQUARE_NOTIFICATION_URL", "")

    if not sig_key:
        logger.warning("SQUARE_WEBHOOK_SIGNATURE_KEY not set — skipping signature check")
        return True  # skip in dev; set the key in prod

    combined = notification_url.encode() + body
    expected = b64encode(
        hmac.new(sig_key.encode(), combined, hashlib.sha256).digest()
    ).decode()
    return hmac.compare_digest(expected, signature_header)


# ── Webhook event handler ──────────────────────────────────────────────────

async def handle_payment_event(db: AsyncSession, event: dict) -> None:
    """
    Processes incoming Square webhook events and updates the payment record.

    Supported event types:
        payment.updated  — covers COMPLETED, FAILED, CANCELED states
        refund.created   — marks payment as refunded
    """
    event_type = event.get("type", "")
    data = event.get("data", {}).get("object", {})

    if event_type == "payment.updated":
        payment_obj = data.get("payment", {})
        square_payment_id = payment_obj.get("id")
        order_id = payment_obj.get("order_id")
        sq_status = payment_obj.get("status")  # COMPLETED | FAILED | CANCELED

        if not order_id:
            return

        result = await db.execute(
            select(LeadPayment).where(LeadPayment.square_order_id == order_id).limit(1)
        )
        payment = result.scalar_one_or_none()
        if not payment:
            logger.warning("No LeadPayment found for Square order_id %s", order_id)
            return

        payment.square_payment_id = square_payment_id

        if sq_status == "COMPLETED":
            payment.status = "paid"
            payment.paid_at = datetime.now(timezone.utc).replace(tzinfo=None)
            # Auto-advance lead to booked if not already
            await _maybe_advance_to_booked(db, payment.lead_id)
        elif sq_status == "FAILED":
            payment.status = "failed"
        elif sq_status == "CANCELED":
            payment.status = "cancelled"

        await db.commit()

    elif event_type == "refund.created":
        refund = data.get("refund", {})
        square_payment_id = refund.get("payment_id")
        if not square_payment_id:
            return

        result = await db.execute(
            select(LeadPayment).where(
                LeadPayment.square_payment_id == square_payment_id
            ).limit(1)
        )
        payment = result.scalar_one_or_none()
        if payment:
            payment.status = "refunded"
            await db.commit()


async def _maybe_advance_to_booked(db: AsyncSession, lead_id: str) -> None:
    from app.models.lead import Lead, LeadStatus
    result = await db.execute(select(Lead).where(Lead.id == lead_id).limit(1))
    lead = result.scalar_one_or_none()
    if lead and lead.status not in (LeadStatus.booked, LeadStatus.released, LeadStatus.lost):
        lead.status = LeadStatus.booked
        lead.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)


# ── Payment request helper (used by router) ────────────────────────────────

async def request_payment(
    db: AsyncSession,
    lead_id: str,
    amount_cents: int,
    payment_type: str,
    customer_name: Optional[str],
    phone: str,
    created_by: str,
    city_location_id: str | None = None,
) -> LeadPayment:
    """Creates a Square payment link, stores the record, and sends the SMS."""
    description = f"Holy Hauling - {customer_name or 'Moving Service'}"
    link_data = await create_payment_link(amount_cents, description, city_location_id)

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    payment = LeadPayment(
        lead_id=lead_id,
        amount_cents=amount_cents,
        payment_type=payment_type,
        status="pending",
        square_order_id=link_data["order_id"],
        square_payment_link_id=link_data["payment_link_id"],
        square_location_id=_location_id(city_location_id),
        payment_link_url=link_data["url"],
        sent_to_phone=phone,
        sent_at=now,
        created_by=created_by,
    )
    db.add(payment)
    await db.commit()
    await db.refresh(payment)

    # Fire SMS via existing Twilio helper
    _send_payment_sms(phone, link_data["url"], amount_cents, customer_name)

    return payment


def _normalize_phone(phone: str) -> str:
    digits = "".join(c for c in phone if c.isdigit())
    if len(digits) == 10:
        digits = "1" + digits
    return f"+{digits}" if not phone.startswith("+") else phone


def _send_payment_sms(phone: str, url: str, amount_cents: int, name: Optional[str]) -> None:
    from app.services.alert_service import _send_sms
    normalized = _normalize_phone(phone)
    dollars = amount_cents / 100
    greeting = f"Hi {name}," if name else "Hi,"
    msg = (
        f"{greeting} your Holy Hauling quote is ready! "
        f"Total: ${dollars:,.2f}. "
        f"Click here to pay securely: {url}"
    )
    err = _send_sms(normalized, msg)
    if err:
        logger.error("Payment SMS failed to %s: %s", normalized, err)
