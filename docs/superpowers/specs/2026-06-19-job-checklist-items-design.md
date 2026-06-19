# Per-Job Checklist — Items to Bring — Design Spec

**Date:** 2026-06-19
**Status:** Approved direction, pre-implementation
**Author:** Ron + Claude

## Problem

Crew show up to jobs without the right gear — the wrong dolly for a stairs-heavy move, too few blankets for a 4-bed, no truck on a job that needed one. The app captures rich job scope (`move_size_label`, `load_stairs`/`unload_stairs`, `move_type`, `service_type`) but never turns it into a concrete "bring this" list. Nothing helps crew prep before they roll out.

This is crew-assist feature #3 (after the crew agenda and My Pay). It is an **"items to bring" checklist**, per job, seeded automatically from the job's scope, owned and edited by the crew working the job.

## Goal

For each booked job, give crew a checkable **Items to bring** list inside their working modal: seeded once from a configurable standard kit plus smart scope-based extras, then fully crew-editable (check, add, remove). Office can configure the standard kit (the always-bring base list) in Settings; the scope-based extras stay automatic.

Decisions locked during brainstorming:
- **Scope:** items to bring (equipment/supplies), not a general task checklist. Work *phases* (dispatched→en_route→arrived→started) already cover "what to do."
- **Ownership:** crew-owned. The assigned crew check/uncheck, add, and remove items on their own job. No per-job office curation step.
- **Seeding:** seed once, lazily, on first open of a **booked** job's checklist; tracked by a per-lead marker so it never silently repopulates after crew edits.
- **Configurability:** the **standard kit** (base always-bring list) is editable in Settings (office/admin). The conditional scope rules stay in code.

## Architecture

### Data model

**New table `lead_checklist_item`** (one row per item per lead; mirrors the existing per-lead child pattern such as `screenshots`):

| Column | Type | Notes |
|---|---|---|
| `id` | String PK | uuid default |
| `lead_id` | String FK → `leads.id` | `nullable=False` |
| `label` | String | `nullable=False` — the item text |
| `is_checked` | Boolean | `nullable=False, default=False` |
| `source` | String | `nullable=False, default="custom"` — one of `standard` \| `scope` \| `custom`; drives the UI tag |
| `sort_order` | Integer | `nullable=False, default=0` — display order |
| `created_at` | DateTime | default now (UTC) |
| `updated_at` | DateTime | default now (UTC) |

`Lead` gains a relationship `checklist_items` (cascade like other children) and **one new column** `checklist_seeded_at` (`DateTime`, nullable) — the "seeded exactly once" marker. A startup migration in `main.py` adds the column to existing DBs (`_existing_columns` guard, matching the established migration pattern).

**Standard kit config** is stored as an `AppSetting` row, key `checklist_standard_kit`, value a JSON array of strings. A module-level `DEFAULT_STANDARD_KIT` constant is used when the setting is absent or empty:

```
Moving blankets, Furniture dolly, Hand truck, Ratchet straps, Shrink wrap,
Packing tape, Basic tool kit, Floor runners, Work gloves
```

### Seeder

`app/backend/app/services/checklist_service.py`:

- `get_standard_kit(db) -> list[str]` — read the `checklist_standard_kit` AppSetting (JSON-decoded), falling back to `DEFAULT_STANDARD_KIT`. Tolerant of malformed/empty values (returns the default).
- `set_standard_kit(db, items: list[str]) -> list[str]` — upsert the AppSetting (JSON-encoded). Strips blanks and de-dupes preserving order.
- `scope_items(lead) -> list[str]` — pure function returning the conditional extras from the lead's scope (see rules below). No DB.
- `seed_checklist(db, lead) -> None` — if `lead.checklist_seeded_at is not None`, no-op (idempotent). Otherwise build the ordered item list — standard kit first (`source=standard`), then scope extras not already present (`source=scope`) — assign incrementing `sort_order`, insert rows, set `lead.checklist_seeded_at = now`, commit. Caller decides *when* to seed (the GET endpoint gates on `booked`).

**Conditional scope rules** (`scope_items`), keyed on the real field types (`service_type` is the `ServiceType` enum `moving`/`hauling`/`both`/`unknown`; `move_type`/`move_size_label` are free strings; stairs are integers). Matching is keyword/threshold-based and defensive against nulls:

| Signal | Adds |
|---|---|
| `service_type` in (`moving`, `both`) | `Mattress bags`, `Wardrobe boxes` |
| `service_type` in (`hauling`, `both`) | `Contractor/disposal bags`, `Junk bins` |
| `(load_stairs or 0) > 0` or `(unload_stairs or 0) > 0` | `Stair-climbing hand truck`, `Extra straps` |
| `move_size_label` implies 3+ bedrooms or a house (keyword scan: contains "house", or a digit ≥ 3 before "bed") | `Extra blankets (large move)` |
| `move_type` does **not** indicate labor-only / customer-truck (i.e. we bring the truck); treat null/empty as "we bring the truck" | `Company truck — fuel & equipment check` |

Duplicate labels across standard + scope are de-duped (case-insensitive) so a scope item already in the standard kit isn't added twice.

### Endpoints

Per-lead checklist routes follow the existing per-lead router pattern (e.g. `payroll.lead_router`, lead notes). New router module `app/backend/app/routers/checklist.py`, mounted in `main.py`:

- `GET /leads/{lead_id}/checklist` → `list[ChecklistItemOut]`. Loads the lead (404 if missing). If `checklist_seeded_at is None` **and** `lead.status == LeadStatus.booked`, call `seed_checklist`. Return items ordered by `(sort_order, created_at)`. Non-booked, not-yet-seeded lead → returns `[]` without seeding. `require_auth`.
- `POST /leads/{lead_id}/checklist` body `{label: str}` → `ChecklistItemOut`. Appends a `source=custom` item with `sort_order` = max+1, `is_checked=False`. Rejects blank label (422). `require_auth`.
- `PATCH /leads/{lead_id}/checklist/{item_id}` body `{is_checked?: bool, label?: str}` → `ChecklistItemOut`. Updates the provided fields; bumps `updated_at`. 404 if the item isn't on that lead. `require_auth`.
- `DELETE /leads/{lead_id}/checklist/{item_id}` → `{deleted: true}`. 404 if not found. `require_auth`.

**Standard kit config** (office-managed): `GET /settings/checklist-kit` → `{items: list[str]}` (`require_auth`); `PUT /settings/checklist-kit` body `{items: list[str]}` → `{items: list[str]}`, gated `require_role("admin", "facilitator")`. Implemented in the existing settings router (or a small dedicated router) using `checklist_service.get_standard_kit` / `set_standard_kit`.

### Schemas

`app/backend/app/schemas/checklist.py`:
- `ChecklistItemOut` — `id, lead_id, label, is_checked, source, sort_order, created_at (str), updated_at (str)`.
- `ChecklistItemCreate` — `label: str`.
- `ChecklistItemUpdate` — `is_checked: bool | None = None`, `label: str | None = None`.
- `StandardKitOut` / `StandardKitUpdate` — `items: list[str]`.

### Frontend

- `app/frontend/src/hooks/useChecklist.ts` — `useChecklist(leadId)` query (`['checklist', leadId]`) + `useAddChecklistItem`, `useToggleChecklistItem`, `useDeleteChecklistItem` mutations with **optimistic** cache updates and rollback on error.
- `app/frontend/src/components/JobChecklist.tsx` — rendered inside the crew working modal (the shared `JobModal` opened from `JobsScreen`). Progress header (`<checked>/<total> packed` + a progress bar), rows (tap-to-toggle checkbox, label, `scope`/`added` tag for `source` ≠ `standard`, delete control), and an add-item input row. Read-only-safe when `leadId` is absent.
- `app/frontend/src/hooks/useStandardKit.ts` + `app/frontend/src/components/StandardKitEditor.tsx` — Settings editor (add/remove items, Save → `PUT /settings/checklist-kit`), rendered in `SettingsScreen` **only for admin/facilitator** (role-guarded). Includes loading/saving/empty states.
- `app/frontend/src/services/api.ts` — `ChecklistItem` type, `StandardKit` type, and fetchers.

### Action states (write operations)

Per the project's all-three-states rule, every write ships with in-progress + success + failure handling in the same pass:
- **Toggle check:** optimistic flip in cache → persist → on success keep; on failure revert + error toast.
- **Add item:** optimistic append (temp row) → on success replace with server row; on failure remove + error toast.
- **Delete item:** optimistic removal → on failure re-insert + error toast.
- **Standard kit Save:** in-progress "Saving…" on the button → success confirmation → failure keeps edits + error message.

## Data flow

```
Crew opens a booked job -> JobModal -> GET /leads/{id}/checklist
   first time (booked, not seeded): seed_checklist(standard kit + scope_items) -> persist, stamp checklist_seeded_at
   -> render progress + rows
   toggle/add/delete -> optimistic cache update -> PATCH/POST/DELETE -> reconcile / rollback

Office opens Settings (admin/facilitator) -> Standard kit editor
   GET /settings/checklist-kit -> edit -> PUT /settings/checklist-kit
   -> future jobs seed from the updated kit (already-seeded jobs unchanged)
```

## Error / empty states

- Lead not booked and not yet seeded → `GET` returns `[]`; UI shows "Checklist opens once the job is booked."
- Seeded then all items deleted → empty list; UI shows "No items — add what you need." with the add row.
- Toggle / add / delete failure → optimistic rollback + error toast.
- Standard-kit setting missing or malformed → `get_standard_kit` returns `DEFAULT_STANDARD_KIT`.
- Empty standard kit configured → seeding adds only scope items (still valid).
- Add with blank label → 422; UI disables Add for empty input.

## Testing

### Backend (pytest)

- `scope_items`: stairs > 0 (either end) adds the stair dolly + extra straps; `service_type=moving` adds mattress/wardrobe; `hauling` adds disposal bags/junk bins; `both` adds both families; a "4 bedroom house" size adds large-move blankets while "studio" does not; `move_type="labor_only"` and `"customer_truck"` omit the truck item while null/`"our_truck"` include it.
- `seed_checklist` idempotency: first call on a booked lead creates standard + scope items and stamps `checklist_seeded_at`; a second call is a no-op (count unchanged) even after items are deleted.
- De-dup: a label present in both the standard kit and scope appears once.
- `GET /leads/{id}/checklist`: first call on a **booked** lead seeds and returns items ordered by `sort_order`; on a **non-booked** lead returns `[]` and does not seed (marker stays null).
- `POST` appends a `custom` item with the next `sort_order`; blank label → 422.
- `PATCH` toggles `is_checked` and renames; wrong lead/item → 404.
- `DELETE` removes the item; missing → 404.
- Standard kit: `GET /settings/checklist-kit` returns the default when unset; `PUT` as admin/facilitator persists and round-trips; `PUT` as crew → 403.

Use the `client` fixture (mock admin) for seed/CRUD and the `crew_client` pattern where crew-role behavior matters; seed leads/items via the session factory, mirroring existing tests.

### Frontend

- `tsc && vite build` green with the new hooks, components, and Settings wiring.
- (Structural) progress header computes `checked/total`; optimistic toggle updates immediately; `scope`/`added` tags render by `source`; empty + not-booked states render; the Standard kit editor shows only for admin/facilitator. No JS test runner exists — verification is type-check + build plus backend contract tests; visual confirmation is manual.

## Out of scope

- A general task/to-do checklist (steps), reminders, or notifications — items to bring only.
- Fully configurable conditional rules / a rules editor (the "B" option) — only the standard kit is configurable now.
- Re-seeding or a "Reset to scope" button — seeding is once-only; deferred.
- Per-item quantities as structured data (crew can write "(×6)" in the label) — no quantity field.
- Office per-job curation of individual job lists — crew-owned; office configures only the standard kit.
- Sharing/sync of check state semantics beyond a boolean (no "loaded vs staged").
