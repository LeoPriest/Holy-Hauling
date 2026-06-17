# Escalation, Reconciled — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make escalation a resolvable overlay on a lead (level + AI summary + decision-needed → owner review → outcome), decoupled from the pipeline status, and reconcile the idle timer to raise that overlay instead of flipping `status` to `escalated`.

**Architecture:** New `LeadEscalation` table (one row per escalation, history preserved). `LeadStatus.escalated` stays defined but becomes unreachable. A startup migration moves any live `escalated` lead back to a real stage and opens an overlay. The alert ladder's T2 status-flip becomes an overlay raise. Backend service + router expose suggest/raise/resolve/list; the AI summary reuses `ai_review_service` helpers exactly like `quote_service`. Frontend adds an Escalate sheet (Log tab), an escalation card + Resolve in the lead window, and a pinned "Escalations" band + card badge on the queue.

**Tech Stack:** FastAPI, SQLAlchemy 2.x async + aiosqlite, Pydantic v2, anthropic SDK; React 18 + TS + Vite + Tailwind + TanStack Query.

**Spec:** `docs/superpowers/specs/2026-06-16-escalation-reconciled-design.md`

---

## File Structure

**Backend — create:**
- `app/backend/app/models/lead_escalation.py` — the table + string-valued constants
- `app/backend/app/schemas/escalation.py` — Pydantic in/out models
- `app/backend/app/services/escalation_service.py` — raise / resolve / suggest / auto-open / query helpers
- `app/backend/app/routers/escalation.py` — endpoints
- `app/backend/tests/test_escalation.py` — lifecycle + query tests
- `app/backend/tests/test_escalation_suggest.py` — AI summary tests
- `app/backend/tests/test_escalation_migration.py` — startup migration test

**Backend — modify:**
- `app/backend/main.py` — register model import, router, and the migration
- `app/backend/app/services/alert_service.py` — replace the T2 status-flip with an overlay raise
- `app/backend/tests/test_alert_service.py` — update `test_t2_escalates_lead_status`

**Frontend — create:**
- `app/frontend/src/types/escalation.ts`
- `app/frontend/src/hooks/useEscalation.ts`
- `app/frontend/src/components/EscalateSheet.tsx`
- `app/frontend/src/components/EscalationCard.tsx`

**Frontend — modify:**
- `app/frontend/src/screens/panels/LogPanel.tsx` — Escalate button + sheet trigger; drop `escalated` from the status list
- `app/frontend/src/screens/LeadCommandCenter.tsx` — render the escalation card above the tabs
- `app/frontend/src/screens/LeadQueue.tsx` — pinned Escalations band; drop the `escalated` stage; pass `isEscalated` to cards
- `app/frontend/src/components/LeadCard.tsx` — escalation badge

**Docs — modify:**
- `CAPABILITIES.md`

---

## Task 1: `LeadEscalation` model

**Files:**
- Create: `app/backend/app/models/lead_escalation.py`

- [ ] **Step 1: Write the model**

```python
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, String, Text

from app.database import Base

# String-valued vocabularies (validated in Pydantic; stored as plain strings)
LEVELS = ("monitor", "pause", "owner_takeover")
SOURCES = ("manual", "auto_idle")
STATUSES = ("open", "resolved")
OUTCOMES = ("approved", "adjusted", "owner_takeover", "release", "need_more_info")


class LeadEscalation(Base):
    __tablename__ = "lead_escalations"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    lead_id = Column(String, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False)
    level = Column(String, nullable=False)            # monitor | pause | owner_takeover
    source = Column(String, nullable=False)           # manual | auto_idle
    decision_needed = Column(String, nullable=False)
    summary = Column(Text, nullable=False)
    raised_by = Column(String, nullable=True)
    raised_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    status = Column(String, nullable=False, default="open")   # open | resolved
    outcome = Column(String, nullable=True)
    resolution_note = Column(Text, nullable=True)
    resolved_by = Column(String, nullable=True)
    resolved_at = Column(DateTime, nullable=True)
```

- [ ] **Step 2: Register the model import in `main.py`**

In `app/backend/main.py`, after line `import app.models.recurring_expense  # noqa: F401` (line 41), add:

```python
import app.models.lead_escalation  # noqa: F401
```

- [ ] **Step 3: Commit**

```bash
git add app/backend/app/models/lead_escalation.py app/backend/main.py
git commit -m "feat(escalation): LeadEscalation model + register"
```

---

## Task 2: Pydantic schemas

**Files:**
- Create: `app/backend/app/schemas/escalation.py`

- [ ] **Step 1: Write the schemas**

```python
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

Level = Literal["monitor", "pause", "owner_takeover"]
Outcome = Literal["approved", "adjusted", "owner_takeover", "release", "need_more_info"]


class RaiseEscalationIn(BaseModel):
    level: Level
    decision_needed: str = Field(min_length=1)
    summary: str = Field(min_length=1)
    raised_by: Optional[str] = None


class ResolveEscalationIn(BaseModel):
    outcome: Outcome
    resolution_note: Optional[str] = None
    resolved_by: Optional[str] = None


class EscalationSummaryOut(BaseModel):
    summary: str


class LeadEscalationOut(BaseModel):
    id: str
    lead_id: str
    level: str
    source: str
    decision_needed: str
    summary: str
    raised_by: Optional[str] = None
    raised_at: datetime
    status: str
    outcome: Optional[str] = None
    resolution_note: Optional[str] = None
    resolved_by: Optional[str] = None
    resolved_at: Optional[datetime] = None
    # Populated via join when listing for the queue band
    lead_customer_name: Optional[str] = None
    lead_status: Optional[str] = None

    model_config = {"from_attributes": True}
```

- [ ] **Step 2: Commit**

```bash
git add app/backend/app/schemas/escalation.py
git commit -m "feat(escalation): request/response schemas"
```

---

## Task 3: `escalation_service`

**Files:**
- Create: `app/backend/app/services/escalation_service.py`

- [ ] **Step 1: Write the service**

```python
"""
Escalation overlay service.

Escalation is modeled as a resolvable overlay on a lead, independent of the
pipeline status. A lead has at most one open escalation at a time. The AI
summary reuses ai_review_service's client/grounding helpers, mirroring
quote_service.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai_review import AiReview
from app.models.lead import Lead
from app.models.lead_escalation import LeadEscalation
from app.models.lead_event import LeadEvent
from app.services.ai_review_service import (
    _load_grounding,
    _make_client,
    _require_api_key,
    _require_model,
)

_log = logging.getLogger(__name__)

_SYSTEM_PROMPT_TEMPLATE = """
You are the Escalation Assistant for Holy Hauling, a moving and junk hauling company.
A lead handler is escalating a lead to the owner for a decision. Using the lead scope
and any prior AI review below, write a concise Escalation Summary in exactly this format:

Lead type: <moving | hauling>
Customer request: <what they want right now>
Scope as understood: <short summary>
Access/risk: <stairs, elevator, heavy items, dump burden, etc.>
AI posture: <pricing posture / escalation notes from the review, or "none">
Decision needed: <price | schedule | truck | release | owner takeover>

Be specific and brief. Do not invent facts not present in the scope. Output only the summary.

[HOLY HAULING SOPs]
{grounding}
""".strip()


def _build_scope(lead: Lead) -> str:
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
        "quote_context": lead.quote_context,
        "current_status": lead.status.value if lead.status else None,
    }
    return "\n".join(f"{k}: {v}" for k, v in fields.items() if v is not None)


async def _latest_ai_posture(db: AsyncSession, lead_id: str) -> str:
    result = await db.execute(
        select(AiReview).where(AiReview.lead_id == lead_id).order_by(AiReview.created_at.desc()).limit(1)
    )
    review = result.scalar_one_or_none()
    if not review:
        return ""
    import json
    try:
        sections = json.loads(review.sections_json)
    except (json.JSONDecodeError, TypeError):
        return ""
    keys = ["l_pricing_guidance", "n_escalation_flags", "o_recommended_action"]
    lines = [f"{k}: {sections[k]}" for k in keys if sections.get(k)]
    return ("\nPRIOR AI REVIEW:\n" + "\n".join(lines)) if lines else ""


async def get_open(db: AsyncSession, lead_id: str) -> LeadEscalation | None:
    result = await db.execute(
        select(LeadEscalation)
        .where(LeadEscalation.lead_id == lead_id, LeadEscalation.status == "open")
        .order_by(LeadEscalation.raised_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def suggest_summary(db: AsyncSession, lead: Lead) -> str:
    """Assemble an AI Escalation Summary. Raises HTTPException(503) if AI unconfigured."""
    api_key = _require_api_key()
    model = _require_model()
    grounding_content, _ = _load_grounding()
    system_prompt = _SYSTEM_PROMPT_TEMPLATE.format(grounding=grounding_content)
    user_content = "LEAD SCOPE:\n" + _build_scope(lead) + await _latest_ai_posture(db, lead.id)
    try:
        client = _make_client(api_key)
        response = await client.messages.create(
            model=model,
            max_tokens=512,
            system=system_prompt,
            messages=[{"role": "user", "content": user_content}],
        )
        return response.content[0].text.strip()
    except HTTPException:
        raise
    except Exception as exc:
        _log.exception("Escalation summary call failed")
        raise HTTPException(502, f"Escalation summary call failed: {exc}") from exc


async def _notify(db: AsyncSession, roles: list[str], message: str, city_id: str) -> None:
    try:
        from app.services.push_service import send_push_to_roles
        await send_push_to_roles(db, roles, message, city_id=city_id)
    except Exception as exc:  # push is best-effort, never blocks the flow
        _log.warning("escalation push failed: %s", exc)


async def raise_escalation(
    db: AsyncSession,
    lead: Lead,
    *,
    level: str,
    decision_needed: str,
    summary: str,
    source: str = "manual",
    raised_by: str | None = None,
) -> LeadEscalation:
    """Open an escalation. If one is already open, return it unchanged (idempotent)."""
    existing = await get_open(db, lead.id)
    if existing:
        return existing

    esc = LeadEscalation(
        id=str(uuid.uuid4()),
        lead_id=lead.id,
        level=level,
        source=source,
        decision_needed=decision_needed,
        summary=summary,
        raised_by=raised_by,
        raised_at=datetime.now(timezone.utc),
        status="open",
    )
    db.add(esc)
    db.add(LeadEvent(
        id=str(uuid.uuid4()),
        lead_id=lead.id,
        event_type="escalation_raised",
        actor=raised_by or source,
        note=f"{level} — {decision_needed}",
    ))
    await db.commit()
    await db.refresh(esc)
    await _notify(db, ["admin", "supervisor"], f'Lead escalated ({level}) — {decision_needed}', lead.city_id)
    return esc


async def resolve_escalation(
    db: AsyncSession,
    escalation_id: str,
    *,
    outcome: str,
    resolution_note: str | None,
    resolved_by: str | None,
) -> LeadEscalation:
    result = await db.execute(select(LeadEscalation).where(LeadEscalation.id == escalation_id))
    esc = result.scalar_one_or_none()
    if esc is None:
        raise HTTPException(404, "Escalation not found")
    if esc.status != "open":
        raise HTTPException(409, "Escalation is already resolved")

    esc.status = "resolved"
    esc.outcome = outcome
    esc.resolution_note = resolution_note
    esc.resolved_by = resolved_by
    esc.resolved_at = datetime.now(timezone.utc)
    db.add(LeadEvent(
        id=str(uuid.uuid4()),
        lead_id=esc.lead_id,
        event_type="escalation_resolved",
        actor=resolved_by,
        note=f"{outcome}" + (f" — {resolution_note}" if resolution_note else ""),
    ))
    await db.commit()
    await db.refresh(esc)

    result = await db.execute(select(Lead).where(Lead.id == esc.lead_id))
    lead = result.scalar_one_or_none()
    if lead:
        await _notify(db, ["facilitator"], f'Escalation resolved: {outcome}', lead.city_id)
    return esc


async def open_auto_escalation(db: AsyncSession, lead: Lead) -> LeadEscalation | None:
    """Called by the idle ladder at T2. Best-effort AI summary; static fallback."""
    if await get_open(db, lead.id):
        return None
    try:
        summary = await suggest_summary(db, lead)
    except Exception:
        summary = "Idle past threshold — review. (auto-raised by the alert ladder)"
    return await raise_escalation(
        db, lead,
        level="monitor",
        decision_needed="review",
        summary=summary,
        source="auto_idle",
        raised_by="alert_scheduler",
    )
```

- [ ] **Step 2: Commit**

```bash
git add app/backend/app/services/escalation_service.py
git commit -m "feat(escalation): service — raise/resolve/suggest/auto-open"
```

> **Note for the implementer:** `_latest_ai_posture` references AI review section keys `l_pricing_guidance`, `n_escalation_flags`, `o_recommended_action`. If `app/backend/app/schemas/ai_review.py` uses different key names for the pricing-guidance / escalation / recommended-action sections, substitute the actual keys. The function degrades gracefully (returns "") if keys are absent, so a mismatch is non-fatal but worth getting right.

---

## Task 4: Escalation router + registration

**Files:**
- Create: `app/backend/app/routers/escalation.py`
- Modify: `app/backend/main.py`

- [ ] **Step 1: Write the router**

```python
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_auth
from app.models.lead import Lead
from app.models.lead_escalation import LeadEscalation
from app.models.user import User
from app.schemas.escalation import (
    EscalationSummaryOut,
    LeadEscalationOut,
    RaiseEscalationIn,
    ResolveEscalationIn,
)
from app.services import escalation_service

router = APIRouter(tags=["escalation"])


async def _get_lead_or_404(db: AsyncSession, lead_id: str) -> Lead:
    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    if lead is None:
        raise HTTPException(404, "Lead not found")
    return lead


@router.get("/leads/{lead_id}/escalation", response_model=LeadEscalationOut | None)
async def get_lead_escalation(lead_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_auth)):
    esc = await escalation_service.get_open(db, lead_id)
    return esc


@router.post("/leads/{lead_id}/escalation/suggest", response_model=EscalationSummaryOut)
async def suggest_escalation_summary(lead_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_auth)):
    lead = await _get_lead_or_404(db, lead_id)
    summary = await escalation_service.suggest_summary(db, lead)
    return EscalationSummaryOut(summary=summary)


@router.post("/leads/{lead_id}/escalation", response_model=LeadEscalationOut)
async def raise_lead_escalation(
    lead_id: str,
    body: RaiseEscalationIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_auth),
):
    lead = await _get_lead_or_404(db, lead_id)
    esc = await escalation_service.raise_escalation(
        db, lead,
        level=body.level,
        decision_needed=body.decision_needed,
        summary=body.summary,
        raised_by=body.raised_by or user.username,
    )
    return esc


@router.post("/escalations/{escalation_id}/resolve", response_model=LeadEscalationOut)
async def resolve_lead_escalation(
    escalation_id: str,
    body: ResolveEscalationIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_auth),
):
    return await escalation_service.resolve_escalation(
        db, escalation_id,
        outcome=body.outcome,
        resolution_note=body.resolution_note,
        resolved_by=body.resolved_by or user.username,
    )


@router.get("/escalations", response_model=list[LeadEscalationOut])
async def list_escalations(
    status: str = Query("open"),
    city_id: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_auth),
):
    stmt = (
        select(LeadEscalation, Lead.customer_name, Lead.status)
        .join(Lead, Lead.id == LeadEscalation.lead_id)
        .where(LeadEscalation.status == status)
        .order_by(LeadEscalation.raised_at.desc())
    )
    if city_id:
        stmt = stmt.where(Lead.city_id == city_id)
    rows = (await db.execute(stmt)).all()
    out: list[LeadEscalationOut] = []
    for esc, customer_name, lead_status in rows:
        item = LeadEscalationOut.model_validate(esc)
        item.lead_customer_name = customer_name
        item.lead_status = lead_status.value if lead_status else None
        out.append(item)
    return out
```

- [ ] **Step 2: Register the router in `main.py`**

In `app/backend/main.py`, add `escalation` to the routers import (line 44) and an `include_router` call. Change the import line to include `escalation`:

```python
from app.routers import admin_cities, admin_google, admin_metrics, admin_users, auth as auth_router, chat, escalation, finance, ingest, jobs, leads, payroll, push, recurring_expenses, settings as settings_router, square_router, truck_rental, users
```

After `app.include_router(recurring_expenses.router)` (line 549), add:

```python
app.include_router(escalation.router)
```

- [ ] **Step 3: Verify the app imports**

Run: `cd app/backend && python -c "import main"`
Expected: no errors (exit 0).

- [ ] **Step 4: Commit**

```bash
git add app/backend/app/routers/escalation.py app/backend/main.py
git commit -m "feat(escalation): router — suggest/raise/resolve/list + per-lead get"
```

---

## Task 5: Lifecycle + query tests (backend)

**Files:**
- Create: `app/backend/tests/test_escalation.py`

- [ ] **Step 1: Write the tests**

```python
"""Escalation overlay lifecycle + query tests."""

from __future__ import annotations


async def _create_lead(client, **overrides) -> str:
    payload = {"source_type": "manual", "customer_name": "Esc Customer", "service_type": "moving"}
    payload.update(overrides)
    r = await client.post("/leads", json=payload)
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def test_raise_creates_open_escalation(client):
    lead_id = await _create_lead(client)
    r = await client.post(f"/leads/{lead_id}/escalation", json={
        "level": "pause", "decision_needed": "price", "summary": "Pricing feels risky.",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "open"
    assert body["level"] == "pause"
    assert body["source"] == "manual"

    # The lead's pipeline status is NOT touched
    lead = (await client.get(f"/leads/{lead_id}")).json()
    assert lead["status"] != "escalated"


async def test_raise_is_idempotent_when_open(client):
    lead_id = await _create_lead(client)
    first = (await client.post(f"/leads/{lead_id}/escalation", json={
        "level": "monitor", "decision_needed": "review", "summary": "Keep an eye on this.",
    })).json()
    second = (await client.post(f"/leads/{lead_id}/escalation", json={
        "level": "owner_takeover", "decision_needed": "owner takeover", "summary": "Different.",
    })).json()
    assert first["id"] == second["id"]
    assert second["level"] == "monitor"  # unchanged — still the first one


async def test_get_open_returns_current(client):
    lead_id = await _create_lead(client)
    assert (await client.get(f"/leads/{lead_id}/escalation")).json() is None
    await client.post(f"/leads/{lead_id}/escalation", json={
        "level": "pause", "decision_needed": "truck", "summary": "Truck timing unclear.",
    })
    assert (await client.get(f"/leads/{lead_id}/escalation")).json()["decision_needed"] == "truck"


async def test_resolve_closes_and_records_outcome(client):
    lead_id = await _create_lead(client)
    esc = (await client.post(f"/leads/{lead_id}/escalation", json={
        "level": "pause", "decision_needed": "price", "summary": "Risky.",
    })).json()
    r = await client.post(f"/escalations/{esc['id']}/resolve", json={
        "outcome": "approved", "resolution_note": "Price is fine, send it.",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "resolved"
    assert body["outcome"] == "approved"
    assert body["resolved_at"] is not None
    # Drops out of the open view
    assert (await client.get(f"/leads/{lead_id}/escalation")).json() is None


async def test_resolve_twice_is_409(client):
    lead_id = await _create_lead(client)
    esc = (await client.post(f"/leads/{lead_id}/escalation", json={
        "level": "monitor", "decision_needed": "review", "summary": "x",
    })).json()
    await client.post(f"/escalations/{esc['id']}/resolve", json={"outcome": "release"})
    r = await client.post(f"/escalations/{esc['id']}/resolve", json={"outcome": "approved"})
    assert r.status_code == 409


async def test_list_open_includes_lead_name(client):
    lead_id = await _create_lead(client, customer_name="Jane Doe")
    await client.post(f"/leads/{lead_id}/escalation", json={
        "level": "pause", "decision_needed": "price", "summary": "x",
    })
    rows = (await client.get("/escalations?status=open")).json()
    assert any(row["lead_customer_name"] == "Jane Doe" for row in rows)


async def test_raise_writes_event(client):
    lead_id = await _create_lead(client)
    await client.post(f"/leads/{lead_id}/escalation", json={
        "level": "pause", "decision_needed": "price", "summary": "x",
    })
    lead = (await client.get(f"/leads/{lead_id}")).json()
    assert any(e["event_type"] == "escalation_raised" for e in lead["events"])
```

- [ ] **Step 2: Run the tests**

Run: `cd app/backend && python -m pytest tests/test_escalation.py -v`
Expected: 7 passed.

- [ ] **Step 3: Commit**

```bash
git add app/backend/tests/test_escalation.py
git commit -m "test(escalation): lifecycle + query coverage"
```

---

## Task 6: AI summary tests (backend)

**Files:**
- Create: `app/backend/tests/test_escalation_suggest.py`

- [ ] **Step 1: Write the tests** (mirrors `test_quote_suggestion.py`'s mocking)

```python
"""Tests for the AI escalation summary (POST /leads/{id}/escalation/suggest)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

_SUMMARY_TEXT = (
    "Lead type: moving\nCustomer request: quote\nScope as understood: 2BR local\n"
    "Access/risk: 2 flights stairs\nAI posture: none\nDecision needed: price"
)


def _mock_client(text: str = _SUMMARY_TEXT) -> AsyncMock:
    msg = MagicMock()
    msg.content = [MagicMock(text=text)]
    client = AsyncMock()
    client.messages.create = AsyncMock(return_value=msg)
    return client


async def _create_lead(client) -> str:
    r = await client.post("/leads", json={"source_type": "manual", "customer_name": "S", "service_type": "moving"})
    assert r.status_code == 201
    return r.json()["id"]


async def test_suggest_summary_success(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("AI_REVIEW_MODEL", "test-model")
    monkeypatch.delenv("AI_GROUNDING_FILE", raising=False)
    lead_id = await _create_lead(client)
    with patch("app.services.escalation_service._make_client", return_value=_mock_client()):
        r = await client.post(f"/leads/{lead_id}/escalation/suggest")
    assert r.status_code == 200, r.text
    assert "Decision needed: price" in r.json()["summary"]


async def test_suggest_summary_missing_api_key_503(client, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("AI_REVIEW_MODEL", "test-model")
    lead_id = await _create_lead(client)
    r = await client.post(f"/leads/{lead_id}/escalation/suggest")
    assert r.status_code == 503


async def test_suggest_summary_lead_not_found_404(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("AI_REVIEW_MODEL", "test-model")
    r = await client.post("/leads/missing/escalation/suggest")
    assert r.status_code == 404
```

- [ ] **Step 2: Run the tests**

Run: `cd app/backend && python -m pytest tests/test_escalation_suggest.py -v`
Expected: 3 passed.

- [ ] **Step 3: Commit**

```bash
git add app/backend/tests/test_escalation_suggest.py
git commit -m "test(escalation): AI summary suggest coverage"
```

---

## Task 7: Reconcile the idle timer

**Files:**
- Modify: `app/backend/app/services/alert_service.py:348-361`
- Modify: `app/backend/tests/test_alert_service.py:84-91`

- [ ] **Step 1: Replace the T2 status-flip block**

In `app/backend/app/services/alert_service.py`, replace the block that currently reads (lines 348-361):

```python
        # T2: auto-advance to escalated and write audit event
        if is_t2 and lead.status != LeadStatus.escalated:
            old_status = lead.status.value
            lead.status = LeadStatus.escalated
            lead.updated_at = now_naive
            db.add(LeadEvent(
                id=str(uuid.uuid4()),
                lead_id=lead.id,
                event_type="status_changed",
                from_status=old_status,
                to_status=LeadStatus.escalated.value,
                actor="alert_scheduler",
            ))
            await db.commit()
```

with:

```python
        # T2: raise an escalation overlay (does NOT touch the pipeline status)
        if is_t2:
            from app.services.escalation_service import open_auto_escalation
            await open_auto_escalation(db, lead)
```

- [ ] **Step 2: Update the timer test**

In `app/backend/tests/test_alert_service.py`, replace `test_t2_escalates_lead_status` (lines 84-91) with:

```python
async def test_t2_opens_escalation_overlay_without_touching_status(client, db_session):
    lead_id = await _make_stale_lead(client, db_session, minutes_ago=35)
    settings = SettingsOut(t1_minutes=15, t2_minutes=30)
    with patch("app.services.alert_service._send_sms", return_value=None), \
         patch("app.services.alert_service._send_email", return_value=None):
        await _process_stale_leads(db_session, settings)
    # Pipeline status is untouched
    lead = (await client.get(f"/leads/{lead_id}")).json()
    assert lead["status"] != "escalated"
    # An auto_idle escalation is now open
    esc = (await client.get(f"/leads/{lead_id}/escalation")).json()
    assert esc is not None
    assert esc["source"] == "auto_idle"
    assert esc["level"] == "monitor"


async def test_t2_does_not_double_raise(client, db_session):
    lead_id = await _make_stale_lead(client, db_session, minutes_ago=35)
    settings = SettingsOut(t1_minutes=15, t2_minutes=30)
    with patch("app.services.alert_service._send_sms", return_value=None), \
         patch("app.services.alert_service._send_email", return_value=None):
        await _process_stale_leads(db_session, settings)
        await _process_stale_leads(db_session, settings)
    rows = (await client.get(f"/escalations?status=open")).json()
    assert len([r for r in rows if r["lead_id"] == lead_id]) == 1
```

> **Note:** `open_auto_escalation` calls `suggest_summary`, which will raise (no API key in tests) and fall back to the static summary — no model env is needed for these tests.

- [ ] **Step 3: Run the alert tests**

Run: `cd app/backend && python -m pytest tests/test_alert_service.py -v`
Expected: all passed (the two new tests included).

- [ ] **Step 4: Commit**

```bash
git add app/backend/app/services/alert_service.py app/backend/tests/test_alert_service.py
git commit -m "refactor(escalation): idle ladder raises overlay instead of flipping status"
```

---

## Task 8: Startup migration for legacy `escalated` leads

**Files:**
- Modify: `app/backend/main.py`
- Create: `app/backend/tests/test_escalation_migration.py`

- [ ] **Step 1: Add the migration function**

In `app/backend/main.py`, after `_migrate_users_add_hourly_rate_cents` (ends line 478), add:

```python
async def _migrate_escalated_status_leads(conn) -> None:
    """Move legacy status=escalated leads back to a real stage and open an overlay.

    Idempotent: after the first run no leads remain at status='escalated'.
    """
    result = await conn.execute(text("PRAGMA table_info(lead_escalations)"))
    if not result.fetchall():
        return  # table not created yet; create_all runs after migrations on first boot

    rows = (await conn.execute(text(
        "SELECT id, city_id FROM leads WHERE status = 'escalated'"
    ))).fetchall()
    if not rows:
        return

    import uuid as _uuid
    now = datetime.now(timezone.utc)
    for lead_id, _city_id in rows:
        prior = (await conn.execute(text(
            "SELECT from_status FROM lead_events "
            "WHERE lead_id = :lid AND event_type = 'status_changed' AND to_status = 'escalated' "
            "ORDER BY created_at DESC LIMIT 1"
        ), {"lid": lead_id})).fetchone()
        restored = (prior[0] if prior and prior[0] else "in_review")
        await conn.execute(text("UPDATE leads SET status = :s WHERE id = :lid"),
                           {"s": restored, "lid": lead_id})

        has_open = (await conn.execute(text(
            "SELECT 1 FROM lead_escalations WHERE lead_id = :lid AND status = 'open' LIMIT 1"
        ), {"lid": lead_id})).fetchone()
        if not has_open:
            await conn.execute(text(
                "INSERT INTO lead_escalations "
                "(id, lead_id, level, source, decision_needed, summary, raised_by, raised_at, status) "
                "VALUES (:id, :lid, 'monitor', 'auto_idle', 'review', "
                ":summary, 'migration', :now, 'open')"
            ), {
                "id": str(_uuid.uuid4()), "lid": lead_id,
                "summary": "Migrated from legacy escalated status.", "now": now,
            })
    print(f"[startup] escalation migration: moved {len(rows)} legacy escalated lead(s) to overlay")
```

- [ ] **Step 2: Call the migration in `lifespan`**

In `app/backend/main.py` `lifespan`, the migrations run before `create_all` — but this migration needs the `lead_escalations` table to exist. Add the call **after** `await conn.run_sync(Base.metadata.create_all)` (line 508) and before `_seed_default_admin`:

```python
        await conn.run_sync(Base.metadata.create_all)
        await _migrate_escalated_status_leads(conn)
        await _seed_default_admin(conn)
```

- [ ] **Step 3: Write the migration test**

```python
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
    await _migrate_escalated_status_leads(conn)  # second run is a no-op
    await db_session.commit()

    rows = (await client.get("/escalations?status=open")).json()
    assert len([x for x in rows if x["lead_id"] == lead_id]) == 1  # not duplicated
    lead = (await client.get(f"/leads/{lead_id}")).json()
    assert lead["status"] == "in_review"  # fallback (no prior-status event)
```

- [ ] **Step 4: Run the migration test**

Run: `cd app/backend && python -m pytest tests/test_escalation_migration.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add app/backend/main.py app/backend/tests/test_escalation_migration.py
git commit -m "feat(escalation): startup migration moves legacy escalated leads to overlay"
```

---

## Task 9: Full backend suite green

- [ ] **Step 1: Run the whole backend suite**

Run: `cd app/backend && python -m pytest -q`
Expected: all passed. If `test_alert_service.py` or any other test still references the old escalate-status behavior, fix it to match the overlay model.

- [ ] **Step 2: Commit any fixes**

```bash
git add -A
git commit -m "test(escalation): backend suite green"
```

---

## Task 10: Frontend types + hooks

**Files:**
- Create: `app/frontend/src/types/escalation.ts`
- Create: `app/frontend/src/hooks/useEscalation.ts`

- [ ] **Step 1: Write the types**

```ts
export type EscalationLevel = 'monitor' | 'pause' | 'owner_takeover'
export type EscalationOutcome =
  | 'approved' | 'adjusted' | 'owner_takeover' | 'release' | 'need_more_info'

export interface LeadEscalation {
  id: string
  lead_id: string
  level: EscalationLevel
  source: 'manual' | 'auto_idle'
  decision_needed: string
  summary: string
  raised_by: string | null
  raised_at: string
  status: 'open' | 'resolved'
  outcome: EscalationOutcome | null
  resolution_note: string | null
  resolved_by: string | null
  resolved_at: string | null
  lead_customer_name: string | null
  lead_status: string | null
}

export const LEVEL_LABELS: Record<EscalationLevel, string> = {
  monitor: 'Monitor',
  pause: 'Pause before quote',
  owner_takeover: 'Owner takeover',
}

export const OUTCOME_LABELS: Record<EscalationOutcome, string> = {
  approved: 'Approved',
  adjusted: 'Adjusted',
  owner_takeover: 'Owner taking over',
  release: 'Release',
  need_more_info: 'Need more info',
}

export const DECISION_OPTIONS = ['price', 'schedule', 'truck', 'release', 'owner takeover'] as const
```

- [ ] **Step 2: Write the hooks** (mirrors `useTruckRental.ts`)

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../services/api'
import { useCity } from '../context/CityContext'
import type { EscalationLevel, EscalationOutcome, LeadEscalation } from '../types/escalation'

export function useLeadEscalation(leadId: string) {
  return useQuery<LeadEscalation | null>({
    queryKey: ['escalation', leadId],
    queryFn: async () => {
      const r = await apiFetch(`/leads/${leadId}/escalation`)
      if (!r.ok) throw new Error('Failed to fetch escalation')
      return r.json()
    },
  })
}

export function useOpenEscalations() {
  const { cityQueryId } = useCity()
  return useQuery<LeadEscalation[]>({
    queryKey: ['escalations', 'open', cityQueryId],
    queryFn: async () => {
      const q = new URLSearchParams({ status: 'open' })
      if (cityQueryId) q.set('city_id', cityQueryId)
      const r = await apiFetch(`/escalations?${q.toString()}`)
      if (!r.ok) throw new Error('Failed to fetch escalations')
      return r.json()
    },
  })
}

export function useSuggestEscalationSummary(leadId: string) {
  return useMutation({
    mutationFn: async () => {
      const r = await apiFetch(`/leads/${leadId}/escalation/suggest`, { method: 'POST' })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        throw new Error((err as { detail?: string }).detail ?? 'Suggestion failed')
      }
      return r.json() as Promise<{ summary: string }>
    },
  })
}

export function useRaiseEscalation(leadId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { level: EscalationLevel; decision_needed: string; summary: string }) => {
      const r = await apiFetch(`/leads/${leadId}/escalation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        throw new Error((err as { detail?: string }).detail ?? 'Failed to escalate')
      }
      return r.json() as Promise<LeadEscalation>
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['escalation', leadId] })
      qc.invalidateQueries({ queryKey: ['escalations', 'open'] })
      qc.invalidateQueries({ queryKey: ['lead', leadId] })
    },
  })
}

export function useResolveEscalation(leadId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { escalationId: string; outcome: EscalationOutcome; resolution_note?: string }) => {
      const r = await apiFetch(`/escalations/${vars.escalationId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome: vars.outcome, resolution_note: vars.resolution_note ?? null }),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        throw new Error((err as { detail?: string }).detail ?? 'Failed to resolve')
      }
      return r.json() as Promise<LeadEscalation>
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['escalation', leadId] })
      qc.invalidateQueries({ queryKey: ['escalations', 'open'] })
      qc.invalidateQueries({ queryKey: ['lead', leadId] })
    },
  })
}
```

> **Note:** confirm the lead-detail query key is `['lead', leadId]` by checking `app/frontend/src/hooks/useLeads.ts`. If it differs (e.g. `['leads', leadId]`), use the actual key in the `invalidateQueries` calls above.

- [ ] **Step 3: Commit**

```bash
git add app/frontend/src/types/escalation.ts app/frontend/src/hooks/useEscalation.ts
git commit -m "feat(escalation): frontend types + react-query hooks"
```

---

## Task 11: Escalate sheet (Log tab)

**Files:**
- Create: `app/frontend/src/components/EscalateSheet.tsx`
- Modify: `app/frontend/src/screens/panels/LogPanel.tsx`

- [ ] **Step 1: Write the sheet** — captures level + decision-needed + AI-prefilled summary, with all three action states.

```tsx
import { useState } from 'react'
import { useRaiseEscalation, useSuggestEscalationSummary } from '../hooks/useEscalation'
import { DECISION_OPTIONS, LEVEL_LABELS, type EscalationLevel } from '../types/escalation'

interface Props {
  leadId: string
  onClose: () => void
}

const LEVELS: EscalationLevel[] = ['monitor', 'pause', 'owner_takeover']

export function EscalateSheet({ leadId, onClose }: Props) {
  const [level, setLevel] = useState<EscalationLevel>('pause')
  const [decision, setDecision] = useState<string>('price')
  const [summary, setSummary] = useState('')
  const suggest = useSuggestEscalationSummary(leadId)
  const raise = useRaiseEscalation(leadId)

  const handleSuggest = () => {
    suggest.mutate(undefined, { onSuccess: r => setSummary(r.summary) })
  }

  const handleEscalate = () => {
    raise.mutate(
      { level, decision_needed: decision, summary: summary.trim() },
      { onSuccess: onClose },
    )
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-t-2xl bg-white p-4 dark:bg-gray-800 sm:rounded-2xl"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="mb-3 text-base font-semibold text-gray-900 dark:text-white">Escalate to owner</h3>

        <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">Level</label>
        <div className="mb-3 flex flex-wrap gap-2">
          {LEVELS.map(l => (
            <button
              key={l}
              onClick={() => setLevel(l)}
              className={`min-h-11 rounded-lg border px-3 py-1.5 text-xs font-medium ${
                level === l
                  ? 'border-amber-600 bg-amber-600 text-white'
                  : 'border-gray-300 bg-white text-gray-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100'
              }`}
            >
              {LEVEL_LABELS[l]}
            </button>
          ))}
        </div>

        <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">Decision needed</label>
        <select
          value={decision}
          onChange={e => setDecision(e.target.value)}
          className="mb-3 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        >
          {DECISION_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>

        <div className="mb-1 flex items-center justify-between">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Summary</label>
          <button
            onClick={handleSuggest}
            disabled={suggest.isPending}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50 dark:text-indigo-400"
          >
            {suggest.isPending ? 'Drafting…' : '✨ Suggest with AI'}
          </button>
        </div>
        {suggest.isError && (
          <p className="mb-1 text-xs text-red-600 dark:text-red-400">{(suggest.error as Error).message}</p>
        )}
        <textarea
          rows={6}
          value={summary}
          onChange={e => setSummary(e.target.value)}
          placeholder="What changed / why this needs the owner. Tap ✨ to draft from the lead."
          className="mb-3 w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        />

        {raise.isError && (
          <p className="mb-2 text-xs text-red-600 dark:text-red-400">{(raise.error as Error).message}</p>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="min-h-11 rounded-lg px-4 py-2 text-sm text-gray-600 dark:text-gray-300">
            Cancel
          </button>
          <button
            onClick={handleEscalate}
            disabled={raise.isPending || !summary.trim()}
            className="min-h-11 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {raise.isPending ? 'Escalating…' : 'Escalate'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Drop `escalated` from the Log status list and add the Escalate trigger**

In `app/frontend/src/screens/panels/LogPanel.tsx`:

Remove the `'escalated',` line from `ALL_STATUSES` (line 25). **Leave** the `escalated: 'Escalated',` entry in `STATUS_LABELS` (the `Record<LeadStatus, string>` type requires every key).

Add the import at the top:

```tsx
import { EscalateSheet } from '../../components/EscalateSheet'
```

Add state inside the component (near the other `useState` calls, ~line 74):

```tsx
const [showEscalate, setShowEscalate] = useState(false)
```

In the "Move to Status" `<section>` (after the closing `</div>` of the status buttons flex container, before the section closes ~line 162), add an Escalate button:

```tsx
          <button
            onClick={() => setShowEscalate(true)}
            className="mt-3 min-h-11 rounded-lg border border-amber-500 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50 dark:border-amber-600 dark:text-amber-300 dark:hover:bg-amber-900/20"
          >
            ⚠ Escalate to owner
          </button>
```

Render the sheet at the end of the component, just before the final closing `</>` (line 393):

```tsx
        {showEscalate && <EscalateSheet leadId={leadId} onClose={() => setShowEscalate(false)} />}
```

- [ ] **Step 3: Commit**

```bash
git add app/frontend/src/components/EscalateSheet.tsx app/frontend/src/screens/panels/LogPanel.tsx
git commit -m "feat(escalation): Escalate sheet + Log-tab trigger; drop escalated from status list"
```

---

## Task 12: Escalation card + Resolve (lead window)

**Files:**
- Create: `app/frontend/src/components/EscalationCard.tsx`
- Modify: `app/frontend/src/screens/LeadCommandCenter.tsx`

- [ ] **Step 1: Write the card** — shows the open escalation and the owner Resolve flow (all three action states).

```tsx
import { useState } from 'react'
import { useLeadEscalation, useResolveEscalation } from '../hooks/useEscalation'
import { LEVEL_LABELS, OUTCOME_LABELS, type EscalationOutcome } from '../types/escalation'

const OUTCOMES: EscalationOutcome[] = ['approved', 'adjusted', 'owner_takeover', 'release', 'need_more_info']

export function EscalationCard({ leadId }: { leadId: string }) {
  const { data: esc } = useLeadEscalation(leadId)
  const resolve = useResolveEscalation(leadId)
  const [outcome, setOutcome] = useState<EscalationOutcome>('approved')
  const [note, setNote] = useState('')
  const [showResolve, setShowResolve] = useState(false)

  if (!esc) return null

  const handleResolve = () => {
    resolve.mutate(
      { escalationId: esc.id, outcome, resolution_note: note.trim() || undefined },
      { onSuccess: () => { setShowResolve(false); setNote('') } },
    )
  }

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-900/20">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
            ⚠ Escalated · {LEVEL_LABELS[esc.level]}
            {esc.source === 'auto_idle' && ' · auto'}
          </p>
          <p className="mt-0.5 text-sm font-medium text-gray-900 dark:text-white">Decision needed: {esc.decision_needed}</p>
          <p className="mt-1 whitespace-pre-wrap text-xs text-gray-600 dark:text-gray-300">{esc.summary}</p>
          <p className="mt-1 text-[11px] text-gray-400">Raised by {esc.raised_by ?? 'system'}</p>
        </div>
        {!showResolve && (
          <button
            onClick={() => setShowResolve(true)}
            className="shrink-0 min-h-11 rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-700"
          >
            Resolve
          </button>
        )}
      </div>

      {showResolve && (
        <div className="mt-3 space-y-2">
          <select
            value={outcome}
            onChange={e => setOutcome(e.target.value as EscalationOutcome)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          >
            {OUTCOMES.map(o => <option key={o} value={o}>{OUTCOME_LABELS[o]}</option>)}
          </select>
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Decision note (sent back to the handler)"
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          />
          {resolve.isError && (
            <p className="text-xs text-red-600 dark:text-red-400">{(resolve.error as Error).message}</p>
          )}
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowResolve(false)} className="min-h-11 rounded-lg px-4 py-2 text-sm text-gray-600 dark:text-gray-300">
              Cancel
            </button>
            <button
              onClick={handleResolve}
              disabled={resolve.isPending}
              className="min-h-11 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
            >
              {resolve.isPending ? 'Resolving…' : 'Confirm decision'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Render the card in the lead window**

In `app/frontend/src/screens/LeadCommandCenter.tsx`, add the import:

```tsx
import { EscalationCard } from '../components/EscalationCard'
```

Render `<EscalationCard leadId={lead.id} />` directly above the tab bar — locate the tab-bar JSX (the row of `brief` / `quote` / `log` tab buttons, search for `id: 'quote', label: 'Quote'` ~line 389 and find the container that renders the tabs) and place the card immediately before that container so it sits between the header/pinned area and the tabs. The card renders nothing when there is no open escalation.

- [ ] **Step 3: Commit**

```bash
git add app/frontend/src/components/EscalationCard.tsx app/frontend/src/screens/LeadCommandCenter.tsx
git commit -m "feat(escalation): lead-window escalation card + Resolve flow"
```

---

## Task 13: Queue band + card badge

**Files:**
- Modify: `app/frontend/src/screens/LeadQueue.tsx`
- Modify: `app/frontend/src/components/LeadCard.tsx`

- [ ] **Step 1: Add the escalation badge to `LeadCard`**

In `app/frontend/src/components/LeadCard.tsx`, add `isEscalated?: boolean` to the component's props interface, and render a badge near the staleness chip. Add this prop to the destructured props and, in the card's header/chip row, add:

```tsx
{isEscalated && (
  <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
    ⚠ Escalated
  </span>
)}
```

> **Note:** open `LeadCard.tsx` and place the badge alongside the existing age/staleness chip so it follows the established chip layout. Pass the prop through from the queue (next step).

- [ ] **Step 2: Wire the band + badge in `LeadQueue`**

In `app/frontend/src/screens/LeadQueue.tsx`:

Remove the `escalated` entry from `ACTIVE_STAGES` (line 24).

Add the import and hook:

```tsx
import { useOpenEscalations } from '../hooks/useEscalation'
import { LEVEL_LABELS } from '../types/escalation'
```

Inside the component, after the other hooks (~line 63):

```tsx
const { data: openEscalations = [] } = useOpenEscalations()
const escalatedLeadIds = useMemo(() => new Set(openEscalations.map(e => e.lead_id)), [openEscalations])
const [escBandOpen, setEscBandOpen] = useState(true)
```

In the `<main>` block, as the first child (before `{isLoading && ...}` ~line 196), add the pinned band:

```tsx
{view === 'active' && openEscalations.length > 0 && (
  <section className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-900/20">
    <button
      onClick={() => setEscBandOpen(o => !o)}
      className="flex w-full min-h-12 items-center justify-between px-3 py-2 text-left"
      aria-expanded={escBandOpen}
    >
      <span className="font-semibold text-amber-800 dark:text-amber-200">
        ⚠ Escalations <span className="text-amber-600 dark:text-amber-400">{openEscalations.length}</span>
      </span>
      <span className={`text-amber-500 transition-transform ${escBandOpen ? 'rotate-90' : ''}`} aria-hidden="true">›</span>
    </button>
    {escBandOpen && (
      <div className="space-y-1 px-2 pb-2">
        {openEscalations.map(e => (
          <button
            key={e.id}
            onClick={() => navigate(`/leads/${e.lead_id}`)}
            className="flex w-full items-center justify-between gap-2 rounded-lg bg-white/70 px-3 py-2 text-left dark:bg-gray-800/60"
          >
            <span className="min-w-0 truncate text-sm font-medium text-gray-900 dark:text-white">
              {e.lead_customer_name ?? 'Unknown'}
            </span>
            <span className="shrink-0 text-xs text-amber-700 dark:text-amber-300">
              {LEVEL_LABELS[e.level]} · {e.decision_needed}
            </span>
          </button>
        ))}
      </div>
    )}
  </section>
)}
```

Pass `isEscalated` into the `LeadCard` render (~line 246):

```tsx
<LeadCard
  lead={lead}
  onClick={id => navigate(`/leads/${id}`)}
  staleness={overdueIds.has(lead.id) ? 'overdue' : agingIds.has(lead.id) ? 'aging' : null}
  idleMinutes={idleMinuteMap.get(lead.id)}
  hasTruckRental={rentalLeadIds.has(lead.id)}
  isEscalated={escalatedLeadIds.has(lead.id)}
/>
```

- [ ] **Step 3: Type-check + build**

Run: `cd app/frontend && npm run build`
Expected: build succeeds, no TS errors.

- [ ] **Step 4: Commit**

```bash
git add app/frontend/src/screens/LeadQueue.tsx app/frontend/src/components/LeadCard.tsx
git commit -m "feat(escalation): queue Escalations band + card badge; drop escalated stage"
```

---

## Task 14: Docs + final verification

**Files:**
- Modify: `CAPABILITIES.md`

- [ ] **Step 1: Update `CAPABILITIES.md`**

Add an escalation entry describing: escalation is now a resolvable overlay (level + AI summary + decision-needed → owner review → outcome), independent of pipeline status; the idle ladder raises an `auto_idle` overlay at T2 instead of flipping status; legacy `escalated` leads were migrated to overlays. Update the test count to reflect the new tests.

- [ ] **Step 2: Run the full backend suite once more**

Run: `cd app/backend && python -m pytest -q`
Expected: all passed.

- [ ] **Step 3: Build the frontend once more**

Run: `cd app/frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add CAPABILITIES.md
git commit -m "docs(escalation): capabilities + suite green"
```

- [ ] **Step 5: Push**

```bash
git push
```

---

## Self-Review Notes (addressed)

- **Spec coverage:** model (T1), schemas (T2), service incl. AI summary + auto-open (T3/T6), router incl. all 5 endpoints (T4), timer reconciliation (T7), migration (T8), notifications folded into service `_notify` (T3), frontend escalate/resolve/band/badge (T11-T13), `escalated` removed from UI lists (T11/T13). All spec sections map to a task.
- **Type consistency:** levels `monitor|pause|owner_takeover`, outcomes `approved|adjusted|owner_takeover|release|need_more_info`, sources `manual|auto_idle`, statuses `open|resolved` — identical across model `LEVELS/OUTCOMES/...`, Pydantic `Literal`s, and TS types.
- **Open assumptions flagged inline:** AI-review section keys in `_latest_ai_posture` (T3 note); lead-detail query key in hooks (T10 note); exact chip-row placement in `LeadCard` (T13 note). Each degrades gracefully or is a one-line confirm.
