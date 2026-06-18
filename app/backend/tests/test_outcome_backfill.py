"""The reconciler-as-backfill creates rows for pre-existing terminal leads."""

from __future__ import annotations

from sqlalchemy import select, text

from app.models.lead_outcome import LeadOutcome
from app.services.outcome_service import reconcile_outcomes


async def test_backfill_creates_rows_for_existing_terminal_leads(client, db_session):
    won = (await client.post("/leads", json={"source_type": "manual", "customer_name": "A", "service_type": "moving"})).json()
    lost = (await client.post("/leads", json={"source_type": "manual", "customer_name": "B", "service_type": "moving"})).json()
    await db_session.execute(text("UPDATE leads SET status = 'released' WHERE id = :id"), {"id": won["id"]})
    await db_session.execute(text("UPDATE leads SET status = 'lost' WHERE id = :id"), {"id": lost["id"]})
    await db_session.commit()

    await reconcile_outcomes(db_session, won["city_id"])

    rows = (await db_session.execute(select(LeadOutcome))).scalars().all()
    by_lead = {r.lead_id: r for r in rows}
    assert by_lead[won["id"]].conversion == "won"
    assert by_lead[lost["id"]].conversion == "lost"
