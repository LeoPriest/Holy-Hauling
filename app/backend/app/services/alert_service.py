from __future__ import annotations

import os
import smtplib
import uuid
from datetime import datetime, time, timedelta, timezone
from email.mime.text import MIMEText
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models.lead import Lead, LeadStatus
from app.models.lead_alert import LeadAlert
from app.models.lead_event import LeadEvent
from app.schemas.settings import SettingsOut, TestAlertResult


# ── quiet hours ───────────────────────────────────────────────────────────────

def _is_quiet_now(settings: SettingsOut) -> bool:
    if not settings.quiet_hours_enabled:
        return False
    try:
        now_t = datetime.now().time()
        start = time.fromisoformat(settings.quiet_hours_start)
        end = time.fromisoformat(settings.quiet_hours_end)
        if start <= end:
            return start <= now_t < end
        # Overnight range (e.g. 22:00–07:00)
        return now_t >= start or now_t < end
    except ValueError:
        return False


# ── send helpers ─────────────────────────────────────────────────────────────

def _send_sms(to: str, body: str) -> Optional[str]:
    """Send via Twilio. Returns error string on failure, None on success."""
    sid = os.environ.get("TWILIO_ACCOUNT_SID", "")
    token = os.environ.get("TWILIO_AUTH_TOKEN", "")
    from_num = os.environ.get("TWILIO_FROM_NUMBER", "")
    if not all([sid, token, from_num]):
        return "Twilio credentials not configured"
    if not to:
        return "No recipient phone number configured"
    try:
        from twilio.rest import Client  # lazy — optional dep
        Client(sid, token).messages.create(body=body, from_=from_num, to=to)
        return None
    except ImportError:
        return "twilio package not installed (pip install twilio)"
    except Exception as exc:
        return str(exc)


def _send_email(to: str, subject: str, body: str) -> Optional[str]:
    """Send via SMTP. Returns error string on failure, None on success."""
    host = os.environ.get("SMTP_HOST", "")
    user = os.environ.get("SMTP_USER", "")
    password = os.environ.get("SMTP_PASS", "")
    from_addr = os.environ.get("SMTP_FROM", "")
    if not all([host, user, password, from_addr]):
        return "SMTP credentials not configured"
    if not to:
        return "No recipient email address configured"
    try:
        msg = MIMEText(body)
        msg["Subject"] = subject
        msg["From"] = from_addr
        msg["To"] = to
        with smtplib.SMTP(host, 587) as server:
            server.starttls()
            server.login(user, password)
            server.send_message(msg)
        return None
    except Exception as exc:
        return str(exc)


# ── test send ─────────────────────────────────────────────────────────────────

async def fire_test_alert(
    settings: SettingsOut,
    channel: str,
    recipient: str,
) -> TestAlertResult:
    """Send a test message, bypassing quiet hours and dedup."""
    if recipient == "primary":
        sms_to = settings.primary_sms
        email_to = settings.primary_email
    else:
        sms_to = settings.backup_sms
        email_to = settings.backup_email

    if channel == "sms":
        err = _send_sms(sms_to, "Holy Hauling test alert — SMS notifications are working correctly.")
    else:
        err = _send_email(
            email_to,
            "[Holy Hauling] Test alert",
            "This is a test alert from Holy Hauling. Email notifications are working correctly.",
        )

    if err:
        return TestAlertResult(sent=False, reason=err)
    return TestAlertResult(sent=True)


# ── stale lead checker ────────────────────────────────────────────────────────

_ACTIVE_STATUSES = {
    LeadStatus.new,
    LeadStatus.in_review,
    LeadStatus.waiting_on_customer,
    LeadStatus.ready_for_quote,
    LeadStatus.ready_for_booking,
}


async def _alert_channel(
    db: AsyncSession,
    lead: Lead,
    tier: int,
    channel: str,
    to: str,
    msg: str,
    subject: str,
    quiet: bool,
    snapshot: datetime,
) -> None:
    """Send one channel alert, respecting dedup and quiet hours."""
    # Check for already-sent (non-suppressed) record → skip
    sent = await db.execute(
        select(LeadAlert).where(
            LeadAlert.lead_id == lead.id,
            LeadAlert.tier == tier,
            LeadAlert.channel == channel,
            LeadAlert.lead_updated_at_snapshot == snapshot,
            LeadAlert.suppressed.is_(False),
        ).limit(1)
    )
    if sent.scalar_one_or_none():
        return

    if quiet:
        # Log suppressed once for audit (skip if already logged)
        existing = await db.execute(
            select(LeadAlert).where(
                LeadAlert.lead_id == lead.id,
                LeadAlert.tier == tier,
                LeadAlert.channel == channel,
                LeadAlert.lead_updated_at_snapshot == snapshot,
            ).limit(1)
        )
        if not existing.scalar_one_or_none():
            db.add(LeadAlert(
                id=str(uuid.uuid4()),
                lead_id=lead.id,
                tier=tier,
                channel=channel,
                sent_at=datetime.now(timezone.utc),
                suppressed=True,
                lead_updated_at_snapshot=snapshot,
            ))
            await db.commit()
        return

    # Send
    if channel == "sms":
        _send_sms(to, msg)
    else:
        _send_email(to, subject, msg)

    db.add(LeadAlert(
        id=str(uuid.uuid4()),
        lead_id=lead.id,
        tier=tier,
        channel=channel,
        sent_at=datetime.now(timezone.utc),
        suppressed=False,
        lead_updated_at_snapshot=snapshot,
    ))
    await db.commit()


async def _process_stale_leads(db: AsyncSession, settings: SettingsOut) -> None:
    """Core check logic — accepts a session so tests can inject the test DB."""
    now_naive = datetime.utcnow()
    t1_cutoff = now_naive - timedelta(minutes=settings.t1_minutes)
    t2_cutoff = now_naive - timedelta(minutes=settings.t2_minutes)
    quiet = _is_quiet_now(settings)

    result = await db.execute(
        select(Lead).where(
            Lead.status.in_(_ACTIVE_STATUSES),
            Lead.updated_at < t1_cutoff,
        )
    )
    stale_leads = result.scalars().all()

    for lead in stale_leads:
        snapshot = lead.updated_at  # naive UTC datetime from SQLite
        idle_minutes = int((now_naive - snapshot).total_seconds() / 60)
        is_t2 = snapshot < t2_cutoff
        tier = 2 if is_t2 else 1

        name = lead.customer_name or "Unknown"
        base_msg = (
            f'Holy Hauling Alert: Lead "{name}" has been idle for {idle_minutes}m. '
            f"Status: {lead.status.value}. Open the app to take action."
        )
        if is_t2:
            base_msg += " Escalated — backup handler also notified."
        subject = f"[Holy Hauling] Lead idle {idle_minutes}m — action needed"

        recipients: list[tuple[str, str]] = [(settings.primary_sms, settings.primary_email)]
        if is_t2:
            recipients.append((settings.backup_sms, settings.backup_email))

        for sms_to, email_to in recipients:
            await _alert_channel(db, lead, tier, "sms", sms_to, base_msg, subject, quiet, snapshot)
            await _alert_channel(db, lead, tier, "email", email_to, base_msg, subject, quiet, snapshot)

        # T2: auto-advance to escalated and write audit event
        if is_t2 and lead.status != LeadStatus.escalated:
            old_status = lead.status.value
            lead.status = LeadStatus.escalated
            lead.updated_at = now_naive
            db.add(LeadEvent(
                id=str(uuid.uuid4()),
                lead_id=lead.id,
                event_type="status_changed",
                from_status=old_status,
                to_status=LeadStatus.escalated.value,
                actor="alert_scheduler",
            ))
            await db.commit()


async def check_stale_leads() -> None:
    """Entry point for the scheduler — opens its own session."""
    from app.services import settings_service
    try:
        async with AsyncSessionLocal() as db:
            settings = await settings_service.get_settings(db)
            await _process_stale_leads(db, settings)
    except Exception as exc:
        print(f"[alert_scheduler] Error: {exc}")
