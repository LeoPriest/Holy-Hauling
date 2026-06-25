# Quote Grounding Eval View (Feature B) — Design Spec

**Date:** 2026-06-24
**Status:** Approved direction, pre-implementation
**Author:** Ron + Claude

## Problem

The self-learning loop already measures whether AI quote *grounding* works: `GET /admin/eval/quote-grounding` joins the latest quote-suggestion log per lead to finalized outcomes and reports two cohorts — **grounded** (the quote anchored on comparable local jobs) vs **ungrounded** (SOP-only) — each with `n`, `win_rate`, `priced_n`, `pricing_accuracy`, `pricing_bias`. But it has **zero UI**: the endpoint is reachable only via curl/Swagger. So no one can see whether grounded quoting actually wins more or prices tighter.

This is feature **B** of the two-part quote-logic effort (A — per-quote basis — shipped). It surfaces the eval as a screen, **legible to a facilitator** (not just an analyst), and honest when the data is still too thin to conclude.

## Goals

1. Surface the grounding eval as a screen — two cohorts side by side, the metrics, and a plain-language read.
2. **Facilitator-comprehensible**: plain metric names + one-line explanations + the concrete counts (won/lost) behind each percentage — not raw jargon.
3. **Honest with sparse data**: a verdict/takeaway and per-metric "winner" marks appear *only* once each cohort clears a sample threshold; otherwise show the numbers + counts and say "too early."
4. Reachable by the people who quote: admins via an Admin card, facilitators via a link from the Quote panel.

Out of scope: per-lead drill-down (overlaps the per-quote basis view A already ships), changing how the eval is computed, configurable thresholds, time-series/trend charts.

## Decisions locked during brainstorming

- **Interpret only when earned** (option A) — verdict + winner marks gate on sample size; never a strong auto-claim on small n.
- **Plain-language + won/lost counts** (option B) — each metric explained in one line; the raw won/lost behind win rate shown.
- **Facilitator access** — endpoint opens to admin + facilitator; the rest of the admin area stays admin-only, so facilitators reach this screen via a **Quote-panel link**, not the Admin tab.
- **Relabeled metrics**: `pricing_accuracy` → "Pricing accuracy (avg error, lower is tighter)"; `pricing_bias` → "Over/under (closer to even is better)".

## Architecture

### Backend (small add)

- **`CohortMetrics` schema** (`schemas/eval.py`): add `won: int` and `lost: int`. The service already computes both (`eval_service._cohort_metrics`, lines 44-45) — pass them into the `CohortMetrics(...)` constructor. No new computation.
- **Endpoint access** (`routers/eval.py`): change `require_role("admin")` → `require_role("admin", "facilitator")` on `GET /admin/eval/quote-grounding`. (Still rejects crew/supervisor.)

That is the entire backend change. `win_rate`, `priced_n`, `pricing_accuracy`, `pricing_bias`, the join, and the city filter are unchanged.

### Frontend

- **`useQuoteGroundingEval(cityId)`** — TanStack Query hook → `GET /admin/eval/quote-grounding?city_id=`. Types `CohortMetrics` (incl. `won`/`lost`) + `QuoteGroundingEval` added to `services/api.ts`.
- **`AdminQuoteGroundingScreen`** (`screens/AdminQuoteGroundingScreen.tsx`) — uses the existing admin CitySwitcher for `city_id`. Renders:
  - An **intro** line (grounded vs SOP-only, plain English).
  - A **takeaway banner**: an actionable read ("Grounded quotes are landing more / pricing closer — keep leaning on the comparables", or the inverse) **only when both cohorts clear `MIN_COHORT_N`**; otherwise an amber "Too early to tell — keep quoting (need ~N finished in each group)".
  - **One card per metric** — **Win rate** (higher better; explanation: "of quotes that finished, how many became booked jobs"; shows `won X · lost Y` per cohort), **Pricing accuracy** (lower error better; "on won jobs, how far the quote was from realized revenue"; shows the job count = `priced_n`), **Over/under** (closer to 0 better; "do you quote too low or too high"; under/over label). Two cohorts side by side per card; a **winner ✓** on the better side **only when both sides clear the metric's threshold**.
  - A **footnote** defining the terms + how each metric is measured.
  - Loading / error / empty states.
- **AdminScreen card** (`screens/AdminScreen.tsx`): add a "Quote grounding" entry to `CARDS` (path `/admin/quote-grounding`, description "Is AI grounding winning more / pricing tighter?").
- **Route** (`App.tsx`): `/admin/quote-grounding` with `RoleGuard roles={['admin', 'facilitator']}` (note: broader than the other admin routes, which are admin-only — this is intentional).
- **Quote-panel entry point** (`screens/panels/QuotePanel.tsx`): a small "How grounded quoting is performing →" link near the `QuoteBasis` section, navigating to `/admin/quote-grounding`. This is how facilitators (who can't reach the Admin tab) get there.

### Thresholds (frontend constants)

- `MIN_COHORT_N = 10` — per cohort, on `n` (= won+lost). Gates the takeaway verdict and the **Win rate** winner mark.
- `MIN_PRICED_N = 5` — per cohort, on `priced_n` (won jobs with realized pricing, naturally smaller). Gates the **Pricing accuracy** and **Over/under** winner marks.

Below threshold: the value + counts still render; no winner ✓, no takeaway verdict. A null metric (`win_rate`/`pricing_accuracy`/`pricing_bias` = null) renders `—`.

## Data flow

```
Admin opens the "Quote grounding" card  ─┐
Facilitator taps the Quote-panel link   ─┴─> /admin/quote-grounding (RoleGuard admin|facilitator)
  AdminQuoteGroundingScreen -> useQuoteGroundingEval(cityId) -> GET /admin/eval/quote-grounding?city_id=
    -> { grounded, ungrounded } each { n, won, lost, win_rate, priced_n, pricing_accuracy, pricing_bias }
    -> takeaway (if both n >= MIN_COHORT_N) + per-metric cards with winner marks (per-metric threshold)
```

## Error / empty states

- **Both cohorts empty** (`n = 0/0`, no finished quotes) → "No finished quotes yet — this fills in as jobs are won/lost."
- **Below threshold** (the common early case) → numbers + counts shown; amber "too early" takeaway; no winner marks.
- **One cohort empty** → its cells show `—`/`0`; no winner mark for any metric (the other side can't "win" uncontested).
- **Null metric** (e.g., `win_rate` null when n=0, `pricing_accuracy` null when priced_n=0) → `—`.
- **Request error** → inline "Couldn't load the grounding stats."
- **Crew/supervisor** somehow hitting the route → blocked by `RoleGuard`; the endpoint also 403s.

## Testing

### Backend (pytest)

- `CohortMetrics` exposes `won` + `lost`; `compute_quote_grounding_eval` returns them populated (seed grounded + ungrounded suggestion logs joined to won/lost outcomes; assert the counts and that `win_rate == won/(won+lost)`).
- Endpoint access: `GET /admin/eval/quote-grounding` returns 200 for admin **and** facilitator; 403 for crew and supervisor.

### Frontend

- `tsc && vite build` green with the hook, screen, card, route, and Quote-panel link.
- (Structural) the takeaway + winner marks appear only when the relevant threshold is met (above `MIN_COHORT_N` / `MIN_PRICED_N`) and are absent below it; null metrics render `—`; the city filter passes `city_id`; the AdminScreen card and the Quote-panel link both navigate to the screen. No JS test runner — verification is type-check + build + the backend contract tests; visual confirmation manual.

## Out of scope

- **Per-lead/per-quote drill-down** — A's per-quote basis view already shows an individual quote's grounding.
- **Configurable thresholds** — `MIN_COHORT_N` / `MIN_PRICED_N` are named constants, not settings.
- **Trend / time-series** — point-in-time cohorts only.
- **Changing the eval computation** — pure read/surface of the existing service.
- **Opening the whole Admin area to facilitators** — only this one route is widened; facilitators reach it via the Quote-panel link.
