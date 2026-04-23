import pytest
from unittest.mock import patch, MagicMock

from app.schemas.settings import SettingsOut

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
