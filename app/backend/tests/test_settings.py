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
