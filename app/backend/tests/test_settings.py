import pytest

pytestmark = pytest.mark.asyncio


async def test_get_settings_returns_defaults(client):
    r = await client.get("/settings")
    assert r.status_code == 200
    d = r.json()
    assert d["t1_minutes"] == 15
    assert d["t2_minutes"] == 30
    assert d["quiet_hours_enabled"] is False
    assert d["primary_sms"] == ""
    assert d["backup_name"] == ""


async def test_patch_settings_updates_values(client):
    r = await client.patch("/settings", json={"t1_minutes": 20, "primary_sms": "+15551234567"})
    assert r.status_code == 200
    d = r.json()
    assert d["t1_minutes"] == 20
    assert d["primary_sms"] == "+15551234567"
    assert d["t2_minutes"] == 30  # unchanged default


async def test_patch_settings_persists(client):
    r_patch = await client.patch("/settings", json={"backup_name": "Jordan"})
    assert r_patch.status_code == 200
    r = await client.get("/settings")
    assert r.json()["backup_name"] == "Jordan"


async def test_patch_quiet_hours_enabled(client):
    r = await client.patch("/settings", json={"quiet_hours_enabled": True, "quiet_hours_start": "21:00"})
    assert r.status_code == 200
    d = r.json()
    assert d["quiet_hours_enabled"] is True
    assert d["quiet_hours_start"] == "21:00"


async def test_notification_status_reports_missing_env(client, monkeypatch):
    monkeypatch.delenv("TWILIO_ACCOUNT_SID", raising=False)
    monkeypatch.delenv("TWILIO_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("TWILIO_FROM_NUMBER", raising=False)
    monkeypatch.delenv("SMTP_HOST", raising=False)
    monkeypatch.delenv("SMTP_USER", raising=False)
    monkeypatch.delenv("SMTP_PASS", raising=False)
    monkeypatch.delenv("SMTP_FROM", raising=False)
    monkeypatch.delenv("VAPID_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("VAPID_PRIVATE_KEY", raising=False)

    r = await client.get("/settings/notification-status")

    assert r.status_code == 200
    data = r.json()
    assert data["sms"]["configured"] is False
    assert "TWILIO_ACCOUNT_SID" in data["sms"]["missing"]
    assert data["email"]["configured"] is False
    assert "SMTP_HOST" in data["email"]["missing"]
    assert data["web_push"]["configured"] is False
    assert "VAPID_PUBLIC_KEY" in data["web_push"]["missing"]


async def test_notification_status_reports_configured_env(client, monkeypatch):
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "sid")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "token")
    monkeypatch.setenv("TWILIO_FROM_NUMBER", "+15550001111")
    monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("SMTP_USER", "user")
    monkeypatch.setenv("SMTP_PASS", "pass")
    monkeypatch.setenv("SMTP_FROM", "from@example.com")
    monkeypatch.setenv("VAPID_PUBLIC_KEY", "public")
    monkeypatch.setenv("VAPID_PRIVATE_KEY", "private")

    r = await client.get("/settings/notification-status")

    assert r.status_code == 200
    data = r.json()
    assert data["sms"]["configured"] is True
    assert data["email"]["configured"] is True
    assert data["web_push"]["configured"] is True
