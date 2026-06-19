# Calendar Sync Without Crew — Design Spec

**Date:** 2026-06-18
**Status:** Approved direction (A), pre-implementation
**Author:** Ron + Claude

## Problem

Google Calendar sync is fully built (`calendar_service.py`: OAuth refresh token per city → events on the connected Holy Hauling account's `primary` calendar). But job events only reach the calendar when **crew with Google emails are assigned as attendees**:

- `_insert_event_or_raise`: `if not crew_emails: return None` — no crew, no event.
- `sync_job_calendar` (auto, fired on crew assign/unassign in `jobs.py`): creates only when crew present; **deletes** the event when crew is removed.
- `sync_job_calendar_now` (manual `POST /jobs/{id}/sync-google`): returns **409** "Assign at least one crew member with a Google email before syncing this job."
- The booking path (`lead_service.update_lead`, auto-books on `job_address` entry) re-syncs only when `lead.google_calendar_event_id` is **already** set — so booking never *creates* an event.

Net effect: a booked job with no assigned crew never appears on the calendar. Recurring-expense events already sync to the same calendar with no attendees, proving attendee-less events are fine.

## Goal

A booked, dated job syncs to the Holy Hauling Google Calendar **automatically, regardless of crew**. Crew become **optional attendees**, not a precondition. Removing crew updates the event's attendees; it no longer deletes the event.

## Changes

### `calendar_service.py`

1. **`_insert_event_or_raise`** — remove the `if not crew_emails: return None` gate. Create the event with `attendees = crew_emails` (may be empty; `_build_event_body` already renders `attendees: []` cleanly). Keep the `service is None → None` (not-connected) guard.

2. **`sync_job_calendar`** (fire-and-forget) — rewrite so the event tracks the *booked + dated* state, independent of crew:
   - Load lead; gather `crew_emails` (may be empty).
   - **Eligible** = `lead.status == LeadStatus.booked and lead.job_date_requested is not None`.
   - If not eligible → no-op (leave any existing event untouched). *(Removing the previous delete-on-no-crew behavior; cancellation-driven deletion is out of scope.)*
   - If eligible and `google_calendar_event_id` set → `update_event(...)` (refreshes details + attendees, possibly empty).
   - If eligible and no event → `create_event(...)`; on success store `google_calendar_event_id` and commit.
   - Requires importing `LeadStatus` (currently only `Lead` is imported).

3. **`sync_job_calendar_now`** (manual) — remove the crew-emails 409 block. Keep the not-connected 503 and the needs-a-date 409. Create/update with `crew_emails` as-is (may be empty).

### `lead_service.py` (`update_lead`)

The calendar trigger currently fires only when an event already exists:

```python
if lead.google_calendar_event_id and any(f in _CALENDAR_FIELDS for f in changed):
```

Change the gate so booking itself creates the event (booking sets `job_address`, which is in `_CALENDAR_FIELDS`):

```python
if lead.status == LeadStatus.booked and any(f in _CALENDAR_FIELDS for f in changed):
```

`sync_job_calendar` then handles create-vs-update. `LeadStatus` is already imported in `lead_service`.

### Frontend

No change required: the "Sync to Google" button calls `POST /jobs/{id}/sync-google`, which now succeeds without crew. (If the button's UI hard-codes a "assign crew first" message, soften it — verify during implementation; not expected.)

## Out of scope

- Deleting the calendar event when a booking is cancelled (`booked → lost`) — no such delete exists today; tracked separately if wanted.
- Pulling Google Calendar events *into* the app (this is push-only, app → Google).
- Changing which Google account is connected (the existing per-city OAuth flow is unchanged; "the Holy Hauling gmail" = whatever account was connected in Settings).

## Testing (`test_calendar_service.py`)

- **Replace** `test_create_event_empty_emails_returns_none` with a test that empty `crew_emails` + mocked Google **creates** an event (returns an id).
- `_build_event_body(lead, [], tz)` → `body["attendees"] == []`.
- `sync_job_calendar`: a booked + dated lead with **no crew** and no existing event → creates an event and sets `google_calendar_event_id` (Google mocked).
- `sync_job_calendar`: a **non-booked** (or dateless) lead → no event created, `google_calendar_event_id` stays None.
- `sync_job_calendar`: removing crew on a lead that already has an event → **updates** (does not delete) the event.
- `sync_job_calendar_now`: connected + dated + **no crew** → returns `ok=True` and creates the event (no 409).
- Keep all existing `_build_event_body` / create / update / delete tests green.
