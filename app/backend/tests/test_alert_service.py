from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from sqlalchemy import text

from app.schemas.settings import SettingsOut
from app.services.alert_service import _is_quiet_now, _process_stale_leads

pytestmark = pytest.mark.asyncio

_EMPTY_SETTINGS = SettingsOut()  # all defaults, no contact info configured


async def test_fire_test_alert_sms_no_credentials():
    from app.services.alert_service import fire_test_alert
    result = await fire_test_alert(_EMPTY_SETTINGS, "sms", "primary")
    assert result.sent is False
    assert result.reason is not None


async def test_fire_test_alert_email_no_credentials():
    from app.services.alert_service import fire_test_alert
    result = await fire_test_alert(_EMPTY_SETTINGS, "email", "backup")
    assert result.sent is False
    assert result.reason is not None


_BASE_LEAD = {
    "source_type": "manual",
    "customer_name": "Test User",
    "service_type": "moving",
}

_SETTINGS_15_30 = SettingsOut(t1_minutes=15, t2_minutes=30)


async def _make_stale_lead(client, db_session, minutes_ago: int) -> str:
    r = await client.post("/leads", json=_BASE_LEAD)
    assert r.status_code == 201
    lead_id = r.json()["id"]
    stale_time = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=minutes_ago)
    await db_session.execute(
        text("UPDATE leads SET updated_at = :t WHERE id = :id"),
        {"t": stale_time, "id": lead_id},
    )
    await db_session.commit()
    return lead_id


async def test_fresh_lead_not_alerted(client, db_session):
    await client.post("/leads", json=_BASE_LEAD)
    with patch("app.services.alert_service._send_sms") as mock_sms, \
         patch("app.services.alert_service._send_email") as mock_email:
        await _process_stale_leads(db_session, _SETTINGS_15_30)
    mock_sms.assert_not_called()
    mock_email.assert_not_called()


async def test_t1_lead_fires_alert(client, db_session):
    lead_id = await _make_stale_lead(client, db_session, minutes_ago=20)
    settings = SettingsOut(t1_minutes=15, t2_minutes=30, primary_sms="+15550001111", primary_email="p@test.com")
    with patch("app.services.alert_service._send_sms", return_value=None) as mock_sms, \
         patch("app.services.alert_service._send_email", return_value=None) as mock_email:
        await _process_stale_leads(db_session, settings)
    mock_sms.assert_called_once()
    mock_email.assert_called_once()


async def test_t1_alert_not_sent_twice(client, db_session):
    lead_id = await _make_stale_lead(client, db_session, minutes_ago=20)
    settings = SettingsOut(t1_minutes=15, t2_minutes=30, primary_sms="+15550001111")
    with patch("app.services.alert_service._send_sms", return_value=None) as mock_sms, \
         patch("app.services.alert_service._send_email", return_value=None):
        await _process_stale_leads(db_session, settings)
        await _process_stale_leads(db_session, settings)
    assert mock_sms.call_count == 1  # dedup prevents second send


async def test_t2_escalates_lead_status(client, db_session):
    lead_id = await _make_stale_lead(client, db_session, minutes_ago=35)
    settings = SettingsOut(t1_minutes=15, t2_minutes=30)
    with patch("app.services.alert_service._send_sms", return_value=None), \
         patch("app.services.alert_service._send_email", return_value=None):
        await _process_stale_leads(db_session, settings)
    r = await client.get(f"/leads/{lead_id}")
    assert r.json()["status"] == "escalated"


async def test_quiet_hours_suppresses_sms(client, db_session):
    await _make_stale_lead(client, db_session, minutes_ago=20)
    settings = SettingsOut(
        t1_minutes=15, t2_minutes=30,
        primary_sms="+15550001111",
        quiet_hours_enabled=True,
        quiet_hours_start="00:00",  # always quiet for test
        quiet_hours_end="23:59",
    )
    with patch("app.services.alert_service._send_sms") as mock_sms, \
         patch("app.services.alert_service._send_email") as mock_email:
        await _process_stale_leads(db_session, settings)
    mock_sms.assert_not_called()
    mock_email.assert_not_called()


def test_is_quiet_now_overnight():
    settings_always_quiet = SettingsOut(quiet_hours_enabled=True, quiet_hours_start="00:00", quiet_hours_end="23:59")
    assert _is_quiet_now(settings_always_quiet) is True

    settings_never_quiet = SettingsOut(quiet_hours_enabled=False, quiet_hours_start="00:00", quiet_hours_end="23:59")
    assert _is_quiet_now(settings_never_quiet) is False
