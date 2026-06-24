# Quote Basis — "What This Quote Is Based On" — Design Spec

**Date:** 2026-06-24
**Status:** Approved direction, pre-implementation
**Author:** Ron + Claude

## Problem

The AI quote engine already computes the **logic behind each quote** — it retrieves the top-5 most similar past jobs (comparables) with their prices, won/lost outcomes, and similarity scores, and anchors the price on them plus an SOP-grounded rationale. But almost none of that reaches the operator:

- The `comparables` list **is returned in the `/quote-suggestion` API response and silently dropped** by the frontend (the TS type omits the field).
- The `rationale` is shown once at draft time but **never persisted**.
- The `quote_suggestion_log` records `was_grounded` and `comparables_count` but **not the comparables themselves**, and no endpoint reads it back.

So the operator can't see *what a quote was based on* — not even right after drafting (comparables), and definitely not later (nothing persisted). This is feature **A** of a two-part "quote logic" effort; **B** (the aggregate grounding eval admin view) is a separate later spec.

**Framing guardrail:** the honest "logic" is the **comparables + grounded signal** (real past jobs the model anchored on). The `rationale` is the model's *post-hoc explanation* — useful, shown as such, but never presented as a deterministic formula.

## Goals

1. Persist each draft's **basis** (comparables + rationale) so it survives reload, not just at draft time.
2. Show, in the Quote panel, **"what this quote is based on"**: the comparable jobs (price · won/lost · why-similar · tap-to-open) + a grounded/cold-start badge + the rationale.
3. Be **honest about cold-start** — when there are no comparables, say "priced from SOP only," never a fake grounded badge.

Out of scope: the aggregate grounding eval (win-rate / pricing-accuracy across jobs) — that's feature **B**. Full per-lead draft *history* — we persist every draft but surface only the **latest** snapshot.

## Decisions locked during brainstorming

- **Persist (A2), not ephemeral** — store the snapshot so the basis is revisitable after reload.
- **Latest snapshot only** in the UI — "what is *this* quote based on" wants one answer; older rows still accrue in the table for B.
- **Persist comparables AND rationale** — together they form the complete basis.
- **Match strength as dots, not the raw score** — the internal score is meaningless out of context.
- **Comparable rows are tappable** to open that lead.
- **Internal-only**, matching the existing "AI Pricing Guidance — Internal Only" visibility.

## Architecture

### Data model — extend `quote_suggestion_log`

Two new columns on the existing table (it already stores `lead_id`, `city_id`, `was_grounded`, `comparables_count`, `suggested_price_cents`, `model_used`, `created_at`):

| Column | Type | Notes |
|---|---|---|
| `comparables_json` | Text (nullable) | JSON-serialized list of the `ComparableOut` the draft anchored on. |
| `rationale` | Text (nullable) | The AI's rationale for the draft. |

A startup migration in `main.py` adds both (`_existing_columns` guard). No new table.

### Write path — `_log_suggestion`

`quote_service._log_suggestion` already writes a log row best-effort on every `suggest_quote` (never breaking quoting). Extend it to also serialize and store `comparables_json` (from the same `comparables` list it already counts) and `rationale`. Best-effort semantics unchanged — a logging failure must never affect the returned quote.

### Read path — latest snapshot endpoint

`GET /leads/{lead_id}/quote-suggestion/latest` → returns the most recent `quote_suggestion_log` row for the lead, deserialized:

```jsonc
{
  "suggested_price_cents": 124000,
  "was_grounded": true,
  "comparables_count": 5,
  "rationale": "Priced near the top of the won band …",
  "comparables": [ { lead_id, conversion, price_cents, price_basis, score,
                     move_size_label, move_distance_miles, move_type }, … ],
  "created_at": "…"
}
```

Returns `204`/`null` (no body) when the lead has never been drafted. Schema `QuoteSuggestionSnapshotOut` in `schemas/quote_suggestion.py`, reusing the existing `ComparableOut`. The endpoint is auth-gated like the other lead sub-routes (internal use).

### Frontend — `QuoteBasis` in the Quote panel

A `QuoteBasis` component rendered in `screens/panels/QuotePanel.tsx`, **live-first with background reconcile** — two fillers, the live draft taking precedence:

- **Right after a fresh draft (live-first):** the `/quote-suggestion` response already carries `comparables` + `rationale`. The panel holds it in local state and `QuoteBasis` renders it **instantly** — no wait for a refetch. On the same success, invalidate the `['quote-basis', leadId]` query so the persisted snapshot refetches in the background and **reconciles** to the same data (the just-written log row).
- **On panel load / reload (no live draft this session):** `useQuoteBasis(leadId)` fetches the latest persisted snapshot and renders that.

`QuoteBasis` takes a single `basis` prop of one shape (`{ comparables, rationale, was_grounded, comparables_count, suggested_price_cents? }`); the panel passes the **live response if present this session, else the fetched snapshot**. Both fillers produce the identical shape, so there is one rendering path — the live one is just shown first and the persisted fetch confirms it.

The frontend `QuoteSuggestion` TS type (`services/api.ts`) gains the missing `comparables` field (it's already in the payload), so the live response is fully typed.

Renders (per the mockup):
- **Grounding badge** — "◎ Grounded · N local jobs" when `comparables_count > 0`, else "Cold start" with a "priced from SOP & AI pricing guidance only" note.
- **Comparable rows** — price + `price_basis` tag (Realized/Quoted), a Won/Lost badge from `conversion`, a "why similar" line (`move_size_label` · `move_distance_miles` · `move_type`), a dot-based match-strength derived from `score`, and the row taps through to `/leads/{comparable.lead_id}`.
- **Rationale** — the persisted `rationale` in the existing violet "AI-drafted" treatment.

This sits alongside (not replacing) the current rationale box and the AI Pricing Guidance F–L cards already in the panel.

## Data flow

```
Operator drafts a quote -> POST /leads/{id}/quote-suggestion
   suggest_quote returns {price, line_items, duration, rationale, comparables}
   _log_suggestion writes the row (+ comparables_json + rationale)  [best-effort]
   frontend: hold the live response in panel state -> QuoteBasis renders it INSTANTLY
             + invalidate ['quote-basis', id] -> snapshot refetches in background -> reconciles
Reopen the lead later (no live draft) -> useQuoteBasis(id) -> GET /leads/{id}/quote-suggestion/latest
   -> QuoteBasis renders the persisted snapshot (same shape, same basis)
```

## Error / empty states

- **Never drafted** → endpoint returns no snapshot; `QuoteBasis` shows a quiet "Run *Suggest with AI* to see what a quote would be based on" (or hides) — no error.
- **Cold start** (drafted, zero comparables) → "Cold start" badge + SOP-only note + the rationale; no comparable rows.
- **Malformed/legacy `comparables_json`** (older rows pre-migration) → treat as empty comparables; still show the rationale/price if present. Never 500 on a bad blob.
- **Logging failure during draft** → quote still returns (best-effort logging unchanged); the basis just won't reflect that draft until the next successful one.
- **A comparable's lead later deleted** → the row still renders from the frozen snapshot; tapping a now-missing lead degrades gracefully (lead screen's own 404 handling).

## Testing

### Backend (pytest)

- Migration adds both columns idempotently.
- `_log_suggestion` persists `comparables_json` (round-trips to the same `ComparableOut` shape) and `rationale`; a serialization error doesn't break `suggest_quote` (best-effort).
- `GET /leads/{id}/quote-suggestion/latest` returns the **most recent** row's deserialized comparables + rationale + `was_grounded` + price; returns empty/204 when none; returns the latest when multiple drafts exist.
- A malformed `comparables_json` row yields empty comparables, not a 500.

### Frontend

- `tsc && vite build` green with the `comparables` type addition, `useQuoteBasis`, and `QuoteBasis`.
- (Structural) grounded state renders the rows + "Grounded · N" badge; cold-start renders the honest empty + SOP note; never-drafted hides/prompts; a comparable row links to its lead; the badge reflects `was_grounded`. No JS test runner — verification is type-check + build + backend contract tests; visual confirmation manual.

## Out of scope

- **Feature B** — the admin aggregate grounding eval view (`/admin/eval/quote-grounding` UI). Separate spec, next.
- **Full draft history** in the UI — latest snapshot only (history accrues in the table for B).
- **Editing/overriding comparables** — read-only provenance.
- **Surfacing the raw similarity score number** — shown as dot strength only.
- **Backfilling basis for pre-existing log rows** — only new drafts persist comparables/rationale; old rows render as cold-start/rationale-less gracefully.
