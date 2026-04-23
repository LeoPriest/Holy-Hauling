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
