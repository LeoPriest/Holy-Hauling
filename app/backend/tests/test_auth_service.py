import os
os.environ.setdefault("JWT_SECRET", "test-secret-32-characters-long!!!")

import pytest
from app.services.auth_service import create_token, decode_token, hash_pin, verify_pin
from app.models.user import User
import app.models.push_subscription  # noqa: F401 — ensures PushSubscription is registered before User relationship resolves
from datetime import datetime, timezone


def _make_user(**kwargs) -> User:
    defaults = dict(
        id="user-1",
        username="testuser",
        credential_hash="placeholder",
        role="admin",
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )
    defaults.update(kwargs)
    user = User(**defaults)
    return user


def test_hash_and_verify_pin_correct():
    h = hash_pin("1234")
    assert h != "1234"
    assert verify_pin("1234", h) is True


def test_verify_pin_wrong():
    h = hash_pin("1234")
    assert verify_pin("9999", h) is False


def test_create_and_decode_token():
    user = _make_user(id="abc", username="alice", role="facilitator")
    token = create_token(user)
    assert isinstance(token, str)
    payload = decode_token(token)
    assert payload["sub"] == "alice"
    assert payload["user_id"] == "abc"
    assert payload["role"] == "facilitator"


def test_decode_invalid_token_raises():
    from jose import JWTError
    with pytest.raises(JWTError):
        decode_token("not.a.valid.token")
