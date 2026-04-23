# CHANGELOG

All meaningful development changes for the Holy Hauling app are logged here.

---

## [2026-04-20] Slice 8 — Move Detail Fields + Thumbtack Contact Flow

### Added
- **9 new lead columns**: `move_distance_miles`, `load_stairs`, `unload_stairs`, `move_size_label`, `move_type`, `move_date_options`, `accept_and_pay`, `contact_status`, `acknowledgment_sent`
- **Startup migration** `_migrate_leads_add_v8_columns`: idempotent `ALTER TABLE ADD COLUMN` for all 9 columns
- **Contact lock/unlock logic** in `lead_service.update_lead()` and `ocr_service.apply_ocr_fields()`:
  - Lead created with `accept_and_pay=True` → `contact_status='unlocked'` immediately
  - PATCH `acknowledgment_sent=True` on non-accept_and_pay lead → `contact_status='unlocked'`
  - Phone set on any unlocked lead (via PATCH, OCR apply, or any future path) → `acknowledged_at` auto-set + `acknowledged` event logged
  - Phone set on locked lead → no acknowledgment (contact still locked)
  - `accept_and_pay` applied via OCR → `contact_status='unlocked'`
- **`source_category_label`** computed field on `LeadOut`: maps `source_type` enum to human-readable label (e.g. `"Thumbtack Screenshot"`); no DB column
- **Expanded OCR extraction**: 7 new fields added to `_EXTRACTION_PROMPT` and `_APPLICABLE_FIELDS`: `move_size_label`, `move_type`, `move_distance_miles`, `load_stairs`, `unload_stairs`, `move_date_options`, `accept_and_pay`
- **`move_date_options` handling**: comma-separated OCR string converted to JSON array on apply; stored as JSON TEXT; returned as `list[str]`
- **Revised LeadDetail layout** — Intake / Job Details / Scope & Access:
  - Intake: source label, Accept & Pay badge, contact lock message, acknowledgment-sent checkbox, phone lock state
  - Job Details: move size, move type, distance (`~N mi`), origin→destination, date chips (from `move_date_options`), assigned handler
  - Scope & Access: load stairs, unload stairs, scope notes
- **Edit form extended**: move size (select), move type (select), distance (number), load/unload stairs (numbers), date options (comma-separated text), urgency, handler, notes
- 15 new tests: 10 in `test_leads.py`, 5 in `test_ocr.py`

### Changed
- `_PROVENANCE_FIELDS` in both `lead_service.py` and `ocr_service.py`: added `move_size_label`, `move_type`, `move_distance_miles`, `load_stairs`, `unload_stairs`, `move_date_options`
- `LeadCreate`, `LeadUpdate`, `LeadOut` schemas: all 9 new columns + `source_category_label`
- `OcrApply` schema: 7 new applicable fields
- `create_lead()`: serializes `move_date_options` list → JSON; sets `contact_status` from `accept_and_pay`
- `update_lead()`: serializes `move_date_options`; adds contact flow triggers
- `LeadDetail.tsx` "Scope" section → "Scope & Access"; Intake and Job Details sections expanded

### Notes
- `contact_status` is system-managed — never directly settable by the user via PATCH
- Phone auto-acknowledge fires once (`acknowledged_at is None` guard — idempotent with existing `/acknowledge` endpoint)
- Old DB rows get `contact_status='locked'` via migration DEFAULT; facilitators can unlock via acknowledgment_sent checkbox

### Verified
- 108/108 tests passing (93 carried over + 15 new)

---

## [2026-04-20] Slice 7 — Field Expansion + Intake Layout

### Added
- **3 new lead fields**: `job_origin`, `job_destination`, `scope_notes` — captured from screenshots and editable via PATCH
- **`field_sources` column**: JSON dict tracking per-field provenance (`"ocr"` / `"edited"`; absence = manually entered)
- **Startup migration** `_migrate_leads_add_v7_columns`: adds all 4 columns via `ALTER TABLE ADD COLUMN` on existing DBs (idempotent)
- **Expanded OCR prompt**: extraction now requests `job_origin`, `job_destination`, `scope_notes` (operational summary: stairs/elevator, heavy items, access/parking) in addition to the existing 6 fields
- **Field provenance tracking**: `apply_ocr_fields()` marks applied fields as `"ocr"` in `field_sources`; `update_lead()` marks manually changed fields as `"edited"`
- **LeadDetail layout — three sections**: Intake (name, phone+call/text, urgency, source, handler) / Job Details (service type, origin→destination or location, date) / Scope (scope_notes)
- **`FieldSourceBadge` component**: subtle `[ocr]` (blue) / `[edited]` (green) inline badges on key fields only (name, phone, service type, location/origin/destination, date, scope_notes)
- **"Not captured" states**: origin, destination, scope_notes, phone, and date show gray italic placeholder when null
- **Origin → Destination display**: renders as `123 Main St → 456 Oak Ave` when both present; falls back to `job_location`; falls back to "not captured"
- 7 new tests: `test_create_lead_with_v7_fields`, `test_patch_v7_fields`, `test_patch_sets_field_sources_edited`, `test_v7_fields_default_null`, `test_extraction_returns_v7_fields`, `test_apply_v7_fields_updates_lead`, `test_apply_sets_field_sources_ocr`

### Changed
- `LeadCreate`, `LeadUpdate`, `LeadOut` schemas: add `job_origin`, `job_destination`, `scope_notes`, `field_sources`
- `OcrApply` schema: add `job_origin`, `job_destination`, `scope_notes`
- `_APPLICABLE_FIELDS` in `ocr_service.py`: 6 → 9 fields
- `LeadDetail.tsx`: Contact section replaced by Intake / Job Details / Scope; Edit form expanded to cover all new fields; `FieldSourceBadge` added; "not captured" placeholders added; standalone Assigned Handler editor removed (already subsumed by edit form in Slice 6)
- `Lead` and `LeadUpdate` TypeScript interfaces: 4 new fields

### Notes
- `scope_notes` is an operational sentence synthesized by OCR: stairs/elevator, bulky/heavy items, access/parking issues, assembly needs. Not a free-text dump.
- `field_sources` only tracks the *last* write source per field — consistent with existing overwrite behavior on re-extraction
- `job_location` is kept as a fallback for hauling jobs and for records predating Slice 7

### Verified
- 93/93 tests passing (86 carried over + 7 new)

---

## [2026-04-20] Slice 6 — Facilitator Usability: A–O Review + Lead Controls

### Added
- **A–O AI review structure** (15 sections, up from 8): grouped into Action-first (A–E), Pricing & Control (F–L, internal-only), Support & Context (M–O)
- `_BUILTIN_GROUNDING` extended with definitions for all 7 new Pricing & Control concepts (Pricing Band, Band Position, Friction Points, Sayability Check, Quote Style, Quote Source Label, Internal Pricing Guidance)
- `DELETE /leads/{lead_id}` — hard delete with 204 response; cascades children via explicit SQL DELETEs (ocr_results → screenshots → lead_events → ai_reviews → lead)
- `delete_lead()` in `lead_service.py`
- `deleteLead()` in `api.ts`; `useDeleteLead()` hook in `useLeads.ts`
- **Grouped AI review UI** in `LeadDetail.tsx`: three labeled groups with "Pricing & Control — Internal only" rendered orange
- **Tap-to-call / tap-to-text** on customer phone number (`tel:` and `sms:` links)
- **Edit Lead form** in `LeadDetail.tsx`: inline form covering all 8 `LeadUpdate` fields (name, phone, service type, location, date, urgency, handler, notes); replaces the old standalone "Assigned Handler" editor
- **Actions section** at the bottom of LeadDetail: Archive (Release) button + Delete Permanently button (guarded by `window.confirm`)
- Legacy A–H → A–O key mapping in `_to_out()` (try/except ValidationError fallback) so old records remain readable
- 5 new tests: `test_delete_lead_success`, `test_delete_lead_not_found`, `test_delete_lead_removes_from_list`, `test_delete_lead_cascades`, `test_legacy_ah_record_readable`
- `cascade="all, delete-orphan"` added to all three Lead relationships in `models/lead.py`

### Changed
- `AiReviewSections` Pydantic schema: 8 fields → 15 fields (A–O); old 8-key records fall back via key mapping
- `_SYSTEM_PROMPT_TEMPLATE`: updated to request 15 A–O keys; "sections F–L are strictly internal" replaces "section G is strictly internal"
- `_USER_TEMPLATE`: "Run the A–H review" → "Run the A–O review"
- `AiReviewSections` TypeScript interface in `types/lead.ts`: 8 → 15 fields
- `test_ai_review.py`: `_VALID_SECTIONS` updated to all 15 A–O keys; affected test assertions updated
- Error message in `trigger_review`: "invalid A–H structure" → "invalid A–O structure"
- `LeadDetail.tsx`: "Assigned Handler" standalone section removed; subsumed by Edit Lead form

### Notes
- No DB migration needed: `sections_json` is TEXT; A–O JSON is simply larger; old records stay readable via fallback
- Hard delete is the right tool here — "released" status already serves as soft-archive with full audit trail
- Delete cascade order: ocr_results first (FK to screenshots), then screenshots, lead_events, ai_reviews, then the lead itself

### Verified
- 86/86 tests passing (81 carried over + 5 new)

---

## [2026-04-18] Recovery — AI Connection Layer (Markdown Fence Stripping)

### Fixed
- Claude (claude-haiku-4-5-20251001) wraps JSON responses in markdown code fences (` ```json ... ``` `) despite prompt instructions not to; `json.loads()` failed immediately at the backtick character with "Expecting value: line 1 column 1 (char 0)", causing all OCR extraction and AI review calls to return 502
- Added `_strip_fence()` to both `ocr_service.py` and `ai_review_service.py` to strip markdown fences before JSON parsing — both paths now work end-to-end with real Claude calls
- Frontend hardcoded "check ANTHROPIC_API_KEY / OCR_MODEL / AI_REVIEW_MODEL" error messages for any failure regardless of actual cause; updated to pass actual API error body through so errors are truthful
- `triggerExtraction` and `triggerAiReview` in `api.ts` were discarding the error body and only showing HTTP status code; updated to parse and re-throw the backend `detail` field

### Added
- `test_extraction_succeeds_when_response_wrapped_in_fence` in `test_ocr.py`
- `test_review_succeeds_when_response_wrapped_in_fence` in `test_ai_review.py`

### Verified live (2026-04-18)
- OCR extraction on real Thumbtack screenshot returns full `raw_text` and structured `fields`
- AI review returns valid A–H structure with `grounding_source: holy_hauling_app_sop_from_revised_pricing.md`
- 81/81 tests passing

---

## [2026-04-18] Recovery — Env Loading + DB Schema Migrations

### Fixed
- `load_dotenv()` was never called — all `.env` values (`ANTHROPIC_API_KEY`, `OCR_MODEL`, `AI_REVIEW_MODEL`, `AI_GROUNDING_FILE`) were absent at runtime; every AI call returned 503
- `load_dotenv(override=True)` added to `main.py` before any other imports so `.env` is always authoritative, even if a stale/empty system env var exists
- `OCR_MODEL` and `AI_REVIEW_MODEL` were set to `haiku-4.5` (invalid Anthropic model ID); corrected to `claude-haiku-4-5-20251001`
- `leads.customer_name` column had `NOT NULL` constraint in the live DB (schema from before Slice 5); `create_all` never alters existing tables, so screenshot ingest crashed with a constraint violation every time it tried to create a stub with `customer_name=None` — fixed via rename-recreate startup migration
- `screenshots.ocr_status` column was missing from the live DB (column added in Slice 3, but DB was created earlier); fixed via `ALTER TABLE screenshots ADD COLUMN ocr_status VARCHAR` startup migration
- `_load_grounding()` silently fell back to built-in when `AI_GROUNDING_FILE` was set but unreadable; changed to raise 503 so config errors are visible
- Added startup grounding-file validation (`_validate_grounding_file`) that prints OK or WARNING on boot

### Added
- `CHANGELOG.md` (this file)
- `CAPABILITIES.md`
- `python-dotenv>=1.0.0` to `requirements.txt`
- 3 new grounding tests in `test_ai_review.py`: missing file → 503, valid file → used correctly, no env var → built-in fallback

### Notes
- Startup migrations are idempotent — safe to run on every boot; they check the schema first and skip if already correct
- Both migrations run against the production DB on startup (and also against the in-memory test DB when the test lifespan fires — this is the existing behavior of the test harness)
- Model ID `claude-haiku-4-5-20251001` is used for both OCR and AI review; update `.env` if a different tier is preferred

---

## [2026-04-18] Slice 5 — Screenshot-First Intake + Webhook Ingest API

### Added
- `POST /ingest/screenshot` — one-shot upload: create lead stub → OCR → auto-apply high-confidence fields → return `IngestResult`
- `POST /ingest/webhook/thumbtack` — Thumbtack payload normalization + dedup by `source_reference_id` + queue
- `IngestResult`, `WebhookIngestResult` schemas
- Thumbtack webhook payload schemas (`ThumbTackWebhookPayload`, etc.)
- Dedup logic: if a `thumbtack_api` lead with the same `leadID` already exists, return existing with `was_duplicate=True`
- `LeadCreate.tsx` redesigned: screenshot-first mode select, drag-drop upload, processing spinner, review form
- `LeadCard.tsx` shows "No name yet" (gray italic) when `customer_name` is null
- 15 ingest tests

### Changed
- `leads.customer_name` changed to `nullable=True` in the ORM model (ingest stubs start without a name)
- `LeadOut.customer_name` changed to `Optional[str]`
- Manual entry shifted to fallback-only
- Vite proxy extended to include `/ingest`

### Notes
- Auto-apply rule: only `confidence == "high"` OCR fields applied silently; medium/low pre-fill review form only
- `customer_name=None` is the correct stub state — "Pending" or any placeholder is not acceptable

---

## [2026-04-18] Slice 4 — Grounded AI Review Engine

### Added
- `POST /leads/{id}/ai-review` — builds input snapshot, calls Claude with SOP grounding, validates A–H structure, stores result
- `GET /leads/{id}/ai-review` — returns latest review
- `ai_reviews` table with `sections_json`, `input_snapshot_json`, `prompt_version`, `grounding_source`
- `AiReviewSections` Pydantic model — all 8 keys required; 502 on missing keys or bad JSON
- `AI_GROUNDING_FILE` env var support; falls back to built-in SOP stub when not set
- `prompt_version` = SHA-256[:8] of grounding content + system prompt template
- AI review panel in `LeadDetail.tsx`: A–H section cards, G section marked internal-only
- `docs/sops/holy_hauling_app_sop_from_revised_pricing.md` as the active pricing-weighted grounding source
- 13 AI review tests

### Notes
- Section G (Pricing Posture) is internal-only; must never be shown as customer-facing output
- Grounding file is now loaded at request time; `AI_GROUNDING_FILE` path is absolute (Windows-compatible)

---

## [2026-04-18] Slice 3 — Screenshot Extraction / OCR

### Added
- `POST /leads/{id}/screenshots/{id}/extract` — sends image to Claude Vision, returns structured fields + raw text
- `GET /leads/{id}/screenshots/{id}/extract` — fetch existing result
- `POST /leads/{id}/screenshots/{id}/apply` — apply extracted fields to lead + write event
- `OcrResult` model and `ocr_results` table
- `ocr_status` column on `screenshots` (`pending` / `done` / `failed`)
- Extraction panel in `LeadDetail.tsx`: extract button, confidence badges, editable field form, raw text collapsible
- `OCR_MODEL` env var (no model version hardcoded)
- 14 OCR tests

---

## [2026-04-18] Slice 2 — Intake-to-Queue Foundation

### Added
- Screenshot upload: `POST /leads/{id}/screenshots`
- Lead field editing via `PATCH /leads/{id}`
- Operational notes via `POST /leads/{id}/notes`
- Assigned-to field + queue filter
- `LeadDetail.tsx` with contact section, status transitions, note form, event history

### Changed
- Intake notes vs operational notes distinction clarified

---

## [2026-04-18] Slice 1 — App Skeleton + Lead Domain + Queue Foundation

### Added
- FastAPI backend with SQLAlchemy 2.0 async + aiosqlite
- `leads` table with full domain model (status, source_type, urgency_flag, events, etc.)
- `GET /leads`, `POST /leads`, `GET /leads/{id}`, `PATCH /leads/{id}/status`, `POST /leads/{id}/acknowledge`
- Event log (`lead_events` table) with append-only writes
- React + Vite + Tailwind frontend
- Queue screen with source/status filters and urgency/unacked visual indicators
- `run.py` to start both backend and frontend together
- pytest-asyncio test suite foundation
