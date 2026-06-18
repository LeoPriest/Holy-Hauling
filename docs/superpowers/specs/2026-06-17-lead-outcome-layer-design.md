# Lead Outcome Layer — Design Spec

**Date:** 2026-06-17
**Status:** Approved, pre-implementation
**Author:** Ron + Claude

## Context

The Holy Hauling app captures everything a learning loop needs — AI reviews (`AiReview` with `prompt_version`/`input_snapshot`/`model_used`), quotes (`quote_cents`/`quoted_price_total`), terminal lead states, the `LeadEvent` audit trail, escalation outcomes, and finance/pay records — but **nothing reads those outcomes back** to improve future AI output. Every AI call (`ai_review_service`, `quote_service`, `escalation_service.suggest_summary`) is forward-only and stateless across leads, grounded in a static SOP file plus the current lead's own data. The system records what happened; it does not learn from it.

This spec is **item 1 of a 4-part self-learning roadmap**:
1. **Outcome layer (this spec)** — a stable, queryable record of "what actually happened" per lead. Foundation for everything else.
2. Retrieval grounding — inject the N most similar past leads + their outcomes into AI prompts.
3. Eval harness — score `prompt_version` A vs B against real outcomes.
4. (Later, if ever) regenerate grounding/pricing bands from won-quote data, or fine-tune.

Items 2–4 each get their own spec → plan → build cycle. Item 1's shape determines what they can consume.

## Goal

A materialized `lead_outcome` table — one evolving row per lead — that freezes the decision-time snapshot and the eventual real-world result (conversion + realized price + escalation), kept current by an idempotent reconciliation sweep. Self-contained enough that retrieval (item 2) and eval (item 3) read from it without re-joining the operational tables.

## Architecture

### Component boundaries

- `app/backend/app/models/lead_outcome.py` — the table.
- `app/backend/app/services/outcome_service.py` — `reconcile_outcomes(db, city_id)` (compute + upsert) and the per-lead computation helpers. One clear responsibility: derive an outcome row from a lead + its finance/review/escalation data.
- `app/backend/app/routers/outcomes.py` — one read endpoint for visibility/verification.
- `app/backend/main.py` — register the model, schedule the reconciler, run the backfill once at startup.

### Data model — `lead_outcome`

One row per lead (`lead_id` is the primary key / FK).

| Field | Type | Meaning |
|---|---|---|
| `lead_id` | str PK, FK→leads.id (CASCADE) | one row per lead |
| `city_id` | str | multi-city scoping |
| `conversion` | str | `won` \| `lost` \| `pending` |
| `terminal_status` | str | the lead status that produced this row (`booked` \| `released` \| `lost`) |
| `quoted_price_cents` | int, nullable | decision-time quote (`quote_cents`, else `round(quoted_price_total*100)`) |
| `realized_revenue_cents` | int, nullable | sum of `income` `FinanceTransaction` rows for the lead |
| `realized_cost_cents` | int, nullable | sum of `expense` `FinanceTransaction` rows for the lead |
| `price_delta_cents` | int, nullable | `realized_revenue_cents − quoted_price_cents` (null until both exist) |
| `was_escalated` | bool | lead had ≥1 escalation (any status) |
| `escalation_outcome` | str, nullable | outcome of the most recent resolved escalation, else null |
| `scope_snapshot` | text (JSON) | frozen copy of scope fields — bridge to item-2 retrieval |
| `ai_prompt_version` | str, nullable | `prompt_version` of the latest `AiReview`, else null — grouping key for item-3 eval |
| `booked_at` | datetime, nullable | when the lead reached `booked` (from the `status_changed`→`booked` event, else null) |
| `completed_at` | datetime, nullable | when the lead reached `released` (completed) |
| `time_to_book_minutes` | int, nullable | minutes from `lead.created_at` to `booked_at` |
| `finalized` | bool, default false | economic picture closed; row frozen from further updates |
| `created_at` | datetime | |
| `updated_at` | datetime | |

`scope_snapshot` reuses the field set already assembled by `quote_service._build_scope` / `escalation_service._build_scope` (service_type, job_location, job_origin, job_destination, move_size_label, move_type, move_distance_miles, load_stairs, unload_stairs, scope_notes). Stored as a JSON string (consistent with `move_date_options`, `field_sources`, etc.).

Columns are plain `String`/`Integer`/`Boolean`/`Text`/`DateTime`, naive-UTC datetimes — consistent with the existing models (`lead_alert`, `lead_escalation`, `lead`). String-valued vocabularies (`conversion`, `terminal_status`) validated in code, not via DB enums.

### Outcome semantics (unambiguous definitions)

- **Conversion:** `terminal_status` `booked` or `released` → `won`; `lost` → `lost`; any other status → `pending` (no row is written for a lead that hasn't reached a terminal-ish state).
- **Label quirk (documented so nothing downstream depends on it):** in this app, status `released` means *job completed* (a won lead that finished), and status `lost` means *released without booking* (didn't convert). `conversion` is encoded explicitly so consumers never rely on the confusing status names.
- **Realized price source:** sum of `FinanceTransaction` rows with `transaction_type = income` and `lead_id = lead`. The Square `lead_payment` path is secondary and not used here. **Documented caveat:** completed jobs with no logged income transaction show `realized_revenue_cents = null` — a data-completeness gap, not a bug; such rows still finalize on the `released` status (see below) but carry null revenue.
- **`realized_cost_cents`:** sum of `expense` `FinanceTransaction` rows for the lead (e.g. the truck-rental expense). Enables margin analysis later; same query as revenue.
- **Finalization:** `finalized = true` when the lead is `lost` (no revenue expected), **or** the lead is `released`/completed. Once `finalized`, the reconciler skips the row — preserving the decision-time snapshot. Unfinalized rows (e.g. `booked`, not yet completed) are recomputed on every sweep so realized revenue fills in as it lands.

### Reconciler + backfill

- `outcome_service.reconcile_outcomes(db, city_id)`:
  1. Select leads in `booked` / `released` / `lost` for the city whose `lead_outcome` row is missing **or** not yet `finalized`.
  2. For each, compute the row (conversion, prices from finance, escalation fields, scope snapshot, prompt version, timings) and **upsert** (insert if absent, update in place if present-and-unfinalized).
  3. Idempotent: re-running produces identical rows; finalized rows are never touched.
- **Scheduling:** registered in `main.py`'s `lifespan` on the existing `AsyncIOScheduler`, interval **15 minutes**, alongside `check_stale_leads` / `check_due_followups`. Entry point `reconcile_all_outcomes()` opens its own session and loops active cities (mirrors `check_stale_leads`).
- **Backfill:** the same `reconcile_all_outcomes()` is invoked once during startup (after `create_all`), so existing terminal leads get rows immediately. No separate backfill code.
- Multi-city aware throughout.

### Access

- `GET /admin/outcomes?city_id=&conversion=` → list of outcome rows (most recent first), optional `conversion` filter. Auth via `require_auth`, city filter when provided (mirrors the rental/escalation list endpoints). For visibility and verification only.
- No write API — the reconciler is the sole writer.

## Data flow

```
lead reaches booked/released/lost
  → (≤15 min) reconcile sweep, or startup backfill
  → outcome_service computes row:
       conversion + terminal_status (from lead.status)
       quoted_price_cents (from lead)
       realized_revenue/cost (sum finance txns by type)
       was_escalated / escalation_outcome (from lead_escalations)
       scope_snapshot (frozen scope fields)
       ai_prompt_version (latest AiReview)
       booked_at/completed_at/time_to_book (from lead_events + lead)
       finalized (lost, or released)
  → upsert lead_outcome (skip if already finalized)
  → GET /admin/outcomes surfaces it
  → (future) item-2 retrieval & item-3 eval read these rows
```

## Error handling

- A lead missing finance rows → `realized_revenue_cents`/`realized_cost_cents` null, `price_delta_cents` null. Row still written.
- A lead with no `AiReview` → `ai_prompt_version` null.
- A lead with no `booked` event (e.g. went straight to `lost`) → `booked_at`/`time_to_book_minutes` null.
- Reconciler is best-effort per lead: an exception computing one lead's row is logged and skipped, never aborts the sweep (mirrors `check_stale_leads`'s try/except posture).
- Re-running the reconciler or backfill is always safe (idempotent upsert; finalized rows frozen).

## Testing

- Conversion mapping: `booked`→`won`, `released`→`won`, `lost`→`lost`; non-terminal lead → no row.
- Realized revenue = sum of income txns; realized cost = sum of expense txns; `price_delta_cents = realized_revenue − quoted`.
- A lead with no finance rows → null revenue/cost/delta, row still created.
- `finalized` set for `lost` and `released`; **finalized-freeze**: a finalized row is not overwritten when the reconciler runs again with changed source data.
- An unfinalized `booked` row gets realized revenue filled in on a later sweep once an income txn exists.
- `was_escalated` / `escalation_outcome` populated from a resolved escalation; null when none.
- `scope_snapshot` contains the expected scope fields; `ai_prompt_version` reflects the latest review.
- Reconciler idempotency (two runs → one identical row); backfill over a pre-seeded terminal lead creates its row.
- `GET /admin/outcomes` returns rows and honors the `conversion` filter.

## Out of scope (this item)

- Any consumption of outcome rows by AI prompts (that is item 2 — retrieval grounding).
- Eval/scoring of prompt versions against outcomes (item 3).
- Embeddings / similarity search (item 2 will add the retrieval mechanism; item 1 only stores the `scope_snapshot` it will use).
- Backfilling realized revenue for historically completed jobs that never logged a finance income txn (data-completeness gap, documented).
- Event-driven (synchronous) outcome updates — rejected in favor of the reconciliation sweep.
