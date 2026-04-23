# CAPABILITIES

Tracks what the Holy Hauling app can currently do, what needs verification, what is broken, and what is planned.

---

## Currently Working

- [x] Backend starts cleanly and loads `.env` values on boot
- [x] Startup prints grounding file status (OK or WARNING) so config errors are visible
- [x] Lead queue loads and displays correctly (`GET /leads`)
- [x] Manual lead creation (`POST /leads`) with full field validation
- [x] Screenshot-first intake (`POST /ingest/screenshot`): upload → lead stub → OCR → auto-apply → review form
- [x] Screenshot upload reaches backend and is stored on disk
- [x] Screenshot OCR/extraction via Claude (`POST /leads/{id}/screenshots/{id}/extract`)
- [x] Extracted fields editable and appliable to the lead model (`POST /leads/{id}/screenshots/{id}/apply`)
- [x] OCR status tracked on screenshot record (`pending` / `done` / `failed`)
- [x] AI review generated via Claude with A–O locked structure (`POST /leads/{id}/ai-review`)
- [x] AI review grounded in `holy_hauling_app_sop_from_revised_pricing.md`
- [x] AI review stores `input_snapshot` (lead fields + screenshot IDs + OCR fields)
- [x] AI review stores `prompt_version` and `grounding_source` for auditability
- [x] Latest AI review retrievable (`GET /leads/{id}/ai-review`)
- [x] AI review grouped in UI: Action-first (A–E), Pricing & Control (F–L, orange/internal), Support & Context (M–O)
- [x] Old A–H review records readable via backward-compatible key mapping (no data loss)
- [x] Lead fields: `job_origin`, `job_destination`, `scope_notes` stored and editable
- [x] Field provenance tracking: `field_sources` records `"ocr"` or `"edited"` per field
- [x] OCR extracts `job_origin`, `job_destination`, `scope_notes` from screenshots (9 fields total)
- [x] Lead detail: Intake / Job Details / Scope sections replace flat Contact view
- [x] `FieldSourceBadge`: subtle `[ocr]` / `[edited]` inline badges on key fields
- [x] "Not captured" placeholder on origin, destination, scope, phone, date when null
- [x] Origin → Destination display (`123 Main St → 456 Oak Ave`); falls back to location or "not captured"
- [x] Lead field editing via `PATCH /leads/{id}` (inline edit form covers all 11 fields)
- [x] Status transitions via `PATCH /leads/{id}/status`
- [x] Lead acknowledgment (`POST /leads/{id}/acknowledge`)
- [x] Archive (Release) button in lead detail view
- [x] Hard delete via `DELETE /leads/{id}` with cascade (204 response)
- [x] Operational notes append-only (`POST /leads/{id}/notes`)
- [x] Assigned handler field editable and filterable
- [x] Urgency flag and unacknowledged state visible in queue
- [x] Lead event/audit trail shown in detail view
- [x] Tap-to-call (`tel:` link) and tap-to-text (`sms:` link) on customer phone number
- [x] Thumbtack webhook normalization (`POST /ingest/webhook/thumbtack`)
- [x] Webhook dedup by `source_reference_id` (idempotent on repeated delivery)
- [x] Queue filters: status, source type, assigned handler
- [x] Screenshot image accessible via `/uploads/screenshots/...`
- [x] Screenshot OCR returns real extracted text and structured fields from actual Thumbtack screenshots
- [x] AI review returns valid A–O structure grounded in the configured SOP file
- [x] Frontend shows actual backend error message on OCR/review failure (not hardcoded "check env vars")
- [x] 93 backend tests passing (Slice 7)
- [x] Move detail fields: `move_distance_miles`, `load_stairs`, `unload_stairs`, `move_size_label`, `move_type`, `move_date_options` stored and editable
- [x] Thumbtack contact flow: `accept_and_pay`, `contact_status` (locked/unlocked), `acknowledgment_sent`
- [x] Contact auto-unlock: `acknowledgment_sent=True` on non-accept_and_pay lead → `contact_status='unlocked'`
- [x] Phone auto-acknowledge: phone set on unlocked lead (via PATCH or OCR apply) → `acknowledged_at` auto-set
- [x] Accept & Pay leads start unlocked; phone entry triggers acknowledgment on same code path
- [x] Phone field visually locked in UI until first reply sent; amber warning when unlocked but phone missing
- [x] `source_category_label` computed field on every lead response
- [x] LeadDetail layout: Intake / Job Details / Scope & Access sections with all new fields
- [x] Distance rendered as `~N mi` in Job Details
- [x] `move_date_options` rendered as date chips; falls back to `job_date_requested`
- [x] OCR extraction covers 7 new v8 fields: move size, move type, distance, stairs, date options, accept_and_pay
- [x] 108 backend tests passing

---

## Partially Working / Needs Live Verification

- [x] Extraction on real Thumbtack screenshots — verified live 2026-04-18
- [x] AI review against pricing-weighted SOP — verified live 2026-04-18
- [ ] A–O review with new 15-section structure — needs live verification (model behavior with new keys)
- [ ] New OCR fields (origin/destination/scope_notes) — needs live verification on real Thumbtack screenshots
- [ ] Auto-apply accuracy: only `confidence == "high"` fields apply silently — needs real-world test
- [ ] Grounding file path portability across machines (currently absolute Windows path in `.env`)
- [ ] Webhook HMAC signature verification (not implemented — noted as TODO before production)

---

## Broken / In Progress

_Nothing currently known to be broken. All issues from the recovery pass have been resolved._

---

## Planned / Not Yet Built

- [ ] Alert ladder for unprocessed leads (time-based escalation)
- [ ] Quote builder / pricing control UI
- [ ] Quiet hours / backup handler routing
- [ ] Review history UI (currently only latest review shown)
- [ ] Owner-review automation rules
- [ ] Booking-to-job conversion and handoff refinement
- [ ] Crew workflow expansion
- [ ] Payments / closeout flow
- [ ] Provider/model switching UI
- [ ] Multi-doc retrieval if SOP grows too large for single prompt
- [ ] Thumbtack HMAC signature verification

---

## Current Provider / Config

| Setting | Value |
|---------|-------|
| OCR provider | Anthropic |
| OCR model | `claude-haiku-4-5-20251001` |
| AI review provider | Anthropic |
| AI review model | `claude-haiku-4-5-20251001` |
| Grounding file | `docs/sops/holy_hauling_app_sop_from_revised_pricing.md` (absolute path in `.env`) |
| Screenshot-first intake | Primary path |
| Manual entry | Fallback only |
| Env loading | `load_dotenv(override=True)` — `.env` is authoritative |

---

## Last Verified

- Date: 2026-04-20
- Verified by: Claude (automated tests)
- Notes: 108/108 tests passing. Slice 8 complete: move detail fields, Thumbtack contact flow (accept_and_pay, contact lock/unlock, phone auto-acknowledge), source_category_label, revised Intake/Job Details/Scope & Access layout.
