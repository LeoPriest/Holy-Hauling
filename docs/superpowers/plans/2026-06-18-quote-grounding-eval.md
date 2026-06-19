# Quote-Grounding Eval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture what each AI quote suggestion proposed (grounded?, comparables count, raw price) in an append-only log, then expose a read-only eval that compares grounded-vs-ungrounded quotes on win rate, pricing accuracy, and pricing bias against finalized outcomes.

**Architecture:** A `quote_suggestion_log` table written best-effort at the end of `suggest_quote`. An `eval_service` joins the latest log per lead to finalized `lead_outcome` rows, splits into grounded/ungrounded cohorts, and computes the metrics. A `GET /admin/eval/quote-grounding` endpoint returns them. Item 3 of the self-learning roadmap; consumes item-1 outcomes and item-2 grounding.

**Tech Stack:** FastAPI, SQLAlchemy 2.x async + aiosqlite, Pydantic v2.

**Spec:** `docs/superpowers/specs/2026-06-18-quote-grounding-eval-design.md`

---

## File Structure

**Create:**
- `app/backend/app/models/quote_suggestion_log.py`
- `app/backend/app/schemas/eval.py`
- `app/backend/app/services/eval_service.py`
- `app/backend/app/routers/eval.py`
- `app/backend/tests/test_eval_service.py`
- `app/backend/tests/test_eval_api.py`

**Modify:**
- `app/backend/app/services/quote_service.py` — write the log row (best-effort)
- `app/backend/tests/test_quote_suggestion.py` — capture tests
- `app/backend/main.py` — register model import + router

---

## Task 1: `QuoteSuggestionLog` model + registration

**Files:**
- Create: `app/backend/app/models/quote_suggestion_log.py`
- Modify: `app/backend/main.py`

- [ ] **Step 1: Write the model**

`app/backend/app/models/quote_suggestion_log.py`:

```python
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String

from app.database import Base


class QuoteSuggestionLog(Base):
    """Append-only provenance of each AI quote suggestion (item 3 capture)."""

    __tablename__ = "quote_suggestion_logs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    lead_id = Column(String, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False)
    city_id = Column(String, nullable=False)
    was_grounded = Column(Boolean, nullable=False, default=False)
    comparables_count = Column(Integer, nullable=False, default=0)
    suggested_price_cents = Column(Integer, nullable=True)
    model_used = Column(String, nullable=True)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
```

- [ ] **Step 2: Register the model import in `main.py`**

In `app/backend/main.py`, after `import app.models.lead_outcome  # noqa: F401`, add:

```python
import app.models.quote_suggestion_log  # noqa: F401
```

- [ ] **Step 3: Verify it imports**

Run: `cd app/backend ; python -c "import main ; from app.models.quote_suggestion_log import QuoteSuggestionLog ; print('OK')"`
Expected: prints `OK`.

- [ ] **Step 4: Commit**

```bash
git add app/backend/app/models/quote_suggestion_log.py app/backend/main.py
git commit -m "feat(eval): QuoteSuggestionLog append-only model + register"
```

---

## Task 2: Eval schemas

**Files:**
- Create: `app/backend/app/schemas/eval.py`

- [ ] **Step 1: Write the schemas**

`app/backend/app/schemas/eval.py`:

```python
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class CohortMetrics(BaseModel):
    n: int
    win_rate: Optional[float] = None
    priced_n: int
    pricing_accuracy: Optional[float] = None
    pricing_bias: Optional[float] = None


class QuoteGroundingEval(BaseModel):
    grounded: CohortMetrics
    ungrounded: CohortMetrics
```

- [ ] **Step 2: Verify it imports**

Run: `cd app/backend ; python -c "from app.schemas.eval import CohortMetrics, QuoteGroundingEval ; print('OK')"`
Expected: prints `OK`.

- [ ] **Step 3: Commit**

```bash
git add app/backend/app/schemas/eval.py
git commit -m "feat(eval): CohortMetrics + QuoteGroundingEval schemas"
```

---

## Task 3: Capture in `suggest_quote`

**Files:**
- Modify: `app/backend/app/services/quote_service.py`
- Modify: `app/backend/tests/test_quote_suggestion.py`

- [ ] **Step 1: Write the failing capture tests**

Append to `app/backend/tests/test_quote_suggestion.py`:

```python
async def test_suggest_quote_logs_grounded_provenance(client, db_session, monkeypatch):
    import json as _json
    import uuid as _uuid
    from datetime import datetime, timezone
    from unittest.mock import patch
    from sqlalchemy import select
    from app.models.lead import Lead
    from app.models.lead_outcome import LeadOutcome
    from app.models.quote_suggestion_log import QuoteSuggestionLog

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("AI_REVIEW_MODEL", "test-model")
    monkeypatch.delenv("AI_GROUNDING_FILE", raising=False)

    lead_id = await _create_lead(client)
    lead = (await db_session.execute(select(Lead).where(Lead.id == lead_id))).scalar_one()
    db_session.add(LeadOutcome(
        lead_id=str(_uuid.uuid4()), city_id=lead.city_id, conversion="won",
        terminal_status="released", realized_revenue_cents=72000,
        scope_snapshot=_json.dumps({"service_type": "moving", "move_size_label": "2 bedroom apartment"}),
        was_escalated=False, finalized=True,
        created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc),
    ))
    await db_session.commit()

    with patch("app.services.quote_service._make_client", return_value=_mock_client()):
        r = await client.post(f"/leads/{lead_id}/quote-suggestion")
    assert r.status_code == 200, r.text

    logs = (await db_session.execute(
        select(QuoteSuggestionLog).where(QuoteSuggestionLog.lead_id == lead_id)
    )).scalars().all()
    assert len(logs) == 1
    assert logs[0].was_grounded is True
    assert logs[0].comparables_count == 1
    assert logs[0].suggested_price_cents == 72500  # _VALID total 725 * 100


async def test_suggest_quote_logs_ungrounded_on_cold_start(client, db_session, monkeypatch):
    from unittest.mock import patch
    from sqlalchemy import select
    from app.models.quote_suggestion_log import QuoteSuggestionLog

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("AI_REVIEW_MODEL", "test-model")
    monkeypatch.delenv("AI_GROUNDING_FILE", raising=False)

    lead_id = await _create_lead(client)
    with patch("app.services.quote_service._make_client", return_value=_mock_client()):
        r = await client.post(f"/leads/{lead_id}/quote-suggestion")
    assert r.status_code == 200, r.text

    logs = (await db_session.execute(
        select(QuoteSuggestionLog).where(QuoteSuggestionLog.lead_id == lead_id)
    )).scalars().all()
    assert len(logs) == 1
    assert logs[0].was_grounded is False
    assert logs[0].comparables_count == 0


async def test_suggest_quote_capture_failure_does_not_break_quote(client, monkeypatch):
    from unittest.mock import patch
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("AI_REVIEW_MODEL", "test-model")
    monkeypatch.delenv("AI_GROUNDING_FILE", raising=False)

    lead_id = await _create_lead(client)
    with patch("app.services.quote_service.QuoteSuggestionLog", side_effect=RuntimeError("boom")), \
         patch("app.services.quote_service._make_client", return_value=_mock_client()):
        r = await client.post(f"/leads/{lead_id}/quote-suggestion")
    assert r.status_code == 200, r.text  # capture failure must not break quoting
```

Note: `_VALID` (the canned mock quote) has `quoted_price_total: 725`, so `suggested_price_cents == 72500`. If the helper's canned total differs, use that value `* 100`.

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `cd app/backend ; python -m pytest tests/test_quote_suggestion.py::test_suggest_quote_logs_grounded_provenance tests/test_quote_suggestion.py::test_suggest_quote_logs_ungrounded_on_cold_start -q`
Expected: FAIL — no `QuoteSuggestionLog` rows written yet.

- [ ] **Step 3: Add the capture to `quote_service.py`**

(a) Add imports (near the top): `import uuid` (if not present) and `from app.models.quote_suggestion_log import QuoteSuggestionLog`.

(b) Add this helper after `_safe_find_comparables`:

```python
async def _log_suggestion(db, lead, comparables, suggestion, model) -> None:
    """Append a quote-suggestion provenance row. Best-effort - never breaks quoting."""
    try:
        price = suggestion.quoted_price_total
        db.add(QuoteSuggestionLog(
            id=str(uuid.uuid4()),
            lead_id=lead.id,
            city_id=lead.city_id,
            was_grounded=len(comparables) > 0,
            comparables_count=len(comparables),
            suggested_price_cents=round(price * 100) if price is not None else None,
            model_used=model,
        ))
        await db.commit()
    except Exception as exc:
        await db.rollback()
        _log.warning("quote suggestion log failed for lead %s: %s", lead.id, exc)
```

(c) Replace the final return of `suggest_quote` (currently `return suggestion.model_copy(update={"comparables": comparables})`) with:

```python
    final = suggestion.model_copy(update={"comparables": comparables})
    await _log_suggestion(db, lead, comparables, final, model)
    return final
```

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `cd app/backend ; python -m pytest tests/test_quote_suggestion.py -q`
Expected: all pass (existing suggestion/comparables tests + the 3 new ones).

- [ ] **Step 5: Commit**

```bash
git add app/backend/app/services/quote_service.py app/backend/tests/test_quote_suggestion.py
git commit -m "feat(eval): log quote-suggestion provenance (grounded/count/price), best-effort"
```

---

## Task 4: Eval service

**Files:**
- Create: `app/backend/app/services/eval_service.py`
- Create: `app/backend/tests/test_eval_service.py`

- [ ] **Step 1: Write the failing tests**

`app/backend/tests/test_eval_service.py`:

```python
"""Quote-grounding eval aggregation tests."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from app.models.lead_outcome import LeadOutcome
from app.models.quote_suggestion_log import QuoteSuggestionLog
from app.services.eval_service import compute_quote_grounding_eval

_CITY = "st-louis"
_NOW = datetime(2026, 6, 1, 12, 0, 0)


async def _log(db, lead_id, *, grounded, suggested=None, count=0, when=_NOW, city=_CITY):
    db.add(QuoteSuggestionLog(
        id=str(uuid.uuid4()), lead_id=lead_id, city_id=city,
        was_grounded=grounded, comparables_count=count,
        suggested_price_cents=suggested, model_used="m", created_at=when,
    ))
    await db.commit()


async def _outcome(db, lead_id, *, conversion, realized=None, finalized=True, city=_CITY):
    db.add(LeadOutcome(
        lead_id=lead_id, city_id=city, conversion=conversion,
        terminal_status="released" if conversion == "won" else "lost",
        realized_revenue_cents=realized, scope_snapshot="{}",
        was_escalated=False, finalized=finalized,
        created_at=_NOW, updated_at=_NOW,
    ))
    await db.commit()


async def test_cohort_uses_latest_log(client, db_session):
    lead = str(uuid.uuid4())
    await _log(db_session, lead, grounded=False, when=_NOW - timedelta(days=1))
    await _log(db_session, lead, grounded=True, when=_NOW)  # latest -> grounded
    await _outcome(db_session, lead, conversion="won", realized=50000)
    out = await compute_quote_grounding_eval(db_session, _CITY)
    assert out.grounded.n == 1
    assert out.ungrounded.n == 0


async def test_win_rate(client, db_session):
    for conv in ("won", "won", "lost"):
        lead = str(uuid.uuid4())
        await _log(db_session, lead, grounded=True)
        await _outcome(db_session, lead, conversion=conv, realized=50000 if conv == "won" else None)
    out = await compute_quote_grounding_eval(db_session, _CITY)
    assert out.grounded.n == 3
    assert round(out.grounded.win_rate, 3) == 0.667


async def test_pricing_accuracy_and_bias(client, db_session):
    # suggested 72000 vs realized 60000 -> +0.2 ; suggested 54000 vs 60000 -> -0.1
    a = str(uuid.uuid4())
    await _log(db_session, a, grounded=True, suggested=72000)
    await _outcome(db_session, a, conversion="won", realized=60000)
    b = str(uuid.uuid4())
    await _log(db_session, b, grounded=True, suggested=54000)
    await _outcome(db_session, b, conversion="won", realized=60000)
    out = await compute_quote_grounding_eval(db_session, _CITY)
    assert out.grounded.priced_n == 2
    assert round(out.grounded.pricing_accuracy, 4) == 0.15   # mean(|0.2|, |-0.1|)
    assert round(out.grounded.pricing_bias, 4) == 0.05       # mean(0.2, -0.1)


async def test_excludes_leads_without_outcome_or_log(client, db_session):
    only_log = str(uuid.uuid4())
    await _log(db_session, only_log, grounded=True, suggested=50000)
    only_outcome = str(uuid.uuid4())
    await _outcome(db_session, only_outcome, conversion="won", realized=50000)
    out = await compute_quote_grounding_eval(db_session, _CITY)
    assert out.grounded.n == 0
    assert out.ungrounded.n == 0


async def test_excludes_unfinalized_outcome(client, db_session):
    lead = str(uuid.uuid4())
    await _log(db_session, lead, grounded=True, suggested=50000)
    await _outcome(db_session, lead, conversion="won", realized=50000, finalized=False)
    out = await compute_quote_grounding_eval(db_session, _CITY)
    assert out.grounded.n == 0


async def test_zero_realized_excluded_from_pricing(client, db_session):
    lead = str(uuid.uuid4())
    await _log(db_session, lead, grounded=True, suggested=50000)
    await _outcome(db_session, lead, conversion="won", realized=0)
    out = await compute_quote_grounding_eval(db_session, _CITY)
    assert out.grounded.n == 1            # counts toward n
    assert out.grounded.priced_n == 0     # but not the pricing set (no divide-by-zero)
    assert out.grounded.pricing_accuracy is None


async def test_empty_cohort_null_metrics(client, db_session):
    out = await compute_quote_grounding_eval(db_session, _CITY)
    assert out.grounded.n == 0
    assert out.grounded.win_rate is None
    assert out.grounded.priced_n == 0
    assert out.grounded.pricing_accuracy is None
    assert out.grounded.pricing_bias is None


async def test_city_filter(client, db_session):
    here = str(uuid.uuid4())
    await _log(db_session, here, grounded=True, suggested=50000)
    await _outcome(db_session, here, conversion="won", realized=50000)
    there = str(uuid.uuid4())
    await _log(db_session, there, grounded=True, suggested=50000, city="other")
    await _outcome(db_session, there, conversion="won", realized=50000, city="other")
    out = await compute_quote_grounding_eval(db_session, _CITY)
    assert out.grounded.n == 1  # only the st-louis lead
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app/backend ; python -m pytest tests/test_eval_service.py -q`
Expected: FAIL — no `eval_service` module.

- [ ] **Step 3: Write the service**

`app/backend/app/services/eval_service.py`:

```python
"""
Quote-grounding eval (item 3 of the self-learning roadmap).

Joins the latest quote-suggestion provenance per lead to finalized outcomes,
splits into grounded vs ungrounded cohorts, and reports win rate, pricing
accuracy, and pricing bias. Pure read.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.lead_outcome import LeadOutcome
from app.models.quote_suggestion_log import QuoteSuggestionLog
from app.schemas.eval import CohortMetrics, QuoteGroundingEval


async def _latest_logs_by_lead(db: AsyncSession, city_id: str | None) -> dict:
    stmt = select(QuoteSuggestionLog)
    if city_id:
        stmt = stmt.where(QuoteSuggestionLog.city_id == city_id)
    latest: dict = {}
    for row in (await db.execute(stmt)).scalars().all():
        cur = latest.get(row.lead_id)
        if cur is None or row.created_at > cur.created_at:
            latest[row.lead_id] = row
    return latest


async def _finalized_outcomes_by_lead(db: AsyncSession, city_id: str | None) -> dict:
    stmt = select(LeadOutcome).where(LeadOutcome.finalized.is_(True))
    if city_id:
        stmt = stmt.where(LeadOutcome.city_id == city_id)
    return {row.lead_id: row for row in (await db.execute(stmt)).scalars().all()}


def _cohort_metrics(pairs: list) -> CohortMetrics:
    """pairs: list of (log, outcome)."""
    n = len(pairs)
    won = sum(1 for _, o in pairs if o.conversion == "won")
    lost = sum(1 for _, o in pairs if o.conversion == "lost")
    win_rate = (won / (won + lost)) if (won + lost) > 0 else None

    priced = [
        (log, o) for log, o in pairs
        if o.conversion == "won"
        and o.realized_revenue_cents not in (None, 0)  # exclude $0 sale (divide-by-zero guard)
        and log.suggested_price_cents is not None
    ]
    priced_n = len(priced)
    if priced_n > 0:
        accuracy = sum(
            abs(log.suggested_price_cents - o.realized_revenue_cents) / o.realized_revenue_cents
            for log, o in priced
        ) / priced_n
        bias = sum(
            (log.suggested_price_cents - o.realized_revenue_cents) / o.realized_revenue_cents
            for log, o in priced
        ) / priced_n
    else:
        accuracy = None
        bias = None

    return CohortMetrics(
        n=n, win_rate=win_rate, priced_n=priced_n,
        pricing_accuracy=accuracy, pricing_bias=bias,
    )


async def compute_quote_grounding_eval(db: AsyncSession, city_id: str | None = None) -> QuoteGroundingEval:
    logs = await _latest_logs_by_lead(db, city_id)
    outcomes = await _finalized_outcomes_by_lead(db, city_id)

    grounded: list = []
    ungrounded: list = []
    for lead_id, log in logs.items():
        outcome = outcomes.get(lead_id)
        if outcome is None:
            continue  # not yet evaluable
        (grounded if log.was_grounded else ungrounded).append((log, outcome))

    return QuoteGroundingEval(
        grounded=_cohort_metrics(grounded),
        ungrounded=_cohort_metrics(ungrounded),
    )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app/backend ; python -m pytest tests/test_eval_service.py -q`
Expected: 8 passed.

If a test fails on a real defect, fix the SERVICE. Do not weaken a test.

- [ ] **Step 5: Commit**

```bash
git add app/backend/app/services/eval_service.py app/backend/tests/test_eval_service.py
git commit -m "feat(eval): grounded-vs-ungrounded cohort metrics service, with tests"
```

---

## Task 5: Eval endpoint + registration

**Files:**
- Create: `app/backend/app/routers/eval.py`
- Create: `app/backend/tests/test_eval_api.py`
- Modify: `app/backend/main.py`

- [ ] **Step 1: Write the failing API test**

`app/backend/tests/test_eval_api.py`:

```python
"""GET /admin/eval/quote-grounding endpoint."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from app.models.lead_outcome import LeadOutcome
from app.models.quote_suggestion_log import QuoteSuggestionLog

_NOW = datetime(2026, 6, 1, 12, 0, 0)


async def _seed(db, lead_id, *, grounded, conversion, suggested, realized, city="st-louis"):
    db.add(QuoteSuggestionLog(
        id=str(uuid.uuid4()), lead_id=lead_id, city_id=city,
        was_grounded=grounded, comparables_count=2 if grounded else 0,
        suggested_price_cents=suggested, model_used="m", created_at=_NOW,
    ))
    db.add(LeadOutcome(
        lead_id=lead_id, city_id=city, conversion=conversion,
        terminal_status="released" if conversion == "won" else "lost",
        realized_revenue_cents=realized, scope_snapshot="{}",
        was_escalated=False, finalized=True, created_at=_NOW, updated_at=_NOW,
    ))
    await db.commit()


async def test_quote_grounding_eval_endpoint(client, db_session):
    await _seed(db_session, str(uuid.uuid4()), grounded=True, conversion="won", suggested=63000, realized=60000)
    await _seed(db_session, str(uuid.uuid4()), grounded=False, conversion="won", suggested=72000, realized=60000)

    r = await client.get("/admin/eval/quote-grounding")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["grounded"]["n"] == 1
    assert body["ungrounded"]["n"] == 1
    assert round(body["grounded"]["pricing_accuracy"], 3) == 0.05    # |63000-60000|/60000
    assert round(body["ungrounded"]["pricing_accuracy"], 3) == 0.2   # |72000-60000|/60000
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app/backend ; python -m pytest tests/test_eval_api.py -q`
Expected: FAIL — 404 (route not registered).

- [ ] **Step 3: Write the router**

`app/backend/app/routers/eval.py`:

```python
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_role
from app.models.user import User
from app.schemas.eval import QuoteGroundingEval
from app.services.eval_service import compute_quote_grounding_eval

router = APIRouter(tags=["eval"])


@router.get("/admin/eval/quote-grounding", response_model=QuoteGroundingEval)
async def quote_grounding_eval(
    city_id: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("admin")),
):
    return await compute_quote_grounding_eval(db, city_id)
```

- [ ] **Step 4: Register the router in `main.py`**

(a) Add `eval as eval_router` to the `from app.routers import ...` line (place it after `chat,` / before `escalation,` for alphabetical-ish order, e.g. `chat, eval as eval_router, escalation,`).

(b) After `app.include_router(outcomes.router)`, add:

```python
app.include_router(eval_router.router)
```

(Aliasing to `eval_router` avoids shadowing the Python builtin `eval` in `main.py`.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd app/backend ; python -m pytest tests/test_eval_api.py -q`
Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add app/backend/app/routers/eval.py app/backend/tests/test_eval_api.py app/backend/main.py
git commit -m "feat(eval): GET /admin/eval/quote-grounding endpoint"
```

---

## Task 6: Docs + full suite green

**Files:**
- Modify: `CAPABILITIES.md`

- [ ] **Step 1: Run the full backend suite**

Run: `cd app/backend ; python -m pytest -q`
Expected: all passed (prior 304 + the new capture/eval tests). Diagnose any unrelated break to root cause.

- [ ] **Step 2: Update `CAPABILITIES.md`**

Under the "Self-learning roadmap" section, add an "Item 3 — quote-grounding eval (done)" subsection: each AI quote suggestion now writes an append-only `quote_suggestion_log` (grounded?, comparables count, raw suggested price); `GET /admin/eval/quote-grounding` reports grounded-vs-ungrounded cohorts (n, win_rate, pricing_accuracy, pricing_bias) by joining the latest log per lead to finalized outcomes. Note item 4 (regeneration/fine-tune) remains. Update the test count to the new total.

- [ ] **Step 3: Commit**

```bash
git add CAPABILITIES.md
git commit -m "docs(eval): capabilities + suite green"
```

---

## Self-Review Notes (addressed)

- **Spec coverage:** model (T1), schemas (T2), capture + best-effort + grounded/cold-start (T3), eval cohorts + win-rate + accuracy + bias + null rules + zero-realized guard + city filter (T4), endpoint + admin gate (T5), docs + suite (T6). Every spec section maps to a task.
- **Best-effort capture:** `_log_suggestion` try/except + `db.rollback()`; `test_suggest_quote_capture_failure_does_not_break_quote` asserts a raising `QuoteSuggestionLog` still returns 200.
- **Divide-by-zero guard:** `realized_revenue_cents not in (None, 0)` in the pricing set; `test_zero_realized_excluded_from_pricing`.
- **Latest-log-per-lead cohort:** `_latest_logs_by_lead` keeps max `created_at`; `test_cohort_uses_latest_log`.
- **Type consistency:** `compute_quote_grounding_eval(db, city_id)`, `CohortMetrics(n, win_rate, priced_n, pricing_accuracy, pricing_bias)`, `QuoteGroundingEval(grounded, ungrounded)` — identical across schema, service, router, and tests.
- **Builtin shadow avoided:** router imported `eval as eval_router` in `main.py`.
