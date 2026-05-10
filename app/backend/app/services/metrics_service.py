from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.lead import Lead, LeadStatus
from app.models.lead_event import LeadEvent

PIPELINE_ORDER = [
    ("new", "New"),
    ("in_review", "In Review"),
    ("replied", "Replied"),
    ("waiting_on_customer", "Waiting on Customer"),
    ("ready_for_quote", "Ready to Quote"),
    ("ready_for_booking", "Ready to Book"),
    ("booked", "Booked"),
]

ACTIVE_STATUSES = {"new", "in_review", "replied", "waiting_on_customer", "ready_for_quote", "ready_for_booking"}
CLOSED_STATUSES = {"released", "lost"}

SOURCE_LABELS: dict[str, str] = {
    "thumbtack_api": "Thumbtack API",
    "thumbtack_screenshot": "Thumbtack Screenshot",
    "yelp_screenshot": "Yelp",
    "google_screenshot": "Google",
    "website_form": "Website",
    "manual": "Manual",
}


async def get_metrics(
    db: AsyncSession,
    city_id: str | None = None,
    days: int = 30,
) -> dict:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    period_start = now - timedelta(days=days)
    mtd_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    def scoped(q):
        return q.where(Lead.city_id == city_id) if city_id else q

    # ── Pipeline counts ────────────────────────────────────────────────────
    pipeline_rows = (await db.execute(
        scoped(select(Lead.status, func.count().label("cnt")).group_by(Lead.status))
    )).all()
    status_counts: dict[str, int] = {str(row.status): row.cnt for row in pipeline_rows}

    pipeline = [
        {"status": s, "label": label, "count": status_counts.get(s, 0)}
        for s, label in PIPELINE_ORDER
    ]
    total_active = sum(status_counts.get(s, 0) for s in ACTIVE_STATUSES)
    total_released = sum(status_counts.get(s, 0) for s in CLOSED_STATUSES)

    # ── Revenue booked MTD ────────────────────────────────────────────────
    revenue_booked_mtd = (await db.scalar(
        scoped(
            select(func.coalesce(func.sum(Lead.quoted_price_total), 0.0))
            .where(Lead.status == LeadStatus.booked, Lead.updated_at >= mtd_start)
        )
    )) or 0.0

    # ── Revenue in active pipeline ────────────────────────────────────────
    revenue_pipeline = (await db.scalar(
        scoped(
            select(func.coalesce(func.sum(Lead.quoted_price_total), 0.0))
            .where(
                Lead.status.notin_([LeadStatus.booked, LeadStatus.released, LeadStatus.lost]),
                Lead.quoted_price_total.isnot(None),
            )
        )
    )) or 0.0

    # ── Conversion (period window) ─────────────────────────────────────────
    leads_created_30d = (await db.scalar(
        scoped(select(func.count()).where(Lead.created_at >= period_start))
    )) or 0

    leads_booked_30d = (await db.scalar(
        scoped(
            select(func.count()).where(
                Lead.status == LeadStatus.booked,
                Lead.updated_at >= period_start,
            )
        )
    )) or 0

    conversion_rate_30d = (
        round(leads_booked_30d / leads_created_30d * 100, 1)
        if leads_created_30d > 0
        else 0.0
    )

    # ── Source breakdown ───────────────────────────────────────────────────
    source_rows = (await db.execute(
        scoped(
            select(Lead.source_type, func.count().label("cnt"))
            .where(Lead.created_at >= period_start)
            .group_by(Lead.source_type)
            .order_by(func.count().desc())
        )
    )).all()
    sources_30d = [
        {
            "source_type": str(row.source_type),
            "label": SOURCE_LABELS.get(str(row.source_type), str(row.source_type)),
            "count": row.cnt,
        }
        for row in source_rows
    ]

    # ── Average reply time ─────────────────────────────────────────────────
    # First "replied" event per lead, joined to lead created_at
    first_reply_sub = (
        select(LeadEvent.lead_id, func.min(LeadEvent.created_at).label("first_reply"))
        .where(LeadEvent.event_type == "status_changed", LeadEvent.to_status == "replied")
        .group_by(LeadEvent.lead_id)
        .subquery()
    )
    reply_q = select(Lead.created_at.label("lead_created"), first_reply_sub.c.first_reply).join(
        first_reply_sub, Lead.id == first_reply_sub.c.lead_id
    )
    if city_id:
        reply_q = reply_q.where(Lead.city_id == city_id)

    reply_rows = (await db.execute(reply_q)).all()
    avg_reply_hours: float | None = None
    if reply_rows:
        diffs: list[float] = []
        for row in reply_rows:
            lc, fr = row.lead_created, row.first_reply
            if lc and fr:
                if isinstance(lc, str):
                    lc = datetime.fromisoformat(lc)
                if isinstance(fr, str):
                    fr = datetime.fromisoformat(fr)
                diff = (fr - lc).total_seconds() / 3600
                if 0 <= diff <= 336:  # sanity cap at 2 weeks
                    diffs.append(diff)
        if diffs:
            avg_reply_hours = round(sum(diffs) / len(diffs), 1)

    return {
        "period_days": days,
        "pipeline": pipeline,
        "total_active": total_active,
        "total_released": total_released,
        "revenue_booked_mtd": float(revenue_booked_mtd),
        "revenue_pipeline": float(revenue_pipeline),
        "leads_created_30d": leads_created_30d,
        "leads_booked_30d": leads_booked_30d,
        "conversion_rate_30d": conversion_rate_30d,
        "sources_30d": sources_30d,
        "avg_reply_hours": avg_reply_hours,
    }
