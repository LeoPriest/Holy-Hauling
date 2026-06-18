"""GET /admin/outcomes read endpoint."""

from __future__ import annotations

from sqlalchemy import text

from app.services.outcome_service import reconcile_outcomes


async def _terminal_lead(client, db_session, status: str) -> tuple[str, str]:
    body = (await client.post("/leads", json={"source_type": "manual", "customer_name": "C", "service_type": "moving"})).json()
    await db_session.execute(text("UPDATE leads SET status = :s WHERE id = :id"), {"s": status, "id": body["id"]})
    await db_session.commit()
    return body["id"], body["city_id"]


async def test_list_outcomes_returns_rows(client, db_session):
    lead_id, city = await _terminal_lead(client, db_session, "released")
    await reconcile_outcomes(db_session, city)
    r = await client.get("/admin/outcomes")
    assert r.status_code == 200, r.text
    rows = r.json()
    assert any(row["lead_id"] == lead_id and row["conversion"] == "won" for row in rows)


async def test_list_outcomes_filters_by_conversion(client, db_session):
    won_id, city = await _terminal_lead(client, db_session, "released")
    lost_id, _ = await _terminal_lead(client, db_session, "lost")
    await reconcile_outcomes(db_session, city)
    rows = (await client.get("/admin/outcomes?conversion=lost")).json()
    ids = {row["lead_id"] for row in rows}
    assert lost_id in ids
    assert won_id not in ids
