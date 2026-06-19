# Quote-Grounding Eval — Design Spec

**Date:** 2026-06-18
**Status:** Approved, pre-implementation
**Author:** Ron + Claude

## Context

This is **item 3 of the 4-part self-learning roadmap**. Item 1 (`lead_outcome`) records what actually happened per lead. Item 2 (retrieval grounding) injects comparable past outcomes into the quote prompt so the AI anchors on real local sale prices. Item 3 answers the question that closes the loop: **does the grounding actually improve pricing?**

The attribution gap that defines this spec: `lead_outcome.ai_prompt_version` is the *AI review's* prompt version, and `lead_outcome.quoted_price_cents` is the *human-edited final* quote — neither records whether a given quote was grounded or what the AI raw-suggested. So we cannot measure item 2's effect from the existing tables. Item 3 therefore has two components:

1. **Capture** — an append-only log of what each `suggest_quote` call proposed (grounded?, how many comparables, the AI's raw price).
2. **Eval** — a read-only aggregation that joins that log to finalized outcomes and reports grounded-vs-ungrounded win rate, pricing accuracy, and pricing bias.

Both ship in this cycle. The eval is meaningful in production only once provenance accumulates, but it is fully deterministic and testable now with seeded data.

## Architecture

### Component boundaries

- `app/backend/app/models/quote_suggestion_log.py` — the append-only capture table.
- `app/backend/app/services/quote_service.py` (modify) — write a log row at the end of `suggest_quote`, best-effort.
- `app/backend/app/services/eval_service.py` — `compute_quote_grounding_eval(db, city_id)`; the cohort split + metric math.
- `app/backend/app/schemas/eval.py` — `CohortMetrics`, `QuoteGroundingEval` response models.
- `app/backend/app/routers/eval.py` — the read endpoint.
- `app/backend/main.py` — register the model import + the router.

### 1. Data model — `quote_suggestion_log` (append-only)

One row per `suggest_quote` call. Mirrors the `LeadEvent`/`LeadAlert` append-only pattern (separate table, never updated).

| Field | Type | Notes |
|---|---|---|
| `id` | str (uuid) PK | |
| `lead_id` | str FK -> leads.id (CASCADE) | |
| `city_id` | str | scoping |
| `was_grounded` | bool | comparables were injected into the prompt |
| `comparables_count` | int | how many comparables (0 when ungrounded) |
| `suggested_price_cents` | int, nullable | the AI's reconciled total * 100; null if unavailable |
| `model_used` | str, nullable | the model that produced the suggestion |
| `created_at` | datetime (naive UTC) | |

Plain String/Integer/Boolean/DateTime columns, naive-UTC datetimes — consistent with existing models.

### 2. Capture — in `suggest_quote`

After the suggestion is built and the line-item total reconciled (existing logic), and before/around the return, write one `quote_suggestion_log` row:
- `was_grounded = len(comparables) > 0`
- `comparables_count = len(comparables)`
- `suggested_price_cents = round(suggestion.quoted_price_total * 100)` (after reconciliation; the AI's raw number, not a human edit)
- `model_used = model`
- `city_id = lead.city_id`

The write is wrapped in a best-effort helper (`_log_suggestion`) with try/except — a logging failure must never break quoting, exactly like `_safe_find_comparables`. (A failed write rolls back only the log, not the suggestion response.)

### 3. Eval service — `compute_quote_grounding_eval(db, city_id=None)`

Returns a `QuoteGroundingEval` (two `CohortMetrics`: `grounded`, `ungrounded`).

Algorithm:
1. Load `quote_suggestion_log` rows (filtered by `city_id` when provided), and determine the **latest** log per `lead_id` (max `created_at`).
2. Load finalized `lead_outcome` rows (same `city_id` filter), keyed by `lead_id`.
3. **Eligible leads** = leads present in BOTH maps (have a latest suggestion log AND a finalized outcome).
4. Assign each eligible lead to a cohort by its latest log: `grounded` if `was_grounded` else `ungrounded`.
5. Per cohort compute:
   - `n` = eligible leads in the cohort.
   - `win_rate` = won / (won + lost) over the cohort's outcomes; `null` if (won+lost) == 0.
   - Pricing set = cohort leads where `outcome.conversion == "won"` AND `outcome.realized_revenue_cents` is set AND the latest log's `suggested_price_cents` is set.
   - `priced_n` = size of the pricing set.
   - `pricing_accuracy` = mean of `abs(suggested - realized) / realized` over the pricing set; `null` if `priced_n == 0`.
   - `pricing_bias` = mean of `(suggested - realized) / realized` over the pricing set; `null` if `priced_n == 0`.

Pure read; no writes. No statistical-significance testing — `n`/`priced_n` are surfaced and the human judges.

### 4. Schemas — `app/backend/app/schemas/eval.py`

```python
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

### 5. Endpoint — `routers/eval.py`

`GET /admin/eval/quote-grounding?city_id=` -> `QuoteGroundingEval`. Admin-gated via `require_role("admin")` (matches `/admin/outcomes`, financial data). Read-only.

## Data flow

```
POST /leads/{id}/quote-suggestion
  -> suggest_quote(...)  [item 2: finds comparables, injects block, reconciles]
  -> _log_suggestion(db, lead, comparables, suggestion, model)  [best-effort]
       -> quote_suggestion_log row (was_grounded, count, suggested_price, model)

(later, lead finalizes) -> lead_outcome row (item 1)

GET /admin/eval/quote-grounding
  -> compute_quote_grounding_eval(db, city_id)
       -> latest log per lead  x  finalized outcomes  -> cohorts
       -> per cohort: n, win_rate, priced_n, pricing_accuracy, pricing_bias
```

## Error handling

- Capture write failure -> logged, swallowed; the quote suggestion still returns (best-effort, mirrors `_safe_find_comparables`).
- `suggested_price_cents` null (no/invalid total) -> the lead is excluded from the pricing metrics but still counts toward `n`/`win_rate`.
- A lead with a log but no finalized outcome (or vice versa) -> excluded from the eval (not yet evaluable).
- Empty cohort / empty pricing set -> `win_rate` / `pricing_accuracy` / `pricing_bias` are `null`, with `n` / `priced_n` shown.
- `realized_revenue_cents == 0` would divide by zero -> guard: treat 0 realized as not-priceable (exclude from the pricing set), since a $0 sale is a data artifact, not a price.

## Testing

Capture (`test_quote_suggestion.py` extension, model mocked):
- A grounded suggestion writes a log with `was_grounded=True`, `comparables_count>0`, the reconciled `suggested_price_cents`.
- A cold-start suggestion writes a log with `was_grounded=False`, `comparables_count=0`.
- A capture failure (e.g. patched to raise) does NOT break the quote response.

Eval (`test_eval_service.py`):
- Cohort assignment uses the latest log per lead (a lead re-run with grounding lands in `grounded`).
- `win_rate` math: cohort with 2 won / 1 lost -> 0.667.
- `pricing_accuracy` + `pricing_bias` computed on won+realized only; signs correct (underpricing -> negative bias).
- Leads without a finalized outcome, or without any log, are excluded.
- Empty cohort -> null metrics, `n=0`, `priced_n=0`.
- `realized_revenue_cents == 0` is excluded from the pricing set (no divide-by-zero).
- `city_id` filter scopes both logs and outcomes.

Endpoint (`test_eval_api.py`):
- `GET /admin/eval/quote-grounding` returns the two cohorts with the expected shape and values for a seeded scenario.

## Out of scope (this item)

- Statistical significance / confidence intervals (report `n`, human judges).
- Grouping by `ai_prompt_version` or quote-prompt version (the grounded/ungrounded split is the chosen dimension; prompt-version A/B is a later extension once a quote prompt_version exists).
- A frontend dashboard for the eval (the endpoint surfaces JSON; UI is a separate optional follow-up).
- Item 4 (regenerate grounding / fine-tune from the eval signal).
- Backfilling provenance for quotes suggested before this ships (no log exists for them; they're simply not evaluable — documented).
