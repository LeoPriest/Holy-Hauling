from __future__ import annotations

import os
import smtplib
from datetime import datetime, time
from email.mime.text import MIMEText
from typing import Optional

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
