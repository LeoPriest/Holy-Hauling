# Lead Outcome Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A materialized `lead_outcome` table — one evolving row per lead — that freezes the decision-time snapshot plus the real-world result (conversion, realized price, escalation), kept current by an idempotent reconciliation sweep on the existing scheduler, with a startup backfill and a read endpoint.

**Architecture:** New `LeadOutcome` model + Pydantic out-schema. `outcome_service` derives a row from a lead's status, finance transactions, escalations, AI reviews, and lead events, and upserts it (finalized rows are frozen). The reconciler runs every 15 min and once at startup (backfill). A read-only `GET /admin/outcomes` endpoint exposes the rows. This is item 1 of the self-learning roadmap; items 2 (retrieval grounding) and 3 (eval) consume these rows later and are out of scope here.

**Tech Stack:** FastAPI, SQLAlchemy 2.x async + aiosqlite, Pydantic v2, APScheduler.

**Spec:** `docs/superpowers/specs/2026-06-17-lead-outcome-layer-design.md`

---

## File Structure

**Create:**
- `app/backend/app/models/lead_outcome.py` — the table
- `app/backend/app/schemas/outcome.py` — `LeadOutcomeOut`
- `app/backend/app/services/outcome_service.py` — computation + reconcile + entry point
- `app/backend/app/routers/outcomes.py` — read endpoint
- `app/backend/tests/test_outcome_service.py` — reconciler/computation tests
- `app/backend/tests/test_outcomes_api.py` — read-endpoint tests

**Modify:**
- `app/backend/main.py` — register model import, schedule the reconciler, backfill at startup, register the router

---

## Task 1: `LeadOutcome` model + schema + registration

**Files:**
- Create: `app/backend/app/models/lead_outcome.py`
- Create: `app/backend/app/schemas/outcome.py`
- Modify: `app/backend/main.py`

- [ ] **Step 1: Write the model**

`app/backend/app/models/lead_outcome.py`:

```python
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text

from app.database import Base

# String-valued vocabularies (validated in code; stored as plain strings)
CONVERSIONS = ("won", "lost", "pending")


class LeadOutcome(Base):
    __tablename__ = "lead_outcomes"

    lead_id = Column(String, ForeignKey("leads.id", ondelete="CASCADE"), primary_key=True)
    city_id = Column(String, nullable=False)
    conversion = Column(String, nullable=False)            # won | lost | pending
    terminal_status = Column(String, nullable=False)       # booked | released | lost
    quoted_price_cents = Column(Integer, nullable=True)
    realized_revenue_cents = Column(Integer, nullable=True)
    realized_cost_cents = Column(Integer, nullable=True)
    price_delta_cents = Column(Integer, nullable=True)
    was_escalated = Column(Boolean, nullable=False, default=False)
    escalation_outcome = Column(String, nullable=True)
    scope_snapshot = Column(Text, nullable=True)           # JSON string of frozen scope fields
    ai_prompt_version = Column(String, nullable=True)
    booked_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    time_to_book_minutes = Column(Integer, nullable=True)
    finalized = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
```

- [ ] **Step 2: Write the schema**

`app/backend/app/schemas/outcome.py`:

```python
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class LeadOutcomeOut(BaseModel):
    lead_id: str
    city_id: str
    conversion: str
    terminal_status: str
    quoted_price_cents: Optional[int] = None
    realized_revenue_cents: Optional[int] = None
    realized_cost_cents: Optional[int] = None
    price_delta_cents: Optional[int] = None
    was_escalated: bool
    escalation_outcome: Optional[str] = None
    scope_snapshot: Optional[str] = None
    ai_prompt_version: Optional[str] = None
    booked_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    time_to_book_minutes: Optional[int] = None
    finalized: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
```

- [ ] **Step 3: Register the model import in `main.py`**

In `app/backend/main.py`, after the line `import app.models.lead_escalation  # noqa: F401` (it follows `import app.models.recurring_expense`), add:

```python
import app.models.lead_outcome  # noqa: F401
```

- [ ] **Step 4: Verify it imports**

Run: `cd app/backend ; python -c "import main ; from app.schemas.outcome import LeadOutcomeOut ; print('OK')"`
Expected: prints `OK`. (PowerShell — the cwd resets between commands; keep `cd` and the python call in one command.)

- [ ] **Step 5: Commit**

```bash
git add app/backend/app/models/lead_outcome.py app/backend/app/schemas/outcome.py app/backend/main.py
git commit -m "feat(outcome): LeadOutcome model + schema + register"
```

---

## Task 2: `outcome_service` — computation + reconcile

**Files:**
- Create: `app/backend/app/services/outcome_service.py`
- Create: `app/backend/tests/test_outcome_service.py`

- [ ] **Step 1: Write the failing tests**

`app/backend/tests/test_outcome_service.py`:

```python
"""Outcome reconciliation tests — derive lead_outcome rows from lead state + finance + escalation."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select, text

from app.models.lead_outcome import LeadOutcome
from app.services.outcome_service import reconcile_outcomes


async def _make_lead(client, **overrides) -> tuple[str, str]:
    payload = {"source_type": "manual", "customer_name": "Outcome Cust", "service_type": "moving"}
    payload.update(overrides)
    r = await client.post("/leads", json=payload)
    assert r.status_code == 201, r.text
    body = r.json()
    return body["id"], body["city_id"]


async def _set_status(db_session, lead_id: str, status: str) -> None:
    await db_session.execute(text("UPDATE leads SET status = :s WHERE id = :id"), {"s": status, "id": lead_id})
    await db_session.commit()


async def _add_finance(db_session, lead_id: str, city_id: str, txn_type: str, cents: int) -> None:
    await db_session.execute(text(
        "INSERT INTO finance_transactions (id, city_id, occurred_on, transaction_type, category, amount_cents, lead_id, created_at, updated_at) "
        "VALUES (:id, :city, :on, :tt, 'job', :amt, :lid, :now, :now)"
    ), {
        "id": str(uuid.uuid4()), "city": city_id, "on": datetime.now(timezone.utc).date(),
        "tt": txn_type, "amt": cents, "lid": lead_id, "now": datetime.now(timezone.utc),
    })
    await db_session.commit()


async def _get_outcome(db_session, lead_id: str) -> LeadOutcome | None:
    return (await db_session.execute(select(LeadOutcome).where(LeadOutcome.lead_id == lead_id))).scalar_one_or_none()


async def test_booked_lead_becomes_won(client, db_session):
    lead_id, city = await _make_lead(client)
    await _set_status(db_session, lead_id, "booked")
    await reconcile_outcomes(db_session, city)
    row = await _get_outcome(db_session, lead_id)
    assert row is not None
    assert row.conversion == "won"
    assert row.terminal_status == "booked"
    assert row.finalized is False  # booked but not completed


async def test_released_lead_is_won_and_finalized(client, db_session):
    lead_id, city = await _make_lead(client)
    await _set_status(db_session, lead_id, "released")
    await reconcile_outcomes(db_session, city)
    row = await _get_outcome(db_session, lead_id)
    assert row.conversion == "won"
    assert row.finalized is True


async def test_lost_lead_is_lost_and_finalized(client, db_session):
    lead_id, city = await _make_lead(client)
    await _set_status(db_session, lead_id, "lost")
    await reconcile_outcomes(db_session, city)
    row = await _get_outcome(db_session, lead_id)
    assert row.conversion == "lost"
    assert row.finalized is True


async def test_non_terminal_lead_gets_no_row(client, db_session):
    lead_id, city = await _make_lead(client)  # status 'new'
    await reconcile_outcomes(db_session, city)
    assert await _get_outcome(db_session, lead_id) is None


async def test_realized_revenue_cost_and_delta(client, db_session):
    lead_id, city = await _make_lead(client)
    await db_session.execute(text("UPDATE leads SET quote_cents = 50000 WHERE id = :id"), {"id": lead_id})
    await db_session.commit()
    await _set_status(db_session, lead_id, "released")
    await _add_finance(db_session, lead_id, city, "income", 52000)
    await _add_finance(db_session, lead_id, city, "expense", 8000)
    await reconcile_outcomes(db_session, city)
    row = await _get_outcome(db_session, lead_id)
    assert row.quoted_price_cents == 50000
    assert row.realized_revenue_cents == 52000
    assert row.realized_cost_cents == 8000
    assert row.price_delta_cents == 2000  # 52000 - 50000


async def test_no_finance_leaves_amounts_null(client, db_session):
    lead_id, city = await _make_lead(client)
    await _set_status(db_session, lead_id, "released")
    await reconcile_outcomes(db_session, city)
    row = await _get_outcome(db_session, lead_id)
    assert row.realized_revenue_cents is None
    assert row.price_delta_cents is None


async def test_finalized_row_is_frozen(client, db_session):
    lead_id, city = await _make_lead(client)
    await _set_status(db_session, lead_id, "lost")
    await reconcile_outcomes(db_session, city)
    # Now data changes underneath a finalized row; a re-run must NOT overwrite it
    await _add_finance(db_session, lead_id, city, "income", 99999)
    await reconcile_outcomes(db_session, city)
    row = await _get_outcome(db_session, lead_id)
    assert row.realized_revenue_cents is None  # frozen — the late income is ignored


async def test_unfinalized_booked_row_fills_in_revenue_on_next_sweep(client, db_session):
    lead_id, city = await _make_lead(client)
    await _set_status(db_session, lead_id, "booked")
    await reconcile_outcomes(db_session, city)
    assert (await _get_outcome(db_session, lead_id)).realized_revenue_cents is None
    # Revenue lands later; booked row is not finalized, so the next sweep updates it
    await _add_finance(db_session, lead_id, city, "income", 40000)
    await reconcile_outcomes(db_session, city)
    assert (await _get_outcome(db_session, lead_id)).realized_revenue_cents == 40000


async def test_reconcile_is_idempotent(client, db_session):
    lead_id, city = await _make_lead(client)
    await _set_status(db_session, lead_id, "booked")
    await reconcile_outcomes(db_session, city)
    await reconcile_outcomes(db_session, city)
    rows = (await db_session.execute(select(LeadOutcome).where(LeadOutcome.lead_id == lead_id))).scalars().all()
    assert len(rows) == 1


async def test_escalation_fields_populated(client, db_session):
    lead_id, city = await _make_lead(client)
    # Raise + resolve an escalation through the API so the overlay rows exist
    esc = (await client.post(f"/leads/{lead_id}/escalation", json={
        "level": "pause", "decision_needed": "price", "summary": "x",
    })).json()
    await client.post(f"/escalations/{esc['id']}/resolve", json={"outcome": "approved"})
    await _set_status(db_session, lead_id, "released")
    await reconcile_outcomes(db_session, city)
    row = await _get_outcome(db_session, lead_id)
    assert row.was_escalated is True
    assert row.escalation_outcome == "approved"


async def test_scope_snapshot_and_prompt_version(client, db_session):
    lead_id, city = await _make_lead(client, move_size_label="2 bedroom apartment")
    await _set_status(db_session, lead_id, "released")
    await reconcile_outcomes(db_session, city)
    row = await _get_outcome(db_session, lead_id)
    assert "2 bedroom apartment" in (row.scope_snapshot or "")
    # No AI review created in this test → prompt version is null
    assert row.ai_prompt_version is None
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app/backend ; python -m pytest tests/test_outcome_service.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.outcome_service'` (or import error).

- [ ] **Step 3: Write the service**

`app/backend/app/services/outcome_service.py`:

```python
"""
Lead outcome layer.

Derives a stable, queryable `lead_outcome` row per lead — the decision-time
snapshot plus the real-world result (conversion, realized price, escalation).
Kept current by an idempotent reconciliation sweep; finalized rows are frozen.

This is item 1 of the self-learning roadmap. Items 2 (retrieval grounding) and
3 (eval) read these rows; this module does not consume them.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models.ai_review import AiReview
from app.models.city import City, DEFAULT_CITY_ID
from app.models.finance import FinanceTransaction, FinanceTransactionType
from app.models.lead import Lead, LeadStatus
from app.models.lead_escalation import LeadEscalation
from app.models.lead_event import LeadEvent
from app.models.lead_outcome import LeadOutcome

_log = logging.getLogger(__name__)

_TERMINAL = (LeadStatus.booked, LeadStatus.released, LeadStatus.lost)


def _conversion_and_terminal(lead: Lead) -> tuple[str, str] | None:
    """(conversion, terminal_status) for a terminal-ish lead, else None."""
    if lead.status in (LeadStatus.booked, LeadStatus.released):
        return "won", lead.status.value
    if lead.status == LeadStatus.lost:
        return "lost", lead.status.value
    return None


def _is_finalized(lead: Lead) -> bool:
    return lead.status in (LeadStatus.lost, LeadStatus.released)


def _quoted_price_cents(lead: Lead) -> int | None:
    if lead.quote_cents is not None:
        return lead.quote_cents
    if lead.quoted_price_total is not None:
        return round(lead.quoted_price_total * 100)
    return None


def _scope_snapshot(lead: Lead) -> str:
    fields = {
        "service_type": lead.service_type.value if lead.service_type else None,
        "job_location": lead.job_location,
        "job_origin": lead.job_origin,
        "job_destination": lead.job_destination,
        "move_size_label": lead.move_size_label,
        "move_type": lead.move_type,
        "move_distance_miles": lead.move_distance_miles,
        "load_stairs": lead.load_stairs,
        "unload_stairs": lead.unload_stairs,
        "scope_notes": lead.scope_notes,
    }
    return json.dumps(fields)


async def _realized_amounts(db: AsyncSession, lead_id: str) -> tuple[int | None, int | None]:
    """(revenue_cents, cost_cents) from finance txns, or (None, None) when absent."""
    result = await db.execute(
        select(FinanceTransaction.transaction_type, func.sum(FinanceTransaction.amount_cents))
        .where(FinanceTransaction.lead_id == lead_id)
        .group_by(FinanceTransaction.transaction_type)
    )
    revenue: int | None = None
    cost: int | None = None
    for txn_type, total in result.all():
        if txn_type == FinanceTransactionType.income:
            revenue = int(total)
        elif txn_type == FinanceTransactionType.expense:
            cost = int(total)
    return revenue, cost


async def _escalation_fields(db: AsyncSession, lead_id: str) -> tuple[bool, str | None]:
    result = await db.execute(
        select(LeadEscalation)
        .where(LeadEscalation.lead_id == lead_id)
        .order_by(LeadEscalation.raised_at.desc())
    )
    escs = result.scalars().all()
    if not escs:
        return False, None
    outcome = next((e.outcome for e in escs if e.status == "resolved" and e.outcome), None)
    return True, outcome


async def _latest_prompt_version(db: AsyncSession, lead_id: str) -> str | None:
    result = await db.execute(
        select(AiReview.prompt_version)
        .where(AiReview.lead_id == lead_id)
        .order_by(AiReview.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _booked_completed_times(db: AsyncSession, lead: Lead):
    booked_at = (await db.execute(
        select(func.min(LeadEvent.created_at)).where(
            LeadEvent.lead_id == lead.id,
            LeadEvent.event_type == "status_changed",
            LeadEvent.to_status == "booked",
        )
    )).scalar_one_or_none()
    completed_at = (await db.execute(
        select(func.min(LeadEvent.created_at)).where(
            LeadEvent.lead_id == lead.id,
            LeadEvent.event_type == "status_changed",
            LeadEvent.to_status == "released",
        )
    )).scalar_one_or_none()
    ttb = None
    if booked_at is not None and lead.created_at is not None:
        ttb = int((booked_at - lead.created_at).total_seconds() / 60)
    return booked_at, completed_at, ttb


async def upsert_outcome(db: AsyncSession, lead: Lead) -> LeadOutcome | None:
    """Compute and upsert the outcome row for a terminal-ish lead. Frozen if finalized."""
    conv = _conversion_and_terminal(lead)
    if conv is None:
        return None
    conversion, terminal_status = conv

    existing = (await db.execute(
        select(LeadOutcome).where(LeadOutcome.lead_id == lead.id)
    )).scalar_one_or_none()
    if existing is not None and existing.finalized:
        return existing  # frozen — preserve the decision-time snapshot

    revenue, cost = await _realized_amounts(db, lead.id)
    quoted = _quoted_price_cents(lead)
    delta = (revenue - quoted) if (revenue is not None and quoted is not None) else None
    was_esc, esc_outcome = await _escalation_fields(db, lead.id)
    booked_at, completed_at, ttb = await _booked_completed_times(db, lead)
    now = datetime.now(timezone.utc)

    values = dict(
        city_id=lead.city_id,
        conversion=conversion,
        terminal_status=terminal_status,
        quoted_price_cents=quoted,
        realized_revenue_cents=revenue,
        realized_cost_cents=cost,
        price_delta_cents=delta,
        was_escalated=was_esc,
        escalation_outcome=esc_outcome,
        scope_snapshot=_scope_snapshot(lead),
        ai_prompt_version=await _latest_prompt_version(db, lead.id),
        booked_at=booked_at,
        completed_at=completed_at,
        time_to_book_minutes=ttb,
        finalized=_is_finalized(lead),
        updated_at=now,
    )

    if existing is None:
        row = LeadOutcome(lead_id=lead.id, created_at=now, **values)
        db.add(row)
    else:
        for key, val in values.items():
            setattr(existing, key, val)
        row = existing
    await db.commit()
    await db.refresh(row)
    return row


async def reconcile_outcomes(db: AsyncSession, city_id: str = DEFAULT_CITY_ID) -> int:
    """Upsert outcome rows for terminal-ish leads in a city. Idempotent; frozen rows skipped."""
    leads = (await db.execute(
        select(Lead).where(Lead.city_id == city_id, Lead.status.in_(_TERMINAL))
    )).scalars().all()
    count = 0
    for lead in leads:
        try:
            existing = (await db.execute(
                select(LeadOutcome).where(LeadOutcome.lead_id == lead.id)
            )).scalar_one_or_none()
            if existing is not None and existing.finalized:
                continue
            await upsert_outcome(db, lead)
            count += 1
        except Exception as exc:  # best-effort per lead — never abort the sweep
            _log.warning("[outcome_reconciler] failed for lead %s: %s", lead.id, exc)
    return count


async def reconcile_all_outcomes() -> None:
    """Entry point for the scheduler and the startup backfill — own session, all active cities."""
    try:
        async with AsyncSessionLocal() as db:
            cities = (await db.execute(select(City).where(City.is_active == True))).scalars().all()
            for city in cities:
                await reconcile_outcomes(db, city.id)
    except Exception as exc:
        _log.error("[outcome_reconciler] error: %s", exc)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app/backend ; python -m pytest tests/test_outcome_service.py -q`
Expected: 11 passed.

If a test fails on a real defect, fix the SERVICE (this task owns it). Do not weaken a test. If a failure reveals a wrong assumption about the schema/DB (e.g. a column name), report DONE_WITH_CONCERNS with the diagnosis.

- [ ] **Step 5: Commit**

```bash
git add app/backend/app/services/outcome_service.py app/backend/tests/test_outcome_service.py
git commit -m "feat(outcome): reconciliation service + computation, with tests"
```

---

## Task 3: Schedule the reconciler + startup backfill

**Files:**
- Modify: `app/backend/main.py`
- Create: `app/backend/tests/test_outcome_backfill.py`

- [ ] **Step 1: Write the failing test**

`app/backend/tests/test_outcome_backfill.py`:

```python
"""The reconciler-as-backfill creates rows for pre-existing terminal leads."""

from __future__ import annotations

from sqlalchemy import select, text

from app.models.lead_outcome import LeadOutcome
from app.services.outcome_service import reconcile_outcomes


async def test_backfill_creates_rows_for_existing_terminal_leads(client, db_session):
    # Two terminal leads already in the DB before any reconcile has run
    won = (await client.post("/leads", json={"source_type": "manual", "customer_name": "A", "service_type": "moving"})).json()
    lost = (await client.post("/leads", json={"source_type": "manual", "customer_name": "B", "service_type": "moving"})).json()
    await db_session.execute(text("UPDATE leads SET status = 'released' WHERE id = :id"), {"id": won["id"]})
    await db_session.execute(text("UPDATE leads SET status = 'lost' WHERE id = :id"), {"id": lost["id"]})
    await db_session.commit()

    # Backfill == running the same reconciler over the city
    await reconcile_outcomes(db_session, won["city_id"])

    rows = (await db_session.execute(select(LeadOutcome))).scalars().all()
    by_lead = {r.lead_id: r for r in rows}
    assert by_lead[won["id"]].conversion == "won"
    assert by_lead[lost["id"]].conversion == "lost"
```

- [ ] **Step 2: Run it to verify it passes already**

Run: `cd app/backend ; python -m pytest tests/test_outcome_backfill.py -q`
Expected: 1 passed. (This test exercises the Task-2 reconciler directly; it documents the backfill contract that Step 3 wires into startup.)

- [ ] **Step 3: Schedule the reconciler + backfill in `main.py`**

In `app/backend/main.py`, inside `lifespan`, the scheduler jobs are registered around here:

```python
    from app.services.alert_service import check_stale_leads
    from app.services.followup_service import check_due_followups
    _scheduler.add_job(check_stale_leads, "interval", minutes=5, id="check_stale_leads", replace_existing=True)
    _scheduler.add_job(check_due_followups, "interval", minutes=1, id="check_due_followups", replace_existing=True)
    _scheduler.start()
```

Change that block to also run the backfill once and schedule the reconciler:

```python
    from app.services.alert_service import check_stale_leads
    from app.services.followup_service import check_due_followups
    from app.services.outcome_service import reconcile_all_outcomes
    await reconcile_all_outcomes()  # backfill existing terminal leads at startup
    _scheduler.add_job(check_stale_leads, "interval", minutes=5, id="check_stale_leads", replace_existing=True)
    _scheduler.add_job(check_due_followups, "interval", minutes=1, id="check_due_followups", replace_existing=True)
    _scheduler.add_job(reconcile_all_outcomes, "interval", minutes=15, id="reconcile_outcomes", replace_existing=True)
    _scheduler.start()
```

Note: `reconcile_all_outcomes()` opens its own `AsyncSessionLocal` and runs after `engine.begin()`/`create_all` have completed, so the schema exists. It is best-effort (wrapped in try/except) and safe to call at startup.

- [ ] **Step 4: Verify the app boots cleanly**

Run: `cd app/backend ; python -c "import main ; print('OK')"`
Expected: prints `OK`.

- [ ] **Step 5: Commit**

```bash
git add app/backend/main.py app/backend/tests/test_outcome_backfill.py
git commit -m "feat(outcome): schedule reconciler every 15m + startup backfill"
```

---

## Task 4: Read endpoint + router registration

**Files:**
- Create: `app/backend/app/routers/outcomes.py`
- Create: `app/backend/tests/test_outcomes_api.py`
- Modify: `app/backend/main.py`

- [ ] **Step 1: Write the failing test**

`app/backend/tests/test_outcomes_api.py`:

```python
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app/backend ; python -m pytest tests/test_outcomes_api.py -q`
Expected: FAIL — 404 (route not registered).

- [ ] **Step 3: Write the router**

`app/backend/app/routers/outcomes.py`:

```python
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_auth
from app.models.lead_outcome import LeadOutcome
from app.models.user import User
from app.schemas.outcome import LeadOutcomeOut

router = APIRouter(tags=["outcomes"])


@router.get("/admin/outcomes", response_model=list[LeadOutcomeOut])
async def list_outcomes(
    city_id: str | None = Query(None),
    conversion: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_auth),
):
    stmt = select(LeadOutcome).order_by(LeadOutcome.updated_at.desc())
    if city_id:
        stmt = stmt.where(LeadOutcome.city_id == city_id)
    if conversion:
        stmt = stmt.where(LeadOutcome.conversion == conversion)
    return (await db.execute(stmt)).scalars().all()
```

- [ ] **Step 4: Register the router in `main.py`**

(a) Add `outcomes` to the `from app.routers import ...` line (alphabetical: after `jobs,` / before `payroll,` works — keep it readable):

```python
from app.routers import admin_cities, admin_google, admin_metrics, admin_users, auth as auth_router, chat, escalation, finance, ingest, jobs, leads, outcomes, payroll, push, recurring_expenses, settings as settings_router, square_router, truck_rental, users
```

(b) After `app.include_router(escalation.router)`, add:

```python
app.include_router(outcomes.router)
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd app/backend ; python -m pytest tests/test_outcomes_api.py -q`
Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add app/backend/app/routers/outcomes.py app/backend/tests/test_outcomes_api.py app/backend/main.py
git commit -m "feat(outcome): GET /admin/outcomes read endpoint"
```

---

## Task 5: Docs + full suite green

**Files:**
- Modify: `CAPABILITIES.md`

- [ ] **Step 1: Run the full backend suite**

Run: `cd app/backend ; python -m pytest -q`
Expected: all passed (the prior 277 + the new outcome tests). If anything unrelated breaks, diagnose to root cause before proceeding.

- [ ] **Step 2: Update `CAPABILITIES.md`**

Add a section describing the outcome layer: `lead_outcome` is a materialized, reconciled record (one row per terminal lead) capturing conversion (won/lost), quoted vs realized price (+ cost/delta), escalation outcome, a frozen `scope_snapshot`, and the AI `prompt_version`; kept current by a 15-min reconciler + startup backfill; read via `GET /admin/outcomes`. Note it is item 1 of the self-learning roadmap (foundation for retrieval grounding + eval, both out of scope so far). Update the test count to the new total.

- [ ] **Step 3: Commit**

```bash
git add CAPABILITIES.md
git commit -m "docs(outcome): capabilities + suite green"
```

---

## Self-Review Notes (addressed)

- **Spec coverage:** model+schema (T1), computation/conversion/finance/escalation/scope/prompt/timings + reconciler + entry point (T2), 15-min schedule + startup backfill (T3), read endpoint + registration (T4), docs + suite (T5). Every spec section maps to a task.
- **Finalization semantics:** `_is_finalized` = `lost` or `released`; `upsert_outcome` returns the frozen row unchanged when `existing.finalized`; `reconcile_outcomes` skips finalized rows before recomputing — covered by `test_finalized_row_is_frozen` and `test_unfinalized_booked_row_fills_in_revenue_on_next_sweep`.
- **Realized price = finance income sum; cost = expense sum; delta = revenue − quoted** — `_realized_amounts` + delta guard; null-safe (`test_no_finance_leaves_amounts_null`).
- **Type consistency:** `reconcile_outcomes(db, city_id)`, `reconcile_all_outcomes()`, `upsert_outcome(db, lead)`, conversions `won|lost|pending`, terminal `booked|released|lost` — identical across model, service, tests, and the `LeadOutcomeOut` schema.
- **Flagged verification:** the test helper inserts `finance_transactions` via raw SQL with the columns from `app/backend/app/models/finance.py` (`id, city_id, occurred_on, transaction_type, category, amount_cents, lead_id, created_at, updated_at`); if that table's columns differ at implementation time, the implementer adjusts the INSERT to match.
