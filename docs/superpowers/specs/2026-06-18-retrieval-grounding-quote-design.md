# Retrieval Grounding for the Quote — Design Spec

**Date:** 2026-06-18
**Status:** Approved, pre-implementation
**Author:** Ron + Claude

## Context

This is **item 2 of the 4-part self-learning roadmap**. Item 1 (the `lead_outcome` layer, shipped 2026-06-17) built a stable, queryable record of what actually happened per lead — `conversion` (won/lost), `realized_revenue_cents` vs `quoted_price_cents`, a frozen `scope_snapshot`, and `finalized`. Nothing consumes it yet.

Item 2 closes the first feedback loop: before the AI drafts a quote, retrieve the most similar past *local* outcomes and inject them so the model anchors on what comparable jobs **actually sold for**, instead of guessing within static SOP bands.

Target: `quote_service.suggest_quote` (`POST /leads/{id}/quote-suggestion`). Review and escalation grounding are deliberately deferred — the retrieval service is reusable by them later.

## Goal

A structured (non-embedding) similarity retriever over `lead_outcome` rows that returns the top-N most similar same-city finalized outcomes (won and lost), which `suggest_quote` formats into a "comparable local jobs" prompt block and surfaces in its response. Degrades to today's exact behavior when no comparables exist.

## Architecture

### Component boundaries

- `app/backend/app/services/comparables_service.py` — `find_comparables(db, lead, limit)`; the scoring function and pool query. One responsibility: given a lead, return the most similar past local outcomes.
- `app/backend/app/schemas/quote_suggestion.py` (modify) — add `ComparableOut` and a `comparables` field on `QuoteSuggestionOut`.
- `app/backend/app/services/quote_service.py` (modify) — call `find_comparables`, format the prompt block, inject it, and return the comparables in the response.

No embeddings, no new dependencies, no vector store.

### The retriever — `find_comparables(db, lead, limit=5) -> list[ComparableOut]`

**Pool query** — read `lead_outcome` rows (self-contained; no joins) with hard filters:
- `city_id == lead.city_id` (pricing is local)
- `finalized == true`
- `conversion in ("won", "lost")`
- a usable price exists: `realized_revenue_cents is not null OR quoted_price_cents is not null`
- `lead_id != lead.id` (self-exclusion)
- **service_type match**: the comparable's `scope_snapshot.service_type` equals the lead's `service_type` (hard filter — no cross-service comparables)

**Scoring** — for each pooled row, parse `scope_snapshot` (JSON) and score proximity to the current lead's scope (higher = more similar):

| Signal | Condition | Score |
|---|---|---|
| `move_size_label` | exact match | +3 |
| `move_distance_miles` | abs diff ≤ 5 | +2 |
| `move_distance_miles` | abs diff ≤ 20 (and > 5) | +1 |
| `move_type` | exact match | +1 |
| stairs | `abs((load+unload)_lead − (load+unload)_comp) ≤ 1` | +1 |

Missing fields on either side simply score 0 for that signal (no crash). Hauling leads (null `move_*`) therefore score mostly 0 and fall back to the recency tiebreak — they still return same-city, same-service comparables, just ranked by recency until hauling-specific scope exists.

**Rank** by score descending, tiebreak `completed_at` descending (recent prices win; nulls last). Return the top `limit` (default 5) as `ComparableOut`.

**`ComparableOut`** fields:
- `lead_id: str`
- `conversion: str` ("won" | "lost")
- `price_cents: int` — `realized_revenue_cents` if present, else `quoted_price_cents`
- `price_basis: str` — "realized" | "quoted"
- `score: int` — the proximity score (explainability)
- `move_size_label: str | None`, `move_distance_miles: float | None`, `move_type: str | None` — the comparable's key scope, for display + the prompt line

### Injection into `suggest_quote`

`quote_service.suggest_quote` currently builds `user_content` from `_USER_TEMPLATE` with `scope_json` + `pricing_section` (the prior AI pricing review). Add a third section, `comparables_section`, between them:

```
COMPARABLE LOCAL JOBS (most similar past outcomes — anchor your price on these real local results, not only the SOP bands):
- moving, 2 bedroom apartment, ~8mi, 2 flights → WON, sold $720 (realized)
- moving, 2 bedroom apartment, ~10mi → LOST, quoted $950 (quoted)
...
```

One line per comparable: service/size/distance/stairs summary → `conversion` (uppercase) → price + basis. Built by a small `_format_comparables(comparables)` helper.

**Cold-start / graceful degradation:** when `find_comparables` returns an empty list, `comparables_section` is the empty string and `user_content` is **byte-identical to today's** — zero behavior change, zero regression risk until outcomes accumulate.

`suggest_quote` returns the comparables it used on `QuoteSuggestionOut.comparables` (default empty list), so the facilitator can see what anchored the AI's price.

### Data flow

```
POST /leads/{id}/quote-suggestion
  → suggest_quote(db, lead_id)
      → find_comparables(db, lead, 5)
          → query lead_outcome (same city, finalized, won|lost, same service, priced)
          → score each vs lead's scope, rank, top 5
      → _format_comparables(...) → comparables_section ("" if none)
      → user_content = scope_json + pricing_section + comparables_section
      → model.messages.create(...)
      → reconcile total to line items (existing behavior)
  → QuoteSuggestionOut{ ...existing..., comparables: [...] }
```

## Error handling

- No outcomes / no matches → empty list → no block → existing behavior. (Most important degradation path — covered by a test.)
- Malformed `scope_snapshot` JSON on a row → that row scores 0 / is skipped, never crashes the retrieval (per-row try/except around the parse).
- `find_comparables` is a pure read; it never writes and never raises into `suggest_quote` for missing data — a retrieval failure must not break quoting (wrap the call so a comparables error degrades to the no-block path, logged).
- Existing `suggest_quote` error handling (503 unconfigured AI, 502 bad model output, 404 lead) is unchanged.

## Testing

`comparables_service`:
- Closer scope ranks above looser scope (size match beats distance-only match).
- Hard filters exclude: other city, other service_type, non-finalized, the lead itself, rows with no price.
- Both won and lost comparables are returned and correctly labeled.
- `price_basis`: realized used when present, quoted used as fallback.
- Recency tiebreak when scores are equal.
- Empty pool → empty list.
- Malformed `scope_snapshot` on one row doesn't crash the call.
- `limit` is honored.

`quote_service` (extending `test_quote_suggestion.py` patterns, model mocked):
- With comparables present, `user_content` contains the `COMPARABLE LOCAL JOBS` block and the response `comparables` is populated.
- Cold-start: with no outcomes, no block is added and `comparables` is empty (prompt unchanged).
- A retrieval error degrades to the no-block path (quote still returned).

## Out of scope (this item)

- Grounding the AI review or escalation summary (later; the retriever is reusable).
- Embedding / semantic similarity (item-2 explicitly chose structured scoring; revisit only if free-text scope dominates).
- Hauling-specific scope fields / scoring signals (hauling falls back to service+recency for now).
- Frontend display of the returned `comparables` (API surfaces them; UI is a separate, optional follow-up).
- Eval of whether comparables actually improve pricing — that is **item 3** (the eval harness).
