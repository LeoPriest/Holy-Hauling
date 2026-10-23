# CHANGELOG

All meaningful development changes for the Holy Hauling app are logged here.

> Entries from 2026-04-23 through 2026-06-15 were reconstructed from git history on 2026-06-15 to close a documentation gap (the log had been stale since Slice 8). They consolidate by feature area rather than per-commit; see `git log` for commit-level detail.
>
> Re-checked 2026-10-22: every commit on `main` since Slice 8 (`b338b72` onward, plus the Lead Command Center / alert-ladder work dated 2026-04-22/23) now falls under an entry below. Entries added in that pass are marked *(backfilled 2026-10-22)*.

---

## Baseline — 2026-10-22

- **Line baselined:** `main` at `c0288c4` (what Railway runs is `origin/main` at `13b5891`; the three commits between are docs only).
- **Backend suite, as found:** 477 passed, 3 failed. The three were `tests/test_admin_google.py::test_status_not_configured`, `::test_status_configured_not_connected`, `::test_status_connected`. They asserted `redirect_uri == http://localhost:8000/admin/google/callback` without setting `GOOGLE_OAUTH_REDIRECT_URI`, so they passed or failed depending on the machine's `.env` (a clean checkout derives `http://test/...` from the request).
- **Fix:** those three tests now set `GOOGLE_OAUTH_REDIRECT_URI` themselves, so the result no longer depends on `.env`.
- **Backend suite, after:** 480 passed, 0 failed (2026-10-22, `python -m pytest -q` from `app/backend/`).

## Built, not live yet

Finished work that is not live. `main` itself is ahead of `origin/main` (Thumbtack Phase 2 merged locally 2026-10-23); a push deploys it to Railway. The two side branches each add their own CHANGELOG/CAPABILITIES entries, so merging them will conflict in these two files. Each needs Ron's merge decision.

| Branch | What it does | Commits | Relation to `main` |
|---|---|---|---|
| `feat/thumbtack-phase-2` (2026-09-01) | Thumbtack webhook deliveries classified as leads become real Leads (V4 payload mapping, lead-cost sync), the facilitator gets a push when one lands, and failed/unknown deliveries get a Retry button. `LeadOut` no longer carries `raw_payload`. | 20 | merged into local `main` 2026-10-23 (`98988eb`); not pushed |
| `feat/direct-booking` (2026-09-29 → 10-02) | A public, phone-first booking page (photo pricing, saved drafts, honeypot/consent, cancel link), customer texting from the business number, a 20/30-minute reply-promise timer, spam dismiss, by-channel scoreboard, Google review request, and moving on the same front door (move type, distance via Google Distance Matrix, crew/hours basis). Uploads served only to signed-in staff. Still waits on Ron's setup (texting number, domain, Google profile). | 36 | branched at `c0288c4`; up to date |
| `fix/payment-integrity-audit` (2026-07-18) | Square webhook fails closed, booking is audit-trailed, the migration is hardened, payout rate made constant. | 1 | branched at `4d3d4ff`; 41 commits behind |

---

## [2026-10-23] Workday design, stage 1 of 8 — colors, fonts, dock, lead queue and cards

- **Tokens app-wide:** Linen / Night backgrounds, Chapel Green, Safety Amber, Barlow Condensed for display type, Figtree for body (`index.css` variables, `tailwind.config.js`, Google Fonts in `index.html`, `viewport-fit=cover`). All motion stops under `prefers-reduced-motion: reduce`.
- **Dock (`BottomNav.tsx`):** floating bar with the sliding amber tab, filled resting icons, hop on tap, red count of `status === 'new'` leads on Queue, and a green + (admin/facilitator only) that bursts rays and offers Screenshot / Type it in. Admin left the bar and is an entry at the top of Settings. Crew see Jobs and Settings only.
- **Lead card (`LeadCard.tsx`):** name + age, title from service and move size, "Town · Source", status badge, hazard band on new leads. Phone, full address and timestamp came off the card. Overdue/aging, escalated, urgent, follow-up and truck stay as visible flags. The card is now a real button.
- **Lead queue (`LeadQueue.tsx`):** dark header with the rays mark and city pill, title + open count, greeting, sliding filter chips (All / New / Review / Quote / Closed — Closed replaces the old Active/Closed tabs), restyled source/handler filters, escalation and refund panels, and new leads dropping in with an amber toast. The header's New Lead / Manual buttons moved to the dock's +.
- **Tests:** `app/frontend/tests/test_workday_queue.py` (Playwright, 11 tests at 390 and 1024 wide, every API call faked). Run from `app/frontend`: `python -m pytest -q tests`. Backend suite unchanged: 527 passed.
- Not live: the design ships in 8 stages and each stays local until Ron pushes.

## [2026-09-01] Intake — Several Screenshots per Lead *(backfilled 2026-10-22)*

### Added
- **Multi-screenshot intake** (`0cef913`): `POST /ingest/screenshot` takes a list of files. One lead is created, every shot attaches to it, OCR runs on each, and the high-confidence fields merge. Capped at 5 files (each is a paid vision call); over the cap it refuses rather than truncating. A failed extraction loses only that shot's fields. Both intake surfaces (the ingest flow and the Lead Create drop zone) accept several files.
- **Conflicts are reported, never guessed**: where shots disagree about a field, nothing is written; the conflict is returned on the response and recorded as a `field_conflict` event on the lead's timeline. Comparison is on the coerced value, so `$36.24` and `36.24` are not a conflict.

### Fixed
- **A figure was reported as filled when nothing was saved** (`13b5891`): a typed OCR field that failed to parse fell through to the string handler, so `lead_cost_total` (not a Lead column) was reported as auto-applied but never persisted, and `pros_contacted` could receive raw text. Unparseable typed fields now end as `None`.
- Every file is validated before the lead is created; an invalid second file used to 400 after the lead and first image were committed, leaving a half-filled lead in the queue.
- The Lead Create upload path now shows the conflict warning too (only the ingest flow did).

---

## Housekeeping — docs only, no app change *(backfilled 2026-10-22)*

- `2f2a7dc`, `a51eded` (2026-09-01): Thumbtack Phase 2 design spec and implementation plan (the code merged into `main` as `98988eb`, above).
- `c0288c4` (2026-09-29): direct booking front door design, stage 1 of 3 (the code is on `feat/direct-booking`, above).

---

## [2026-09-01] Thumbtack Webhooks — Phase 2 (Leads and Alerts)

### Added
- **Lead creation from captured deliveries** (`feat/thumbtack-phase-2`): a pure
  mapper (`thumbtack_mapper.map_lead_payload`) converts a `lead`-classified delivery
  into `MappedLead` field values, and `thumbtack_service._persist_lead` writes a
  `Lead` from it — city from the connection, `leadPrice` parsed into
  `lead_cost_cents` and synced to finance, customer phone stored with
  `customer_phone_is_proxy = True`. Runs after the raw body is already committed, so
  a mapping failure marks the event and never loses the delivery.
- **Push on arrival**: facilitator + admin roles are pushed the moment a lead lands;
  out-of-area leads say so in the notification text. The Lead is committed before the
  push is attempted, so a push failure (logged and swallowed) never costs the lead.
- **Location-mismatch flag**: when the description names a zip or US state
  (allow-listed against the 50 USPS codes + DC) that doesn't match the connection's
  search area, a `[WARNING]` line is appended to `Lead.quote_context`. Never
  suppresses the lead — it was paid for either way.
- **Idempotent redelivery and test-ping handling**: the same `negotiationID`
  delivered twice creates no second lead or expense; Thumbtack's webhook-creation
  test ping (no `negotiationID`) creates nothing.
- **Retry button** on `/admin/thumbtack`, doing three jobs depending on the event: a
  **replay** of an event that never became a lead, a **backlog** replay of a
  pre-Phase-2 delivery that was only ever captured (never mapped), and a **heal** of
  an event whose Lead was created but whose finance sync failed (`processed` with a
  non-null `event.error`, not `failed`). The button renders on
  `status === 'failed'`, `kind === 'unknown'`, a non-null `event.error`, **or
  `kind === 'lead' && !lead_id`** — the last two conditions are what make the heal
  and backlog cases reachable, respectively. `RetryResult.created` is `True` only
  for a genuine new-Lead insert; a found-existing or healed retry returns
  `created: False` with a non-null `lead_id`.
- **Every early-return path in `_persist_lead` now writes an outcome back to the
  event**, so a delivery can no longer sit in silent limbo (`received`, no lead, no
  error, nothing acting on it): an idempotency hit (redelivery) marks the event
  `processed` and links the found `lead_id`; a body the mapper declines (no
  `data.negotiationID`) is marked `failed` with an explicit error.
- **An unparseable `leadPrice`** (missing, `"Free"`, or junk) leaves
  `lead_cost_cents` unset — never guessed, never `0` — and now flags the event with
  an explicit error rather than doing this silently.
- **A successful retry clears `event.error` unconditionally**, not only inside the
  heal branch — a delivery that failed mapping once and was fixed on a later retry
  no longer keeps a permanent red error line and a Retry button that does nothing.
- **A webhook lead now opens with a `created` `LeadEvent`** on its timeline, same as
  a lead created any other way, instead of an empty history.

### Corrected from the design spec during review
- **`RetryResult.created`** originally meant `event.lead_id is not None`, which
  conflated a genuine insert with "found an existing lead." Fixed to mean "this call
  inserted a new Lead row" — nothing else.
- **The spec's payload-mapping table claimed `Lead.source_business` /
  `thumbtack_business_id` columns.** Neither exists. The Thumbtack business identity
  is not queryable off a Lead; it survives only in `Lead.raw_payload` (admin-only —
  see below) and the webhook event's stored raw body (90-day retention).
- **The out-of-area check uses an allow-list**, not the denylist the spec assumed —
  an early denylist excluded "OK" and "ID" as prose words, silently suppressing the
  Oklahoma/Idaho mismatches it was built to catch.
- **The AI review does not auto-run on webhook leads**, unlike the screenshot-intake
  path — a paid model call on every inbound lead (including broker and out-of-area
  ones) was judged not worth it. The facilitator taps "Run AI review" per lead.

### Fixed — whole-branch review, same day (`7e031fa`, `6043d69`, `e085e23`)
- **The refund heal was gated on the wrong signal.** `retry_event`'s cost-sync heal
  originally trusted `lead.lead_refunded_at`; if `mark_refunded` had itself thrown
  and rolled back, that column stayed `NULL` even though Thumbtack had refunded the
  lead, and the heal could book a full-price expense on a refunded lead and report
  success. Now re-derives refund state from the stored payload's own `chargeState`
  on every retry, never from the (possibly stale) column.
- **`Lead.raw_payload` was reachable through `LeadOut`** — the response model
  returned by every lead route except the single-lead detail view, which
  `require_auth` (not `require_role("admin")`) gates. Since the captured Thumbtack
  body carries `business.accessCode`, a live `refundRequestLink`, `customerID`, and
  `requestID`, that meant supervisor and crew logins could pull a real privilege
  step-up off a plain `GET /leads`. Fixed: `raw_payload` is now structurally absent
  from `LeadOut` entirely, and on `GET /leads/{id}` (`LeadDetailOut`) it is redacted
  to `null` for every role but admin on Thumbtack-sourced leads
  (`lead_service.visible_raw_payload`).
- **Retrying an oversize-rejected delivery overwrote its own diagnostic.** The
  stored body for a `record_oversize` rejection is a truncated 2KB prefix that was
  never valid JSON; retrying it hit the JSON-parse failure and replaced the one
  useful message (why it was rejected, and how big it really was) with a generic
  "Body is not valid JSON." Retry now refuses outright on a detected oversize
  rejection instead.
- **`retry_event` lacked the `kind == "lead"` guard `record_event` already had.**
  Retrying a message/review event that happened to carry the same `negotiationID`
  as a real lead could map a hollow Lead with no name, phone, or cost — which would
  then win the idempotency lookup and permanently block the real lead. Retry now
  refuses anything whose `kind != "lead"`.
- **Unbounded exception text could reach `event.error` and the logs.** A bare
  `str(exc)` on a SQLAlchemy DBAPI error includes the driver message *and* the full
  bound-parameter list — customer name, phone, description — for the Lead INSERT.
  All exception text written into `event.error` or logged now passes through
  `_safe_exc_summary` first: cut before SQLAlchemy's `[SQL: ...]`/
  `[parameters: ...]` sections, hard-capped in length.
- **The backlog-lead gap.** Deliveries captured by Phase 1, before this phase's
  mapping shipped, sit as `kind: 'lead'`, `status: 'received'`, `lead_id: null`,
  `error: null` — none of the retry button's original three conditions matched
  them. A fourth condition (`kind === 'lead' && !lead_id`) makes them retryable,
  which is what makes the "no backfill script, use the Retry button instead" note
  below actually true rather than aspirational.

### Fixed — final review pass before merge (`228cbb4`)
- **The retry button's `unknown`-kind disjunct was dead weight, not a working
  path.** Every `unknown`-kind body seen in practice (Thumbtack's synthetic test
  ping) carries no `negotiationID` anywhere the classifier looks, and
  `retry_event` already refused anything whose `kind != "lead"` — so the button
  rendered on `unknown` and then always no-op'd. Dropped the disjunct; the button
  now renders on three conditions (`failed` status, non-null `event.error`, or a
  backlog `kind === 'lead' && !lead_id`), not four, and never on a kind it can't
  act on.
- **A refused retry stopped reporting a misleading clean success.** Retrying an
  oversize-truncated body or a non-`lead` event returns the event unchanged — no
  lead, its own error still attached — and the UI used to read that as "Nothing
  needed doing." next to the row's own red text. It now detects exactly this shape
  (`!result.lead_id && result.event.error`) and shows "Retry did not process this
  delivery — see the error above." in the failure slot instead.
- **The idempotency-hit path now clears a stale error too, when it's actually
  safe to.** A retry resolving through the idempotency lookup (its `negotiationID`
  already has a lead, from a sibling delivery) now clears `event.error` when that
  found lead is healthy — has its expense booked, or is legitimately refunded —
  where it previously left a transient failure's red line and a permanently
  no-op Retry button in place forever. Left untouched when the found lead still has
  a real unresolved problem; that early-return path still cannot fix one.
- **An unparseable `leadPrice` became genuinely repairable, not just flagged.**
  The flag itself is unchanged (cost left unset, never guessed, never `0`, event
  carries an explicit error) — what's new is that `retry_event` re-derives the
  price from the same stored raw body on every retry, so a later `parse_cents` fix
  can turn a real retry into a filled `lead_cost_cents`, a synced expense, and a
  cleared flag. Still unparseable stays flagged, correctly.
- **`POST /ingest/screenshot` picked up the same `raw_payload` redaction
  `GET /leads/{id}` already had**, via one new shared constructor,
  `lead_service.to_lead_detail_out(lead, role)` — the only sanctioned way to build
  a `LeadDetailOut` now, so a future caller gets the redaction by construction
  instead of needing to remember `visible_raw_payload`. Not a real prior leak
  (screenshot-sourced leads are never `source_type: thumbtack_api`), but an
  incidental rather than structural guarantee before this.
- Corrected two stale `CAPABILITIES.md` bullets that had drifted from the shipped
  code and, in one case, from each other: the Replay description still implied
  `unknown`-kind retries worked, and a "clears `event.error` unconditionally" line
  contradicted the idempotency-lookup bullet a few lines above it stating the
  error is deliberately left untouched there. Both are now path-specific and
  consistent with each other and the code.
- **Added an open item:** `_safe_exc_summary`'s truncation logic has no dedicated
  unit test — carried deliberately, low risk (exercised indirectly by every
  failure-path test that checks `event.error`'s shape).

### Notes
- See spec: `docs/superpowers/specs/2026-09-01-thumbtack-phase-2-design.md`
- See plan: `docs/superpowers/plans/2026-09-01-thumbtack-phase-2.md`
- No database migration — every column this phase writes already existed on `Lead`.
- **No backfill script.** Deliveries captured before this shipped are still raw rows
  with no Lead; they can now genuinely be replayed one at a time from the Retry
  button (see the backlog fix above).
- **Known, pre-existing, out of scope this phase:** `push_service._send_one` calls
  `pywebpush` as a blocking call inside an async function, with no timeout — a
  wedged push provider can stall a webhook response (never costs the lead, since the
  Lead commits first). No index on `Lead.source_reference_id`, which the idempotency
  lookup queries on every delivery — and that lookup is itself a SELECT-then-INSERT
  with no unique constraint, so two truly concurrent deliveries of one
  `negotiationID` could each create their own Lead and expense (accepted for now:
  single instance, single sender, SQLite serializes writes). No frontend test
  harness exists; the retry button is verified by `tsc`, `npm run build`, and a
  human pass on a real device.
- **A refunded redelivery is discarded, not applied.** A lead refunded by Thumbtack
  *after* its first delivery already landed is never marked refunded — the refund
  handling in `_persist_lead` is only reachable on a `negotiationID`'s first
  delivery, and `retry_event`'s heal block only ever re-runs the cost sync, never
  `mark_refunded`.
- **`lead_cost_gross_cents` is fed Thumbtack's pre-tax `subtotal`**, while the
  column's meaning elsewhere in this app is pre-discount gross — with any nonzero
  sales tax this inverts the usual gross-≥-net relationship against
  `lead_cost_cents`. Display-only today; the mapping is what the spec asked for, so
  this is an inherited spec question rather than a coding slip.

### Verified
- Backend suite: 527 passed, 0 failed (full suite, 2026-09-01, `228cbb4`)
- Frontend: `tsc --noEmit` and `npm run build` both pass (2026-09-01, `228cbb4`)

---

## [2026-08-26] Lead Window — Phase B (Density and One-Voice Pricing)

### Added
- **Lead window density pass** (`feat/lead-window-phase-b`): consolidated `Booking Date` to render once on Brief (deleted the separate Quote row which was the only path that wrote `job_date_requested` without `job_date_end`); made `Est. Duration` edit on Quote only and display read-only on Brief; reduced intake screenshot preview from ~192px to a 64px thumbnail that opens full-size on tap.
- **Unified quote anchoring**: `suggest_quote` now anchors to the AI review's validated `target_low`/`target_high`/`floor` when present, preventing the builder and decision card from stating different bands. Legacy reviews (no structured figures) behave byte-identically to before.
- **Non-blocking floor validation**: floor caption beneath the quoted-price input now warns when the typed total is below it, but still permits booking. Nothing renders when the review carries no validated floor (no placeholder, dash, or zero).

### Fixed *(backfilled 2026-10-22)*
- **The number the operator reads is the number the review stands behind** (`cedddc5`, 2026-08-28, whole-branch review): a `hold` review's floor no longer shows beside the price input, and its figures never anchor `suggest_quote` (`_build_pricing_context`); the Quote tab's Est. Duration wheel now PATCHes the lead on change (in-progress / saved / failure states) instead of living only in the unsaved draft; validated figures anchor `suggest_quote` even when the review prose is empty. Backend 469 passed after this fix.

### Notes
- See spec: `docs/superpowers/specs/2026-08-25-lead-window-phase-b-design.md`
- See plan: `docs/superpowers/plans/2026-08-26-lead-window-phase-b.md`
- No database migration required — all changes are UI/logic consolidation and backend quote-anchoring logic.
- The `Booking Date` row deletion prevents new stranded end-dates; already-stranded values are not cleaned up (data-completeness gap, open item).

### Verified
- Backend suite: 465 passed, 0 failed (full async test, 2026-08-28)
- Frontend: `tsc --noEmit` and `npm run build` both pass (2026-08-28)

---

## [2026-08-25] Lead Decision Card — Phase A

### Added
- **Decision card UI** (`feat/lead-decision-card`): new card at the top of the lead window, visible on every tab. Displays target range (`target_low` / `target_high`), walkaway floor, job category (band_position), and a lever if the job has one dominant unknown (range_levers: what-if scenarios with prices). Grouped pricing sections A–O now collapsed into "Full analysis" accordion. `RefundBanner` moved inside the scroll region.
- **Structured decision fields on `AiReviewSections`**: `sayability`, `target_low`, `target_high`, `floor`, `band_position`, `band_reason`, `range_levers`, `floor_defense` — optional, derived by Claude from prose sections G–L. Live inside the existing `sections_json` column; no database migration required.
- **Server-side money validation**: parsed figures are dropped wholesale if `floor <= target_low <= target_high` does not hold — all four figures null, card shows "no quotable number", failure logged with lead id. Never renders partial sets. Legacy reviews show the re-run state (no fabricated numbers).
- **`hold` state behavior**: when an AI review is in `hold` state (scope too unresolved to quote), the card suppresses target range, price levers, and floor-defense line. Hold reviews can carry money fields (legacy data), but they are not rendered.

### Notes
- See spec: `docs/superpowers/specs/2026-08-25-lead-decision-card-design.md`
- See plan: `docs/superpowers/plans/2026-08-25-lead-decision-card-phase-a.md`
- No database migration required — fields are optional JSON inside the existing `sections_json` column.
- Money validation is explicit and wholesale; every validation failure is logged.
- Legacy reviews validate unchanged and render the re-run state, never a fabricated number.

### Verified
- Backend suite: 458 passed, 0 failed (full async test, 2026-08-25)

---

## [2026-08-24] Thumbtack Webhooks — Phase 1 (Connect and Capture)

### Added
- **Thumbtack webhook receiver** (`feat/thumbtack-webhooks`): new `thumbtack_webhook_delivery` table + `ThumbTackConnection` model; admin screen `/admin/thumbtack` to create/manage connections (label, city, business) with auto-generated URL token and Basic credentials; `POST /ingest/webhook/thumbtack/{url_token}` public receiver validates token + credentials + body size, classifies payload (lead / message / review / unknown), stores raw body for 90 days.
- **Delivery feed** (`GET /admin/thumbtack/events`): paginated list of deliveries with classification, timestamp, connection details, and raw body; validates `limit` (1–200, returns 422 outside range).
- **Status codes**: 200 on success; 401 for unknown/disabled tokens or bad credentials; 413 for oversized bodies; 503 on database failure (so Thumbtack retries).
- **Phase 1 scope**: capture and ledger only; no lead/message/review creation (Phase 2).

### Notes
- See spec: `docs/superpowers/specs/2026-08-24-thumbtack-webhook-integration-design.md`
- See plan: `docs/superpowers/plans/2026-08-24-thumbtack-webhooks-phase-1.md`
- The older `POST /ingest/webhook/thumbtack` route (requires login, wrong payload shape) remains for backward compatibility but is unusable in production; Phase 2 replaces it.

### Verified
- Backend suite: 430 passed, 0 failed (full async test, 2026-08-24)

---

## [2026-06-25] Role-Aware Help + Escalation-Push Cleanup

### Added
- **Role-aware `/help` + supervisor guide** (`dbb36f3`): generalized the help screen — `content/helpContent.ts` now exposes `HELP_GUIDES{facilitator, supervisor}` + `guideForRole(role)` (admin→facilitator), and the screen renders the viewer's guide. Added a **supervisor (on-site-lead) guide**: jobs-centric (phase tracking, crew, photos/notes, calendar, glossary). Settings entry + `/help` route widened to admin + facilitator + supervisor with a role-adaptive label.

### Changed
- **Escalation-push cleanup** (`d4a833a`): supervisors no longer receive lead-escalation pushes (they don't act on them and can't open leads). Escalation raise now notifies `["admin"]` (was admin + supervisor) and the T2 staleness push drops supervisor. The booked-lead / new-job-assignment push to supervisor + crew is intentionally unchanged.

---

## [2026-06-24] Quote-Logic Transparency, Help Guide, SPA Deep-Link Fix

### Added
- **Per-quote basis** (`2e94b9f`): persist `comparables_json` + `rationale` on `quote_suggestion_log`; `GET /leads/{id}/quote-suggestion/latest` (city-scoped, malformed-safe) returns the latest snapshot. New `QuoteBasis` section in the Quote panel shows the comparable jobs the AI anchored on (price · Realized/Quoted · Won/Lost · why-similar · tap-to-open) + grounded/cold-start badge + persisted rationale, live-first with background reconcile.
- **Grounding-eval view** (`4946907`): exposed `won` / `lost` on `CohortMetrics`; opened `GET /admin/eval/quote-grounding` to admin + facilitator; new `AdminQuoteGroundingScreen` (facilitator-friendly plain-language metric cards — Win rate w/ won·lost, Pricing accuracy, Over/under — with sample-gated takeaway + per-metric winner marks). Reached via an Admin card + a "How grounded quoting is performing" link in the Quote panel.
- **Facilitator help guide** (`edf86e6`): a passive reference at `/help` — collapsible accordion sections (lifecycle walkthrough + glossary), reached from a "Help" entry in Settings. Content authored in one typed data file (`content/helpContent.ts`), no markdown dependency, static.

### Fixed
- **SPA deep-link 404s in production** (`61c24e7`): typed/refreshed deep-link URLs 404'd because the production frontend is served by `serve` from `dist/`, which reads SPA rewrites from a `serve.json` *in the served dir*, but `serve.json` lived in the project root. Moved it to `app/frontend/public/` so the build emits `dist/serve.json` with the `{rewrites:[{source:'/**',destination:'/index.html'}]}` rule.

---

## [2026-06-22] 72-Hour Refund-Eligible Flagging

### Added
- **72-hour refund-eligible flagging** (`2fc7901`): `Lead.customer_responded_at` + `Lead.lead_refunded_at`. Candidate-only (never auto-concludes), computed client-side: Thumbtack + early status + 72h since arrival + unresolved. Four reversible resolve endpoints (`POST/DELETE /leads/{id}/customer-responded` + `/refund`), each emitting a `LeadEvent` with the acting user; marking refunded reversibly drops the lead-fee expense (realized_cost → 0) while preserving `lead_cost_cents`. Frontend `RefundBanner` (candidate → resolved chips w/ Undo → pre-empt marker) + a "Refund-eligible" queue band.

---

## [2026-06-19] Crew-Assist + Thumbtack Numbers Alignment

### Added
- **Crew agenda** (`9d93e69`): for crew, the Jobs tab is a single agenda — active/in-progress job pinned ("Continue job"), then Today / Tomorrow / This week / Later, with an Upcoming / Completed toggle. Calendar tab hidden for crew (office keeps it). Frontend-only (`utils/jobAgenda.ts`, `components/CrewAgenda.tsx`), reuses `GET /jobs`.
- **Completed Jobs view** (`f4ed266`): `GET /jobs?status=completed`; completed jobs carry `realized_revenue_cents` (live income sum) + `completed_at`; read-only Completed tab with an "N completed · $X realized" header.
- **My Pay & hours** (`150f9a6`): `GET /users/me/pay` returns the caller's own pay records (scoped to `user_id`) + totals (earnings, hours, job count); a "My Pay" section in Settings (all roles, own pay only). New `MyPayEntry` / `MyPayOut` schemas; reuses `PayRecord` + `Lead`.
- **Per-job checklist (items to bring)** (`31a00c6`): new `lead_checklist_item` table + `Lead.checklist_seeded_at`. Seeded once (lazily, on first open of a booked job) from a configurable standard kit (an `AppSetting`, editable in Settings by admin/facilitator) + code-driven scope extras (stairs → stair dolly, large move → blankets, hauling → bags, truck unless labor-only). Crew-owned per-lead GET(lazy-seed)/POST/PATCH/DELETE item CRUD + `GET/PUT /settings/checklist-kit`. Frontend `JobChecklist` in the working modal (optimistic, scope/added tags, 44px targets) + `StandardKitEditor` in Settings.
- **Lead-cost tracking + competition capture** (`bc21b2d`): six `Lead` cols — `lead_cost_cents` (net Total), `lead_cost_gross_cents`, `lead_cost_bonus_cents`, `lead_cost_finance_transaction_id`, `pros_contacted`, `pros_responded`. OCR extended to read the Thumbtack fee breakdown (Direct lead / Bonus / Total) + competition line, disambiguated from the "Estimated cost" quote, with `Decimal` money parsing. The net total auto-syncs a lead-linked "Thumbtack lead fee" `FinanceTransaction` (mirrors truck-rental sync) → flows into the outcome layer's realized_cost / ROI. Frontend `LeadCostCard` in the Brief panel.
- **Thumbtack Numbers (proxy phone)** (`71e8f8a`): `Lead.customer_phone_is_proxy` (bool) + `Lead.customer_real_phone`; a `contact_phone(lead)` helper (real-if-valid-else-proxy) used by Square payment SMS + exposed as a computed `LeadOut.contact_phone`; proxy auto-tagged when a valid `customer_phone` is set on a Thumbtack-source lead (manual override persists). Frontend `LeadContact` (replaces the Phone row): "needs a number" prompt, "Thumbtack line" badge, real # as Primary, inline edit.

- **Per-period weekly availability** *(backfilled 2026-10-22)* (`4286e47`, `0ce3950`, `c85e130`, `543fc08`): `UserWeeklyAvailability` gains a `period` column (morning / afternoon / evening) with an expand-existing migration; blocks-map `GET/PUT` with a full-day-only admin rollup; a days x periods grid in Settings.

### Fixed *(backfilled 2026-10-22)*
- **Startup crash from the availability migration** (`a64fbf4`): the `user_id` index was created before the old table was dropped, so the index name collided and the live backend failed to start. The index is now created after the drop.

### Notes
- The Thumbtack-alignment work (lead-cost capture, proxy phones, and the 72h refund flag landed 2026-06-22) responds to Thumbtack's 2026 "Thumbtack Numbers" rollout: masked proxy phones, a ~10% lead-price hike, and 72h refunds.

---

## [2026-06-18] Self-Learning Items 2–3 + Calendar Sync Without Crew *(backfilled 2026-10-22)*

### Added
- **Retrieval grounding for the quote** (roadmap item 2; `c523366`, `5bd9659`, `a02bf36`, `c3afd64`): `comparables_service.find_comparables` scores same-city finalized outcomes on their frozen `scope_snapshot` (size, distance, move type, stairs; no embeddings) and the top 5 go into a `COMPARABLE LOCAL JOBS` block in the quote prompt; they are returned on `QuoteSuggestionOut.comparables`. No comparables means no block and a byte-identical prompt; retrieval failure degrades to `[]`.
- **Quote-grounding eval** (roadmap item 3; `1bf5c02`, `dc87979`, `1e3a93e`, `bbfb2b3`, `bc65fa8`): append-only `quote_suggestion_log` (grounded, comparables count, suggested price, model), best-effort; `GET /admin/eval/quote-grounding` compares grounded vs ungrounded cohorts (win rate, pricing accuracy, signed bias) against finalized outcomes. The facilitator-facing view came 2026-06-24.
- **Google Calendar sync without crew** (`faf0156`): booked jobs sync to GCal even with nobody assigned; crew are optional attendees.

### Fixed
- Comparables block separated from the draft instruction in the quote prompt (`d3fcd3f`).

---

## [2026-06-17] Self-Learning Item 1 — Outcome Layer *(backfilled 2026-10-22)*

### Added
- **`lead_outcome`** (`abfb4cd`, `262194f`, `8e118bf`, `d856903`): one reconciled row per terminal lead freezing the decision-time scope snapshot and the result (won/lost, quoted vs realized revenue and cost, price delta, escalation, AI prompt version, timings). Finalized rows (`lost`, `released`) are frozen; booked rows stay live so revenue fills in. Swept every 15 minutes plus a startup backfill, multi-city aware; read via `GET /admin/outcomes` (admin only).

### Fixed
- Time zones normalized before the time-to-book subtraction; negative values clamped; one city's reconcile failure no longer stops the others (`7900925`, `cd2284f`, `e3b23ab`).

---

## [2026-06-16] Escalation Overlay + Lead Window Default Tab *(backfilled 2026-10-22)*

### Added
- **Escalation as a resolvable overlay** (`064579c` → `a7c4e80`): a `LeadEscalation` row sits beside the lead's real stage instead of replacing it. Raise from the Log tab (level, decision needed, AI-suggested summary), Resolve flow for the owner (outcome + note, `LeadEvent`, handler notified), a pinned Escalations band and card badge on the queue. Routes in `routers/escalation.py`.
- At T2 the idle ladder now opens an `auto_idle` overlay instead of flipping status to `escalated` (`cba8a17`); a startup migration moves legacy `escalated` leads back to their prior stage with an overlay (`b783e7c`). `escalated` is no longer a pipeline stage.

### Changed
- The lead window opens on the Brief tab; the quote stays in the pinned bar (`744cecc`).

### Fixed
- 44px tap target on the Suggest-with-AI button (`6ab17e6`).

---

## [2026-06-15] Calendar UX + AI Review Context Fix

### Added
- **Week-first calendar** (`CalendarScreen.tsx`): default view is a tap-to-expand list of the current week (today highlighted, day quote totals), details one tap away. New **Week / Month** toggle — Month reuses the existing grid + stat cards.
- Collapsible "needs a date" banner for unscheduled jobs, shown only when non-empty.
- *(backfilled 2026-10-22)* **Queue grouped by stage** with an ambient Aging / Overdue signal (`4e853f3`); month grid moved above the stat cards on the Month tab (`c8e9b59`).
- *(backfilled 2026-10-22)* **Quote-centric lead window** (`1f9cc58`): inline quote builder and a pinned quote bar.
- *(backfilled 2026-10-22)* **AI-assisted quote drafting** (`49efb31`): `POST /leads/{id}/quote-suggestion` drafts a total, line items, duration and rationale from the lead scope, `quote_context` and the latest review, grounded in the SOP; the total is reconciled to the line-item sum. A "Suggest with AI" button fills the builder; the facilitator edits before Lock & Book.
- *(backfilled 2026-10-22)* **Truck rental rework** (`901ddbb`): Reserved -> Confirmed -> Completed staged card; confirmation-screenshot OCR pre-fills the form (never auto-saves); saving a cost syncs a lead-linked "Truck Rental" expense; "add truck rental as line item" in the quote builder; navigable pickup/dropoff (new `dropoff_location`, `confirmation_url`).

### Fixed
- **AI review ignored facilitator context.** The Quote panel's "Add Context Before Re-running Review" box saved `quote_context` to the lead, but `_build_input_snapshot` never included it — so hand-typed context (and hand-typed scope/move fields) never reached Claude. Added `quote_context`, `job_origin`, `job_destination`, `scope_notes`, `move_size_label`, `move_type`, `move_distance_miles`, `load_stairs`, `unload_stairs`, `move_date_options`, `accept_and_pay` to the review snapshot. Guard test added.

### Changed
- Removed the static "Sync Notes" wall-of-text block from the calendar; per-job synced/local badges already convey state.
- `.gitignore`: ignore `.superpowers/` (brainstorm visual-companion artifacts).

### Verified
- `test_ai_review.py` 19/19; frontend `tsc --noEmit` + `npm run build` pass. Full backend suite: 239 passed / 11 failed (pre-existing failures in `test_calendar_service.py` + `test_chat.py` — see CAPABILITIES).
- *(backfilled 2026-10-22)* Same day, `a3f8bc4` fixed those 11 stale tests (calendar model-import list and mock signatures; chat response shape). Suite green at 264.

---

## [2026-05-20] Recurring Expenses

### Added
- `RecurringExpense` model + Pydantic schemas; `recurring_expenses` table (new table, no ALTER migration).
- `/admin/recurring-expenses` router: list, `/due` (within 7 days), create, patch, delete, and one-tap `/log` (creates a `FinanceTransaction`, advances `next_due_date`, moves the GCal event).
- GCal helpers `create_recurring_expense_event` / `update_recurring_expense_event` in `calendar_service.py` (non-fatal).
- Frontend: `recurringExpense` types + TanStack hooks; `AdminRecurringExpensesScreen` (manage templates), `AdminDueExpensesScreen` (log due items); due-count badge on admin home; recurring dates on the calendar.
- 13 backend tests; `python-dateutil` dependency for month arithmetic.

---

## [2026-05-19] Payroll + Truck Rentals

### Added
- **Payroll**: `PayRecord` model, `quote_cents` on Lead, `hourly_rate_cents` on User; payroll router (per-lead CRUD + admin aggregation); `PayrollSection` in BriefPanel; `AdminPayrollScreen`; pay types flat / hourly / 10% facilitator cut. 12 backend tests.
- **Truck rentals**: `TruckRental` model + receipts directory; `TruckRentalSection` in BriefPanel; `AdminRentalsScreen`; U-Haul deep link; rental badge on lead-queue cards.

---

## [2026-05-08 → 2026-05-13] Admin Hub, Multi-City, Finance, Metrics, Square, Comms, Deploy

### Added
- **Multi-city isolation**: `City` model, `CityContext`, `CitySwitcher`, per-city data scoping; `AdminCitiesScreen`.
- **Admin finance tracking**: income/expense transactions, categories, payment methods, vendor/customer, lead linking, summary.
- **Admin hub** screen + mobile-first bottom navigation; admin metrics dashboard (pipeline, conversion, revenue, sources, reply time).
- **Follow-up scheduler**: reminders on leads with push notifications; calendar deep-link + schedule-date modal.
- **Square payment integration** (skeleton): payment links, webhook, status chips, tap-to-copy link.
- **Comms**: configurable alert channels (push / SMS / email per tier); Twilio SMS with E.164 normalization; Resend email with SMTP fallback (run in thread pool).
- `replied` status added to the queue workflow.

### Changed
- Removed contact-lock vestiges (`contact_status` / `acknowledgment_sent`) — superseded by the `in_review` / `waiting_on_customer` state machine.
- Deployment made env-driven; Railway `serve.json`/SPA routing; `load_dotenv(override=False)` so Railway env vars win; iframe-embedding CSP (`frame-ancestors`).

---

## [2026-04-23 → 2026-04-28] Booking Flow, Jobs/Crew, Google Calendar, Auth, Dark Mode, Push

### Added
- **Booking confirmation flow**: editable customer confirmation from lead fields, View Lead + Copy Confirmation in JobModal, date ranges, cross-tab booking flow.
- **Jobs + crew**: `JobAssignment` model (many-to-many crew); Jobs screen (Scheduled / In Progress); phase tracking (dispatched → en route → arrived → started → completed) with live timers; crew/supervisor assignment UI; before/after job photos.
- **Google Calendar integration**: `/admin/google` OAuth connect/callback/status; `calendar_service` create/update/delete/sync; auto-sync on job date/address/notes and crew-assignment changes; `user.email` + `leads.google_calendar_event_id`.
- **Auth & users**: `AdminUsersScreen`, `useUsers`, role-grouped assignment dropdowns; role guards.
- **Push notifications** + availability models + service worker; auto-delete stale subscriptions on delivery failure.
- **Dark mode** via `ThemeContext` (defaults dark; toggle in Settings).
- Queue: Active / Released tabs; `lost` terminal status; Completed / Released labels.

### Changed
- API `BASE` reverted to relative path to avoid double-prefixing in hosted environments.
- Added exception logging before re-raising AI review 502s; onError logging for extract/review mutations.

---

## [2026-04-22 → 2026-04-23] Lead Command Center + Alert Ladder *(backfilled 2026-10-22)*

### Added
- **Lead Command Center** (`44d70c2` → `45a085e`): React Router routes for the queue and a tabbed lead window (Brief / Quote / Log) with header and tab bar; `GateIndicator`; Brief panel (screenshot, contact, AI quick read); Quote panel (scope, `quote_context`, AI pricing sections); Log panel (status controls, notes, screenshots, activity); `IngestProgressFlow` for screenshot-first entry.
- **AI pricing chat** (`2c7c3b4`, `a0749b7`, `20c017f`, `2af324b`): `lead_chat_messages` table, chat service and router, `AiChatThread` in the Quote panel.
- **Alert ladder** (`3e6d361` → `282c72a`): `AppSetting` + `LeadAlert` models; settings router; `alert_service` with `check_stale_leads` on the scheduler, T1/T2 thresholds, dedup, and T2 auto-escalation; quiet hours and a backup handler (SMS/email); Settings screen (thresholds, quiet hours, contacts, test-alert buttons); stale banner and card staleness chips on the queue.

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
