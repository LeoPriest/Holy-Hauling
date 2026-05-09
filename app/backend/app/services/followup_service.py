from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.lead_followup import LeadFollowup
from app.models.lead import Lead

logger = logging.getLogger(__name__)


async def upsert_followup(
    db: AsyncSession,
    lead_id: str,
    scheduled_at: datetime,
    note: str | None,
    created_by: str | None,
) -> LeadFollowup:
    result = await db.execute(
        select(LeadFollowup)
        .where(LeadFollowup.lead_id == lead_id, LeadFollowup.fired == False)
        .limit(1)
    )
    followup = result.scalar_one_or_none()

    # Convert to naive UTC if caller passes an aware datetime
    if scheduled_at.tzinfo is not None:
        scheduled_at = scheduled_at.astimezone(timezone.utc).replace(tzinfo=None)

    if followup:
        followup.scheduled_at = scheduled_at
        followup.note = note
    else:
        followup = LeadFollowup(
            lead_id=lead_id,
            scheduled_at=scheduled_at,
            note=note,
            fired=False,
            created_by=created_by,
        )
        db.add(followup)

    await db.commit()
    await db.refresh(followup)
    return followup


async def get_active_followup(db: AsyncSession, lead_id: str) -> LeadFollowup | None:
    result = await db.execute(
        select(LeadFollowup)
        .where(LeadFollowup.lead_id == lead_id, LeadFollowup.fired == False)
        .limit(1)
    )
    return result.scalar_one_or_none()


async def cancel_followup(db: AsyncSession, lead_id: str) -> bool:
    result = await db.execute(
        select(LeadFollowup)
        .where(LeadFollowup.lead_id == lead_id, LeadFollowup.fired == False)
        .limit(1)
    )
    followup = result.scalar_one_or_none()
    if not followup:
        return False
    await db.delete(followup)
    await db.commit()
    return True


async def _fire_due_followups(db: AsyncSession) -> None:
    from app.services.push_service import send_push_to_user
    from app.models.user import User

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    result = await db.execute(
        select(LeadFollowup).where(
            LeadFollowup.fired == False,
            LeadFollowup.scheduled_at <= now,
        )
    )
    due = result.scalars().all()

    for followup in due:
        try:
            lead_result = await db.execute(
                select(Lead).where(Lead.id == followup.lead_id).limit(1)
            )
            lead = lead_result.scalar_one_or_none()
            lead_name = lead.customer_name if lead else followup.lead_id

            if followup.created_by:
                user_result = await db.execute(
                    select(User).where(User.username == followup.created_by).limit(1)
                )
                user = user_result.scalar_one_or_none()
                if user:
                    msg = f"Follow-up reminder: {lead_name}"
                    if followup.note:
                        msg += f" -- {followup.note}"
                    await send_push_to_user(db, user.id, msg)

            followup.fired = True
        except Exception:
            logger.exception("Error firing followup %s", followup.id)

    if due:
        await db.commit()


async def check_due_followups() -> None:
    """Entry point for the scheduler -- opens its own session."""
    from app.database import AsyncSessionLocal
    try:
        async with AsyncSessionLocal() as db:
            await _fire_due_followups(db)
    except Exception:
        logger.exception("[followup_scheduler] Error")
