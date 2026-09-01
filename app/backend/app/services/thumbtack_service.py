from __future__ import annotations

import base64
import binascii
import hmac
import json
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.lead import Lead, LeadSourceType, LeadStatus
from app.models.thumbtack import ThumbtackConnection, ThumbtackWebhookEvent
from app.services import auth_service, lead_cost_service, lead_service, push_service
from app.services.thumbtack_mapper import map_lead_payload

logger = logging.getLogger(__name__)

# Thumbtack lead payloads carry attachment metadata, not the files themselves,
# so a legitimate body is small. 1 MB is generous.
MAX_BODY_BYTES = 1_000_000

# How much of a rejected oversized body to keep. Enough for the operator to
# recognise what arrived, small enough that a flood of them cannot bloat the DB.
OVERSIZE_PREFIX_BYTES = 2_048


def _now() -> datetime:
    return datetime.now(timezone.utc)


def generate_credentials() -> tuple[str, str, str]:
    """Return (url_token, auth_username, auth_secret_plain)."""
    return (
        secrets.token_urlsafe(32),
        f"tt_{secrets.token_hex(8)}",
        secrets.token_urlsafe(24),
    )


async def create_connection(
    db: AsyncSession, *, label: str, city_id: str, business: str
) -> tuple[ThumbtackConnection, str]:
    """Create a connection. Returns the row and the plaintext secret, which is
    the only time the secret is ever available."""
    url_token, username, secret = generate_credentials()
    conn = ThumbtackConnection(
        label=label,
        city_id=city_id,
        business=business,
        auth_username=username,
        auth_secret_hash=auth_service.hash_pin(secret),
        url_token=url_token,
        is_active=True,
    )
    db.add(conn)
    await db.commit()
    await db.refresh(conn)
    return conn, secret


async def list_connections(db: AsyncSession) -> list[ThumbtackConnection]:
    result = await db.execute(
        select(ThumbtackConnection).order_by(ThumbtackConnection.created_at.desc())
    )
    return list(result.scalars().all())


async def get_by_url_token(db: AsyncSession, url_token: str) -> ThumbtackConnection | None:
    result = await db.execute(
        select(ThumbtackConnection).where(ThumbtackConnection.url_token == url_token).limit(1)
    )
    return result.scalar_one_or_none()


async def get_by_id(db: AsyncSession, connection_id: str) -> ThumbtackConnection | None:
    result = await db.execute(
        select(ThumbtackConnection).where(ThumbtackConnection.id == connection_id).limit(1)
    )
    return result.scalar_one_or_none()


async def set_active(
    db: AsyncSession, connection_id: str, is_active: bool
) -> ThumbtackConnection | None:
    conn = await get_by_id(db, connection_id)
    if conn is None:
        return None
    conn.is_active = is_active
    await db.commit()
    await db.refresh(conn)
    return conn


async def delete_connection(db: AsyncSession, connection_id: str) -> bool:
    conn = await get_by_id(db, connection_id)
    if conn is None:
        return False
    # SQLite does not enforce ON DELETE CASCADE unless pragma foreign_keys is on,
    # so remove the child rows explicitly rather than relying on it.
    await db.execute(
        delete(ThumbtackWebhookEvent).where(
            ThumbtackWebhookEvent.connection_id == connection_id
        )
    )
    await db.delete(conn)
    await db.commit()
    return True


def verify_basic_header(authorization: str | None, conn: ThumbtackConnection) -> bool:
    """True only when the header carries valid Basic credentials for this connection.

    A missing header returns False. Whether a missing header is acceptable is the
    route's decision, not this function's — see the verify-if-present rule.
    """
    if not authorization or not authorization.lower().startswith("basic "):
        return False
    if not conn.auth_username or not conn.auth_secret_hash:
        return False
    try:
        decoded = base64.b64decode(authorization[6:].strip(), validate=True).decode()
    except (binascii.Error, UnicodeDecodeError, ValueError):
        return False
    username, _, password = decoded.partition(":")
    if not hmac.compare_digest(username, conn.auth_username):
        return False
    try:
        return auth_service.verify_pin(password, conn.auth_secret_hash)
    except ValueError:
        return False


# Thumbtack documents two payload vocabularies. The older pro-api reference
# keys leads on `leadID`; the developer platform documents V4 events keyed on
# `negotiationID` (NegotiationCreatedV4 / MessageCreatedV4 / ReviewCreatedV4).
# The self-serve webhook may send either, bare or inside an envelope, so we
# recognise both and still fall back to 'unknown'.
_V4_EVENT_KINDS = {
    "negotiationcreatedv4": "lead",
    "messagecreatedv4": "message",
    "reviewcreatedv4": "review",
}


def _declared_kind(obj: dict) -> str | None:
    """Kind taken from an explicit event-type field, if the body carries one."""
    for key in ("eventType", "event_type", "type", "event", "reviewEventType"):
        value = obj.get(key)
        if not isinstance(value, str):
            continue
        kind = _V4_EVENT_KINDS.get(value.strip().lower())
        if kind:
            return kind
        if value.strip().upper().startswith("REVIEW_"):
            return "review"
    return None


def _sniff_kind(obj: dict) -> tuple[str, str | None]:
    """Kind inferred from body shape.

    Order matters: message and review payloads both carry `negotiationID`, so
    they must be ruled out before anything is treated as a lead.
    """
    message = obj.get("message")
    if isinstance(message, dict):
        return "message", message.get("messageID")
    if obj.get("messageID"):
        return "message", obj.get("messageID")

    review = obj.get("review")
    if isinstance(review, dict):
        return "review", review.get("reviewID")
    if obj.get("reviewID"):
        return "review", obj.get("reviewID")
    if "reviewEventType" in obj:
        return "review", None

    if obj.get("leadID") and isinstance(obj.get("request"), dict):
        return "lead", obj.get("leadID")
    if obj.get("negotiationID"):
        return "lead", obj.get("negotiationID")

    return "unknown", None


def classify(body: object) -> tuple[str, str | None]:
    """Identify an event by body shape and return (kind, external_id).

    The Thumbtack form sends every checked event type to one URL, so shape is
    the only discriminator available. Anything unrecognised is 'unknown' and is
    kept for inspection rather than rejected.
    """
    if not isinstance(body, dict):
        return "unknown", None

    # A delivery may arrive bare or wrapped in an envelope carrying the payload.
    candidates = [body]
    for key in ("data", "payload"):
        nested = body.get(key)
        if isinstance(nested, dict):
            candidates.append(nested)

    for candidate in candidates:
        kind, external_id = _sniff_kind(candidate)
        if kind != "unknown":
            return kind, external_id

    # Shape told us nothing, but an explicit event type still identifies it.
    for candidate in candidates:
        declared = _declared_kind(candidate)
        if declared:
            return declared, None

    return "unknown", None


async def _persist_lead(
    db: AsyncSession,
    conn: ThumbtackConnection,
    event: ThumbtackWebhookEvent,
    body: dict,
) -> Optional[str]:
    """Create a Lead from a captured delivery. Returns the lead id, or None.

    Runs AFTER the raw body is committed, so a failure here marks the event and
    leaves the body intact for retry. A delivery is never lost because mapping
    broke.
    """
    mapped = map_lead_payload(body)
    if mapped is None:
        return None   # test ping, or a body carrying no negotiationID

    existing = await db.execute(
        select(Lead).where(
            Lead.source_reference_id == mapped.source_reference_id,
            Lead.source_type == LeadSourceType.thumbtack_api,
        ).limit(1)
    )
    already = existing.scalar_one_or_none()
    if already is not None:
        return already.id   # Thumbtack retries; one delivery, one lead

    quote_context = mapped.quote_context
    if mapped.location_mismatch:
        # Stored here rather than a new column: the spec forbids a migration,
        # and quote_context is carried into the AI review, which is where a
        # "this may be elsewhere" warning is most useful.
        quote_context = "\n\n".join(
            p for p in (quote_context, f"[WARNING] {mapped.location_mismatch}") if p
        )

    lead = Lead(
        id=lead_service._id(),
        city_id=conn.city_id,
        source_type=LeadSourceType.thumbtack_api,
        source_reference_id=mapped.source_reference_id,
        customer_name=mapped.customer_name,
        customer_phone=mapped.customer_phone,
        # A Thumbtack number routes to the customer and is not theirs.
        customer_phone_is_proxy=bool(mapped.customer_phone),
        service_type=mapped.service_type,
        job_location=mapped.job_location,
        scope_notes=mapped.scope_notes,
        quote_context=quote_context,
        move_date_options=json.dumps(mapped.move_date_options) if mapped.move_date_options else None,
        lead_cost_cents=mapped.lead_cost_cents,
        lead_cost_gross_cents=mapped.lead_cost_gross_cents,
        raw_payload=event.raw_body,
        status=LeadStatus.new,
        urgency_flag=False,
        ingested_by="thumbtack_webhook",
        created_at=lead_service._now(),
        updated_at=lead_service._now(),
    )
    db.add(lead)
    await db.commit()
    await db.refresh(lead)
    # Captured now, not read off `lead` after a possible rollback below — same
    # expired-instance trap as `conn.id` in record_event.
    lead_id = lead.id
    # Push message values captured here too: `conn` is bound to `db` and a
    # rollback in either branch below would expire it just like `lead`. None
    # of these are ORM instances once copied out, so they survive the rollback.
    push_city_id = conn.city_id
    push_first_name = (mapped.customer_name or "New lead").split(" ")[0]
    push_category = mapped.service_type.value if mapped.service_type else "lead"
    push_where = mapped.job_location or conn.city_id
    push_location_mismatch = mapped.location_mismatch

    # A failure past this point must never look like a failed delivery: the
    # Lead row is already committed and real. It is marked `processed` either
    # way; a sync failure is surfaced as a loud `event.error`, not a `failed`
    # status that would invite a retry that (per the idempotency lookup above)
    # can never actually retry the sync.
    cost_sync_error: str | None = None

    if mapped.is_refunded:
        # Signature is mark_refunded(db, lead_id, on, actor=..., city_id=...) —
        # `on` is a required positional, not a keyword with a default.
        # mark_refunded calls sync_lead_cost_expense internally, so this is
        # also where a refunded lead's cost sync can fail — no separate direct
        # call follows for a refunded lead (it would just repeat this one).
        try:
            await lead_service.mark_refunded(
                db, lead_id, True, actor="thumbtack_webhook", city_id=conn.city_id
            )
        except Exception as exc:
            logger.exception("thumbtack lead refund sync failed lead=%s", lead_id)
            await db.rollback()
            cost_sync_error = str(exc)
    elif mapped.lead_cost_cents is not None:
        # Mirrors a manually entered cost into finance. Idempotent via
        # lead_cost_finance_transaction_id, so a redelivery adds no second expense.
        try:
            await lead_cost_service.sync_lead_cost_expense(db, lead)
            await db.commit()
        except Exception as exc:
            logger.exception("thumbtack lead cost sync failed lead=%s", lead_id)
            await db.rollback()
            cost_sync_error = str(exc)

    # The notification is why any of this matters — he works leads from a truck
    # between other jobs and will not be watching the app. Built from the
    # locals captured above, not from `lead`/`mapped` reads that could follow
    # a rollback.
    message = f"New Thumbtack lead — {push_first_name} · {push_category} · {push_where}"
    if push_location_mismatch:
        message += " · WARNING address may be out of area"

    try:
        await push_service.send_push_to_roles(
            db, ["facilitator", "admin"], message, city_id=push_city_id
        )
    except Exception:
        # A lead that landed with no ping still beats no lead. Log the lead id
        # only — the message text carries the customer's name and is PII.
        logger.exception("thumbtack lead push failed lead=%s", lead_id)

    event.lead_id = lead_id
    event.status = "processed"
    if cost_sync_error:
        event.error = f"lead created but lead cost sync failed: {cost_sync_error}"
    event.processed_at = _now()
    await db.commit()

    return lead_id


async def retry_event(db: AsyncSession, event_id: str) -> Optional[ThumbtackWebhookEvent]:
    """Re-run mapping over a stored delivery. None when the event does not exist.

    Idempotent by way of _persist_lead's own lookup on source_reference_id —
    retrying a delivery that already produced a lead returns that lead rather
    than making a second one.
    """
    result = await db.execute(
        select(ThumbtackWebhookEvent).where(ThumbtackWebhookEvent.id == event_id).limit(1)
    )
    event = result.scalar_one_or_none()
    if event is None:
        return None

    conn = await get_by_id(db, event.connection_id)
    if conn is None:
        event.status = "failed"
        event.error = "Connection no longer exists"
        await db.commit()
        return event

    try:
        parsed = json.loads(event.raw_body)
    except (json.JSONDecodeError, ValueError) as exc:
        event.status = "failed"
        event.error = f"Body is not valid JSON: {exc}"
        await db.commit()
        return event

    try:
        lead_id = await _persist_lead(db, conn, event, parsed)
    except Exception as exc:
        await db.rollback()
        event.status = "failed"
        event.error = f"Mapping failed: {exc}"
        await db.commit()
        logger.exception("thumbtack retry failed event=%s", event.id)
    else:
        # _persist_lead's own idempotency lookup means a retry of an
        # already-persisted delivery returns the existing lead id without
        # touching cost sync or push — so a `processed` event that still
        # carries Task 3's "lead created but lead cost sync failed" error
        # would otherwise never heal. Do that here, on the retry path only:
        # load the lead and, if it has a known cost but no linked expense yet
        # and was never refunded (mark_refunded owns that lead's expense),
        # run the same idempotent sync_lead_cost_expense the original
        # delivery would have run.
        if lead_id is not None:
            lead_result = await db.execute(select(Lead).where(Lead.id == lead_id).limit(1))
            lead = lead_result.scalar_one_or_none()
            if (
                lead is not None
                and lead.lead_cost_cents is not None
                and lead.lead_cost_finance_transaction_id is None
                and lead.lead_refunded_at is None
            ):
                try:
                    await lead_cost_service.sync_lead_cost_expense(db, lead)
                    # The stale "cost sync failed" string is now false.
                    event.error = None
                    await db.commit()
                except Exception as exc:
                    await db.rollback()
                    logger.exception(
                        "thumbtack retry cost sync heal failed lead=%s", lead_id
                    )
                    event.error = f"lead created but lead cost sync failed: {exc}"
                    await db.commit()

    await db.refresh(event)
    return event


async def record_event(
    db: AsyncSession, conn: ThumbtackConnection, raw_body: bytes
) -> ThumbtackWebhookEvent:
    """Persist a delivery verbatim, then classify it. Never raises for a bad body."""
    try:
        text = raw_body.decode("utf-8")
    except UnicodeDecodeError:
        text = raw_body.decode("utf-8", errors="replace")

    kind = "unknown"
    external_id = None
    status = "received"
    error = None

    try:
        parsed = json.loads(text)
        kind, external_id = classify(parsed)
        if kind == "review":
            # Reviews are out of scope this phase; recorded, not acted on.
            status = "ignored"
    except (json.JSONDecodeError, ValueError) as exc:
        status = "failed"
        error = f"Body is not valid JSON: {exc}"

    # Captured now, not read off `conn` after the block below: a mapping
    # failure rolls back the session, which expires `conn` (expire_on_rollback
    # defaults to True even though this app runs with expire_on_commit=False),
    # and a plain attribute access on an expired ORM instance outside an
    # awaited SQLAlchemy call raises MissingGreenlet.
    conn_id = conn.id

    event = ThumbtackWebhookEvent(
        connection_id=conn_id,
        kind=kind,
        external_id=external_id,
        raw_body=text,
        status=status,
        error=error,
    )
    db.add(event)

    if status == "failed":
        conn.last_error_at = _now()
    else:
        conn.last_event_at = _now()

    await db.commit()
    await db.refresh(event)

    # Everything past this point is best-effort. The body is already committed,
    # so a mapping failure marks the event and can never lose the delivery.
    if kind == "lead" and status == "received":
        try:
            await _persist_lead(db, conn, event, parsed)
        except Exception as exc:
            await db.rollback()
            event.status = "failed"
            event.error = f"Mapping failed: {exc}"
            await db.commit()
            logger.exception("thumbtack lead mapping failed event=%s", event.id)

    # Deliberately not logging the body: it carries customer name, phone, and address.
    logger.info(
        "thumbtack webhook recorded connection=%s kind=%s status=%s",
        conn_id, kind, status,
    )
    return event


async def record_oversize(
    db: AsyncSession,
    conn: ThumbtackConnection,
    raw_prefix: bytes,
    *,
    declared: int | None = None,
) -> ThumbtackWebhookEvent:
    """Record a delivery that was refused for being too large.

    A rejected delivery that leaves no trace is a silent loss, which is exactly
    what a capture-first receiver exists to prevent. The operator needs to see
    that Thumbtack tried and what it looked like, even though we would not store
    the whole thing.
    """
    prefix = raw_prefix[:OVERSIZE_PREFIX_BYTES].decode("utf-8", errors="replace")
    size = f"{declared} bytes declared" if declared is not None else "size not declared"
    event = ThumbtackWebhookEvent(
        connection_id=conn.id,
        kind="unknown",
        external_id=None,
        raw_body=prefix,
        status="failed",
        error=(
            f"Delivery rejected: body exceeds the {MAX_BODY_BYTES} byte limit "
            f"({size}). Only the first {len(prefix)} characters were captured."
        ),
    )
    db.add(event)
    conn.last_error_at = _now()
    await db.commit()
    await db.refresh(event)
    # Deliberately not logging the prefix: it may carry customer PII.
    logger.warning(
        "thumbtack webhook rejected as oversized connection=%s declared=%s",
        conn.id, declared,
    )
    return event


async def list_events(
    db: AsyncSession, *, connection_id: str | None = None, limit: int = 50
) -> list[ThumbtackWebhookEvent]:
    stmt = select(ThumbtackWebhookEvent).order_by(ThumbtackWebhookEvent.received_at.desc())
    if connection_id:
        stmt = stmt.where(ThumbtackWebhookEvent.connection_id == connection_id)
    result = await db.execute(stmt.limit(limit))
    return list(result.scalars().all())


async def prune_events(db: AsyncSession, *, older_than_days: int = 90) -> int:
    """Raw bodies carry customer PII, so the ledger is not kept indefinitely."""
    # received_at round-trips through SQLite as a naive value (see the model's
    # _now() default landing in a plain DateTime column — the house pattern from
    # screenshot.py), so the cutoff must be naive to match what's actually stored.
    cutoff = (_now() - timedelta(days=older_than_days)).replace(tzinfo=None)
    result = await db.execute(
        delete(ThumbtackWebhookEvent)
        .where(ThumbtackWebhookEvent.received_at < cutoff)
        # "evaluate" (the default) re-checks the WHERE clause in Python against
        # objects already in the session's identity map to keep it in sync. That
        # breaks here: a freshly-refreshed row's received_at comes back naive,
        # while a row mutated in-memory by a caller (e.g. a test backdating it)
        # keeps whatever tzinfo it was assigned, so the same query can compare
        # naive and aware datetimes in the same pass. "fetch" sidesteps the
        # in-memory comparison by selecting matching PKs before deleting.
        .execution_options(synchronize_session="fetch")
    )
    await db.commit()
    return result.rowcount or 0


async def prune_old_events() -> None:
    """Entry point for the scheduler — opens its own session."""
    from app.database import AsyncSessionLocal

    try:
        async with AsyncSessionLocal() as db:
            removed = await prune_events(db, older_than_days=90)
            if removed:
                print(f"[thumbtack] pruned {removed} webhook events older than 90 days")
    except Exception as exc:
        print(f"[thumbtack] prune error: {exc}")
