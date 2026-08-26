# Lead Window — Phase B Design Spec

**Date:** 2026-08-25
**Status:** Approved direction, pre-implementation
**Author:** Ron + Claude
**Follows:** `docs/superpowers/specs/2026-08-25-lead-decision-card-design.md` (Phase A, shipped and live)

## Problem

Phase A fixed half of Ron's original complaint. He said the lead workflow felt cluttered —
*"too much to look at, and too many steps."* The decision card fixed **too many steps**: the target
range, the floor, and the price lever now reach him at the top of the lead window, on any tab,
without scrolling. He confirmed the levers work on real leads.

**Too much to look at is unfixed.** Brief is still a **14-row** label/value table on a phone,
carrying a duplicated field, a field that also lives on the other tab, and a cropped image that
spends ~192px repeating what the table below it already says. And Phase A introduced a new risk:
the card renders on every tab, so its structured `$525–$650` headline now sits *inches* from
`suggest_quote`'s independently-derived number instead of a tab away.

Five defects, each verified in the code rather than inferred from screenshots:

**1. `Booking Date` renders twice.** `BriefPanel.tsx:630` and `BriefPanel.tsx:673` are both
`<FieldRow label="Booking Date">`, both bound to `lead.job_date_requested`. The first is a bare
date field; the second adds the end-date range and a Clear control. Two rows, same label, same
value, different affordances — and editing either writes the same field.

**2. `Est. Duration` exists on both tabs.** `BriefPanel.tsx:649` renders a `DurationWheelInput`
bound to `lead.estimated_job_duration_minutes` and saves immediately via `saveEstimatedDuration`.
`QuoteBuilder.tsx` seeds `estimatedDurationMinutes` from the same lead field and renders its own
control, saved as part of the quote draft. **The same value, two homes, two save paths.**

**3. The screenshot preview costs 192px to show a duplicate.** `BriefPanel.tsx:518-525` is
`object-cover max-h-48` inside `overflow-hidden`. It crops a tall Thumbtack screenshot to its top
~192px, which on the observed lead showed "Saint Louis, MO 63117" and "Date: Jun 27" — both
repeated in the LEAD INFO table directly beneath. It already opens full-size on tap.

> **Correction to Phase A's spec.** That document listed this item as "a scroll region inside a
> scroll region — on touch, swiping to scroll the page scrolls the image." That was wrong; it was
> read off a screenshot rather than the code. `object-cover` inside `overflow-hidden` crops, it does
> not scroll, and the apparent inner scrollbar was the page's. The defect is real but it is a
> space-for-duplication trade, not a touch trap.

**4. The floor is not visible while typing the price.** The card carries the floor at the top of
the scroll region; the quoted-price input sits in `QuoteBuilder`. Scroll to the input and the floor
is off-screen. This is the direct mechanism behind the incident Phase A cites: Ashley was quoted
**$510** against a stated floor of **$475** and a target starting at **$525**.

**5. Two AI voices can now disagree on one screen.** `quote_service.py:110` — `_latest_pricing_context`
reads exactly `["f_pricing_band", "g_band_position", "l_pricing_guidance"]`, all prose. So
`suggest_quote` re-derives a number from paragraphs while the card renders the model's own
structured figures. On the observed lead these disagreed: internal guidance said the combined range
was `$525–$725`; the builder rationale said *"at $550 we sit at the lower end of the small moving
band ($350–$550)."* Different bands, one screen apart — and after Phase A, adjacent.

## Goals

1. Every field on the lead window has exactly one home and one save path.
2. Nothing on screen repeats what is already on screen.
3. The floor is visible at the moment the price is typed.
4. The AI states one number, not two.

## Non-goals

- **Restructuring the lead window into one scrolling screen** (approach C from the original
  brainstorm). Still held. Phase B is deletions and reconciliation, not a rewrite.
- **Comparables quality.** Four comparables spanning $200–$950, every one showing a single filled
  dot, under a badge reading "GROUNDED · 4 LOCAL JOBS". Real, separate, and its own pass — see
  Known Issues.
- **Reducing the 14-row LEAD INFO table to a different layout.** Items 1–3 remove rows and space
  from it; redesigning it is a further step, and it should be judged after Ron has used the
  slimmer version.
- **A frontend test harness.** Confirmed twice: `app/frontend/package.json` has only
  `dev`/`build`/`preview`, no test dependencies, no config anywhere. Standing one up is a separate
  project and must not be bolted onto a feature spec.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | **Keep the range row, delete the bare one** (`:630`) | The range row is a superset: same field plus end date plus Clear. Deleting the simpler one loses nothing. |
| 2 | **Duration lives on Quote, not Brief** | It feeds the quote and the Google Calendar event length. Phase A already put the decision on Quote's side; Brief keeps a read-only display so a facilitator scanning the brief still sees it. |
| 3 | **Screenshot becomes a fixed-height thumbnail row** | It stays reachable — the source of truth for what the customer actually wrote — but stops paying full width for a cropped fragment. |
| 4 | **Floor renders beside the price input**, not just on the card | The card is the decision surface; the input is the commitment surface. The floor belongs on both. |
| 5 | **`suggest_quote` consumes the structured fields when present**, falling back to prose | One number. Fallback preserves behaviour for legacy reviews that carry no structured fields. |

## Architecture

### 1. Delete the duplicate Booking Date row

Remove the `FieldRow` at `BriefPanel.tsx:630-635`. Keep the one at `:673`, which already handles
`job_date_requested`, `job_date_end`, and Clear via `saveJobDateRange`.

`onBookingDateSet?.()` fires from both today. It must still fire from the surviving row — it is
what switches the user to the Quote tab after a date is set.

### 2. One home for Est. Duration

`Lead.estimated_job_duration_minutes` keeps its single backing field. The editable control lives in
`QuoteBuilder` only. `BriefPanel.tsx:649-660` becomes a **read-only** row.

The read-only rendering already exists inside that row: `BriefPanel.tsx:658` renders
`Current: {fmtDurationMinutes(lead.estimated_job_duration_minutes)}`, and the helper is imported at
`:11`. So the change is to **keep that line as the row's value and remove the `DurationWheelInput`
and Clear control around it** — not to write a new display. Drop the `Current:` prefix, since it
will no longer be distinguishing a saved value from a control's state.

`saveEstimatedDuration` (`BriefPanel.tsx:439-445`) and the `DurationWheelInput` import become
unused in that file and are removed with it.

**The risk this closes:** two controls writing one field through two save paths — Brief patches
immediately, Quote saves with the draft. A value edited on Brief and then a stale draft saved from
Quote silently reverts it.

### 3. Screenshot thumbnail

Replace the full-width `object-cover max-h-48` block at `BriefPanel.tsx:512-528` with a row: a
small fixed square thumbnail (`h-16 w-16`, `object-cover`, rounded) beside a label reading
**"Intake screenshot"** and a secondary line **"Tap to open"**. The whole row stays the existing
`<a target="_blank">` — behaviour unchanged, footprint reduced from ~192px to ~64px.

The row is a tap target: minimum 44px, satisfied by the 64px thumbnail.

### 4. Floor beside the price input

`QuoteBuilder`'s quoted-price field gains a caption directly beneath it, rendered **only when the
latest review carries a validated floor**: `Floor $475 — do not go below`.

When the typed total is **below the floor**, the caption becomes a warning treatment and states the
gap. **It does not block submission.** Ron may have a real reason to go under; the failure this
fixes is *not knowing*, not *being allowed*. A blocker would train him to work around it.

When no floor is available (legacy review, or the figures failed validation), **nothing renders** —
no placeholder, no zero, no em-dash in a money slot. Phase A's rule holds: the card and the input
never invent a number they do not have.

`QuoteBuilderFields` is currently `({ draft }: { draft: QuoteDraft })` at `QuoteBuilder.tsx:135`.
It gains one optional prop — `floor?: number | null` — passed from `QuotePanel`, which already
receives `aiReview` in its props and can read `aiReview.sections.floor`. The quoted-price input is
at `:144-150`; the caption goes directly beneath it.

`QuoteBuilderFields` already computes `quotedTotalValue = parseMoney(draft.quotedPriceTotal)` at
`:136`, so the below-floor comparison reuses that value rather than re-parsing. Note it can be
`null` while the field is empty or mid-edit — the warning must render only when it is a real
number, never on an empty field.

### 5. One AI voice

`quote_service._latest_pricing_context` (`:98-115`) currently returns a prose block built from
three section keys. It gains the structured figures when the review carries them:

- When `target_low`, `target_high`, and `floor` are all present, the returned context leads with an
  explicit line — `The A–O review already set: target $525–$650, floor $475. Anchor your
  suggestion to this range; do not derive a different band.` — followed by the existing prose.
- When they are absent, the context is **byte-identical to today's**. Legacy reviews and
  validation-failed reviews behave exactly as they do now.

This is the same cold-start discipline `comparables_service` already follows: the prompt is
unchanged when the enrichment is unavailable.

**Why anchor rather than replace:** `suggest_quote` also weighs comparables and scope, which the
A–O review does not see. It should still produce a *specific* number inside the band; it must not
produce a *different band*.

## Testing

Backend baseline is **461 collected tests** (2026-08-25, verified on merged `main`).

**`_latest_pricing_context`**
- A review with all three figures produces a context containing the explicit anchor line
- A review with none produces a context **byte-identical** to the pre-change output (guard against
  silent prompt drift — `prompt_version` cohorting depends on it)
- A review with a partial set (impossible through `_validate_money`, but defend the boundary)
  falls back to the prose-only path rather than emitting a half-stated anchor

**`suggest_quote`**
- Runs unchanged end-to-end when the review has no structured fields

**Frontend** — no harness exists; verification is `tsc --noEmit`, `npm run build`, and Ron's
device pass. The checks he walks:
- `Booking Date` appears exactly once on Brief, and setting it still moves him to Quote
- `Est. Duration` is editable on Quote, read-only on Brief, and a value set in one is reflected in
  the other after save
- The screenshot row opens the full image
- The floor caption appears under the price input, and turns to a warning when he types below it —
  and still lets him submit
- A lead whose review has no floor shows **no** caption at all

## Risks

| Risk | Mitigation |
|---|---|
| Deleting the wrong Booking Date row loses the end-date range | The surviving row is the superset; the test is that end date and Clear still work |
| Making Brief's duration read-only removes a path someone used | It is one tap further, not gone; the value is still visible on Brief |
| The anchor line makes `suggest_quote` parrot the range instead of choosing within it | Wording says *anchor to*, not *use*; the model still weighs comparables and scope |
| A floor warning that blocks would train workarounds | Explicitly non-blocking by design |
| Prompt change silently re-cohorts the grounding eval | `_latest_pricing_context` feeds `suggest_quote`, not the A–O `prompt_version`; the byte-identical test guards the no-structured-fields path |

## Known issues, explicitly not fixed here

**Comparables quality.** Unchanged from Phase A and still unaddressed: four comparables spanning
**$200 to $950**, every one displaying a single filled dot (weakest match), under a badge asserting
**"GROUNDED · 4 LOCAL JOBS"**. The badge claims a confidence the dots contradict. This is a
`find_comparables` scoring and thresholding problem. It deserves its own spec, and folding it into
a density pass would hide it.

**Deferred minors from Phase A**, none blocking: the levers-dropped-with-no-range log path records
no offending value; `band_reason` drops log a character count rather than the value; a duplicate
`import logging as _logging` inside `trigger_review`; a dead `AiReviewSections` import at
`QuotePanel.tsx:4`.

## Related

- `docs/superpowers/specs/2026-08-25-lead-decision-card-design.md` — Phase A
- `docs/superpowers/plans/2026-08-25-lead-decision-card-phase-a.md`
- `07_System/agent-feedback.md` Rule 013 — this surface is phone-first
