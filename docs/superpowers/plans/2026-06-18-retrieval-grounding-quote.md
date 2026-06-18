# Retrieval Grounding for the Quote — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before drafting a quote, retrieve the most similar same-city finalized past outcomes (won + lost) and inject them into the AI prompt so it anchors on what comparable local jobs actually sold for; surface those comparables in the response. Degrade to today's exact behavior when none exist.

**Architecture:** A new `comparables_service.find_comparables(db, lead, limit)` does structured (non-embedding) similarity scoring over `lead_outcome` rows. `quote_service.suggest_quote` calls it, formats a "comparable local jobs" prompt block, injects it, and returns the comparables. Item 2 of the self-learning roadmap; consumes the item-1 `lead_outcome` layer.

**Tech Stack:** FastAPI, SQLAlchemy 2.x async + aiosqlite, Pydantic v2, anthropic SDK.

**Spec:** `docs/superpowers/specs/2026-06-18-retrieval-grounding-quote-design.md`

---

## File Structure

**Create:**
- `app/backend/app/services/comparables_service.py` — `find_comparables` + scoring
- `app/backend/tests/test_comparables_service.py` — retriever tests

**Modify:**
- `app/backend/app/schemas/quote_suggestion.py` — add `ComparableOut`, add `comparables` to `QuoteSuggestionOut`
- `app/backend/app/services/quote_service.py` — call retriever, format + inject block, return comparables
- `app/backend/tests/test_quote_suggestion.py` — add integration tests (block injected + cold-start)

---

## Task 1: Schema — `ComparableOut` + `comparables` field

**Files:**
- Modify: `app/backend/app/schemas/quote_suggestion.py`

- [ ] **Step 1: Read the current schema**

Run: `cd app/backend ; python -c "from app.schemas.quote_suggestion import QuoteSuggestionOut ; print(QuoteSuggestionOut.model_fields.keys())"`
Expected: prints the existing fields (`quoted_price_total`, `line_items`, `estimated_duration_minutes`, `rationale`). Note the exact field set before editing.

- [ ] **Step 2: Add `ComparableOut` and the `comparables` field**

Open `app/backend/app/schemas/quote_suggestion.py`. Add the `Optional`/`List` imports if not present (`from typing import List, Optional`). Add this model near `QuoteLineItem`:

```python
class ComparableOut(BaseModel):
    lead_id: str
    conversion: str          # won | lost
    price_cents: int
    price_basis: str         # realized | quoted
    score: int
    move_size_label: Optional[str] = None
    move_distance_miles: Optional[float] = None
    move_type: Optional[str] = None
```

Then add a field to `QuoteSuggestionOut` (keep all existing fields exactly as they are):

```python
    comparables: List[ComparableOut] = Field(default_factory=list)
```

If `Field` is not already imported, add it: `from pydantic import BaseModel, Field`.

- [ ] **Step 3: Verify it imports**

Run: `cd app/backend ; python -c "from app.schemas.quote_suggestion import ComparableOut, QuoteSuggestionOut ; print('comparables' in QuoteSuggestionOut.model_fields)"`
Expected: prints `True`.

- [ ] **Step 4: Commit**

```bash
git add app/backend/app/schemas/quote_suggestion.py
git commit -m "feat(comparables): ComparableOut schema + comparables field on QuoteSuggestionOut"
```

---

## Task 2: `comparables_service` — retriever + scoring

**Files:**
- Create: `app/backend/app/services/comparables_service.py`
- Create: `app/backend/tests/test_comparables_service.py`

- [ ] **Step 1: Write the failing tests**

`app/backend/tests/test_comparables_service.py`:

```python
"""Structured comparable-outcome retrieval tests."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models.lead import Lead
from app.models.lead_outcome import LeadOutcome
from app.services.comparables_service import find_comparables


async def _make_lead(client, **overrides) -> str:
    payload = {"source_type": "manual", "customer_name": "Cur", "service_type": "moving"}
    payload.update(overrides)
    r = await client.post("/leads", json=payload)
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _lead_obj(db_session, lead_id: str) -> Lead:
    return (await db_session.execute(select(Lead).where(Lead.id == lead_id))).scalar_one()


async def _set_scope(db_session, lead_id: str, **fields) -> None:
    lead = await _lead_obj(db_session, lead_id)
    for k, v in fields.items():
        setattr(lead, k, v)
    await db_session.commit()


_NOW = datetime(2026, 6, 1, 12, 0, 0)  # fixed naive time for deterministic recency


async def _add_outcome(
    db_session, city, *, conversion="won", service="moving", scope=None,
    realized=None, quoted=None, finalized=True, completed_at=None,
) -> str:
    snap = {"service_type": service}
    snap.update(scope or {})
    lead_id = str(uuid.uuid4())
    db_session.add(LeadOutcome(
        lead_id=lead_id,
        city_id=city,
        conversion=conversion,
        terminal_status="released" if conversion == "won" else "lost",
        realized_revenue_cents=realized,
        quoted_price_cents=quoted,
        scope_snapshot=json.dumps(snap),
        was_escalated=False,
        finalized=finalized,
        completed_at=completed_at,
        created_at=_NOW,
        updated_at=_NOW,
    ))
    await db_session.commit()
    return lead_id


async def test_closer_scope_ranks_higher(client, db_session):
    lead_id = await _make_lead(client)
    await _set_scope(db_session, lead_id, move_size_label="2 bedroom apartment", move_distance_miles=8.0)
    lead = await _lead_obj(db_session, lead_id)
    city = lead.city_id
    # Exact size match (should win) vs distance-only match
    close = await _add_outcome(db_session, city, scope={"move_size_label": "2 bedroom apartment", "move_distance_miles": 8.0}, realized=72000)
    far = await _add_outcome(db_session, city, scope={"move_size_label": "studio", "move_distance_miles": 9.0}, realized=40000)
    out = await find_comparables(db_session, lead, 5)
    assert out[0].lead_id == close
    assert out[0].score > out[1].score


async def test_filters_exclude_other_city_service_unfinalized_and_unpriced(client, db_session):
    lead_id = await _make_lead(client)
    await _set_scope(db_session, lead_id, move_size_label="studio")
    lead = await _lead_obj(db_session, lead_id)
    city = lead.city_id
    keep = await _add_outcome(db_session, city, scope={"move_size_label": "studio"}, realized=30000)
    await _add_outcome(db_session, "other-city", scope={"move_size_label": "studio"}, realized=30000)
    await _add_outcome(db_session, city, service="hauling", scope={"move_size_label": "studio"}, realized=30000)
    await _add_outcome(db_session, city, scope={"move_size_label": "studio"}, realized=30000, finalized=False)
    await _add_outcome(db_session, city, scope={"move_size_label": "studio"})  # no price
    out = await find_comparables(db_session, lead, 5)
    ids = {c.lead_id for c in out}
    assert ids == {keep}


async def test_returns_won_and_lost_labeled(client, db_session):
    lead_id = await _make_lead(client)
    lead = await _lead_obj(db_session, lead_id)
    city = lead.city_id
    await _add_outcome(db_session, city, conversion="won", realized=70000)
    await _add_outcome(db_session, city, conversion="lost", quoted=95000)
    out = await find_comparables(db_session, lead, 5)
    convs = {c.conversion for c in out}
    assert convs == {"won", "lost"}


async def test_price_basis_realized_then_quoted_fallback(client, db_session):
    lead_id = await _make_lead(client)
    lead = await _lead_obj(db_session, lead_id)
    city = lead.city_id
    await _add_outcome(db_session, city, realized=72000, quoted=70000)  # realized wins
    await _add_outcome(db_session, city, conversion="lost", quoted=95000)  # quoted fallback
    out = await find_comparables(db_session, lead, 5)
    by_basis = {c.price_basis: c.price_cents for c in out}
    assert by_basis["realized"] == 72000
    assert by_basis["quoted"] == 95000


async def test_recency_tiebreak_when_scores_equal(client, db_session):
    lead_id = await _make_lead(client)
    lead = await _lead_obj(db_session, lead_id)
    city = lead.city_id
    older = await _add_outcome(db_session, city, realized=50000, completed_at=_NOW - timedelta(days=30))
    newer = await _add_outcome(db_session, city, realized=51000, completed_at=_NOW)
    out = await find_comparables(db_session, lead, 5)
    assert out[0].lead_id == newer  # equal score (0), recent completed_at wins


async def test_empty_pool_returns_empty(client, db_session):
    lead_id = await _make_lead(client)
    lead = await _lead_obj(db_session, lead_id)
    assert await find_comparables(db_session, lead, 5) == []


async def test_malformed_scope_snapshot_is_skipped(client, db_session):
    lead_id = await _make_lead(client)
    lead = await _lead_obj(db_session, lead_id)
    city = lead.city_id
    good = await _add_outcome(db_session, city, realized=60000)
    # A row with non-JSON scope_snapshot must not crash retrieval
    bad_id = str(uuid.uuid4())
    db_session.add(LeadOutcome(
        lead_id=bad_id, city_id=city, conversion="won", terminal_status="released",
        realized_revenue_cents=61000, scope_snapshot="{not valid json",
        was_escalated=False, finalized=True, created_at=_NOW, updated_at=_NOW,
    ))
    await db_session.commit()
    out = await find_comparables(db_session, lead, 5)
    assert good in {c.lead_id for c in out}


async def test_limit_is_honored(client, db_session):
    lead_id = await _make_lead(client)
    lead = await _lead_obj(db_session, lead_id)
    city = lead.city_id
    for _ in range(7):
        await _add_outcome(db_session, city, realized=50000)
    out = await find_comparables(db_session, lead, 3)
    assert len(out) == 3
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app/backend ; python -m pytest tests/test_comparables_service.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.comparables_service'`.

- [ ] **Step 3: Write the service**

`app/backend/app/services/comparables_service.py`:

```python
"""
Structured comparable-outcome retrieval (item 2 of the self-learning roadmap).

Given a lead, returns the most similar same-city finalized past outcomes (won +
lost) by a deterministic attribute-similarity score over each outcome's frozen
`scope_snapshot`. No embeddings — explainable and dependency-free. Consumed by
quote_service to anchor the AI's price on real local results.
"""

from __future__ import annotations

import json
import logging

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.lead import Lead
from app.models.lead_outcome import LeadOutcome
from app.schemas.quote_suggestion import ComparableOut

_log = logging.getLogger(__name__)


def _score(lead: Lead, snap: dict) -> int:
    """Attribute-similarity score; higher = more similar. Missing fields score 0."""
    score = 0

    ls, cs = lead.move_size_label, snap.get("move_size_label")
    if ls and cs and ls == cs:
        score += 3

    ld, cd = lead.move_distance_miles, snap.get("move_distance_miles")
    if ld is not None and cd is not None:
        diff = abs(ld - cd)
        if diff <= 5:
            score += 2
        elif diff <= 20:
            score += 1

    lt, ct = lead.move_type, snap.get("move_type")
    if lt and ct and lt == ct:
        score += 1

    lead_has = lead.load_stairs is not None or lead.unload_stairs is not None
    comp_has = snap.get("load_stairs") is not None or snap.get("unload_stairs") is not None
    if lead_has and comp_has:
        lsum = (lead.load_stairs or 0) + (lead.unload_stairs or 0)
        csum = (snap.get("load_stairs") or 0) + (snap.get("unload_stairs") or 0)
        if abs(lsum - csum) <= 1:
            score += 1

    return score


async def find_comparables(db: AsyncSession, lead: Lead, limit: int = 5) -> list[ComparableOut]:
    """Top-N most similar same-city finalized outcomes (won + lost) for pricing."""
    service_type = lead.service_type.value if lead.service_type else None
    if service_type is None:
        return []

    rows = (await db.execute(
        select(LeadOutcome).where(
            LeadOutcome.city_id == lead.city_id,
            LeadOutcome.finalized.is_(True),
            LeadOutcome.conversion.in_(("won", "lost")),
            LeadOutcome.lead_id != lead.id,
            or_(
                LeadOutcome.realized_revenue_cents.isnot(None),
                LeadOutcome.quoted_price_cents.isnot(None),
            ),
        )
    )).scalars().all()

    scored: list[tuple[int, object, ComparableOut]] = []
    for row in rows:
        try:
            snap = json.loads(row.scope_snapshot) if row.scope_snapshot else {}
        except (json.JSONDecodeError, TypeError):
            continue  # malformed snapshot — skip, never crash retrieval
        if not isinstance(snap, dict) or snap.get("service_type") != service_type:
            continue  # hard service_type filter

        if row.realized_revenue_cents is not None:
            price_cents, basis = row.realized_revenue_cents, "realized"
        else:
            price_cents, basis = row.quoted_price_cents, "quoted"

        comp = ComparableOut(
            lead_id=row.lead_id,
            conversion=row.conversion,
            price_cents=price_cents,
            price_basis=basis,
            score=_score(lead, snap),
            move_size_label=snap.get("move_size_label"),
            move_distance_miles=snap.get("move_distance_miles"),
            move_type=snap.get("move_type"),
        )
        # sort key: score desc, then completed_at desc (recent first; None last)
        recency = row.completed_at.timestamp() if row.completed_at is not None else float("-inf")
        scored.append((comp.score, recency, comp))

    scored.sort(key=lambda t: (t[0], t[1]), reverse=True)
    return [comp for _, _, comp in scored[:limit]]
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app/backend ; python -m pytest tests/test_comparables_service.py -q`
Expected: 8 passed.

If a test fails on a real defect, fix the SERVICE (this task owns it). Do not weaken a test. If a failure reveals a wrong assumption (e.g. a `LeadOutcome` column name), report DONE_WITH_CONCERNS with the diagnosis.

- [ ] **Step 5: Commit**

```bash
git add app/backend/app/services/comparables_service.py app/backend/tests/test_comparables_service.py
git commit -m "feat(comparables): structured similarity retriever over lead_outcome, with tests"
```

---

## Task 3: Integrate into `quote_service`

**Files:**
- Modify: `app/backend/app/services/quote_service.py`
- Modify: `app/backend/tests/test_quote_suggestion.py`

- [ ] **Step 1: Write the failing integration tests**

Append these to `app/backend/tests/test_quote_suggestion.py` (they reuse the existing `_mock_client` / `_create_lead` helpers in that file):

```python
async def test_suggest_quote_injects_comparables_block(client, db_session, monkeypatch):
    import json as _json
    import uuid as _uuid
    from datetime import datetime, timezone
    from unittest.mock import patch
    from sqlalchemy import select
    from app.models.lead import Lead
    from app.models.lead_outcome import LeadOutcome

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

    mock = _mock_client()
    with patch("app.services.quote_service._make_client", return_value=mock):
        r = await client.post(f"/leads/{lead_id}/quote-suggestion")

    assert r.status_code == 200, r.text
    # The model saw a comparables block...
    sent = mock.messages.create.call_args.kwargs["messages"][0]["content"]
    assert "COMPARABLE LOCAL JOBS" in sent
    # ...and the response surfaces the comparables used.
    assert len(r.json()["comparables"]) == 1
    assert r.json()["comparables"][0]["conversion"] == "won"


async def test_suggest_quote_cold_start_no_block(client, monkeypatch):
    from unittest.mock import patch
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("AI_REVIEW_MODEL", "test-model")
    monkeypatch.delenv("AI_GROUNDING_FILE", raising=False)

    lead_id = await _create_lead(client)
    mock = _mock_client()
    with patch("app.services.quote_service._make_client", return_value=mock):
        r = await client.post(f"/leads/{lead_id}/quote-suggestion")

    assert r.status_code == 200, r.text
    sent = mock.messages.create.call_args.kwargs["messages"][0]["content"]
    assert "COMPARABLE LOCAL JOBS" not in sent  # no comparables → no block
    assert r.json()["comparables"] == []
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `cd app/backend ; python -m pytest tests/test_quote_suggestion.py::test_suggest_quote_injects_comparables_block tests/test_quote_suggestion.py::test_suggest_quote_cold_start_no_block -q`
Expected: FAIL — `comparables` not in the response (KeyError) and/or no block in the prompt.

- [ ] **Step 3: Wire the retriever into `quote_service.py`**

Open `app/backend/app/services/quote_service.py`.

(a) Add imports near the top (with the other imports):

```python
from app.schemas.quote_suggestion import ComparableOut, QuoteSuggestionOut
from app.services.comparables_service import find_comparables
```
(`QuoteSuggestionOut` is already imported — only add `ComparableOut` to that existing import line, and add the `find_comparables` import. Do not duplicate.)

(b) Add a module constant near the top (after the imports):

```python
COMPARABLE_LIMIT = 5
```

(c) Change `_USER_TEMPLATE` to include a comparables slot. It currently is:

```python
_USER_TEMPLATE = """
LEAD SCOPE:
{scope_json}
{pricing_section}
Draft the quote for this lead.
""".strip()
```

Replace with (note `{comparables_section}` immediately after `{pricing_section}`, no separating newline so an empty section leaves the prompt byte-identical to today):

```python
_USER_TEMPLATE = """
LEAD SCOPE:
{scope_json}
{pricing_section}{comparables_section}
Draft the quote for this lead.
""".strip()
```

(d) Add these two helpers (place them after `_latest_pricing_context`):

```python
def _format_comparables(comparables: list[ComparableOut]) -> str:
    """Render the comparable-jobs block, or '' when there are none (cold-start)."""
    if not comparables:
        return ""
    lines = []
    for c in comparables:
        bits = []
        if c.move_size_label:
            bits.append(c.move_size_label)
        if c.move_distance_miles is not None:
            bits.append(f"~{c.move_distance_miles:g}mi")
        scope = ", ".join(bits) if bits else "similar scope"
        dollars = c.price_cents / 100
        lines.append(f"- {scope} -> {c.conversion.upper()}, ${dollars:.0f} ({c.price_basis})")
    header = (
        "COMPARABLE LOCAL JOBS (most similar past outcomes - anchor your price on "
        "these real local results, not only the SOP bands):"
    )
    return "\n" + header + "\n" + "\n".join(lines)


async def _safe_find_comparables(db: AsyncSession, lead: Lead) -> list[ComparableOut]:
    """Retrieval must never break quoting — degrade to no comparables on any error."""
    try:
        return await find_comparables(db, lead, COMPARABLE_LIMIT)
    except Exception as exc:
        _log.warning("comparables retrieval failed for lead %s: %s", lead.id, exc)
        return []
```

(Confirm `Lead` and `AsyncSession` are already imported in this file; `quote_service` already imports `from app.models.lead import Lead` and `from sqlalchemy.ext.asyncio import AsyncSession`. If either is missing, add it.)

(e) In `suggest_quote`, find this block:

```python
    scope_json = json.dumps(_build_scope(lead), indent=2)
    pricing_section = await _latest_pricing_context(db, lead_id)
    user_content = _USER_TEMPLATE.format(scope_json=scope_json, pricing_section=pricing_section)
```

Replace with:

```python
    scope_json = json.dumps(_build_scope(lead), indent=2)
    pricing_section = await _latest_pricing_context(db, lead_id)
    comparables = await _safe_find_comparables(db, lead)
    comparables_section = _format_comparables(comparables)
    user_content = _USER_TEMPLATE.format(
        scope_json=scope_json,
        pricing_section=pricing_section,
        comparables_section=comparables_section,
    )
```

(f) At the end of `suggest_quote`, the function currently returns `suggestion` (after the line-item reconciliation). Attach the comparables to the returned object. Change the final `return suggestion` to:

```python
    return suggestion.model_copy(update={"comparables": comparables})
```

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `cd app/backend ; python -m pytest tests/test_quote_suggestion.py -q`
Expected: all pass (the existing suggestion tests + the 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add app/backend/app/services/quote_service.py app/backend/tests/test_quote_suggestion.py
git commit -m "feat(comparables): inject comparable-jobs block into quote prompt + surface in response"
```

---

## Task 4: Docs + full suite green

**Files:**
- Modify: `CAPABILITIES.md`

- [ ] **Step 1: Run the full backend suite**

Run: `cd app/backend ; python -m pytest -q`
Expected: all passed (prior 293 + the new comparables/quote tests). Diagnose any unrelated break to root cause.

- [ ] **Step 2: Update `CAPABILITIES.md`**

Under the "Outcome layer" section (or a new "Retrieval grounding" subsection), record: `quote_service` now retrieves the top-5 most similar same-city finalized outcomes (won + lost) via `comparables_service.find_comparables` (structured attribute scoring over `scope_snapshot`, no embeddings) and injects a "comparable local jobs" block so the AI anchors on real local sale prices; cold-start degrades to the prior prompt; comparables are returned on `QuoteSuggestionOut.comparables`. Note this is item 2 of the self-learning roadmap (item 3 = eval). Update the test count to the new total.

- [ ] **Step 3: Commit**

```bash
git add CAPABILITIES.md
git commit -m "docs(comparables): capabilities + suite green"
```

---

## Self-Review Notes (addressed)

- **Spec coverage:** schema (T1), retriever + scoring + all hard filters + price basis + recency + malformed-skip + limit (T2), prompt injection + cold-start + response surfacing + retrieval-never-breaks-quoting (T3), docs + suite (T4). Every spec section maps to a task.
- **Cold-start byte-identical:** `{pricing_section}{comparables_section}` with both empty reproduces today's `{scope_json}\n\nDraft...`; asserted by `test_suggest_quote_cold_start_no_block`.
- **Type consistency:** `find_comparables(db, lead, limit) -> list[ComparableOut]`; `ComparableOut` fields (`lead_id, conversion, price_cents, price_basis, score, move_size_label, move_distance_miles, move_type`) identical across schema, service, and tests; `_score(lead, snap)` weights match the spec table (size +3, dist +2/+1, type +1, stairs +1).
- **ASCII-only prompt text:** the block uses `->` not `→` (Windows cp1252-safe per repo convention).
- **No embeddings / no new deps:** pure SQLAlchemy + json, consistent with the spec's structured-scoring decision.
