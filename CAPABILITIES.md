# CAPABILITIES

Tracks what the Holy Hauling app can currently do, what needs verification, what is broken, and what is planned.

> Last refreshed 2026-06-15 by reconciling the doc against the actual source tree and git history — the prior version was stale at Slice 8 (2026-04-20). Treat the source + `git log` as the real source of truth; this file is a map, not the territory.

---

## Currently Working

### Lead pipeline & intake
- [x] Backend boots cleanly, loads `.env` (`load_dotenv` then Railway env override), prints grounding-file status on startup
- [x] Lead queue with filters (status, source type, assigned handler) and Active / Released tabs
- [x] Manual lead creation (`POST /leads`) with full field validation
- [x] Screenshot-first intake (`POST /ingest/screenshot`): upload → lead stub → OCR → auto-apply high-confidence fields
- [x] **AI review auto-fires after screenshot upload** — the client (`IngestProgressFlow.tsx`) chains upload → OCR → AI review with no manual click (failures are non-fatal; facilitator can re-run)
- [x] Claude Vision OCR extraction — 16 structured fields per screenshot with per-field confidence
- [x] Thumbtack webhook ingest (`POST /ingest/webhook/thumbtack`) with dedup by `source_reference_id`
- [x] Lead field editing (`PATCH /leads/{id}`), inline edit covering all fields, field provenance (`field_sources`: ocr/edited)
- [x] **Masked-phone handling** — Thumbtack masked values (`xxx`) are detected and skipped, never stored (`lead_service._is_valid_phone`)
- [x] Hard delete with cascade; archive (Release) as soft-delete; append-only operational notes; full event/audit trail
- [x] Tap-to-call / tap-to-text on customer phone

### Lead state machine (contact-lock fully replaced)
- [x] States: `new → in_review → replied → waiting_on_customer → ready_for_quote → ready_for_booking → booked → released → lost`
- [x] Auto-transitions live in `lead_service.py`: open detail → `in_review`; valid phone on in_review/replied → `waiting_on_customer`; job address entered → `booked`
- [x] **`escalated` is no longer a pipeline stage** — escalation is a resolvable overlay (see below). The `escalated` enum value stays defined for legacy rows but is unreachable; a startup migration (`_migrate_escalated_status_leads`) moves any legacy `escalated` lead back to its prior stage and opens an overlay.
- [x] Old contact-lock columns (`contact_status`, `acknowledgment_sent`) removed from the model (orphaned migration default remains — see Broken/In Progress)

### Escalation overlay (risk-based, reconciled with the idle timer)
- [x] Escalation modeled as a separate `LeadEscalation` row (overlay), independent of pipeline status — a lead keeps its real stage *and* carries an open escalation
- [x] Manual raise from the lead window Log tab: level (`monitor` / `pause` / `owner_takeover`) + decision-needed + AI-prefilled Escalation Summary (`escalation_service.suggest_summary`, reuses the AI-review grounding/client helpers)
- [x] Resolve flow (owner): outcome (`approved` / `adjusted` / `owner_takeover` / `release` / `need_more_info`) + note → closes the overlay, writes a `LeadEvent`, notifies the handler
- [x] Notifications: raise → push to `admin`+`supervisor`; resolve → push to `facilitator` (best-effort, reuses `send_push_to_roles`)
- [x] **Idle ladder reconciled** — at T2 the timer raises an `auto_idle` overlay (`open_auto_escalation`, idempotent) instead of flipping `status` to escalated; the Aging/Overdue staleness signal and T1/T2 alert pings are unchanged
- [x] Surfaced on the queue as a pinned "⚠ Escalations" band + an `⚠ Escalated` badge on each lead card; endpoints in `routers/escalation.py` (`POST/GET /leads/{id}/escalation`, `/escalation/suggest`, `POST /escalations/{id}/resolve`, `GET /escalations`)

### Self-learning roadmap (4 items)
**Item 1 — outcome layer (done).** **Item 2 — retrieval grounding for the quote (done).** **Item 3 — quote-grounding eval (done).** Item 4 (regeneration/fine-tune) not built yet.

#### Item 3 — quote-grounding eval
- [x] Every `suggest_quote` call writes an append-only **`quote_suggestion_log`** row (provenance): `was_grounded`, `comparables_count`, the AI's reconciled `suggested_price_cents`, `model_used`. Best-effort — a log failure never breaks quoting.
- [x] `GET /admin/eval/quote-grounding?city_id=` (admin-gated) reports **grounded vs ungrounded** cohorts by joining the latest log per lead to finalized outcomes: per cohort `n`, `win_rate`, `priced_n`, **`pricing_accuracy`** (mean `|suggested−realized|/realized`), **`pricing_bias`** (signed — negative = underpricing). Won+realized jobs only for pricing; `$0` realized excluded (divide-by-zero guard); null metrics with `n` shown for empty cohorts. `eval_service.compute_quote_grounding_eval`. 13 tests.
- [x] This is the loop's measurement: it tells you whether item-2 grounding actually improved pricing/conversion. Only evaluable once provenance + outcomes accumulate (documented).

#### Item 2 — retrieval grounding (quote)
- [x] Before drafting a quote, `quote_service` retrieves the **top-5 most similar same-city finalized outcomes** (won + lost) via `comparables_service.find_comparables` — structured attribute scoring over each outcome's frozen `scope_snapshot` (size +3, distance +2/+1, move_type +1, stairs +1), **no embeddings**, explainable.
- [x] Injects a `COMPARABLE LOCAL JOBS` block into the prompt so the AI anchors on what comparable local jobs actually sold for (`realized` price, or `quoted` fallback), labeled won/lost — not just SOP bands.
- [x] **Cold-start safe:** no comparables → no block → prompt byte-identical to before (zero regression). Retrieval never breaks quoting (`_safe_find_comparables` degrades to `[]` on any error). The comparables used are returned on `QuoteSuggestionOut.comparables`. 11 tests.

#### Item 1 — outcome layer
- [x] `lead_outcome` — a materialized, reconciled record (one row per terminal lead) that freezes the decision-time snapshot + real-world result. The foundation for feeding outcomes back into the AI (items 2–4: retrieval grounding, eval, regeneration).
- [x] Per row: `conversion` (won/lost), `terminal_status`, `quoted_price_cents` vs `realized_revenue_cents` (+ `realized_cost_cents`, `price_delta_cents`), `was_escalated`/`escalation_outcome`, a frozen `scope_snapshot` (JSON, the bridge to item-2 retrieval), `ai_prompt_version` (the grouping key for item-3 eval), and booked/completed timings.
- [x] Realized price = sum of `income` finance txns for the lead (cost = `expense` sum); null when no finance txn logged (documented data-completeness gap).
- [x] **Reconciliation sweep** (`outcome_service.reconcile_outcomes`) upserts rows for `booked`/`released`/`lost` leads; **finalized** rows (`lost` or `released`) are frozen to preserve the decision-time snapshot; `booked`-not-completed rows stay live so realized revenue fills in later. Idempotent.
- [x] Runs every 15 min on the scheduler + once at startup as a backfill (`reconcile_all_outcomes`); multi-city aware. Read via `GET /admin/outcomes?city_id=&conversion=` (`routers/outcomes.py`). 16 tests.

### AI review engine
- [x] A–O review (15 sections), grouped Action-first (A–E) / Pricing & Control (F–L, internal) / Support & Context (M–O)
- [x] Grounded in the configured SOP file; stores `input_snapshot`, `prompt_version`, `grounding_source`, `model_used`
- [x] Legacy A–H records remain readable via key mapping (`_to_out`)
- [x] **Quote context + scope feed the review** — `quote_context` plus route/move/scope fields are included in the snapshot sent to Claude, so hand-typed context reaches the AI, not just OCR values (fixed 2026-06-15)
- [x] Correspondence screenshot types supported: `intake`, `correspondence`, `before_job`, `after_job`
- [x] AI pricing chat (`AiChatThread`) to refine pricing; updates `quote_context`

### Booking, jobs & crew
- [x] Booking confirmation flow: `confirmationText.ts` template, JobModal with View Lead + Copy Confirmation, editable confirmation, date ranges (`job_date_end`)
- [x] Jobs screen (Scheduled / In Progress) with phase tracking (dispatched → en route → arrived → started → completed), live timers, before/after photos
- [x] Crew assignment (`job_assignments` many-to-many); admin/facilitator assign crew, admin updates job status; role-gated phase locking

### Calendar & Google Calendar
- [x] **Week-first calendar** (default): tap-to-expand day list for the current week, today highlighted, day quote totals; **Week / Month toggle**; collapsible "needs a date" banner (added 2026-06-15)
- [x] Month view: existing grid + stat cards + selected-day detail (behind the toggle)
- [x] Google Calendar OAuth (`/admin/google` connect/callback/status), auto-sync on job date/address/notes/crew changes (`calendar_service`)
- [x] Recurring expenses render on the calendar (admin)

### Admin & finance
- [x] Admin hub + mobile bottom nav; multi-city isolation (`CityContext`, `CitySwitcher`, per-city scoping)
- [x] Admin Users (roles: admin/facilitator/supervisor/crew, hourly rate, Google email)
- [x] Finance tracking (income/expense transactions, categories, payment methods, vendor/customer, lead linking, summary)
- [x] Recurring expenses (templates, custom intervals, `/due` badge, one-tap log → FinanceTransaction + GCal event move)
- [x] Payroll (per-lead PayRecord: flat / hourly / 10% facilitator cut; AdminPayrollScreen aggregation)
- [x] Truck rentals (TruckRental model, receipts, U-Haul deep link, AdminRentalsScreen, queue badge)
- [x] Admin metrics dashboard (pipeline, conversion, revenue, sources, reply time)
- [x] Follow-up scheduler with push reminders

### Notifications, auth, infra
- [x] JWT auth (python-jose + bcrypt), role guards on routes
- [x] Push notifications (VAPID/pywebpush) + service worker; availability models (per-date + weekly); stale-subscription cleanup
- [x] Configurable alert channels per tier (push / SMS via Twilio / email via Resend+SMTP)
- [x] Square payment integration (payment links, webhook, status chips, copy-link)
- [x] Dark mode (ThemeContext, defaults dark)
- [x] 17 routers; 20 tables; SQLite async (aiosqlite); idempotent startup migrations
- [x] Deploy config: **Railway for both services** — backend (`railway.toml` + `Procfile`, uvicorn) and frontend (`serve.json` SPA rewrites, served via `serve` after `npm run build`). `vercel.json` carries the same rewrite but is vestigial; the live frontend is Railway. Production host is a `*.railway.app` domain (see `.env.example`); DB is SQLite on a Railway `/data` volume.

---

## Partially Working / Needs Live Verification

- [ ] **New week-first calendar UX** — compiles + builds clean, but not yet visually verified in the running app on tablet (spacing, expand interaction, week-range label)
- [ ] **`quote_context` use by the AI** — confirmed to reach the review snapshot (guard test), but the model's actual *use* of it not yet checked on a real lead
- [ ] AI review failure is swallowed silently in the ingest flow (`IngestProgressFlow.tsx:43-45`) — a failed review is invisible to the facilitator until they open the Quote panel
- [ ] Auto-apply accuracy: only `confidence == "high"` OCR fields apply silently — needs real-world test
- [ ] Thumbtack webhook HMAC signature verification — not implemented (TODO before production)

---

## Broken / In Progress

- [x] ~~11 backend tests failing~~ — **fixed 2026-06-15**. All were stale tests that hadn't kept up with the multi-city/payroll changes (not app bugs): `test_calendar_service.py` had an incomplete model-import list (`Lead.pay_records → "PayRecord"` unresolvable, order-dependent), `fake_get_credentials` mocks missing the `city_id` arg, and `_build_event_body` calls missing the `time_zone` arg; `test_chat.py` treated the `ChatResponse` object as a bare list. Full suite now green.
- [ ] **Orphaned schema**: startup migration still creates `contact_status` / `acknowledgment_sent` columns (`main.py`) though the model dropped them — harmless but confusing dead schema
- [ ] **Grounding file path is an absolute Windows path** in `.env` (points into the KOS vault) — not portable; will break on Railway. Deploy risk.

---

## Planned / Not Yet Built

- [ ] Alert ladder timing automation (escalation thresholds) beyond current configurable channels
- [ ] Quote builder / structured pricing-control UI
- [ ] Quiet hours / backup handler routing
- [ ] Review history UI (compare prior reviews, not just latest)
- [ ] Owner-review automation rules
- [ ] Provider/model switching UI
- [ ] Multi-doc retrieval if SOP grows beyond a single prompt
- [ ] Postgres migration path (currently SQLite only; `check_same_thread` arg is SQLite-specific)
- [ ] E2E (Playwright) + frontend unit (Jest) suites
- [ ] CI/CD pipeline

---

## Current Provider / Config

| Setting | Value |
|---------|-------|
| OCR provider / model | Anthropic / `claude-haiku-4-5-20251001` (`OCR_MODEL`) |
| AI review provider / model | Anthropic / `claude-sonnet-4-6` (`AI_REVIEW_MODEL`) |
| Grounding file | `AI_GROUNDING_FILE` — absolute Windows path into the KOS vault (`...\06_Projects\holy-hauling-app\holy-hauling-context.md`); built-in stub fallback |
| Database | SQLite async (`sqlite+aiosqlite`), file-based; `DATABASE_URL` overridable |
| Auth | JWT (python-jose + bcrypt); roles admin/facilitator/supervisor/crew |
| Deploy | Railway — backend (uvicorn) + frontend (static `serve` + `serve.json`, built with `npm run build`); SQLite on Railway `/data` volume. `vercel.json` is vestigial. |
| Screenshot-first intake | Primary path; manual entry = fallback |

---

## Last Verified

- Date: 2026-06-18
- By: Claude (subagent-driven implementation of the quote-grounding eval, spec→plan→TDD)
- Tests: **317 passed, 0 failed** (full backend suite, 2026-06-18). Frontend `tsc --noEmit` + `npm run build` pass.
- Notes: Shipped **item 3 — quote-grounding eval** this session (see "Self-learning roadmap" above) — append-only `quote_suggestion_log` provenance written at quote time (best-effort), `eval_service` grounded-vs-ungrounded cohort metrics (win rate / pricing accuracy / pricing bias), `GET /admin/eval/quote-grounding`; 13 tests. Item 2 (retrieval grounding, 2026-06-18), item 1 (outcome layer, 2026-06-17), the 2026-06-16 escalation overlay, and 2026-06-15 work all remain in place. Next: item 4 (regeneration/fine-tune from the eval signal).
