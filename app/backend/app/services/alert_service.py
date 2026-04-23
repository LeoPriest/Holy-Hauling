# Stub — full implementation in Task 4
from app.schemas.settings import SettingsOut, TestAlertResult


async def fire_test_alert(settings: SettingsOut, channel: str, recipient: str) -> TestAlertResult:
    return TestAlertResult(sent=False, reason="Not yet implemented")
