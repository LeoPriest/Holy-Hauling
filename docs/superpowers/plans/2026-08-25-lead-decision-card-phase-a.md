# Lead Decision Card — Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the target range, the walkaway floor, and the unknown that decides the price on one card at the top of the lead window, so a lead can be worked from a phone without scrolling or switching tabs.

**Architecture:** The A–O review already reasons every figure the card shows — it just publishes them as prose. We add **optional** structured fields to `AiReviewSections`, teach the prompt to emit them alongside the existing 15 prose sections, validate them as money at parse time, and render them in a new `LeadDecisionCard` at the top of the lead window's scroll region. Because `sections_json` is a `Text` column validated on read, optional fields mean **no database migration** and legacy reviews keep validating unchanged.

**Tech Stack:** Python 3, FastAPI, Pydantic v2, SQLAlchemy async + aiosqlite, Anthropic SDK, pytest; React 18 + TypeScript + Vite + Tailwind + TanStack Query.

**Spec:** `docs/superpowers/specs/2026-08-25-lead-decision-card-design.md`

**Branch:** create `feat/lead-decision-card` off `main`

## Global Constraints

- **Test baseline is 444 collected tests** (`python -m pytest --collect-only -q`, 2026-08-25). Do not regress it. `CLAUDE.md` claims 108; it is stale — ignore it.
- **No database migration.** Phase A adds no columns and rebuilds no table. All new fields are optional fields inside the existing `sections_json` Text column.
- **Money is whole dollars as `int`.** Never float. A float here eventually prints `$524.9999`.
- **Money validation drops wholesale, never partially.** If `floor <= target_low <= target_high` is violated, all four money fields become `None` and the card shows the "no quotable number" state. It never renders three good numbers and one wrong one.
- **The card never invents a number it does not have.** No parsing figures out of legacy prose.
- **Every dropped field is logged** with the lead id and the offending value. Silence is the wrong failure mode for money.
- **This surface is phone-first** (Rule 013, amended 2026-08-25). Single column, 44px minimum on every control, no hover-only interactions.
- **Every write action ships all three states in the same pass:** in-progress indicator, success confirmation, recoverable failure.
- Backend business logic lives in services; routers own only HTTP.
- Frontend server state goes in React Query hooks, not component local state.

## Decisions made while planning

1. **`_MONEY_CEILING = 100000`** — the spec says "> 100000 is a parse failure" without naming a constant. Named so the test and the implementation cannot drift.
2. **Lever pruning happens server-side**, in the same validator that checks the money. The frontend renders what it is given. Putting "at most two levers, widest swing" in the UI would mean the API and the screen disagree about what the review says.
3. **`band_reason` is capped at 120 characters** server-side. The spec says "one short clause" without a bound; an unbounded string on a phone card wraps to five lines and destroys the layout. Over-length values are dropped, not truncated mid-word.
4. **The accordion is collapsed by default and its state is not persisted.** The spec says "closed by default". Remembering per-lead open state is scope the spec does not ask for.
5. **The spec's frontend test items are verified by build plus a device pass, not by automated tests.** The spec lists four frontend checks (six states render distinctly, card on all three tabs, re-run's three action states, 44px targets). This repo has Jest and Playwright configured but unused, and no existing screen has a test — introducing the first one here is scope the spec does not ask for and would not have caught anything Tasks 5–7 get wrong. Verification is `tsc --noEmit`, `npm run build`, and Ron's pass on a phone. **Task 5's state table is the checklist for that pass** — walk all six. If this trade is wrong, the fix is a separate task that stands up the harness properly, not one test bolted onto this plan.

## File Structure

**Backend — modify**

| File | Change |
|---|---|
| `app/backend/app/schemas/ai_review.py` | Add `RangeLever` + 8 optional fields on `AiReviewSections` |
| `app/backend/app/services/ai_review_service.py` | Prompt emits the structured block; `_validate_money()` sanitises it before persist |
| `app/backend/tests/test_ai_review.py` | Append schema + validation tests |

**Frontend — create**

| File | Responsibility |
|---|---|
| `app/frontend/src/components/LeadDecisionCard.tsx` | The card. All six states. |

**Frontend — modify**

| File | Change |
|---|---|
| `app/frontend/src/types/lead.ts` | Mirror the new optional fields |
| `app/frontend/src/screens/LeadCommandCenter.tsx` | Render the card inside `<main>`; move `RefundBanner` inside too |
| `app/frontend/src/screens/panels/QuotePanel.tsx` | Collapse the seven pricing cards into one accordion |

---

### Task 1: Structured fields on the review schema

**Files:**
- Modify: `app/backend/app/schemas/ai_review.py`
- Test: `app/backend/tests/test_ai_review.py`

**Interfaces:**
- Produces: `RangeLever` (fields `factor`, `low_answer`, `low_price`, `high_answer`, `high_price`); `AiReviewSections` gains optional `sayability`, `target_low`, `target_high`, `floor`, `band_position`, `band_reason`, `range_levers`, `floor_defense`

- [ ] **Step 1: Write the failing test**

Append to `app/backend/tests/test_ai_review.py`:

```python
# ── Structured decision fields (2026-08-25) ──────────────────────────────────

_PROSE_ONLY = {
    "a_next_message": "Call now", "b_call_plan": "Confirm scope",
    "c_behavior_class": "shopper", "d_transport_path": "own truck",
    "e_escalation_note": "none", "f_pricing_band": "525-725",
    "g_band_position": "Mid", "h_friction_points": "couch size unknown",
    "i_sayability_check": "Partial", "j_quote_style": "Range",
    "k_quote_source_label": "Based on what you described",
    "l_pricing_guidance": "Target 525-650, floor 475",
    "m_quick_read": "clean dual-service job", "n_pattern_anchor": "similar to prior",
    "o_branch_replies": "if she balks, sharpen haul",
}


def test_legacy_sections_validate_with_new_fields_absent():
    from app.schemas.ai_review import AiReviewSections

    sections = AiReviewSections.model_validate(_PROSE_ONLY)

    # Every new field defaults to None — a review written before this feature
    # must keep validating untouched.
    assert sections.sayability is None
    assert sections.target_low is None
    assert sections.target_high is None
    assert sections.floor is None
    assert sections.band_position is None
    assert sections.band_reason is None
    assert sections.range_levers is None
    assert sections.floor_defense is None


def test_structured_fields_round_trip_through_json():
    from app.schemas.ai_review import AiReviewSections

    payload = {
        **_PROSE_ONLY,
        "sayability": "confirm_first",
        "target_low": 525,
        "target_high": 650,
        "floor": 475,
        "band_position": "mid",
        "band_reason": "flat access, no stairs",
        "floor_defense": "Sharpen the haul line only — never discount both.",
        "range_levers": [{
            "factor": "Couch type",
            "low_answer": "Standard sofa", "low_price": 525,
            "high_answer": "Sectional / sleeper", "high_price": 650,
        }],
    }
    sections = AiReviewSections.model_validate(payload)
    restored = AiReviewSections.model_validate_json(sections.model_dump_json())

    assert restored.target_low == 525
    assert restored.floor == 475
    assert restored.sayability == "confirm_first"
    assert restored.range_levers is not None
    assert restored.range_levers[0].factor == "Couch type"
    assert restored.range_levers[0].high_price == 650


def test_sayability_rejects_a_value_outside_the_enum():
    import pytest as _pytest
    from pydantic import ValidationError

    from app.schemas.ai_review import AiReviewSections

    with _pytest.raises(ValidationError):
        AiReviewSections.model_validate({**_PROSE_ONLY, "sayability": "maybe"})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/backend && python -m pytest tests/test_ai_review.py -q -k "legacy_sections or round_trip or outside_the_enum"`
Expected: FAIL with `AttributeError: 'AiReviewSections' object has no attribute 'sayability'`

- [ ] **Step 3: Add the schema**

In `app/backend/app/schemas/ai_review.py`, change the imports at the top of the file to include `Literal` and `Field`:

```python
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field
```

Add `RangeLever` immediately **above** `class AiReviewSections`:

```python
class RangeLever(BaseModel):
    """One unknown that moves the price, with what each answer is worth.

    Exactly two options by design — a lever is a binary the operator resolves in
    one question on a call. Three branches do not fit a phone card and stop being
    glanceable; that is what the full A–O analysis is for.
    """
    factor: str                 # "Couch type"
    low_answer: str             # "Standard sofa"
    low_price: int              # whole dollars
    high_answer: str            # "Sectional / sleeper"
    high_price: int             # whole dollars
```

Then append these fields to the **end** of `AiReviewSections`, after `o_branch_replies`:

```python
    # ── Structured decision fields (2026-08-25) ──────────────────────────────
    # Derived by the model from the prose above; all optional so reviews written
    # before this feature keep validating. Money is whole dollars, never float.
    sayability: Optional[Literal["ready", "confirm_first", "hold"]] = None
    target_low: Optional[int] = None
    target_high: Optional[int] = None
    floor: Optional[int] = None
    band_position: Optional[Literal["low", "mid", "high"]] = None
    band_reason: Optional[str] = None
    range_levers: Optional[list[RangeLever]] = Field(default=None)
    floor_defense: Optional[str] = None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app/backend && python -m pytest tests/test_ai_review.py -q`
Expected: all pass, 3 new

- [ ] **Step 5: Run the full suite**

Run: `cd app/backend && python -m pytest -q 2>&1 | tail -3`
Expected: 447 passed (444 + 3)

- [ ] **Step 6: Commit**

```bash
git add app/backend/app/schemas/ai_review.py app/backend/tests/test_ai_review.py
git commit -m "feat(quoting): optional structured decision fields on AiReviewSections"
```

---

### Task 2: Money validation

**Files:**
- Modify: `app/backend/app/services/ai_review_service.py`
- Test: `app/backend/tests/test_ai_review.py`

**Interfaces:**
- Consumes: `AiReviewSections`, `RangeLever` from Task 1
- Produces: `_MONEY_CEILING: int`, `_MAX_BAND_REASON: int`, `_validate_money(sections: AiReviewSections, lead_id: str) -> AiReviewSections`

- [ ] **Step 1: Write the failing test**

Append to `app/backend/tests/test_ai_review.py`:

```python
def _with(**over) -> dict:
    """A well-formed structured payload, overridden per test."""
    base = {
        **_PROSE_ONLY,
        "sayability": "confirm_first",
        "target_low": 525, "target_high": 650, "floor": 475,
        "band_position": "mid", "band_reason": "flat access, no stairs",
        "floor_defense": "Sharpen the haul line only.",
        "range_levers": [{
            "factor": "Couch type",
            "low_answer": "Standard sofa", "low_price": 525,
            "high_answer": "Sectional / sleeper", "high_price": 650,
        }],
    }
    base.update(over)
    return base


def test_valid_money_survives_validation():
    from app.schemas.ai_review import AiReviewSections
    from app.services.ai_review_service import _validate_money

    out = _validate_money(AiReviewSections.model_validate(_with()), "lead-1")

    assert out.target_low == 525
    assert out.target_high == 650
    assert out.floor == 475
    assert out.range_levers is not None and len(out.range_levers) == 1


def test_floor_above_target_low_drops_all_four_money_fields():
    from app.schemas.ai_review import AiReviewSections
    from app.services.ai_review_service import _validate_money

    # floor 600 > target_low 525 — the model contradicted itself.
    out = _validate_money(AiReviewSections.model_validate(_with(floor=600)), "lead-1")

    assert out.target_low is None
    assert out.target_high is None
    assert out.floor is None
    assert out.range_levers is None      # levers cannot outlive the range
    # Prose is never touched.
    assert out.l_pricing_guidance == "Target 525-650, floor 475"


def test_inverted_range_drops_all_four_money_fields():
    from app.schemas.ai_review import AiReviewSections
    from app.services.ai_review_service import _validate_money

    out = _validate_money(
        AiReviewSections.model_validate(_with(target_low=650, target_high=525)), "lead-1"
    )

    assert out.target_low is None
    assert out.floor is None


def test_money_at_or_below_zero_is_dropped():
    from app.schemas.ai_review import AiReviewSections
    from app.services.ai_review_service import _validate_money

    out = _validate_money(AiReviewSections.model_validate(_with(floor=0)), "lead-1")

    assert out.floor is None
    assert out.target_low is None


def test_money_above_the_ceiling_is_dropped():
    from app.schemas.ai_review import AiReviewSections
    from app.services.ai_review_service import _MONEY_CEILING, _validate_money

    out = _validate_money(
        AiReviewSections.model_validate(_with(target_high=_MONEY_CEILING + 1)), "lead-1"
    )

    assert out.target_high is None
    assert out.target_low is None


def test_lever_priced_outside_the_range_drops_levers_but_keeps_the_range():
    from app.schemas.ai_review import AiReviewSections
    from app.services.ai_review_service import _validate_money

    payload = _with(range_levers=[{
        "factor": "Couch type",
        "low_answer": "Standard sofa", "low_price": 100,      # below floor 475
        "high_answer": "Sectional", "high_price": 650,
    }])
    out = _validate_money(AiReviewSections.model_validate(payload), "lead-1")

    assert out.range_levers is None
    # The range itself was self-consistent, so it survives.
    assert out.target_low == 525
    assert out.floor == 475


def test_at_most_two_levers_survive_widest_swing_first():
    from app.schemas.ai_review import AiReviewSections
    from app.services.ai_review_service import _validate_money

    payload = _with(range_levers=[
        {"factor": "Narrow", "low_answer": "a", "low_price": 600,
         "high_answer": "b", "high_price": 610},           # swing 10
        {"factor": "Widest", "low_answer": "a", "low_price": 480,
         "high_answer": "b", "high_price": 650},           # swing 170
        {"factor": "Middle", "low_answer": "a", "low_price": 500,
         "high_answer": "b", "high_price": 600},           # swing 100
    ])
    out = _validate_money(AiReviewSections.model_validate(payload), "lead-1")

    assert out.range_levers is not None
    assert [lever.factor for lever in out.range_levers] == ["Widest", "Middle"]


def test_overlong_band_reason_is_dropped_not_truncated():
    from app.schemas.ai_review import AiReviewSections
    from app.services.ai_review_service import _MAX_BAND_REASON, _validate_money

    out = _validate_money(
        AiReviewSections.model_validate(_with(band_reason="x" * (_MAX_BAND_REASON + 1))),
        "lead-1",
    )

    assert out.band_reason is None
    assert out.target_low == 525     # nothing else is affected


def test_review_with_no_structured_fields_passes_through_untouched():
    from app.schemas.ai_review import AiReviewSections
    from app.services.ai_review_service import _validate_money

    out = _validate_money(AiReviewSections.model_validate(_PROSE_ONLY), "lead-1")

    assert out.target_low is None
    assert out.m_quick_read == "clean dual-service job"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/backend && python -m pytest tests/test_ai_review.py -q -k "money or lever or band_reason or structured_fields_pass"`
Expected: FAIL with `ImportError: cannot import name '_validate_money'`

- [ ] **Step 3: Write the validator**

In `app/backend/app/services/ai_review_service.py`, add these constants next to the other module-level constants (near `_SYSTEM_PROMPT_TEMPLATE`):

```python
# Money sanity bounds for the structured decision fields. A quote above this is
# a parse failure, not a big job.
_MONEY_CEILING = 100000
# A band reason longer than this wraps to five lines on a phone card.
_MAX_BAND_REASON = 120
# More than two levers and the card is a form again.
_MAX_LEVERS = 2
```

Then add the validator itself, above `generate_review`:

```python
def _validate_money(sections: AiReviewSections, lead_id: str) -> AiReviewSections:
    """Sanitise the model-emitted decision fields before they are persisted.

    These are money figures produced by a text generator. Emitting them as
    structured data does not make them true. Anything that fails a check is
    DROPPED, never corrected or truncated — the card is designed to show a
    "no quotable number" state, which is safe, rather than a wrong figure,
    which is not.
    """
    logger = logging.getLogger(__name__)

    def _sane(value: Optional[int]) -> bool:
        return value is not None and 0 < value <= _MONEY_CEILING

    money = (sections.floor, sections.target_low, sections.target_high)
    any_money_present = any(v is not None for v in money)

    if any_money_present:
        floor, low, high = money
        ok = (
            _sane(floor) and _sane(low) and _sane(high)
            and floor <= low <= high
        )
        if not ok:
            logger.warning(
                "ai_review money dropped for lead=%s floor=%s target_low=%s target_high=%s",
                lead_id, floor, low, high,
            )
            sections.floor = None
            sections.target_low = None
            sections.target_high = None
            # A lever prices a point inside the range; with no range it means nothing.
            sections.range_levers = None

    if sections.range_levers:
        floor, high = sections.floor, sections.target_high
        if floor is None or high is None:
            logger.warning("ai_review levers dropped for lead=%s: no range", lead_id)
            sections.range_levers = None
        else:
            out_of_range = [
                lever for lever in sections.range_levers
                if not (floor <= lever.low_price <= high and floor <= lever.high_price <= high)
            ]
            if out_of_range:
                logger.warning(
                    "ai_review levers dropped for lead=%s: %s priced outside [%s, %s]",
                    lead_id, [lever.factor for lever in out_of_range], floor, high,
                )
                sections.range_levers = None
            elif len(sections.range_levers) > _MAX_LEVERS:
                # Keep the ones that move the number most.
                sections.range_levers = sorted(
                    sections.range_levers,
                    key=lambda lever: lever.high_price - lever.low_price,
                    reverse=True,
                )[:_MAX_LEVERS]

    if sections.band_reason is not None and len(sections.band_reason) > _MAX_BAND_REASON:
        logger.warning(
            "ai_review band_reason dropped for lead=%s: %d chars",
            lead_id, len(sections.band_reason),
        )
        sections.band_reason = None

    return sections
```

Add `import logging` and `from typing import Optional` to the file's imports if they are not already present — check before adding, several modules in this repo already import both.

- [ ] **Step 4: Wire it into the generate path**

In `generate_review`, find this block (around line 356):

```python
    try:
        parsed = json.loads(raw)
        sections = AiReviewSections.model_validate(parsed)
    except (json.JSONDecodeError, ValidationError) as exc:
        raise HTTPException(502, f"AI returned an invalid A–O structure: {exc}") from exc
```

Add the validation call immediately after that `except` block, before the `# Persist` comment:

```python
    sections = _validate_money(sections, lead_id)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd app/backend && python -m pytest tests/test_ai_review.py -q`
Expected: all pass, 9 new

- [ ] **Step 6: Run the full suite**

Run: `cd app/backend && python -m pytest -q 2>&1 | tail -3`
Expected: 456 passed (447 + 9)

- [ ] **Step 7: Commit**

```bash
git add app/backend/app/services/ai_review_service.py app/backend/tests/test_ai_review.py
git commit -m "feat(quoting): validate structured money fields, drop wholesale on failure"
```

---

### Task 3: Teach the prompt to emit the structured block

**Files:**
- Modify: `app/backend/app/services/ai_review_service.py:100-129` (`_SYSTEM_PROMPT_TEMPLATE`)
- Test: `app/backend/tests/test_ai_review.py`

**Interfaces:**
- Consumes: everything from Tasks 1–2
- Produces: no new symbols; `_prompt_version()` output changes as a side effect

- [ ] **Step 1: Write the failing test**

Append to `app/backend/tests/test_ai_review.py`:

```python
def test_prompt_asks_for_the_structured_decision_block():
    from app.services import ai_review_service as svc

    template = svc._SYSTEM_PROMPT_TEMPLATE

    for key in (
        "sayability", "target_low", "target_high", "floor",
        "band_position", "band_reason", "range_levers", "floor_defense",
    ):
        assert key in template, f"prompt never mentions {key}"

    # The optionality is load-bearing: a model pressured to invent a lever
    # produces a fake one, which is worse than none.
    assert "null" in template


def test_prompt_version_changes_when_the_template_changes(monkeypatch):
    from app.services import ai_review_service as svc

    before = svc._prompt_version("SOP CONTENT")
    monkeypatch.setattr(svc, "_SYSTEM_PROMPT_TEMPLATE", svc._SYSTEM_PROMPT_TEMPLATE + " x")
    after = svc._prompt_version("SOP CONTENT")

    # The grounding-eval harness cohorts by prompt_version. If this ever stops
    # changing, pre-card and post-card reviews get silently pooled.
    assert before != after
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/backend && python -m pytest tests/test_ai_review.py -q -k "structured_decision_block or version_changes"`
Expected: `test_prompt_asks_for_the_structured_decision_block` FAILS with "prompt never mentions sayability". The version test should already pass — it guards existing behaviour.

- [ ] **Step 3: Extend the prompt**

In `app/backend/app/services/ai_review_service.py`, the template currently ends with the 15-key JSON example and a closing `"""`. Replace the closing part — from `  "o_branch_replies": "..."` through `}}` — with this, so the JSON example gains the structured keys and the guidance that follows them:

```
  "o_branch_replies": "...",

  "sayability": "ready | confirm_first | hold",
  "target_low": 525,
  "target_high": 650,
  "floor": 475,
  "band_position": "low | mid | high",
  "band_reason": "flat access, no stairs",
  "floor_defense": "Sharpen the haul line only — never discount both.",
  "range_levers": [
    {{"factor": "Couch type",
      "low_answer": "Standard sofa", "low_price": 525,
      "high_answer": "Sectional / sleeper", "high_price": 650}}
  ]
}}

THE STRUCTURED KEYS ARE NOT NEW ANALYSIS. Derive each one from what you already
wrote in the prose sections above:
- "sayability" restates section I. Use "ready" when the scope is firm enough to
  quote now, "confirm_first" when a specific unknown must be resolved first, and
  "hold" when the scope is too unresolved to price at all.
- "target_low"/"target_high"/"floor" are the figures from section L, as whole
  dollars with no currency symbol, commas, or decimals. "floor" is the minimum
  acceptable job. floor <= target_low <= target_high must hold.
- "band_position" restates section G. "band_reason" is the single clearest
  reason it sits there, under 120 characters, no trailing period.
- "floor_defense" is the one sentence from section L about what to concede when
  the customer pushes back.
- "range_levers" is the unknown that moves the price WITH what each answer is
  worth — the conditional you wrote in section L (for example "standard sofa,
  low end; sectional, push higher"). Every lever price must fall between "floor"
  and "target_high". Give at most two, each with exactly two answers.

Use null for anything you cannot state confidently. "range_levers" must be null
when no single unknown dominates the price — an invented lever is worse than
none. Never guess a number to fill a field.
```

Keep the rest of the template unchanged. Note the `{{` / `}}` doubling: this string goes through `.format()`, so literal braces must be escaped.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app/backend && python -m pytest tests/test_ai_review.py -q`
Expected: all pass, 2 new

- [ ] **Step 5: Run the full suite**

Run: `cd app/backend && python -m pytest -q 2>&1 | tail -3`
Expected: 458 passed (456 + 2). If a test outside `test_ai_review.py` fails, STOP and report — a prompt change should not affect anything else.

- [ ] **Step 6: Commit**

```bash
git add app/backend/app/services/ai_review_service.py app/backend/tests/test_ai_review.py
git commit -m "feat(quoting): prompt emits the structured decision block"
```

---

### Task 4: Frontend types

**Files:**
- Modify: `app/frontend/src/types/lead.ts:66-85`

**Interfaces:**
- Consumes: the backend schema from Task 1
- Produces: `RangeLever`, `Sayability`, `BandPosition`; `AiReviewSections` gains the 8 optional fields

- [ ] **Step 1: Add the types**

In `app/frontend/src/types/lead.ts`, add above `export interface AiReviewSections`:

```ts
export type Sayability = 'ready' | 'confirm_first' | 'hold'
export type BandPosition = 'low' | 'mid' | 'high'

/** One unknown that moves the price, with what each answer is worth. */
export interface RangeLever {
  factor: string
  low_answer: string
  low_price: number
  high_answer: string
  high_price: number
}
```

Then append to the **end** of the `AiReviewSections` interface, after `o_branch_replies: string`:

```ts
  // Structured decision fields — absent on reviews written before 2026-08-25.
  // The backend drops any figure that fails validation, so a present value is
  // trustworthy and an absent one means "no quotable number", never "zero".
  sayability?: Sayability | null
  target_low?: number | null
  target_high?: number | null
  floor?: number | null
  band_position?: BandPosition | null
  band_reason?: string | null
  range_levers?: RangeLever[] | null
  floor_defense?: string | null
```

- [ ] **Step 2: Verify it type-checks**

Run: `cd app/frontend && npx tsc --noEmit`
Expected: no errors. Pre-existing errors elsewhere are not yours to fix — record them and leave them alone.

- [ ] **Step 3: Commit**

```bash
git add app/frontend/src/types/lead.ts
git commit -m "feat(quoting): frontend types for the structured decision fields"
```

---

### Task 5: The decision card

**Files:**
- Create: `app/frontend/src/components/LeadDecisionCard.tsx`

**Interfaces:**
- Consumes: `AiReview`, `Lead`, `RangeLever` from `../types/lead`; `useTriggerAiReview` from `../hooks/useLeads`; `contactPhone` via `lead.contact_phone`
- Produces: `<LeadDecisionCard lead={lead} aiReview={aiReview} />`

**The six states, all required in this pass:**

| State | Condition | Renders |
|---|---|---|
| Confirm first | `sayability === 'confirm_first'` and money present | badge, range, floor, band line, levers, floor defense, Call + Text |
| Ready to quote | `sayability === 'ready'` and money present | badge, range, floor, band line, band reason, Call + Text |
| Hold | `sayability === 'hold'` | badge, band reason as the reason to hold, **no range**, Call + Text |
| No quotable number | review exists, money absent | explanation + Re-run AI review |
| No review | `aiReview` undefined | Run AI review |
| Failed | re-run mutation errored | the error, and a retry |

- [ ] **Step 1: Write the component**

Create `app/frontend/src/components/LeadDecisionCard.tsx`:

```tsx
import { useTriggerAiReview } from '../hooks/useLeads'
import type { AiReview, Lead, RangeLever } from '../types/lead'

/** 44px minimum — this surface is phone-first (Rule 013). */
const TOUCH = 'min-h-[44px]'

function money(value: number): string {
  return `$${value.toLocaleString('en-US')}`
}

function CallRow({ lead }: { lead: Lead }) {
  const phone = lead.contact_phone ?? lead.customer_phone
  const name = lead.customer_name?.split(' ')[0] ?? 'customer'

  if (!phone) {
    return (
      <div className={`${TOUCH} flex items-center justify-center rounded-xl bg-gray-100 px-4 text-sm text-gray-500 dark:bg-gray-700 dark:text-gray-300`}>
        No number yet — reply on Thumbtack to reveal it
      </div>
    )
  }

  return (
    <div className="flex gap-2">
      <a
        href={`tel:${phone}`}
        className={`${TOUCH} flex flex-1 items-center justify-center rounded-xl bg-green-600 px-4 font-semibold text-white active:bg-green-700`}
      >
        Call {name}
      </a>
      <a
        href={`sms:${phone}`}
        className={`${TOUCH} flex items-center justify-center rounded-xl border border-gray-300 px-4 text-sm font-medium text-gray-700 active:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:active:bg-gray-700`}
      >
        Text
      </a>
    </div>
  )
}

function Lever({ lever }: { lever: RangeLever }) {
  return (
    <div className="rounded-xl border-l-[3px] border-amber-500 bg-amber-50 p-3 dark:bg-amber-900/20">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
        {lever.factor} decides it
      </p>
      <div className="flex gap-2">
        <div className="flex-1 rounded-lg border border-amber-200 bg-white p-2 dark:border-amber-800 dark:bg-gray-800">
          <p className="text-xs text-gray-500 dark:text-gray-400">{lever.low_answer}</p>
          <p className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">{money(lever.low_price)}</p>
        </div>
        <div className="flex-1 rounded-lg border border-amber-300 bg-white p-2 dark:border-amber-700 dark:bg-gray-800">
          <p className="text-xs text-gray-500 dark:text-gray-400">{lever.high_answer}</p>
          <p className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">{money(lever.high_price)}</p>
        </div>
      </div>
    </div>
  )
}

export function LeadDecisionCard({ lead, aiReview }: { lead: Lead; aiReview: AiReview | undefined }) {
  const triggerReview = useTriggerAiReview()
  const s = aiReview?.sections

  const hasMoney =
    s?.target_low != null && s?.target_high != null && s?.floor != null

  // ── No review at all ──────────────────────────────────────────────────
  if (!aiReview) {
    return (
      <div className="m-3 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          No AI review yet for this lead.
        </p>
        {triggerReview.isError && (
          <p className="mb-2 text-sm text-red-600 dark:text-red-400">
            {triggerReview.error instanceof Error ? triggerReview.error.message : 'Could not run the review.'}
          </p>
        )}
        <button
          onClick={() => triggerReview.mutate({ leadId: lead.id })}
          disabled={triggerReview.isPending}
          className={`${TOUCH} w-full rounded-xl bg-indigo-600 px-4 font-medium text-white disabled:opacity-50`}
        >
          {triggerReview.isPending ? 'Running…' : 'Run AI review'}
        </button>
      </div>
    )
  }

  // ── Review exists but carries no quotable figures ─────────────────────
  if (!hasMoney && s?.sayability !== 'hold') {
    return (
      <div className="m-3 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          No quotable number yet
        </p>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          This review was written before pricing was captured as figures. Re-run it to get a
          target and floor.
        </p>
        {triggerReview.isError && (
          <p className="mb-2 text-sm text-red-600 dark:text-red-400">
            {triggerReview.error instanceof Error ? triggerReview.error.message : 'Could not re-run the review.'}
          </p>
        )}
        <button
          onClick={() => triggerReview.mutate({ leadId: lead.id })}
          disabled={triggerReview.isPending}
          className={`${TOUCH} mb-3 w-full rounded-xl bg-indigo-600 px-4 font-medium text-white disabled:opacity-50`}
        >
          {triggerReview.isPending ? 'Re-running…' : 'Re-run AI review'}
        </button>
        <CallRow lead={lead} />
      </div>
    )
  }

  const isHold = s?.sayability === 'hold'
  const isConfirm = s?.sayability === 'confirm_first'

  const headTone = isHold
    ? 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'
    : isConfirm
      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
      : 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'

  const headLabel = isHold ? 'Hold — scope not firm' : isConfirm ? 'Confirm first' : 'Ready to quote'

  return (
    <div className="m-3 overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <div className={`px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider ${headTone}`}>
        {headLabel}
      </div>

      {/* The range is deliberately suppressed on hold — showing one invites
          quoting it when the model judged the scope too unresolved to price. */}
      {!isHold && hasMoney && (
        <div className="flex flex-wrap items-baseline justify-between gap-3 px-4 pt-4">
          <p className="text-3xl font-bold tabular-nums tracking-tight text-gray-900 dark:text-white">
            {money(s!.target_low!)}–{money(s!.target_high!)}
          </p>
          <p className="text-right text-xs text-gray-500 dark:text-gray-400">
            floor
            <span className="block text-base font-semibold tabular-nums text-red-600 dark:text-red-400">
              {money(s!.floor!)}
            </span>
          </p>
        </div>
      )}

      {s?.band_reason && (
        <p className="px-4 pb-1 pt-2 text-xs text-gray-500 dark:text-gray-400">
          {isHold ? s.band_reason : <><span className="font-medium">{s.band_position ?? 'mid'}-band</span> · {s.band_reason}</>}
        </p>
      )}

      <div className="space-y-2 p-4 pt-3">
        {s?.range_levers?.map((lever, i) => <Lever key={`${lever.factor}-${i}`} lever={lever} />)}

        {s?.floor_defense && hasMoney && (
          <div className="rounded-xl border-l-[3px] border-red-500 bg-red-50 p-3 dark:bg-red-900/20">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-red-700 dark:text-red-400">
              If they push back
            </p>
            <p className="text-sm text-gray-700 dark:text-gray-200">
              {s.floor_defense} Floor {money(s.floor!)}.
            </p>
          </div>
        )}

        <CallRow lead={lead} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `cd app/frontend && npx tsc --noEmit`
Expected: no errors from `LeadDecisionCard.tsx`

- [ ] **Step 3: Commit**

```bash
git add app/frontend/src/components/LeadDecisionCard.tsx
git commit -m "feat(quoting): LeadDecisionCard with all six states"
```

---

### Task 6: Place the card and free the refund banner

**Files:**
- Modify: `app/frontend/src/screens/LeadCommandCenter.tsx` (import block; lines 329-334)

**Interfaces:**
- Consumes: `<LeadDecisionCard lead aiReview />` from Task 5

**Why this placement:** `EscalationCard` and `RefundBanner` currently render as siblings **outside** `<main className="flex-1 overflow-y-auto">`, which is why the refund banner appears in every screenshot — it is not sticky CSS, it permanently occupies height above the scroll region. On a phone that is a significant slice of the screen spent on a lead closed two months ago.

- [ ] **Step 1: Add the import**

In `app/frontend/src/screens/LeadCommandCenter.tsx`, beside the other component imports (near line 17):

```tsx
import { LeadDecisionCard } from '../components/LeadDecisionCard'
```

- [ ] **Step 2: Move the banner and add the card**

Find this block (around line 329):

```tsx
      {/* ── Escalation card (visible on all tabs) ────────── */}
      <EscalationCard leadId={lead.id} />
      <RefundBanner lead={lead} />

      {/* ── Scrollable panel ─────────────────────────────── */}
      <main className="flex-1 overflow-y-auto">
```

Replace it with:

```tsx
      {/* An open escalation is a genuine interrupt — it stays pinned. */}
      <EscalationCard leadId={lead.id} />

      {/* ── Scrollable panel ─────────────────────────────── */}
      <main className="flex-1 overflow-y-auto">
        {/* First thing on open, on every tab; scrolls away once read. */}
        <LeadDecisionCard lead={lead} aiReview={aiReview} />
        {/* Moved inside the scroll region so it stops eating permanent
            vertical space on a phone. */}
        <RefundBanner lead={lead} />
```

- [ ] **Step 3: Verify it type-checks and builds**

Run: `cd app/frontend && npx tsc --noEmit && npm run build`
Expected: clean type-check, successful build

- [ ] **Step 4: Commit**

```bash
git add app/frontend/src/screens/LeadCommandCenter.tsx
git commit -m "feat(quoting): decision card at the top of the lead window"
```

---

### Task 7: Collapse the A–O pricing cards

**Files:**
- Modify: `app/frontend/src/screens/panels/QuotePanel.tsx:193-210`

**Interfaces:**
- Consumes: `PRICING_SECTIONS` (already defined at the top of the file)

- [ ] **Step 1: Collapse the seven cards into an accordion**

In `app/frontend/src/screens/panels/QuotePanel.tsx`, find this block:

```tsx
        {aiReview ? (
          <div className="space-y-2">
            {PRICING_SECTIONS.map(({ key, label }) => (
              <div key={key} className="bg-orange-50 border border-orange-200 rounded-xl p-3">
                <p className="text-xs font-semibold text-orange-700 mb-1">{label}</p>
                <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                  {aiReview.sections[key] || '—'}
                </p>
              </div>
            ))}
          </div>
        ) : (
```

Replace the `aiReview ?` branch (leaving the `: (` fallback untouched) with:

```tsx
        {aiReview ? (
          <details className="group rounded-xl border border-orange-200 bg-orange-50">
            <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between px-4 text-sm font-medium text-orange-800">
              Full analysis
              <span className="text-orange-600 transition-transform group-open:rotate-180">⌄</span>
            </summary>
            <div className="space-y-2 p-3 pt-0">
              {PRICING_SECTIONS.map(({ key, label }) => (
                <div key={key} className="rounded-xl border border-orange-200 bg-white p-3">
                  <p className="mb-1 text-xs font-semibold text-orange-700">{label}</p>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
                    {aiReview.sections[key] || '—'}
                  </p>
                </div>
              ))}
            </div>
          </details>
        ) : (
```

`<details>` is closed by default, keyboard-accessible, and needs no state — the spec does not ask for the open/closed state to be remembered per lead.

Note: `PRICING_SECTIONS` is typed `{ key: keyof AiReviewSections }`. The new optional fields widen that union, but the array literal only lists the seven `f_`–`l_` prose keys, so this keeps type-checking. If `tsc` complains that `aiReview.sections[key]` is no longer assignable to `string`, narrow the const's type to `{ key: 'f_pricing_band' | 'g_band_position' | 'h_friction_points' | 'i_sayability_check' | 'j_quote_style' | 'k_quote_source_label' | 'l_pricing_guidance'; label: string }[]` rather than casting.

- [ ] **Step 2: Verify it type-checks and builds**

Run: `cd app/frontend && npx tsc --noEmit && npm run build`
Expected: clean type-check, successful build

- [ ] **Step 3: Commit**

```bash
git add app/frontend/src/screens/panels/QuotePanel.tsx
git commit -m "feat(quoting): collapse A-O pricing cards into one accordion"
```

---

### Task 8: Documentation and close-out

**Files:**
- Modify: `CAPABILITIES.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Run the full backend suite**

Run: `cd app/backend && python -m pytest -q 2>&1 | tail -3`
Record the actual number. Do not assert a count you have not seen.

- [ ] **Step 2: Update `CAPABILITIES.md`**

Add under the built-and-working section:

```markdown
### Lead decision card (Phase A)

- A card at the top of the lead window, on every tab: target range, walkaway floor,
  what kind of job it is, and the unknown that decides the price rendered with what
  each answer is worth ("standard sofa $525 / sectional $650").
- Fed by optional structured fields on `AiReviewSections` (`sayability`, `target_low`,
  `target_high`, `floor`, `band_position`, `band_reason`, `range_levers`,
  `floor_defense`), derived by the model from prose sections G, H, I, and L. No
  database migration — they live inside the existing `sections_json` column.
- Money is validated at parse time and **dropped wholesale** on failure: if
  `floor <= target_low <= target_high` does not hold, all four figures become null and
  the card shows "no quotable number" with a re-run action. It never renders a partial
  set. Every drop is logged with the lead id.
- Reviews written before this feature validate unchanged and show the re-run state.
  Figures are never parsed out of legacy prose.
- The A–O pricing sections are now one collapsed "Full analysis" accordion.
- `RefundBanner` moved inside the scroll region; it previously occupied permanent
  height above it on every tab.

**Not in Phase A:** the duplicate `Booking Date` row on Brief, `Est. Duration` living
on two tabs, the screenshot preview's nested scroll region, target/floor beside the
price input, and the two AI voices that disagree about the band. See the spec's Phase B.
```

- [ ] **Step 3: Update `CHANGELOG.md`**

Add an entry at the top matching the file's existing format. Name the spec (`docs/superpowers/specs/2026-08-25-lead-decision-card-design.md`) and this plan.

- [ ] **Step 4: Commit**

```bash
git add CAPABILITIES.md CHANGELOG.md
git commit -m "docs(quoting): record the decision card in capabilities and changelog"
```

- [ ] **Step 5: Hand back to Ron**

Phase A is not complete until it has been seen on a phone with a real lead. Report:

1. Deploy (Railway auto-deploys on push to `main`).
2. Open a lead that already has a review — it will show **"No quotable number yet"**, because its review predates the structured fields. That is correct behaviour, not a bug.
3. Tap **Re-run AI review**, then check the card renders a range, a floor, and — if the job has a dominant unknown — a lever.
4. **The open question this answers:** whether the model reliably produces clean levers, or whether Ashley's couch conditional was unusually tidy. Only one review has ever been examined. If levers come back null or nonsensical across several leads, the prompt needs another pass before Phase B.

---

## Phase A exit criteria

- [ ] Full backend suite passes with no regression from 444
- [ ] Frontend type-checks and builds
- [ ] A re-run review on a real lead renders the card with a range and floor
- [ ] A legacy review shows the re-run state and never a fabricated number
- [ ] All six card states from Task 5's table walked on a phone, including the re-run
      failure path (kill the backend or unset the API key to force it)
- [ ] Whether levers are reliably produced is recorded, across more than one lead

## Not in this plan

Phase B (duplicate Booking Date, duration on two tabs, nested scroll region, floor beside
the price input, reconciling the two AI voices) and the comparables-quality issue — four
comparables spanning $200–$950 all showing a one-dot match under a "GROUNDED" badge — are
each separately planned. Bundling the comparables fix inside a density change would hide it.
