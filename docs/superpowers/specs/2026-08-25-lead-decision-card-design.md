# Lead Decision Card — Design Spec

**Date:** 2026-08-25
**Status:** Approved direction, pre-implementation
**Author:** Ron + Claude
**Mockup:** https://claude.ai/code/artifact/d3dba9a9-3a43-4728-a3b5-5a5dfa9d0226

## Problem

Working one lead takes roughly **eighteen phone-screens of scrolling** — nine on Brief, nine on
Quote. The facilitator is now Ron, working leads from a truck between Patriot Claims inspections,
reacting to each lead as it arrives. The screen has to take him from cold to dialing in the length
of a gap between jobs. Today it does not.

Three specific failures, all observed on a real lead (Ashley Emerson, 2026-06-25):

**1. The number is prose.** Section L contains `Target combined quote: $525–$650` and
`Minimum acceptable combined job: $475`. Both figures are real, both are needed, and both are
embedded in six lines of paragraph — in the twelfth of fifteen identically-styled cards, on the tab
he is not on. Reading is not glancing.

**2. Nothing helps him decide inside the range.** A range gives the edges, not the answer. Section L
already resolves it — *"price at $300–$375 depending on couch — if it's a standard sofa, low end; if
sectional or sleeper, push to $375+"* — but that conditional is buried in the same paragraph. The
thing he must confirm and the thing that sets the price are **the same fact**, and the UI presents
neither.

**3. The layout is a tablet layout on a phone.** `LEAD INFO` is an eleven-row label/value table. The
phone row packs six controls plus an input and Save button into one cell. This surface is now
phone-first per Rule 013 (amended 2026-08-25).

Speed-to-response is the stated driver of close rate on this channel. A screen that takes eighteen
scrolls to yield a number is a revenue defect, not a cosmetic one.

## Goals

1. Opening a lead cold shows, without scrolling or switching tabs: what kind of job this is, the
   target range, the walkaway floor, and what moves the price inside that range.
2. The unknown that decides the price is shown **with its price consequences**, so the quote can be
   said the moment the customer answers.
3. Guidance for defending the floor is visible at the moment of pushback.
4. Nothing is deleted — the full A–O analysis stays, one tap away.
5. The card never invents a number it does not have.

## Non-goals

- **New pricing intelligence.** Every figure on the card is already reasoned by the existing A–O
  review. The change is that it is also *emitted as data* rather than only as prose.
- **Re-running or re-scoring old reviews automatically.** Legacy reviews get an explicit re-run
  action, not a silent backfill.
- **Comparables quality.** See Known Issues.
- **Restructuring the lead window into one scrolling screen** (approach C in brainstorming). Held
  until B has been lived with.

## Decisions locked during brainstorming

| Decision | Choice | Rationale |
|---|---|---|
| Card placement | Top of the scroll region, rendered on **all** tabs | First thing seen on open; scrolls away once the decision is made. Avoids the tab switch entirely. |
| Range vs single number | **Range**, with the lever resolving it | Section J already recommends quoting ranges to avoid sticker shock. |
| Confirm items | Rendered as **price levers**, not a checklist | Ron: *"what's helping me decide inside of the range?"* A checklist says "ask about the couch"; a lever says "sofa $525, sectional $650". |
| Floor treatment | Shown always, and repeated in the pushback block | It is the one number that costs money when forgotten. |
| Secondary action | **Text** beside Call | Kept; Ron did not object. Revisit if it proves dead weight. |
| Legacy reviews | Explicit "Re-run AI review" action | Parsing figures out of old prose risks misreading the floor as the target. A silent wrong floor is the worst failure mode here. |
| Phasing | **Spec B, ship A first** | Ron's explicit instruction. |

## Architecture

### Data model — no migration

`AiReviewSections` (`app/backend/app/schemas/ai_review.py`) gains **optional** structured fields
alongside the existing fifteen required prose sections. `sections_json` is a `Text` column
holding serialized JSON validated on read, so **adding optional fields requires no schema
migration and no table change.** Legacy records simply validate with the new fields absent.

| Field | Type | Source section |
|---|---|---|
| `sayability` | `Literal["ready","confirm_first","hold"] \| None` | I |
| `target_low` | `int \| None` (whole dollars) | L |
| `target_high` | `int \| None` | L |
| `floor` | `int \| None` | L |
| `band_position` | `Literal["low","mid","high"] \| None` | G |
| `band_reason` | `str \| None` — one short clause | G |
| `range_levers` | `list[RangeLever] \| None` | L (conditional) + H (the unknown) |
| `floor_defense` | `str \| None` — one sentence | L |

```python
class RangeLever(BaseModel):
    factor: str          # "Couch type"
    low_answer: str      # "Standard sofa"
    low_price: int       # 525
    high_answer: str     # "Sectional / sleeper"
    high_price: int      # 650
```

**Exactly two options, by design.** A lever is a binary the operator resolves in one question on a
call. Three or more branches do not fit a phone card side by side and stop being glanceable — that
is what the full analysis is for. The prompt asks for the two ends of the swing; a model offering
more must be collapsed to its cheapest and dearest, not rendered as a list.

**At most two levers are rendered.** More than two and the card is a form again. If the model emits
more, render the two with the widest price swing — those are the ones that move the number most —
and leave the rest to the full analysis.

**Money is whole dollars as `int`.** Not float — the repo already learned this (`parse_cents` uses
Decimal half-up for exactly this reason). Cents are unnecessary at quote granularity; a float here
would eventually print `$524.9999`.

### Validation — the money rules

The AI is a text generator and these are money figures. Emitting them as structured data does not
make them trustworthy. Validation runs at parse time in `ai_review_service`:

- `floor <= target_low <= target_high` — if violated, **all four money fields are dropped to
  `None`** and the card renders the legacy state. It does not render a partial set.
- Every lever price must fall within `[floor, target_high]`. A lever outside the range means the
  model contradicted itself; drop `range_levers` only, keep the range.
- Any money field ≤ 0 or > 100000 is treated as a parse failure.
- Dropping a field is **logged** with the lead id and the offending value.

This follows the house rule that silence is the wrong failure mode for money: the card refuses to
show a figure rather than show a wrong one, and the operator sees the legacy state, which tells him
what to do about it.

### Prompt changes

`ai_review_service` gains instructions to emit the structured block **in addition to** the fifteen
prose sections, explicitly derived from what it already wrote in G, H, I, and L. The prose sections
are unchanged in content and ordering.

`prompt_version` is a SHA-256 of the grounding content plus prompt template, so it **bumps
automatically**. That matters: the grounding-eval harness cohorts by `prompt_version`, so
pre-card and post-card reviews will not be silently pooled.

`range_levers` is explicitly optional in the prompt. Many jobs have no single dominant unknown, and
a model pressured to invent one would produce a fake lever — worse than none. Ashley's review is
the only sample examined; whether clean conditionals are typical is unverified.

### The card — states

Rendered by a new `LeadDecisionCard` component. Six states, all required in the same pass:

| State | Condition | Renders |
|---|---|---|
| **Confirm first** | `sayability == "confirm_first"` and levers present | Badge, range, floor, band line, lever block, pushback block, Call + Text |
| **Ready to quote** | `sayability == "ready"` | Badge, range, floor, band line, `band_reason`, Call + Text |
| **Hold** | `sayability == "hold"` | Badge, `band_reason` as the reason to hold, Call + Text. **The range is deliberately suppressed** — `hold` means the model judged the scope too unresolved to price, so showing a range invites quoting one. |
| **No quotable number** | Review exists, money fields absent or dropped | Explanation + "Re-run AI review" |
| **No review** | No review at all | "Run AI review" |
| **AI unavailable** | Review endpoint 503 (grounding file unreadable) | Plain statement of the fault, no empty shell |

`hold` is included because the enum must match what the model can actually say. If live output never
produces it, it costs one unused branch; if it does and we omitted it, the card breaks.

### Layout — phone-first

Per Rule 013, this surface is phone-first. Single column, 44px minimum on every control, no hover
dependence, Call as the widest target. The two lever options sit side by side — the only horizontal
split on the card, and it holds at 320px because each cell contains two short lines.

### Placement

Currently `EscalationCard` and `RefundBanner` render as siblings **outside** `<main
className="flex-1 overflow-y-auto">` in `LeadCommandCenter.tsx:330-331`. That is why the refund
banner appears in every screenshot: it is not sticky CSS, it permanently occupies height above the
scroll region.

Change: `LeadDecisionCard` renders as the **first child inside `<main>`**, above the tab
conditionals, so it appears on every tab, is the first thing seen on open, and scrolls away once
read. `RefundBanner` moves inside `<main>` too, below the card, so it stops consuming permanent
vertical space on a phone. `EscalationCard` stays pinned outside — an open escalation is a genuine
interrupt and should not scroll away.

## Phasing

**Phase A — ship first.**
Structured fields, prompt change, validation, `LeadDecisionCard` with all six states, collapse A–O
into one closed-by-default "Full analysis" accordion, move `RefundBanner` inside the scroll region.
Nothing else moves. This is independently useful and touches no existing pricing logic.

**Phase B — the repairs.**
1. Remove the duplicate `Booking Date` row (Brief renders it twice — once plain, once with
   Clear + "Through / End date").
2. Collapse `Est. Duration` to one home; it currently exists on both Brief and Quote.
3. Screenshot preview becomes a thumbnail that opens full-screen. Today it is a large in-page
   scroll region inside a scroll region — on touch, swiping to scroll the page scrolls the image.
4. Target and floor rendered beside the price input, so they are visible while typing.
5. Reconcile the two AI voices. On the same tab today: internal guidance says the combined range is
   `$525–$725`, while the builder rationale says *"at $550 we sit at the lower end of the small
   moving band ($350–$550)"*. Different bands, one screen apart. `suggest_quote` and the A–O review
   must agree or explicitly explain why they differ.

## Testing

Backend baseline is **444 collected tests** (`python -m pytest --collect-only -q`, 2026-08-25).

**Schema and validation**
- Legacy `sections_json` with no structured fields validates; all new fields `None`
- Legacy A–H record still remaps via `_LEGACY_KEY_MAP` and yields `None` for new fields
- `floor > target_low` drops all four money fields to `None`, logs once
- Lever price outside `[floor, target_high]` drops `range_levers`, keeps the range
- Money field ≤ 0 or > 100000 drops the field
- Well-formed structured block survives round-trip through `sections_json`

**Service**
- `prompt_version` changes when the prompt template changes (guards eval cohorting)
- A review with no `range_levers` is valid and yields the ready state

**Frontend**
- Each of the six card states renders its distinct content
- Card renders on all three tabs
- Re-run action shows in-progress, success, and a recoverable failure — all three in this pass
- 44px minimum on Call, Text, Re-run, and the accordion header

## Known issues, explicitly not fixed here

**Comparables quality.** The Ashley lead shows four comparables spanning **$200 to $950**, every one
displaying a single filled dot (weakest match), under a badge reading **"GROUNDED · 4 LOCAL JOBS"**.
The badge asserts confidence the dots contradict. This is a `find_comparables` scoring and
thresholding problem, not a layout one, and it deserves its own pass — surfacing it inside a
density change would hide it.

**The $510 quote.** Ashley was quoted `$510` against a stated target floor of `$475` and a target
range starting at `$525` — below the AI's own target. Whether that was a deliberate override or the
operator losing the number between tabs is unknowable from the record. It is the motivating example
for putting the floor next to the price input (Phase B item 4).

## Related

- `07_System/agent-feedback.md` Rule 013 — amended 2026-08-25; this surface is phone-first
- `docs/superpowers/specs/2026-06-24-quote-basis-design.md` — the comparables panel this sits above
- `docs/superpowers/specs/2026-06-18-quote-grounding-eval-design.md` — cohorts by `prompt_version`
