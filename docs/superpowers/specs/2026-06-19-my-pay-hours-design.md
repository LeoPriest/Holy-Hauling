# My Pay & Hours — Design Spec

**Date:** 2026-06-19
**Status:** Approved direction, pre-implementation
**Author:** Ron + Claude

## Problem

The app already records each crew member's pay per job in the `PayRecord` table (`pay_type`, `hours_worked`, `amount_cents`, per `(lead_id, user_id)`). But that data is only reachable two ways:

- **Per-lead** — `GET /leads/{lead_id}/pay-records`, how office roles enter pay; it lists *every* user's pay on that lead.
- **Admin payroll** — `/admin/payroll/*`, office-only aggregate views.

A crew member has **no way to see their own hours and earnings across jobs.** They can't answer the basic questions "how much have I made?" and "how many hours have I worked?" — and can't spot a job that's missing pay.

This is crew-assist feature #2 (after the crew agenda). It is the lean "running list + totals" option: a personal pay view, newest job first, with headline totals. No pay-period model yet.

## Goal

Give every user a **My Pay** view of their own pay records: a headline total (earned + hours + job count) over a per-job list (date · customer · pay type · hours · amount), newest first. Crew see only their own records; the view lives in **Settings** (no new nav item, no new screen). A pay-period grouping is explicitly deferred.

## Architecture

### New endpoint: `GET /me/pay`

A single read endpoint returning the **caller's own** pay records, each joined to its lead for display context, plus computed totals.

- **Auth:** `require_auth` (any authenticated role). The query is hard-scoped to `PayRecord.user_id == current_user.id` — a user can only ever see their own pay. No role gating beyond authentication; office roles simply also have the admin payroll views.
- **No new model, no new columns.** Reuses `PayRecord` + `Lead`.
- **Lead join** supplies `customer_name` and `job_date` per entry. The customer display name follows whatever the codebase already uses to render a lead's customer (e.g. the lead's `customer_name` / name field used elsewhere in jobs/quotes); the implementer matches the existing convention rather than inventing one.
- **Sort:** entries newest-first by the job date used for display (`job_date_requested`), nulls last; ties broken by `PayRecord.created_at` desc for stable ordering.

### Response shape

```jsonc
{
  "total_earnings_cents": 184000,   // sum of every entry's amount_cents
  "total_hours": 31.5,              // sum of hours_worked where set (null → skipped)
  "job_count": 6,                   // number of entries
  "entries": [
    {
      "lead_id": "…",
      "customer_name": "Maria Lopez",
      "job_date": "2026-06-19",      // ISO date string or null (from lead.job_date_requested)
      "pay_type": "hourly",          // hourly | flat | facilitator_pct
      "hours_worked": 6.0,           // float or null
      "amount_cents": 12000
    }
    // …newest first
  ]
}
```

Schema lives in `app/backend/app/schemas/pay_record.py` (alongside the existing pay schemas): `MyPayEntry` and `MyPayOut`.

### Totals semantics

- `total_earnings_cents` = sum of `amount_cents` over all the caller's records (every pay type contributes).
- `total_hours` = sum of `hours_worked` over records where it is **not null**. Flat and percentage jobs typically have no hours and contribute earnings but not hours — this is intentional, not a bug.
- `job_count` = number of entries (one `PayRecord` per `(lead, user)`).
- Empty result → `total_earnings_cents: 0`, `total_hours: 0`, `job_count: 0`, `entries: []`.

### Router placement

A `me`-scoped route. Prefer an existing `/me`-style router if one exists (the users router already serves `/users/me/weekly-availability`); otherwise add the route to the payroll router under a `/me/pay` path. The implementer picks whichever matches the codebase's existing "current user" routing convention, keeping the path `GET /me/pay` (or `/users/me/pay` if that's the established prefix — confirm against existing `/me` routes and stay consistent). The exact mounted path is settled in the plan against the real router setup; the contract (caller-scoped own pay + totals) is fixed.

## Frontend

### `useMyPay()` hook

`app/frontend/src/hooks/useMyPay.ts` — TanStack Query hook hitting `GET /me/pay` via `apiFetch`, query key `['my-pay']`. Returns `{ data, isLoading, isError }` with `data` typed to the response shape (`MyPay` type added to `services/api.ts`).

### My Pay section in Settings

`app/frontend/src/screens/SettingsScreen.tsx` gains a **My Pay** section (a new block among the existing sections — availability, theme, etc.), visible to **all roles**:

- **Summary card:** headline `$<total earned>` (dollars, from `total_earnings_cents`), with `<total_hours> hrs logged · <job_count> jobs` beneath. Money formatted dollars from cents using the existing cents→dollars formatting convention in the frontend.
- **Per-job list:** one row per entry — left: job date (day + month, or "—" when `job_date` is null); middle: customer name + move/service descriptor + a small pay-type pill (Hourly / Flat / Percentage); right: amount (dollars) and, beneath it, hours (`6.0 hrs`) or a muted "— no hrs" when `hours_worked` is null. Newest first (already sorted by the API). Rows are read-only (no tap target / navigation in this version).
- **Loading state:** a lightweight skeleton or "Loading…" placeholder while `isLoading`.
- **Empty state:** summary shows `$0 · 0 hrs · 0 jobs`; list shows "No pay recorded yet. Completed jobs with pay will show up here."

A small presentational component (`components/MyPay.tsx`) renders the summary + list given the hook's data, keeping `SettingsScreen` thin. Tap targets / rows respect the touch-first minimum height (≥44px) even though rows are non-interactive, for visual rhythm and future tappability.

## Data flow

```
User opens Settings
  My Pay section -> useMyPay() -> GET /me/pay
     backend: SELECT pay_records WHERE user_id = current_user.id
              JOIN leads for customer_name + job_date
              -> compute total_earnings_cents / total_hours / job_count
              -> entries newest-first
  -> summary card (totals) + per-job list (read-only rows)
```

## Error / empty states

- **No pay records** → totals all zero, "No pay recorded yet." empty list (not an error).
- **A record whose lead is missing `job_date_requested`** → `job_date: null`; row shows "—" for the date and sorts after dated rows.
- **A flat / percentage record** (`hours_worked` null) → contributes to earnings, not to `total_hours`; row shows "— no hrs".
- **Request failure** → the section shows a short inline error ("Couldn't load your pay") rather than breaking the rest of Settings.

## Testing

### Backend (pytest)

- `GET /me/pay` returns only the **caller's own** records: seed pay records for the caller and a second user on the same lead; assert the response contains only the caller's, never the other user's.
- `total_earnings_cents` equals the sum of the caller's `amount_cents`.
- `total_hours` equals the sum of `hours_worked` ignoring null-hours records (seed at least one hourly + one flat/null-hours record; assert flat record's amount is counted but its (absent) hours are not).
- `job_count` equals the number of the caller's records.
- Entries carry `customer_name` and `job_date` from the joined lead; a lead with no `job_date_requested` yields `job_date: null`.
- Entries are ordered newest-first by job date (nulls last).
- Empty case: a user with no pay records gets `{0, 0, 0, []}`.
- Auth: unauthenticated request is rejected (consistent with other authed endpoints).

Use the existing `crew_client` / `supervisor_client` (or `client` + a seeded user) fixtures from the jobs/payroll tests; create `PayRecord` rows directly via the db session, mirroring existing payroll tests.

### Frontend

- `tsc && vite build` green with the new hook, type, and Settings section.
- (Structural) Summary renders totals from the hook; a flat-rate row renders "— no hrs"; empty state renders the placeholder. No JS test runner exists in this project, so verification is type-check + build plus the backend contract tests; visual confirmation is manual.

## Out of scope

- **Pay-period grouping / paycheck view** (this week / pay cycle subtotals) — deferred until a real pay cycle is defined (the "B" option from brainstorming).
- **Editing pay from this view** — read-only; office roles still manage pay via the per-lead and admin payroll surfaces.
- **Tap-to-open the job** from a pay row — possible later; rows are read-only now.
- **Exposing other users' pay** to anyone via this endpoint — never; it is strictly caller-scoped.
- **A new bottom-nav item or dedicated Pay screen** — it lives inside Settings.
- The third crew feature (per-job checklist & items to bring) — separate spec → plan cycle.
