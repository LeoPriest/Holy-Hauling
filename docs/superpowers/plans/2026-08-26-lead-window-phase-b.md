# Lead Window — Phase B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every field on the lead window one home and one save path, stop the screen repeating itself, put the walkaway floor where the price is typed, and make the AI state one number instead of two.

**Architecture:** Four of the five changes are deletions or relocations in two frontend files — no new components, no schema change, no migration. The fifth folds the structured figures Phase A already validated into `suggest_quote`'s prompt so it anchors to the same range the decision card displays, falling back byte-identically to today's prompt when a review carries no structured fields.

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind; Python 3, FastAPI, SQLAlchemy async, pytest.

**Spec:** `docs/superpowers/specs/2026-08-25-lead-window-phase-b-design.md`

**Branch:** create `feat/lead-window-phase-b` off `main`

## Global Constraints

- **Test baseline is 461 collected tests** (`python -m pytest --collect-only -q`, verified on merged `main` 2026-08-25). Do not regress it. `CLAUDE.md` claims 108; it is stale — ignore it.
- **No database migration.** Phase B adds no columns, no tables, and no schema changes of any kind.
- **The floor caption never renders a number the app does not have.** No placeholder, no `$0`, no em-dash in a money slot. Absent floor means the caption is absent. This is Phase A's rule and it still binds.
- **The below-floor warning does not block submission.** It states the gap and lets the quote through. The failure being fixed is *not knowing*, not *being allowed*; a blocker on a money field trains workarounds.
- **This surface is phone-first** (Rule 013). 44px minimum on every interactive element, no hover-only interactions.
- **`_latest_pricing_context` must return a byte-identical string** to today's output when a review has no structured fields. `suggest_quote`'s prompt shape is load-bearing for behaviour on every legacy review.
- Backend business logic lives in services; routers own only HTTP.
- Frontend server state goes in React Query hooks, not component local state.

## Decisions made while planning

1. **`STALE_END_DATE_NOTE` is not a thing — there is no data cleanup.** Reading the code turned up more than the spec knew (see Task 1), but repairing already-stranded `job_date_end` values is a data migration this plan does not do. Deleting the bad write path stops new ones.
2. **The floor caption reads the review, not a new prop chain.** `QuotePanel` already receives `aiReview`; it passes one number down. No context, no hook, no store.
3. **`_MIN_ANCHOR_FIELDS` is not introduced.** The anchor renders only when all three of `target_low`, `target_high`, `floor` are present — `_validate_money` already guarantees they arrive as a set or not at all, so a partial check would be dead code guarding an impossible state. The test at Task 5 Step 1 pins the boundary anyway, because "impossible" is a claim about today's validator.
4. **Tasks 1–3 are batched into one commit-per-task but one dispatch.** They are three small independent edits in the same file with no shared logic. Splitting them across three subagents would cost three context rebuilds to change ~40 lines.

## File Structure

**Frontend — modify**

| File | Change |
|---|---|
| `app/frontend/src/screens/panels/BriefPanel.tsx` | Delete the duplicate Booking Date row; make Est. Duration read-only; shrink the screenshot preview to a thumbnail row |
| `app/frontend/src/components/QuoteBuilder.tsx` | `QuoteBuilderFields` gains an optional `floor` prop and renders the caption |
| `app/frontend/src/screens/panels/QuotePanel.tsx` | Pass `aiReview.sections.floor` into `QuoteBuilderFields` |

**Backend — modify**

| File | Change |
|---|---|
| `app/backend/app/services/quote_service.py` | `_latest_pricing_context` leads with the structured anchor when present |
| `app/backend/tests/test_quote_suggestion.py` | Append four `_build_pricing_context` tests |

---

### Task 1: Delete the duplicate Booking Date row

**Files:**
- Modify: `app/frontend/src/screens/panels/BriefPanel.tsx:630-637`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: nothing later tasks rely on

**Why this row and not the other.** Reading the code turned up a defect the spec did not capture. There are **three** paths that set `job_date_requested` on Brief:

| Line | Row | Writes |
|---|---|---|
| `:626` | Requested Dates → "Use" | `saveJobDateRange(d, null)` — sets start, clears end |
| `:630` | Booking Date (bare) | `save('job_date_requested', v)` — **sets start only** |
| `:673` | Booking Date (range) | `saveJobDateRange(v, …)` — sets start and end together |

The row being deleted is the only one that writes `job_date_requested` **without** touching `job_date_end`. So setting a date range, then editing the date through the bare row, leaves the old end date stranded against a new start. Deleting it removes a duplicate *and* an inconsistent write path.

This plan does not clean up already-stranded values — that is a data migration and out of scope. It stops new ones.

- [ ] **Step 1: Delete the row**

Remove this block entirely from `app/frontend/src/screens/panels/BriefPanel.tsx` (it sits between the `Requested Dates` row and the `Time Slot` row):

```tsx
          <FieldRow label="Booking Date">
            <EditableField
              value={lead.job_date_requested}
              onSave={v => { save('job_date_requested', v); if (v) onBookingDateSet?.() }}
              placeholder="Tap to add date…"
              type="date"
            />
          </FieldRow>
```

Note the placeholder contains a mojibake sequence in the file (`dateâ€¦`) rather than a real ellipsis. Match whatever is actually on disk when you locate the block — do not retype it from this plan.

Leave the `Booking Date` row further down (the one containing `saveJobDateRange`, the `Clear` button, and the `Through` end-date field) exactly as it is. It already calls `onBookingDateSet?.()`, which is what moves the user to the Quote tab.

- [ ] **Step 2: Verify it type-checks and builds**

Run: `cd "app/frontend" && npx tsc --noEmit && npm run build`
Expected: clean type-check, successful build.

If `tsc` now reports `save` as unused, **stop and report** — it is used by many other rows in this file and an unused warning means you deleted more than the block above.

- [ ] **Step 3: Commit**

```bash
git add app/frontend/src/screens/panels/BriefPanel.tsx
git commit -m "fix(lead-window): delete the duplicate Booking Date row

It was the only path writing job_date_requested without job_date_end,
so editing through it stranded a previously-set end date."
```

---

### Task 2: One home for Est. Duration

**Files:**
- Modify: `app/frontend/src/screens/panels/BriefPanel.tsx` — the `Est. Duration` row, plus `saveEstimatedDuration` and the `DurationWheelInput` import

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: nothing later tasks rely on

**The defect.** `Lead.estimated_job_duration_minutes` has one backing field but two editors: `BriefPanel`'s `DurationWheelInput` patches it immediately, while `QuoteBuilder` seeds a draft from it and saves on quote save. Edit on Brief, then save a stale draft from Quote, and the Brief edit is silently reverted. The editable control belongs on Quote, which is where the value is used — it feeds the quote and the Google Calendar event length.

- [ ] **Step 1: Make the row read-only**

Replace this block in `app/frontend/src/screens/panels/BriefPanel.tsx`:

```tsx
          <FieldRow label="Est. Duration">
            <div className="space-y-2">
              <DurationWheelInput
                value={lead.estimated_job_duration_minutes}
                onChange={saveEstimatedDuration}
                allowClear
              />
              {lead.estimated_job_duration_minutes != null && (
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  Current: {fmtDurationMinutes(lead.estimated_job_duration_minutes)}
                </p>
              )}
            </div>
          </FieldRow>
```

with:

```tsx
          <FieldRow label="Est. Duration">
            {lead.estimated_job_duration_minutes != null ? (
              <p className="text-sm text-gray-900 dark:text-white">
                {fmtDurationMinutes(lead.estimated_job_duration_minutes)}
                <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">set on Quote</span>
              </p>
            ) : (
              <p className="text-sm text-gray-400 dark:text-gray-500">Set on the Quote tab</p>
            )}
          </FieldRow>
```

The "set on Quote" hint matters: without it a read-only value that used to be editable reads as broken rather than relocated.

`fmtDurationMinutes` is already imported at the top of this file — do not add an import for it.

- [ ] **Step 2: Remove the now-unused save handler**

Delete `saveEstimatedDuration` from `BriefPanel.tsx`. It reads:

```tsx
  const saveEstimatedDuration = (value: number | null) => {
    if (value == null) {
      patch.mutate({ id: lead.id, data: { estimated_job_duration_minutes: null } })
      return
    }
    patch.mutate({ id: lead.id, data: { estimated_job_duration_minutes: value } })
  }
```

Do **not** delete `patch` — many other handlers in this file use it.

- [ ] **Step 3: Remove the now-unused import**

Delete the `DurationWheelInput` import line from `BriefPanel.tsx`:

```tsx
import { DurationWheelInput } from '../../components/DurationWheelInput'
```

Leave the component file itself alone — `QuoteBuilder.tsx` still imports and uses it.

- [ ] **Step 4: Verify it type-checks and builds**

Run: `cd "app/frontend" && npx tsc --noEmit && npm run build`
Expected: clean type-check, successful build.

- [ ] **Step 5: Commit**

```bash
git add app/frontend/src/screens/panels/BriefPanel.tsx
git commit -m "fix(lead-window): Est. Duration is edited on Quote, shown on Brief

Two controls wrote one field through two save paths; a stale quote draft
could silently revert a Brief edit."
```

---

### Task 3: Screenshot thumbnail

**Files:**
- Modify: `app/frontend/src/screens/panels/BriefPanel.tsx` — the intake screenshot section

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: nothing later tasks rely on

**The defect.** The preview is `object-cover max-h-48` inside `overflow-hidden`. It crops a tall Thumbtack screenshot to its top ~192px — which on the observed lead showed only "Saint Louis, MO 63117" and "Date: Jun 27", both repeated in the table immediately below. It spends the largest single block of phone height on a duplicate.

It is **not** a nested scroll region. Phase A's spec said so and that was wrong; `object-cover` inside `overflow-hidden` crops, and the apparent inner scrollbar was the page's.

- [ ] **Step 1: Replace the preview with a thumbnail row**

Replace this block in `app/frontend/src/screens/panels/BriefPanel.tsx`:

```tsx
      {intakeShot && (
        <section>
          <a
            href={buildUploadUrl(intakeShot.stored_path)}
            target="_blank"
            rel="noreferrer"
            className="block rounded-xl overflow-hidden border border-gray-200 bg-gray-100"
          >
            <img
              src={buildUploadUrl(intakeShot.stored_path)}
              alt="Thumbtack screenshot"
              className="w-full object-cover max-h-48"
            />
            <p className="text-xs text-gray-400 px-3 py-1.5">Tap to open full size</p>
          </a>
        </section>
      )}
```

with:

```tsx
      {intakeShot && (
        <section>
          <a
            href={buildUploadUrl(intakeShot.stored_path)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-2 active:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:active:bg-gray-700"
          >
            <img
              src={buildUploadUrl(intakeShot.stored_path)}
              alt="Intake screenshot"
              className="h-16 w-16 shrink-0 rounded-lg object-cover"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-gray-900 dark:text-white">
                Intake screenshot
              </span>
              <span className="block text-xs text-gray-400 dark:text-gray-500">Tap to open</span>
            </span>
          </a>
        </section>
      )}
```

The row is 64px of image plus 8px padding top and bottom — comfortably past the 44px tap-target minimum, and roughly a third of the height it replaces. `active:` states are present because this surface is phone-first and `hover:` alone is invisible on touch.

- [ ] **Step 2: Verify it type-checks and builds**

Run: `cd "app/frontend" && npx tsc --noEmit && npm run build`
Expected: clean type-check, successful build.

- [ ] **Step 3: Commit**

```bash
git add app/frontend/src/screens/panels/BriefPanel.tsx
git commit -m "fix(lead-window): intake screenshot becomes a thumbnail row

It spent ~192px cropping to content the table below already showed."
```

---

### Task 4: Floor beside the price input

**Files:**
- Modify: `app/frontend/src/components/QuoteBuilder.tsx:135` — `QuoteBuilderFields` signature and the quoted-price field
- Modify: `app/frontend/src/screens/panels/QuotePanel.tsx` — the `<QuoteBuilderFields>` call site

**Interfaces:**
- Consumes: `QuoteDraft` and `parseMoney`, both already in `QuoteBuilder.tsx`
- Produces: `QuoteBuilderFields({ draft, floor }: { draft: QuoteDraft; floor?: number | null })`

**Why.** The card carries the floor at the top of the scroll region; the price is typed further down, with the floor off-screen. That gap is the mechanism behind the incident the Phase A spec cites — a lead quoted at **$510** against a floor of **$475** and a target starting at **$525**.

- [ ] **Step 1: Add the prop and the caption**

In `app/frontend/src/components/QuoteBuilder.tsx`, change the signature at line 135:

```tsx
export function QuoteBuilderFields({ draft }: { draft: QuoteDraft }) {
```

to:

```tsx
export function QuoteBuilderFields({ draft, floor }: { draft: QuoteDraft; floor?: number | null }) {
```

The function already computes `const quotedTotalValue = parseMoney(draft.quotedPriceTotal)` on the next line — reuse it, do not re-parse.

Add this immediately after that line:

```tsx
  // The floor is a validated figure or it is absent — never a placeholder.
  // quotedTotalValue is null while the field is empty or mid-edit, so an
  // untouched field must not read as "below floor".
  const belowFloor =
    floor != null && quotedTotalValue != null && quotedTotalValue < floor
```

Then, directly beneath the quoted-price `<input>` (inside the same `<label className="block space-y-1">` that starts at line 144), add:

```tsx
        {floor != null && (
          <p
            className={
              belowFloor
                ? 'text-xs font-medium text-red-600 dark:text-red-400'
                : 'text-xs text-gray-400 dark:text-gray-500'
            }
          >
            {belowFloor
              ? `$${(floor - quotedTotalValue!).toLocaleString('en-US')} below the $${floor.toLocaleString('en-US')} floor`
              : `Floor $${floor.toLocaleString('en-US')} — do not go below`}
          </p>
        )}
```

The `!` on `quotedTotalValue` is safe: `belowFloor` is only true when it is non-null.

**This must not disable, block, or gate the submit control.** It informs; it does not prevent.

- [ ] **Step 2: Pass the floor from QuotePanel**

In `app/frontend/src/screens/panels/QuotePanel.tsx`, find the `<QuoteBuilderFields draft={quoteDraft} />` call and change it to:

```tsx
<QuoteBuilderFields draft={quoteDraft} floor={aiReview?.sections.floor ?? null} />
```

`aiReview` is already a prop on `QuotePanel` — do not add a hook or a fetch.

- [ ] **Step 3: Verify it type-checks and builds**

Run: `cd "app/frontend" && npx tsc --noEmit && npm run build`
Expected: clean type-check, successful build.

`QuotePanel.tsx:265` is the **only** call site — verified by grep across `app/frontend/src`. The prop is optional anyway, so nothing else needs touching. If `tsc` disagrees and reports another call site, add `floor={null}` there rather than making the prop required, and report what you found.

- [ ] **Step 4: Commit**

```bash
git add app/frontend/src/components/QuoteBuilder.tsx app/frontend/src/screens/panels/QuotePanel.tsx
git commit -m "feat(quoting): show the walkaway floor beside the price input

Non-blocking by design — the failure being fixed is not knowing, not
being allowed."
```

---

### Task 5: One AI voice

**Files:**
- Modify: `app/backend/app/services/quote_service.py:98-114` — `_latest_pricing_context`
- Test: `app/backend/tests/test_quote_suggestion.py` (confirm in Step 0)

**Interfaces:**
- Consumes: `AiReviewSections`' structured fields, validated by `_validate_money` in Phase A
- Produces: no new symbols; `_latest_pricing_context`'s return value gains a leading anchor block when the review carries structured figures

**The defect.** `_latest_pricing_context` reads exactly `["f_pricing_band", "g_band_position", "l_pricing_guidance"]` — all prose. So `suggest_quote` re-derives a band from paragraphs while the decision card renders the model's own validated figures. On the observed lead they disagreed: the internal guidance said `$525–$725`; the builder rationale said *"at $550 we sit at the lower end of the small moving band ($350–$550)."* Phase A put those two claims on the same screen.

**Anchor, do not replace.** `suggest_quote` also weighs comparables and scope, which the A–O review never sees. It should still choose a *specific* number inside the band. It must not invent a *different* band.

- [ ] **Step 0: Confirm the test file**

The target is **`app/backend/tests/test_quote_suggestion.py`** — it covers `suggest_quote`.
(`test_quote_basis.py` also exists but covers the persisted-basis snapshot endpoint, not the
prompt.) Confirm it exists and imports `quote_service` before appending:

Run: `cd "app/backend" && grep -n "quote_service" tests/test_quote_suggestion.py | head -3`

If that returns nothing, stop and report — the file layout has changed since this plan was
written. Everywhere below that says "the quote test file" means this one.

- [ ] **Step 1: Write the failing tests**

Append to the quote test file:

```python
# ── Structured anchor in the pricing context (2026-08-26) ────────────────────

import json as _json

_PROSE_SECTIONS = {
    "f_pricing_band": "Two bands apply. Combined ~$525-$725.",
    "g_band_position": "Mid. Flat access, no stairs.",
    "l_pricing_guidance": "Target combined quote: $525-$650. Minimum: $475.",
}


def _sections(**extra) -> str:
    return _json.dumps({**_PROSE_SECTIONS, **extra})


def test_pricing_context_leads_with_the_structured_anchor():
    from app.services.quote_service import _build_pricing_context

    out = _build_pricing_context(_sections(target_low=525, target_high=650, floor=475))

    assert "525" in out and "650" in out and "475" in out
    # The anchor must precede the prose, so the instruction is read first.
    assert out.index("525") < out.index("Two bands apply")
    # The prose is kept, not replaced — it carries reasoning the figures do not.
    assert "Two bands apply" in out
    assert "Mid. Flat access" in out


def test_pricing_context_without_structured_fields_is_unchanged():
    from app.services.quote_service import _build_pricing_context

    out = _build_pricing_context(_sections())

    # Byte-identical to the pre-change format. suggest_quote's prompt shape is
    # load-bearing for every legacy review; silent drift here changes behaviour
    # on leads nobody re-ran.
    expected = (
        "\nPRIOR AI PRICING GUIDANCE:\n"
        f"f_pricing_band: {_PROSE_SECTIONS['f_pricing_band']}\n"
        f"g_band_position: {_PROSE_SECTIONS['g_band_position']}\n"
        f"l_pricing_guidance: {_PROSE_SECTIONS['l_pricing_guidance']}"
    )
    assert out == expected


def test_pricing_context_falls_back_when_the_figure_set_is_partial():
    from app.services.quote_service import _build_pricing_context

    # _validate_money guarantees these arrive as a set or not at all, so this
    # state should be unreachable — but "unreachable" is a claim about today's
    # validator, and a half-stated anchor would be worse than none.
    partial = _build_pricing_context(_sections(target_low=525, target_high=650))

    assert "anchor" not in partial.lower()
    assert partial == _build_pricing_context(_sections())


def test_pricing_context_is_empty_when_there_are_no_sections():
    from app.services.quote_service import _build_pricing_context

    assert _build_pricing_context(_json.dumps({})) == ""
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "app/backend" && python -m pytest tests/test_quote_suggestion.py -q -k "pricing_context"`
Expected: FAIL with `ImportError: cannot import name '_build_pricing_context'`

- [ ] **Step 3: Extract the formatting into a pure function**

The current `_latest_pricing_context` mixes a database read with string building, which is why the tests above cannot reach it. Split it: the query stays, the formatting becomes testable.

In `app/backend/app/services/quote_service.py`, replace:

```python
async def _latest_pricing_context(db: AsyncSession, lead_id: str) -> str:
    """Fold the latest AI review's pricing sections in as extra grounding, if present."""
    result = await db.execute(
        select(AiReview).where(AiReview.lead_id == lead_id).order_by(AiReview.created_at.desc()).limit(1)
    )
    review = result.scalar_one_or_none()
    if not review:
        return ""
    try:
        sections = json.loads(review.sections_json)
    except (json.JSONDecodeError, TypeError):
        return ""
    keys = ["f_pricing_band", "g_band_position", "l_pricing_guidance"]
    lines = [f"{key}: {sections[key]}" for key in keys if sections.get(key)]
    if not lines:
        return ""
    return "\nPRIOR AI PRICING GUIDANCE:\n" + "\n".join(lines)
```

with:

```python
_PRICING_PROSE_KEYS = ["f_pricing_band", "g_band_position", "l_pricing_guidance"]


def _build_pricing_context(sections_json: str) -> str:
    """Render the prior-review grounding block from a review's sections JSON.

    When the review carries the structured figures Phase A validated, the block
    leads with an explicit anchor so the suggestion lands inside the same range
    the decision card is showing the operator. Otherwise the output is
    byte-identical to what this produced before that anchor existed — legacy
    reviews must not silently change behaviour.
    """
    try:
        sections = json.loads(sections_json)
    except (json.JSONDecodeError, TypeError):
        return ""
    if not isinstance(sections, dict):
        return ""

    lines = [f"{key}: {sections[key]}" for key in _PRICING_PROSE_KEYS if sections.get(key)]
    if not lines:
        return ""

    prose = "\nPRIOR AI PRICING GUIDANCE:\n" + "\n".join(lines)

    low, high, floor = (
        sections.get("target_low"),
        sections.get("target_high"),
        sections.get("floor"),
    )
    # All three or none. A partial set would state a half-anchor, which is
    # worse than leaving the model to the prose.
    if not all(isinstance(v, int) for v in (low, high, floor)):
        return prose

    anchor = (
        "\nALREADY DECIDED BY THE A-O REVIEW:\n"
        f"target ${low}-${high}, floor ${floor}.\n"
        "Anchor your suggestion inside this range. Choose a specific number "
        "within it using the scope and comparable jobs below — do not derive a "
        "different band, and never suggest below the floor."
    )
    return anchor + prose


async def _latest_pricing_context(db: AsyncSession, lead_id: str) -> str:
    """Fold the latest AI review's pricing sections in as extra grounding, if present."""
    result = await db.execute(
        select(AiReview).where(AiReview.lead_id == lead_id).order_by(AiReview.created_at.desc()).limit(1)
    )
    review = result.scalar_one_or_none()
    if not review:
        return ""
    return _build_pricing_context(review.sections_json)
```

`isinstance(v, int)` rather than a truthiness check is deliberate: `0` is falsy but is also an impossible price, and `_validate_money` already rejects it. The type check states the real requirement without conflating "absent" with "zero".

Note `isinstance(True, int)` is `True` in Python. A boolean here would mean the model emitted `true` where a price belongs — `_validate_money` would have dropped it, so this is not a reachable gap, but do not "fix" it by loosening the check.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "app/backend" && python -m pytest tests/test_quote_suggestion.py -q`
Expected: all pass, 4 new.

- [ ] **Step 5: Run the full suite**

Run: `cd "app/backend" && python -m pytest -q 2>&1 | tail -3`
Expected: 465 passed (461 + 4). If a pre-existing test fails, STOP and report — do not edit a test you did not write.

- [ ] **Step 6: Commit**

```bash
git add app/backend/app/services/quote_service.py app/backend/tests/test_quote_suggestion.py
git commit -m "feat(quoting): anchor suggest_quote to the review's validated range

The card and the builder could state different bands on one screen.
Falls back byte-identically when a review has no structured figures."
```

---

### Task 6: Documentation and close-out

**Files:**
- Modify: `CAPABILITIES.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Run both suites one final time**

Run: `cd "app/backend" && python -m pytest -q 2>&1 | tail -3`
Run: `cd "app/frontend" && npx tsc --noEmit && npm run build`

Record the actual backend number. Do not assert a count you have not seen.

- [ ] **Step 2: Update `CAPABILITIES.md`**

Add under the built-and-working section:

```markdown
### Lead window — Phase B (density and one-voice pricing)

- `Booking Date` renders once on Brief. The deleted row was the only path that
  wrote `job_date_requested` without `job_date_end`, so editing through it stranded a
  previously-set end date. Already-stranded values are not cleaned up — only new ones
  are prevented.
- `Est. Duration` is edited on the Quote tab and displayed read-only on Brief. Two
  controls previously wrote one field through two save paths, so a stale quote draft
  could silently revert a Brief edit.
- The intake screenshot is a 64px thumbnail row that opens full-size on tap, replacing
  a ~192px crop whose visible content duplicated the table beneath it.
- The walkaway floor renders beneath the quoted-price input, and turns to a warning
  stating the gap when the typed total is below it. **Non-blocking by design** — the
  failure being fixed is not knowing, not being allowed. Nothing renders when the
  review carries no validated floor.
- `suggest_quote` now anchors to the A-O review's validated `target_low`/`target_high`/
  `floor` when present, so the builder and the decision card cannot state different
  bands. With no structured figures the prompt is byte-identical to before, so legacy
  reviews behave exactly as they did.

**Not in Phase B:** comparables quality — four comparables spanning $200-$950, each
showing a single filled dot, under a badge reading "GROUNDED · 4 LOCAL JOBS". That is a
`find_comparables` scoring problem and has its own pass.
```

- [ ] **Step 3: Update `CHANGELOG.md`**

Add an entry at the top matching the file's existing format. Name the spec (`docs/superpowers/specs/2026-08-25-lead-window-phase-b-design.md`) and this plan.

- [ ] **Step 4: Commit**

```bash
git add CAPABILITIES.md CHANGELOG.md
git commit -m "docs(lead-window): record Phase B in capabilities and changelog"
```

- [ ] **Step 5: Hand back to Ron**

Phase B is not complete until it has been seen on a phone. Report:

1. Deploy (Railway auto-deploys on push to `main`).
2. **Brief tab:** `Booking Date` appears once; setting it still moves you to Quote; the end-date "Through" field still works; `Est. Duration` shows a value with "set on Quote" beside it; the screenshot is a small row that opens full-size on tap.
3. **Quote tab:** the floor caption sits under the price input. Type a number below it — the caption should turn red and state the gap, **and still let you book**.
4. **A lead whose review has no floor** shows no caption at all, not a dash or a zero.
5. Tap **Suggest with AI** on a lead with a validated range. Its number should land inside that range. **If it suggests outside the range, say so** — that means the anchor is being ignored and the prompt needs another pass.

---

## Phase B exit criteria

- [ ] Full backend suite passes with no regression from 461
- [ ] Frontend type-checks and builds
- [ ] `Booking Date` appears once on Brief and the range still works
- [ ] Duration edits on Quote and is reflected on Brief
- [ ] The floor caption appears, warns below the floor, and does not block booking
- [ ] A no-floor review renders no caption
- [ ] An AI suggestion lands inside the review's stated range

## Not in this plan

Comparables quality, the LEAD INFO table's remaining row count, a frontend test harness
(confirmed absent: `app/frontend/package.json` has only `dev`/`build`/`preview`), and the
Phase A deferred minors — the levers-dropped-with-no-range log path carrying no value,
`band_reason` drops logging a character count, the duplicate `import logging as _logging`
in `trigger_review`, and the dead `AiReviewSections` import at `QuotePanel.tsx:4`.
