"""Startup migration: legacy status=escalated leads become overlays."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import text

from main import _migrate_escalated_status_leads


async def test_migration_moves_escalated_lead_to_overlay(client, db_session):
    # Seed a lead, force it to the legacy escalated status with a prior-status event
    r = await client.post("/leads", json={"source_type": "manual", "customer_name": "Legacy", "service_type": "moving"})
    lead_id = r.json()["id"]
    await db_session.execute(text("UPDATE leads SET status = 'escalated' WHERE id = :id"), {"id": lead_id})
    await db_session.execute(text(
        "INSERT INTO lead_events (id, lead_id, event_type, from_status, to_status, created_at) "
        "VALUES (:id, :lid, 'status_changed', 'ready_for_quote', 'escalated', :now)"
    ), {"id": str(uuid.uuid4()), "lid": lead_id, "now": datetime.now(timezone.utc)})
    await db_session.commit()

    # Run migration against the same connection the test session uses
    conn = await db_session.connection()
    await _migrate_escalated_status_leads(conn)
    await db_session.commit()

    lead = (await client.get(f"/leads/{lead_id}")).json()
    assert lead["status"] == "ready_for_quote"  # restored from the prior-status event
    esc = (await client.get(f"/leads/{lead_id}/escalation")).json()
    assert esc is not None
    assert esc["source"] == "auto_idle"


async def test_migration_is_idempotent(client, db_session):
    r = await client.post("/leads", json={"source_type": "manual", "customer_name": "Legacy2", "service_type": "moving"})
    lead_id = r.json()["id"]
    await db_session.execute(text("UPDATE leads SET status = 'escalated' WHERE id = :id"), {"id": lead_id})
    await db_session.commit()

    conn = await db_session.connection()
    await _migrate_escalated_status_leads(conn)
    await db_session.commit()
    # Re-acquire the connection after commit (the session releases the prior one)
    conn = await db_session.connection()
    await _migrate_escalated_status_leads(conn)  # second run is a no-op
    await db_session.commit()

    rows = (await client.get("/escalations?status=open")).json()
    assert len([x for x in rows if x["lead_id"] == lead_id]) == 1  # not duplicated
    lead = (await client.get(f"/leads/{lead_id}")).json()
    assert lead["status"] == "in_review"  # fallback (no prior-status event)
