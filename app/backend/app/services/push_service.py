from __future__ import annotations

import json
import logging
import os

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

_VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
_VAPID_CLAIM_EMAIL = os.getenv("VAPID_CLAIM_EMAIL", "mailto:admin@holyhauling.com")


async def save_subscription(
    db: AsyncSession, user_id: str, endpoint: str, p256dh: str, auth: str
):
    from datetime import datetime, timezone
    from app.models.push_subscription import PushSubscription

    sub = PushSubscription(
        user_id=user_id,
        endpoint=endpoint,
        p256dh=p256dh,
        auth=auth,
        created_at=datetime.now(timezone.utc),
    )
    db.add(sub)
    await db.commit()
    await db.refresh(sub)
    return sub


async def send_push_to_roles(db: AsyncSession, roles: list[str], message: str) -> None:
    from app.models.push_subscription import PushSubscription
    from app.models.user import User

    result = await db.execute(
        select(PushSubscription)
        .join(User, PushSubscription.user_id == User.id)
        .where(User.role.in_(roles), User.is_active == True)
    )
    subs = result.scalars().all()
    for sub in subs:
        _send_one(sub, message)


def _send_one(sub, message: str) -> None:
    if not _VAPID_PRIVATE_KEY:
        logger.debug("VAPID_PRIVATE_KEY not set; skipping push delivery")
        return
    try:
        from pywebpush import webpush
        webpush(
            subscription_info={
                "endpoint": sub.endpoint,
                "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
            },
            data=json.dumps({"body": message}),
            vapid_private_key=_VAPID_PRIVATE_KEY,
            vapid_claims={"sub": _VAPID_CLAIM_EMAIL},
        )
    except Exception as exc:
        logger.error("Push failed for subscription %s: %s", sub.id, exc)
