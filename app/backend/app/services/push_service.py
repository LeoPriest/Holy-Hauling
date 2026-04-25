from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.push_subscription import PushSubscription
from app.models.user import User

logger = logging.getLogger(__name__)


def _vapid_private_key() -> str:
    return os.getenv("VAPID_PRIVATE_KEY", "")


def _vapid_public_key() -> str:
    return os.getenv("VAPID_PUBLIC_KEY", "")


def _vapid_claim_email() -> str:
    return os.getenv("VAPID_CLAIM_EMAIL", "mailto:admin@holyhauling.com")


def web_push_status() -> dict[str, object]:
    missing: list[str] = []
    if not _vapid_public_key():
        missing.append("VAPID_PUBLIC_KEY")
    if not _vapid_private_key():
        missing.append("VAPID_PRIVATE_KEY")
    configured = not missing
    detail = None
    if missing:
        detail = (
            "Web push is not configured. Add "
            + ", ".join(missing)
            + " to app/backend/.env and restart the backend."
        )
    return {
        "configured": configured,
        "missing": missing,
        "detail": detail,
    }


async def save_subscription(
    db: AsyncSession, user_id: str, endpoint: str, p256dh: str, auth: str
) -> PushSubscription:
    result = await db.execute(
        select(PushSubscription).where(PushSubscription.endpoint == endpoint)
    )
    sub = result.scalar_one_or_none()
    if sub is None:
        sub = PushSubscription(
            user_id=user_id,
            endpoint=endpoint,
            p256dh=p256dh,
            auth=auth,
            created_at=datetime.now(timezone.utc),
        )
        db.add(sub)
    else:
        sub.user_id = user_id
        sub.p256dh = p256dh
        sub.auth = auth
    await db.commit()
    await db.refresh(sub)
    return sub


async def delete_subscription(db: AsyncSession, user_id: str, endpoint: str) -> bool:
    result = await db.execute(
        select(PushSubscription).where(
            PushSubscription.user_id == user_id,
            PushSubscription.endpoint == endpoint,
        )
    )
    sub = result.scalar_one_or_none()
    if sub is None:
        return False
    await db.delete(sub)
    await db.commit()
    return True


async def user_subscription_count(db: AsyncSession, user_id: str) -> int:
    result = await db.execute(
        select(PushSubscription).where(PushSubscription.user_id == user_id)
    )
    return len(result.scalars().all())


async def send_push_to_roles(db: AsyncSession, roles: list[str], message: str) -> int:
    result = await db.execute(
        select(PushSubscription)
        .join(User, PushSubscription.user_id == User.id)
        .where(User.role.in_(roles), User.is_active == True)
    )
    subs = result.scalars().all()
    sent = 0
    stale = []
    for sub in subs:
        success, should_delete = _send_one(sub, message)
        if success:
            sent += 1
        elif should_delete:
            stale.append(sub)
    for sub in stale:
        await db.delete(sub)
    if stale:
        await db.commit()
    return sent


async def send_push_to_user(db: AsyncSession, user_id: str, message: str) -> int:
    result = await db.execute(
        select(PushSubscription)
        .join(User, PushSubscription.user_id == User.id)
        .where(
            PushSubscription.user_id == user_id,
            User.is_active == True,
        )
    )
    subs = result.scalars().all()
    sent = 0
    stale = []
    for sub in subs:
        success, should_delete = _send_one(sub, message)
        if success:
            sent += 1
        elif should_delete:
            stale.append(sub)
    for sub in stale:
        await db.delete(sub)
    if stale:
        await db.commit()
    return sent


def _send_one(sub, message: str) -> tuple[bool, bool]:
    """Returns (sent, should_delete)."""
    vapid_private_key = _vapid_private_key()
    if not vapid_private_key:
        logger.debug("VAPID_PRIVATE_KEY not set; skipping push delivery")
        return False, False
    try:
        from pywebpush import webpush
        webpush(
            subscription_info={
                "endpoint": sub.endpoint,
                "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
            },
            data=json.dumps({"body": message}),
            vapid_private_key=vapid_private_key,
            vapid_claims={"sub": _vapid_claim_email()},
        )
        return True, False
    except Exception as exc:
        logger.error("Push failed for subscription %s: %s", sub.id, exc)
        status = getattr(getattr(exc, "response", None), "status_code", None)
        return False, status in (400, 401, 403, 404, 410)
