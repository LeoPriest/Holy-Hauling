# Recurring Expenses Design

**Date:** 2026-05-20

## Goal

Allow admins to define recurring expenses (insurance, truck payments, subscriptions, etc.) with a custom repeat interval. The admin home screen surfaces a count of expenses due within 7 days. A dedicated Due Expenses screen lets admins log each one with a single tap, which records a real finance transaction and advances the schedule. Due dates appear on both the in-app calendar and Google Calendar.

---

## Data Model

New table: `recurring_expenses`

| Column | Type | Notes |
|---|---|---|
| id | String PK | UUID |
| city_id | String FK → cities | city-scoped like finance_transactions |
| name | String, not null | human label, e.g. "Truck insurance" |
| category | String, not null | same free-text category as FinanceTransaction |
| amount_cents | Integer, not null | stored in cents |
| payment_method | String, nullable | |
| vendor_customer | String, nullable | |
| description | Text, nullable | |
| interval_value | Integer, not null | e.g. 2 |
| interval_unit | String, not null | `days` \| `weeks` \| `months` |
| next_due_date | Date, not null | the upcoming occurrence; advances on each log |
| google_calendar_event_id | String, nullable | GCal event ID for the current upcoming occurrence |
| is_active | Boolean, not null, default True | pause without deleting |
| created_by | String, nullable | user_id of creator |
| created_at | DateTime, not null | UTC |
| updated_at | DateTime, not null | UTC |

No separate occurrences table — the single `next_due_date` field drives everything. Logged transactions live in `finance_transactions` as normal records.

---

## Backend API

Base prefix: `/admin/recurring-expenses`

All endpoints require `admin` role.

| Method | Path | Description |
|---|---|---|
| GET | `/` | List all recurring expenses for the scoped city. Query params: `city_id`, `is_active`. |
| POST | `/` | Create a recurring expense. Triggers GCal event creation. |
| PATCH | `/{id}` | Update fields. If `next_due_date` or `name` changes, update GCal event. |
| DELETE | `/{id}` | Delete recurring expense. Deletes pending GCal event. |
| POST | `/{id}/log` | Log the current occurrence: creates a `FinanceTransaction`, advances `next_due_date` by interval, moves GCal event to new date. Returns the created transaction. |
| GET | `/due` | Returns recurring expenses where `next_due_date <= today + 7 days` and `is_active = true`, city-scoped. Used by admin home screen and due list. |

### Log action detail (`POST /{id}/log`)

1. Load recurring expense by id (404 if not found or wrong city).
2. Create `FinanceTransaction` with: `occurred_on = next_due_date`, `transaction_type = expense`, and all fields copied from the recurring expense template.
3. Advance `next_due_date`:
   - `days`: add `interval_value` days
   - `weeks`: add `interval_value * 7` days
   - `months`: add `interval_value` months (use `dateutil.relativedelta`)
4. Delete the existing GCal event (if `google_calendar_event_id` set).
5. Create a new GCal event for the new `next_due_date`.
6. Save and return the created `FinanceTransaction`.

---

## Admin Home Screen

Add a new card to `AdminScreen.tsx` (purple color scheme) after the Payroll card:

- **Label:** Recurring
- **Description:** "Track scheduled expenses and log due payments"
- **Badge:** count from `GET /admin/recurring-expenses/due` — displayed as a red dot or number when > 0
- **Navigation:** taps to `/admin/recurring-expenses/due`

The badge query runs on mount and refetches when the screen is focused.

---

## Due Expenses Screen (`/admin/recurring-expenses/due`)

Sticky header: back → `/admin`, "Due Expenses" title, CitySwitcher.

Lists all recurring expenses returned by `GET /admin/recurring-expenses/due`, sorted by `next_due_date` ascending.

Each row shows:
- Name and category
- Amount (formatted as currency)
- Due date — with an "Overdue" red badge if `next_due_date < today`
- **Log** button — calls `POST /{id}/log`, shows in-progress state while pending, removes the row on success

Loading, error, and empty ("Nothing due in the next 7 days") states all required.

No Skip action. Due expenses stay in the list until logged or the recurring expense is deactivated.

---

## Manage Recurring Expenses Screen (`/admin/recurring-expenses`)

Accessed via a "Recurring" button in the header of `AdminFinancesScreen` (not a separate admin home card).

Shows a list of all recurring expenses (active first, then paused), each displaying:
- Name, amount, interval label (e.g. "Every 2 months"), next due date
- Active/paused toggle (calls PATCH `/{id}` with `is_active`)
- Edit button → opens edit form
- Delete button → confirm dialog, then DELETE `/{id}`

### Create / Edit Form

Fields:
- Name (required, text)
- Category (required, text — consistent with finance transaction categories)
- Amount in dollars (required, number input — stored as cents)
- Payment method (optional, text)
- Vendor / customer (optional, text)
- Description (optional, textarea)
- Interval: number input + unit select (`days` / `weeks` / `months`)
- Next due date (required, date picker)
- City (if admin has access to multiple cities)

---

## In-App Calendar Integration

Recurring expense due dates appear on the existing calendar screen as read-only entries, visually distinct from jobs:
- Purple/amber color (not the green/blue used for jobs)
- Dollar sign icon
- Label: expense name + formatted amount
- Tapping shows a read-only detail popover (name, amount, category, due date) — no editing from the calendar

The calendar fetches recurring expenses from `GET /admin/recurring-expenses?is_active=true` and renders each `next_due_date` as a calendar item. Admin role only.

---

## Google Calendar Integration

Uses the existing Google Calendar integration (same credentials and calendar as jobs).

| Event | GCal action |
|---|---|
| Recurring expense created | Create event on `next_due_date`. Store event ID in `google_calendar_event_id`. |
| Recurring expense edited (name or date changes) | Update existing event. |
| Recurring expense logged | Delete current event. Create new event on new `next_due_date`. Update `google_calendar_event_id`. |
| Recurring expense deactivated (`is_active = false`) | Delete pending event. Clear `google_calendar_event_id`. |
| Recurring expense reactivated | Create new event on current `next_due_date`. |
| Recurring expense deleted | Delete pending event. |

GCal sync failures are non-fatal: log the error, continue the operation. Don't block logging a transaction because GCal is unavailable.

**Event format:**
- Title: expense name (e.g. "Truck insurance")
- Description: amount + category + "Recurring expense"
- Date: all-day event on `next_due_date`

---

## UX Requirements

1. Admin home card shows due count badge when > 0; no badge when 0.
2. Due list shows "Overdue" badge on rows where `next_due_date < today`.
3. Log button shows in-progress state ("Logging…") while the mutation is pending.
4. Row disappears from the due list immediately on successful log.
5. Due list shows empty state: "Nothing due in the next 7 days."
6. Due list shows loading and error states.
7. Manage screen: active/paused toggle is immediate with optimistic update.
8. Delete requires confirmation before calling the API.
9. Edit form pre-populates all current values.
10. Interval label in the list displays as human-readable text ("Every 2 months", "Every week", "Every 14 days").
11. GCal sync failures are shown as a non-blocking warning toast — the transaction is still logged.
12. In-app calendar entries are read-only — no editing from the calendar.

---

## File Map

**Create:**
- `app/backend/app/models/recurring_expense.py`
- `app/backend/app/schemas/recurring_expense.py`
- `app/backend/app/routers/recurring_expenses.py`
- `app/backend/tests/test_recurring_expenses.py`
- `app/frontend/src/types/recurringExpense.ts`
- `app/frontend/src/hooks/useRecurringExpenses.ts`
- `app/frontend/src/screens/AdminRecurringExpensesScreen.tsx`
- `app/frontend/src/screens/AdminDueExpensesScreen.tsx`

**Modify:**
- `app/backend/main.py` — model import, migration, router registration
- `app/frontend/src/App.tsx` — two new routes
- `app/frontend/src/screens/AdminScreen.tsx` — Recurring card with due badge
- `app/frontend/src/screens/AdminFinancesScreen.tsx` — "Recurring" button in header
- `app/frontend/src/screens/CalendarScreen.tsx` (or equivalent) — render recurring expense due dates
