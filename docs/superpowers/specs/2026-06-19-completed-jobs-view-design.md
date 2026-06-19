# Completed Jobs View — Design Spec

**Date:** 2026-06-19
**Status:** Approved, pre-implementation
**Author:** Ron + Claude

## Problem

`GET /jobs` lists only `booked` jobs (`Lead.status == LeadStatus.booked`), so once a job is marked `released` (completed) it vanishes from the Jobs screen. Completed jobs only appear mixed with `lost` leads in the LeadQueue "Closed" tab, as generic lead cards with none of the job detail (crew, duration, revenue). There's no place to see and track completed jobs.

## Goal

A **"Completed"** tab on the Jobs screen listing released (completed) jobs, most-recent-first, with each card showing the operational record **and** the financials (quoted price + realized revenue), plus a header total (count + total realized revenue). Tapping a card opens the lead detail (unchanged).

## Architecture

### Backend — extend `GET /jobs`

Add a `status` query param: `"booked"` (default, unchanged behavior) or `"completed"`. Invalid values → 400. `"completed"` maps to `LeadStatus.released`.

Auth/role logic is unchanged: admin/facilitator/supervisor see all jobs in scope; crew see only jobs assigned to them (the same `JobAssignment` join, with the status swapped).

For the **completed** branch, two extra pieces of data are attached per job, computed in **batched** queries over the result set (no N+1):
- `realized_revenue_cents` — `SUM(amount_cents)` of `FinanceTransaction` rows with `transaction_type = income` for the lead (one `GROUP BY lead_id` query over the result leads). The authoritative realized revenue (same definition as the outcome layer), computed live so a just-completed job isn't subject to the 15-min reconciler lag.
- `completed_at` — `MIN(created_at)` of `LeadEvent` rows with `event_type = "status_changed"` and `to_status = "released"` for the lead (one query over the result leads). ISO string.

The completed list is **sorted most-recent-completed first** (by `completed_at` desc, nulls last) — done in Python after attaching `completed_at`, since it's derived from events. The booked branch keeps its existing SQL sort.

`_to_job_out` gains two optional params (`realized_revenue_cents`, `completed_at`) defaulting to `None`; the booked branch passes neither (they stay None on `JobOut`).

### Schema — `JobOut` (additions)

```python
    realized_revenue_cents: Optional[int] = None
    completed_at: Optional[str] = None  # ISO datetime; set for completed jobs
```

All existing fields unchanged. For booked jobs both are `None`.

### Frontend — Jobs screen "Completed" tab

- `JobView` gains `'completed'` (a third tab after Scheduled / In-Progress).
- A `useJobs(status)` variant fetches `GET /jobs?status=completed` when the Completed tab is active (its own query key; the existing booked fetch is unchanged). The `Job` type gains `realized_revenue_cents?: number` and `completed_at?: string`.
- Each completed-job card reuses the existing job card's operational fields (customer, service, crew, on-site duration, address/date) and adds a **completed line**: completed date + quoted price + realized revenue. (The active-job phase timers/controls are not shown in the completed tab — completed jobs are read-only history.)
- A **header summary** above the list: `N completed · $X realized` — count of completed jobs shown and the sum of their `realized_revenue_cents` (treating null as 0).
- Most-recent first (the backend already sorts). Tap a card → existing lead detail route.

## Data flow

```
Jobs screen "Completed" tab
  -> GET /jobs?status=completed
      -> released leads in scope (crew -> only assigned)
      -> batch: SUM income finance per lead  -> realized_revenue_cents
      -> batch: MIN released status_changed event per lead -> completed_at
      -> JobOut[] sorted by completed_at desc
  -> header: count + sum(realized_revenue_cents ?? 0)
  -> cards (operational + price + realized + completed date)
```

## Error handling

- `status` not in {`booked`, `completed`} → 400 with a clear message.
- A completed job with no logged income transaction → `realized_revenue_cents = null`; the card shows the quote with realized blank, and it contributes 0 to the header total (documented data-completeness gap, not an error).
- A released lead with no `status_changed → released` event (e.g., status set by a path that didn't log the event) → `completed_at = null`; it sorts last and shows no completed date. Non-fatal.
- Empty completed list → "No completed jobs yet."

## Testing

**Backend:**
- `GET /jobs?status=completed` returns `released` jobs and excludes `booked`; `GET /jobs` (default) still returns only `booked` (unchanged).
- `status=invalid` → 400.
- `realized_revenue_cents` equals the sum of the lead's income finance transactions; a lead with no income → null; expense transactions are excluded.
- `completed_at` is set from the `status_changed → released` event; results sorted most-recent-completed first.
- Crew role: `?status=completed` returns only released jobs assigned to that crew member.
- Booked jobs (`?status=booked`) carry `realized_revenue_cents = null` / `completed_at = null`.

**Frontend:**
- `tsc --noEmit` + `npm run build` green with the new tab, hook variant, and `Job` fields.

## Out of scope

- Period/date filtering and month-by-month totals (lean list + running total first; add filters when volume demands — explicitly deferred).
- A new bottom-nav screen (it's a tab on the existing Jobs screen).
- Editing or re-opening completed jobs (read-only history; the lead detail already allows status changes if needed).
- Export / reporting.
- Including `lost` leads (this view is completed jobs only; `lost` never-booked leads stay in the LeadQueue Closed tab).
