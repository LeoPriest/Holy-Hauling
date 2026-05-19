# Payroll Feature Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Track per-job pay records for facilitators (10% of job quote) and crew members (hourly rate or flat amount), with an admin screen to aggregate what each person is owed over a date range.

**Architecture:** Pay records live on the job (one row per person per job in a `pay_records` table). `amount_cents` is always computed server-side and stored. A separate admin aggregation endpoint sums by user across a date range. No pay period concept — date filtering is applied to `lead.job_date_requested`.

**Tech Stack:** FastAPI + SQLAlchemy async, React 18 + TypeScript + TanStack Query + Tailwind, consistent with existing patterns (finance, truck rental).

---

## Data Model

### Changes to existing tables

**`leads`** — add column:
- `quote_cents` (Integer, nullable) — the agreed job quote; drives facilitator pay calculation.

**`users`** — add column:
- `hourly_rate_cents` (Integer, nullable) — the worker's default hourly rate; null means not set.

### New table: `pay_records`

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | String PK | No | UUID |
| `lead_id` | FK → leads (CASCADE) | No | |
| `user_id` | FK → users (CASCADE) | No | |
| `pay_type` | Enum | No | `facilitator_pct` / `hourly` / `flat` |
| `hours_worked` | Float | Yes | Only for `hourly` |
| `override_amount_cents` | Integer | Yes | Only for `flat` |
| `amount_cents` | Integer | No | Always stored; computed server-side |
| `note` | Text | Yes | Optional memo |
| `created_at` | DateTime | No | |
| `updated_at` | DateTime | No | |

**Unique constraint:** `(lead_id, user_id)` — one pay record per person per job.

### Calculation rules (applied at write time)

| `pay_type` | Formula |
|---|---|
| `facilitator_pct` | `round(lead.quote_cents × 0.10)` |
| `hourly` | `round(hours_worked × user.hourly_rate_cents)` |
| `flat` | `override_amount_cents` |

Server never trusts `amount_cents` from the client — always recomputes on write.

---

## Backend API

### Per-job pay records

**Router prefix:** `/leads/{lead_id}/pay-records`
**Auth:** `require_auth`

| Method | Path | Description |
|---|---|---|
| `GET` | `` | List all pay records for this job (with user display name) |
| `POST` | `` | Upsert a pay record for a user on this job |
| `DELETE` | `/{record_id}` | Remove a pay record |

**POST payload (`PayRecordUpsert`):**
```
user_id: str
pay_type: PayType
hours_worked: float | None       # required when pay_type=hourly
override_amount_cents: int | None # required when pay_type=flat
note: str | None
```

`amount_cents` computed server-side — rejected if sent by client.

**Validation:**
- `hours_worked` must be > 0 when `pay_type=hourly`; must be null otherwise.
- `override_amount_cents` must be ≥ 0 when `pay_type=flat`; must be null otherwise.
- `pay_type=facilitator_pct` requires `lead.quote_cents` to be set; returns 422 if not.
- `pay_type=hourly` requires `user.hourly_rate_cents` to be set; returns 422 if not.

**GET response (`PayRecordOut`):**
Includes all columns plus `user_username` and `user_hourly_rate_cents` for display.

### Admin aggregation

**Router prefix:** `/admin/payroll`
**Auth:** `require_role("admin", "facilitator")`

| Method | Path | Description |
|---|---|---|
| `GET` | `` | Aggregate pay records by user |

**Query params:** `city_id`, `date_from` (ISO date), `date_to` (ISO date)
- Date filter applies to `lead.job_date_requested`.
- City scoped via `city_scope(current_user, city_id)` (same pattern as rentals/finances).

**Response:** List of objects, one per user:
```
user_id: str
username: str
total_amount_cents: int
record_count: int
jobs: list[{ lead_id, customer_name, job_date_requested, amount_cents, pay_type }]
```

### Existing endpoints touched

- **Lead upsert** — `quote_cents` added to the lead update schema (nullable int, ≥ 0).
- **User update (`PUT /admin/users/{id}`)** — `hourly_rate_cents` added to user update schema (nullable int, ≥ 0).

---

## Frontend

### 1. Quote field — BriefPanel

A `$/quote` dollar input appears in the job details section when `lead.status === 'booked'`. Saves on blur via existing lead mutation. Displays as `—` when null. Only admin/supervisor/facilitator can edit.

### 2. Hourly rate — AdminUsersScreen

A `$/hr` input added to the user create/edit form. Nullable — left blank means not set. Displays as `—` in the user list.

### 3. PayrollSection component

**Location:** `src/components/PayrollSection.tsx`
**Used in:** BriefPanel (below TruckRentalSection)
**Props:** `{ lead: Lead }`

**Behavior:**
- Collapsible (same toggle pattern as TruckRentalSection).
- Lists all pay records for the job in a detail grid: user name, pay type, hours (if hourly), amount.
- "Add Pay Record" button — opens a form pre-populated with assigned crew members as a dropdown. Selecting a user pre-fills their `pay_type` (facilitator if role=facilitator, hourly if `hourly_rate_cents` set, else flat) and their default rate.
- Inline edit: click a record to edit hours or switch to flat override.
- Delete: single-tap with confirmation (matches truck rental pattern).
- `useEffect` resets state when `lead.id` changes.
- `role="switch"` / ARIA attrs consistent with existing components.

**Hooks:** `src/hooks/usePayroll.ts`
- `usePayRecords(leadId)` — GET query
- `useUpsertPayRecord(leadId)` — POST mutation, invalidates `['pay-records', leadId]` + `['payroll']`
- `useDeletePayRecord(leadId)` — DELETE mutation, same invalidation
- `usePayrollSummary(filters?)` — GET `/admin/payroll` with city scoping

### 4. AdminPayrollScreen

**Location:** `src/screens/AdminPayrollScreen.tsx`
**Route:** `/admin/payroll` (admin only via RoleGuard)
**Admin menu card:** Added to AdminScreen after Rentals (orange → amber color scheme).

**Layout:**
- Header: back → `/admin`, `<CitySwitcher allowAll />`
- Date range inputs: `date_from` / `date_to`, default to current week (Monday–Sunday).
- Summary bar: total owed across all users in range.
- User rows: name, total owed, job count. Tap to expand job breakdown.
- Loading / empty / error states.
- `<BottomNav />`

---

## Testing

**Backend (`tests/test_payroll.py`):**
- 404 when no pay records exist for a lead
- Create pay record (facilitator_pct) — calculates 10% of quote
- Create pay record (hourly) — calculates hours × rate
- Create pay record (flat) — stores override amount
- Upsert updates existing record
- Validation: facilitator_pct fails if quote_cents is null
- Validation: hourly fails if hourly_rate_cents is null on user
- Validation: hours_worked required for hourly type
- Delete pay record
- Admin aggregation: sums correctly across multiple jobs
- Admin aggregation: date filter excludes out-of-range jobs
- Admin aggregation: city filter scopes correctly

**Frontend:** TypeScript compilation clean; TanStack Query invalidation verified via integration.
