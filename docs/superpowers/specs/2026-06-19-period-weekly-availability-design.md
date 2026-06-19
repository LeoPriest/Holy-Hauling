# Period-Level Weekly Availability — Design Spec

**Date:** 2026-06-19
**Status:** Approved, pre-implementation
**Author:** Ron + Claude

## Problem

Crew set recurring weekly **blocks** (unavailability) via `UserWeeklyAvailability` — one row per `(user_id, weekday)`, meaning "blocked all day this weekday." There's no way to block only part of a day. Ron wants morning / afternoon / evening granularity so a crew member can block, say, Monday morning while staying open Monday afternoon and evening.

(Note the existing naming: the model is `UserWeeklyAvailability` but a row means *blocked/unavailable* — the Settings UI labels selected slots "Currently blocked" and the admin list maps them to `unavailable_weekdays`. This spec keeps that "a row = a block" semantic; it does not rename anything.)

## Scope

- **Weekly recurring grid only** (`UserWeeklyAvailability`). Per-date blackouts (`UserAvailability.unavailable_on`) stay whole-day — out of scope.
- Admin rollup stays **coarse**: a weekday is reported unavailable only when all three periods are blocked.
- Periods are **labels only** — no specific hour ranges.

## Architecture

### Data model — `UserWeeklyAvailability`

Add a `period` column (`String`, values `"morning"` | `"afternoon"` | `"evening"`). The unique constraint changes from `(user_id, weekday)` to `(user_id, weekday, period)`. A blocked slot is one row per period.

**Migration** (`main.py`, startup, idempotent — rename-recreate-copy, the pattern `_migrate_app_settings_city_scope` already uses; runs **before** `create_all`):
1. `PRAGMA table_info(user_weekly_availability)` — if a `period` column already exists, return (no-op).
2. If the table doesn't exist yet, return (fresh DB; `create_all` builds the new shape).
3. Otherwise: rename the table to `_user_weekly_availability_old`; `CREATE TABLE user_weekly_availability` with the `period` column and `UNIQUE(user_id, weekday, period)`; **expand** each old row into three rows (one per period) via `INSERT ... SELECT ... CROSS JOIN (SELECT 'morning' ... UNION 'afternoon' ... UNION 'evening')`, deriving a unique `id` per new row (e.g. `old.id || '-' || period`); `DROP TABLE _user_weekly_availability_old`.

Existing all-day blocks are preserved exactly (all-day = all three periods).

### Constants

`PERIODS = ("morning", "afternoon", "evening")` (define once, in the model module; reused by validation + migration). `_WEEKDAY_ORDER` already exists in `users.py`.

### API — `/users/me/weekly-availability`

The exchange shape changes from `{weekdays: [...]}` to a **weekday → blocked-periods map**:

```json
{ "blocks": { "monday": ["morning"], "sunday": ["morning", "afternoon", "evening"] } }
```

Schemas (`schemas/user.py`):
- `UserWeeklyAvailabilityOut(blocks: dict[str, list[str]])`
- `UserWeeklyAvailabilityUpdate(blocks: dict[str, list[str]])`

- **`GET`** — load the user's rows, group into `{weekday: [periods]}` (periods ordered morning→afternoon→evening; weekdays only present when they have ≥1 block).
- **`PUT`** — validate every weekday is one of the seven and every period ∈ `PERIODS` (reject with 422/400 otherwise); delete the user's existing rows; insert one row per `(weekday, period)` in the payload; return the normalized `GET` shape. An absent weekday or empty list = nothing blocked that day.

### Admin rollup (coarse)

`UserListItem.unavailable_weekdays` keeps its shape (a list of weekday strings). In the user-list endpoint, build per user a `weekday -> set(periods)` map; a weekday qualifies as unavailable only when `len(periods) == 3` (all three blocked). Partial-day blocks do not appear as full-day unavailability.

### Frontend — `SettingsScreen.tsx` + `hooks/useAvailability.ts` + `types`

- The single row of day toggles becomes a **7-row × 3-column grid** (days × morning/afternoon/evening). Each cell is a toggle with a ≥44px tap target (tablet-first). A selected (highlighted) cell = blocked.
- Local state holds the set of blocked `(weekday, period)` cells; Save issues `PUT { blocks }`; the hook's types change from `WeekdayKey[]` to the blocks map.
- "Currently blocked" summary renders per day (e.g. "Mon: morning", "Sun: all day"). "Clear all" stays (empties the grid).
- All three action states on Save: in-progress ("Saving…"), success ("Saved"), failure (inline error) — already present; preserve them.

## Data flow

```
Settings grid toggle -> local blocks state
Save -> PUT /users/me/weekly-availability { blocks: {weekday: [periods]} }
   -> validate -> delete user's rows -> insert one row per (weekday, period) -> return blocks map
GET /users/me/weekly-availability -> rows grouped into { blocks: {weekday: [periods]} }
admin GET /users -> per user, weekday unavailable iff all 3 periods blocked
```

## Error handling

- `PUT` with an invalid weekday or period → 422 (Pydantic) / 400 with a clear message; no rows changed.
- Empty `blocks` (or `{}`) → clears all of the user's weekly blocks (valid).
- Migration is idempotent (guarded on the `period` column) and preserves data; running twice is safe.

## Testing

**Backend:**
- Migration: a pre-existing `(user, weekday)` row (no period) expands into exactly three period rows for that weekday; running the migration twice is a no-op; a fresh DB needs no migration.
- `GET` returns the `{blocks: {weekday: [periods]}}` map, periods ordered, only weekdays with blocks present.
- `PUT` replaces: adding `{monday: [morning]}` then `{monday: [morning, evening]}` yields exactly those; an empty payload clears all.
- `PUT` validation rejects an unknown weekday and an unknown period (no partial write).
- Admin user-list: a user with all three Monday periods blocked → `monday` in `unavailable_weekdays`; with only `morning` blocked → `monday` absent.

**Frontend:**
- `tsc --noEmit` + `npm run build` green with the new grid + blocks-map types.

## Out of scope

- Hour ranges for the periods (labels only).
- Period granularity on per-date blackouts (`UserAvailability`).
- Period detail in the admin list / assignment UI (coarse full-day rollup only).
- Enforcing availability in crew assignment (the data is displayed, not enforced — unchanged).
