from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import bcrypt
from jose import jwt

def hash_pin(pin: str) -> str:
    return bcrypt.hashpw(pin.encode(), bcrypt.gensalt()).decode()


def verify_pin(pin: str, credential_hash: str) -> bool:
    return bcrypt.checkpw(pin.encode(), credential_hash.encode())


def create_token(user) -> str:  # user: User — avoid circular import by using duck typing
    secret = os.environ["JWT_SECRET"]
    algorithm = os.getenv("JWT_ALGORITHM", "HS256")
    expire_days = int(os.getenv("JWT_EXPIRE_DAYS", "30"))
    payload = {
        "sub": user.username,
        "user_id": user.id,
        "role": user.role,
        "exp": datetime.now(timezone.utc) + timedelta(days=expire_days),
    }
    return jwt.encode(payload, secret, algorithm=algorithm)


def decode_token(token: str) -> dict:
    secret = os.environ["JWT_SECRET"]
    algorithm = os.getenv("JWT_ALGORITHM", "HS256")
    return jwt.decode(token, secret, algorithms=[algorithm])
