# Crew Agenda (My Schedule) — Design Spec

**Date:** 2026-06-19
**Status:** Approved direction, pre-implementation
**Author:** Ron + Claude

## Problem

Crew see their assigned jobs spread across three surfaces that overlap heavily for someone who works one job at a time and has only a few jobs a day:
- **Jobs tab** — Scheduled / In-Progress / Completed sub-tabs, with the working controls (phases, photos, notes).
- **Calendar tab** — a week/month grid of the same jobs, plus office clutter (city switcher, recurring expenses, calendar-sync status).

Two problems fall out: (1) the single most important thing — the job a crew member is *working right now* — is hidden behind the "In-Progress" tab, easy to overlook; (2) three views of the same 3-4 jobs is needless nav complexity for crew.

## Goal

For **crew**, make the **Jobs tab a single agenda**: the active job pinned at the top (impossible to miss), then their upcoming jobs grouped by day, with Completed history one tap away. Remove the Calendar tab from crew's nav. Crew end up with two tabs — **Jobs** (their day) and **Settings** (their stuff). Office roles (admin / facilitator / supervisor) are unchanged.

This is **frontend-only** — it reuses existing endpoints (`GET /jobs` and `GET /jobs?status=completed`, already crew-scoped) and the existing job-detail/working modal.

## Architecture

### Role-conditional Jobs screen

`JobsScreen.tsx` branches by role:
- **Crew** → the new **agenda** view (below).
- **admin / facilitator / supervisor** → the existing Scheduled / In-Progress / Completed phase view, **unchanged**.

The screen already fetches role-scoped data via `useJobs()` (crew → only their assigned booked jobs) and `useJobs('completed')`, and opens the existing working modal via `setSelectedJob(job)`. The agenda is a new *presentation* over that same data and modal — no new endpoint, no new detail screen.

### The crew agenda

A small **Upcoming / Completed** segmented toggle at the top (replacing the crew's Scheduled / In-Progress / Completed tabs).

**Upcoming** (default) renders, in order, only the sections that have jobs:
1. **▸ Active now** — pinned, visually emphasized card(s) for the crew's in-progress job(s) (any job where work has begun, i.e. `job_phase != null` / a phase timestamp is set). Shows customer, service, "on site / started <time>", address, and a prominent **Continue job** action. Usually exactly one.
2. **Today** — remaining jobs with `job_date_requested` == today that aren't already in Active now.
3. **Tomorrow** — `job_date_requested` == tomorrow.
4. **This week** — after tomorrow, through the end of the current calendar week.
5. **Later** — beyond this week.
6. **Unscheduled** — booked jobs with no `job_date_requested` (defensive; booking normally sets one).

Within a day, sort by `appointment_time_slot` (timed jobs ascending; "All day" / no-slot jobs after the timed ones). Each non-active row: time (or "All day"), customer + service type, address with a tap-to-navigate (Google Maps, the existing pattern), and a chevron; tapping the row opens the working modal (`setSelectedJob`). The Active-now card's **Continue job** does the same.

**Completed** renders the read-only completed-jobs list already built (the `realized_revenue_cents` / `completed_at` cards + header total), reusing `useJobs('completed')`.

No header city switcher, expenses, or sync controls.

### Date bucketing

A small pure helper (e.g. `bucketJobsByDay(jobs, now)` in a utils module) maps each job to one of `active | today | tomorrow | this_week | later | unscheduled` using `job_date_requested` (and `job_phase` for active), returning ordered groups. Pure and unit-testable; "today/tomorrow/week" computed from the local date. Active membership is decided first (a started job is "active" regardless of its date).

### Navigation change

`BottomNav.tsx` `NAV_ITEMS`: remove `'crew'` from the **Calendar** item's `roles` (office roles keep it). Crew nav becomes **Jobs + Settings** (Admin/Queue were already office-only). Ensure crew's post-login landing is `/jobs` (it already is, or redirect there if not — confirm in implementation).

## Data flow

```
Crew opens app -> Jobs tab (their landing)
  Upcoming:  useJobs()            -> bucketJobsByDay -> Active now (pinned) + Today/Tomorrow/This week/Later/Unscheduled
  Completed: useJobs('completed') -> existing completed cards + total
  tap row / Continue job -> setSelectedJob(job) -> existing working modal (phases/photos/notes)
Calendar tab hidden from crew nav (office roles keep it).
```

## Error / empty states

- No upcoming jobs at all → "No upcoming jobs scheduled."
- No active job → the Active-now section simply doesn't render.
- A booked job missing `job_date_requested` → Unscheduled bucket (still tappable).
- Completed empty → existing "No completed jobs yet."

## Testing

**Frontend:**
- `bucketJobsByDay` unit tests: a started job → `active` regardless of date; date == today → `today`; tomorrow → `tomorrow`; later-this-week → `this_week`; next week → `later`; null date → `unscheduled`; within-day ordering by `appointment_time_slot` with all-day last.
- Build green with the role-conditional render + the trimmed nav.
- (Manual/structural) office roles still see the existing Scheduled/In-Progress/Completed view; crew see the agenda; Calendar tab absent for crew.

**Backend:** none — endpoints unchanged (existing `GET /jobs` crew-scoping tests cover the data).

## Out of scope

- Any change to the office (admin/facilitator/supervisor) Jobs or Calendar experience.
- A new backend endpoint or new job fields (reuses what exists).
- Distance/ETA on rows, crew-mate names, push reminders (possible later; not now).
- The other two crew features (pay & hours, per-job checklist) — separate spec → plan cycles.
