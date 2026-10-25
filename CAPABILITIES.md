# CAPABILITIES

Tracks what the Holy Hauling app can currently do, what needs verification, what is broken, and what is planned.

> Last refreshed 2026-06-15 by reconciling the doc against the actual source tree and git history — the prior version was stale at Slice 8 (2026-04-20). Treat the source + `git log` as the real source of truth; this file is a map, not the territory.
>
> Re-checked 2026-10-22 against `main` at `c0288c4`: multi-screenshot intake, quote builder + AI drafting, per-period availability, GCal-without-crew and the alert ladder added; three "planned" items that had already shipped (alert ladder timing, quote builder, quiet hours / backup handler) moved to Currently Working. Work on unmerged branches is listed in `CHANGELOG.md` under "Built, not live yet", not here.

---

## Currently Working

### Thumbtack webhooks — Phase 1 (connect and capture)

- Admin screen at `/admin/thumbtack`: create a connection (label, city, business),
  copy the endpoint URL and Basic credentials into thumbtack.com/pro/webhooks/create,
  disable or delete a connection, and watch incoming deliveries.
- Public receiver `POST /ingest/webhook/thumbtack/{url_token}`: identifies the
  connection by an unguessable path token, verifies Basic credentials if the caller
  sends any, stores the raw body, and returns 200. Unknown or disabled tokens and bad
  credentials get 401; oversized bodies get 413; database failures get 503 (triggering Thumbtack retry).
- Deliveries are classified by body shape (lead / message / review / unknown) and kept
  in a ledger with the verbatim body for 90 days.
- `GET /admin/thumbtack/events` paginated delivery feed: validates `limit` (1–200) and
  returns 422 for values outside that range; returns raw body, classification, timestamp,
  and connection details.
- **Messages and reviews are still capture-only.** Phase 2 (below) maps `lead`
  deliveries into Leads; message/review mapping is not built.

**Known limitation:** the older `POST /ingest/webhook/thumbtack` route is unusable in
production — it requires a logged-in user and expects a payload shape Thumbtack does
not send. The token-scoped receiver above replaces it. Do not point Thumbtack at it.

---

### Thumbtack webhooks — Phase 2 (leads and alerts)

- A delivery classified `lead` becomes a Lead in the facilitator queue: city pinned
  from the connection, `leadPrice` parsed into `lead_cost_cents` and synced to
  finance (idempotent — a redelivery adds no second expense), and the customer's
  phone recorded as a **Thumbtack proxy line** (`customer_phone_is_proxy = True`)
  rather than their real number.
- A refunded delivery (`chargeState == "Refunded"`) runs `mark_refunded` instead of
  a direct cost sync, which drops the realized cost to zero and reverses the finance
  expense the same way a manual refund does.
- An unparseable `leadPrice` (missing, `"Free"`, or junk) leaves `lead_cost_cents`
  unset — never guessed, never `0` — but is not silent about it: the event carries
  `event.error = "lead created, but Thumbtack's lead price could not be parsed —
  cost left unset"` so a cost-per-lead figure can never quietly understate with no
  trace anywhere.
- A webhook lead opens with a `created` `LeadEvent` on its timeline, same as a lead
  created any other way, instead of an empty history.
- The facilitator and admin roles are pushed the moment a lead lands
  (`send_push_to_roles(..., ["facilitator", "admin"], city_id=...)`). Out-of-area
  leads say so in the notification text (`· WARNING address may be out of area`). A
  push failure is logged and swallowed — the Lead is committed before the push is
  attempted, so a wedged or failing push provider never costs the lead, only the
  alert.
- **Location mismatch flag.** `location` carries the search-area city/state/zip; the
  street address, when present at all, is only in the description prose (`address1`/
  `address2` are empty on every observed lead). When the description names a zip
  whose leading digit differs from the search area's, or a US state code other than
  the search area's own, the lead is flagged as a `[WARNING]` line appended to
  `Lead.quote_context` (no new column) — never suppressed,
  since the lead was paid for either way. The state check matches against an
  **allow-list of the 50 USPS codes plus DC**, not a denylist — an earlier denylist
  excluded "OK" and "ID" as ordinary prose words, which silently ate the Oklahoma and
  Idaho mismatches it existed to catch. Accepted residual: a description that happens
  to contain the word "OK" (as in "that's OK") can still produce a false positive.
  That's the accepted tradeoff — the flag only ever adds a warning, never hides a
  lead, so a false positive costs a glance and a false negative costs a shipped
  problem.
- **Thumbtack's business identity does not live on the Lead.** `Lead` has no
  `source_business` or `thumbtack_business_id` column — an earlier version of this
  plan assumed one, and it was wrong. The mapper extracts `business.businessID` from
  the payload, but the persister never writes it to a Lead field; it survives only
  inside `Lead.raw_payload` (kept indefinitely, admin-only — see below) and the
  webhook event's stored raw body (90-day retention, pruned by `prune_old_events`).
  If per-business reporting is ever needed, it has to be read back out of one of
  those two places, not queried off `Lead` directly.
- Re-delivery of the same `negotiationID` creates no second lead and no second
  finance expense — `_persist_lead`'s idempotency lookup on
  `(source_reference_id, source_type)` returns the existing lead id and does not
  touch cost sync or push again. The event itself is marked `processed` and linked
  to the found lead's id rather than left `received` forever — a delivery can no
  longer land in a silent limbo indistinguishable from one nobody has looked at.
  `event.error` is deliberately left untouched on this path: a redelivery is not
  the delivery that had the problem, and overwriting its error would misreport
  what actually went wrong and where.
- **A redelivered lead can never update an existing one.** If a redelivery carries a
  changed `chargeState` (e.g. Thumbtack refunding a lead after the fact) or any other
  changed field, the idempotency early-return above discards the new body entirely —
  the lead is never marked refunded and the expense is never reversed from a
  redelivery. Only a lead's *first* delivery is read for state; only a first
  delivery already carrying `chargeState: "Refunded"` is honoured.
- A body that `classify()` judged a lead by shape (a `leadID`/`request` pair, or a
  bare `negotiationID`) but the stricter mapper rejects — typically no
  `data.negotiationID` — is marked `failed` with an explicit `event.error`
  (`"Could not map this delivery as a Thumbtack lead..."`) rather than left
  `received` with nothing anywhere acting on it.
- **Thumbtack's synthetic test ping** (sent on webhook creation) carries no
  `negotiationID`, `leadID`, or any other kind-identifying field anywhere `classify()`
  looks — it is judged `unknown` before the mapper is ever reached, and creates no
  lead. Unlike a genuinely malformed lead body, this one is not marked `failed`: it
  stays `received`/`unknown` with no error, and a Retry tap on it is a no-op
  (`retry_event` refuses anything whose `kind != "lead"`).
- **The AI review does not auto-run on webhook leads**, deliberately — unlike the
  screenshot-intake path, which does chain OCR → AI review automatically
  (`IngestProgressFlow.tsx`). Auto-running it here would be a paid model call on
  every inbound lead, including broker leads and out-of-area ones the facilitator
  may never act on. The facilitator taps "Run AI review" per lead, same as any other
  lead.
- **Failed deliveries — and pre-Phase-2 backlog rows — can be retried from
  `/admin/thumbtack`**, and retry does three different jobs depending on the event:
  - **Replay.** An event that never became a lead (`failed` status) is re-mapped
    from its stored raw body — no request back to Thumbtack. An `unknown`-kind body
    (Thumbtack's synthetic test ping, above, is the one seen in practice) is **not**
    replayable this way: it has no `negotiationID` anywhere the classifier looks, so
    there is nothing for the mapper to re-map, and `retry_event` refuses anything
    whose `kind != "lead"` outright.
  - **Backlog.** A delivery captured by Phase 1, before Phase 2's mapping shipped, is
    `kind: 'lead'`, `status: 'received'`, `lead_id: null`, `error: null` — none of
    the other conditions match it. This is real and current: deliveries captured
    before this phase are still raw rows with no Lead, and they now have a working
    path back into the queue.
  - **Heal.** A delivery that already created its Lead but whose finance sync failed,
    or whose `leadPrice` could not be parsed, ends `processed`, not `failed` — the
    Lead is real, and marking it `failed` would invite a retry that (per the
    idempotency lookup) can never re-create it. `event.error` carries either
    `"lead created but lead cost sync failed: ..."` or `"lead created, but
    Thumbtack's lead price could not be parsed — cost left unset"`. Retrying
    re-derives the price and refund state from the **stored raw body** (not from
    the Lead row), so:
    - A cost-sync failure is retried against the already-created lead.
    - **An unparseable price is now genuinely repairable.** The unset-cost flag
      itself is unchanged (never guessed, never `0`) — what changed is that a retry
      re-runs the mapper against the same stored body, so if `parse_cents` is later
      fixed to handle whatever Thumbtack sent, retrying fills `lead_cost_cents`,
      syncs the expense, and clears the flag. If it still will not parse, the flag
      correctly stays.
    - The heal is gated on the **payload's own `chargeState`** (re-derived on every
      retry), not on `lead.lead_refunded_at` — a refund that failed to record
      (`mark_refunded` threw and rolled back) leaves that column `NULL` even though
      Thumbtack refunded the lead, and trusting the column would let the heal book a
      full-price expense on a refunded lead and report success.
  - Because of all three, the admin screen's Retry button renders on **three**
    conditions, not one: `event.status === 'failed' OR event.error OR
    (event.kind === 'lead' && !event.lead_id)` — the last reaches the backlog case,
    the second a `processed`-but-erroring heal case. `event.kind === 'unknown'` is
    **not** one of the three (dropped — see Replay above): every `unknown` body seen
    in practice is the test ping, which is never retryable, so a button that always
    no-ops was worse than no button.
  - **A successful retry clears a stale `event.error` on two different paths, not
    unconditionally.** At the bottom of `_persist_lead`'s main (non-early-return)
    path, `event.error` is always overwritten with whatever this attempt's own
    outcome is (`None` on a clean success) — a delivery that once failed mapping and
    was fixed on a later retry no longer keeps a permanent red `Mapping failed:`
    line. On the **idempotency-hit early return** (this event's `negotiationID`
    already has a lead, found via a sibling delivery), `event.error` is cleared only
    when that found lead is actually healthy — has its expense booked
    (`lead_cost_finance_transaction_id is not None`) or is legitimately refunded
    (`lead_refunded_at is not None`); otherwise it is left exactly as it was, since
    this early-return path does nothing to fix an unresolved problem and must not
    report one as fixed. (An earlier version of this doc said the clear was
    unconditional "at the bottom of `_persist_lead`" for every path — that
    contradicted the idempotency-lookup bullet a few lines above stating the error
    is deliberately left untouched there. Both bullets are now accurate for their
    own path.)
  - `RetryResult.created` is `True` **only** when the retry call genuinely inserted a
    new Lead row. A retry that found an existing lead via the idempotency lookup, or
    one that only healed a cost sync, returns `created: False` with a non-null
    `lead_id` — the two are not distinguished on the wire; both read as "Lead already
    existed — nothing new created" in the UI. "No lead at all" is the only case with
    `lead_id: None`.
  - **A refused retry now reports failure, not a misleading clean success.**
    Retrying an oversize-truncated body, or a non-`lead`-kind event, returns the
    event unchanged — no lead, and the error explaining the refusal still on the
    row. The frontend used to read that as "Nothing needed doing." (a green line
    right beside the row's own red error); it now checks for exactly this shape
    (`!result.lead_id && result.event.error`) and shows "Retry did not process this
    delivery — see the error above." instead, in the failure slot.
  - Two smaller guards on the retry path: an event `record_oversize` rejected for
    being too large (its stored body is a truncated 2KB prefix, never valid JSON) now
    **refuses** a retry instead of overwriting its one useful diagnostic — the size
    explanation — with a generic "Body is not valid JSON" error. And `retry_event`
    now carries the same `kind == "lead"` guard `record_event` already had: without
    it, retrying a message/review event that happens to carry the same
    `negotiationID` as a real lead could create a hollow Lead with no name, phone, or
    cost that would then win the idempotency lookup and permanently block the real
    lead from ever landing.
  - Any exception text written into `event.error` (a mapping failure, a database
    error) is passed through one helper, `_safe_exc_summary`, first — truncated
    before SQLAlchemy's `[SQL: ...]`/`[parameters: ...]` sections and hard-capped in
    length, so a DBAPI error can never dump bound query parameters (customer name,
    phone, address) into an API response or a log line. Every logging call around
    these paths uses `logger.error` with the same bounded summary, not
    `logger.exception` — the latter's traceback would carry the same unbounded text
    the summary exists to keep out. This helper has no dedicated unit test of its
    own (carried deliberately — low risk, and it's exercised indirectly by every
    failure-path test that checks `event.error`'s shape).

**Payload note.** The published Thumbtack documentation is wrong about seven fields —
`customer.name` is actually `firstName`/`lastName`, `category` is an object,
`request.title` does not exist, `schedule` is `proposedTimes[]`, `leadPrice` is the
string `"$15.88"`, `chargeState` is `"Charged"`, and `location.address1` is empty. The
real captured body is checked in at `app/backend/tests/fixtures/thumbtack_lead_v4.json`
and is the authority.

**Not in Phase 2:** photos (`request.attachments[]`), inbound messages, replying to
Thumbtack, and extracting the street address out of description prose. The AI review
does not auto-run on webhook leads (see above). Deliveries captured before Phase 2
shipped are still raw rows with no Lead — no backfill script was written; they can be
replayed one at a time from `/admin/thumbtack`'s Retry button once a connection
exists to own them.

**Known limitations carried into Phase 2, out of scope for this phase:**
- `push_service._send_one` (called from `send_push_to_roles`/`send_push_to_user`)
  invokes `pywebpush.webpush` as a plain blocking call from inside an `async def`,
  with no timeout — not offloaded to a thread pool. A wedged push provider blocks the
  event loop for the request that triggered it. Pre-existing before this phase; the
  Lead is always committed before the push is attempted, so this can stall a webhook
  response but cannot cost a lead.
- **No index on `Lead.source_reference_id`**, which the idempotency lookup above
  queries on every delivery. Pre-existing; a migration was ruled out of scope for
  this phase (the plan's global constraint was "no database migration — every column
  this writes already exists on `Lead`").
- **No frontend test harness exists in this repo.** The retry button (and everything
  else on the React side) is verified by `tsc --noEmit`, `npm run build`, and a human
  pass on a real device — not by an automated UI test suite.
- **The idempotency lookup is SELECT-then-INSERT with no unique constraint.**
  `Lead.source_reference_id` carries no `UNIQUE(source_reference_id, source_type)`.
  Two truly concurrent deliveries of the same `negotiationID` could both pass the
  lookup and each insert its own Lead and its own finance expense. Deliberately
  accepted for now — single Railway instance, single sender (Thumbtack), SQLite
  serializes writes, and the Lead itself commits before any of the slower paths
  (cost sync, push) — but a `UNIQUE(source_reference_id, source_type)` constraint
  belongs in the next migration this repo takes.
- **`Lead.lead_cost_gross_cents` is fed Thumbtack's pre-tax `subtotal`**
  (`leadPriceBreakdown.subtotal`), while the column's own meaning elsewhere in this
  app is pre-*discount* gross. With any nonzero `salesTax` on the breakdown, that
  inverts the usual gross-is-greater-than-or-equal-to-net invariant between this
  column and `lead_cost_cents`. Display-only today, and the mapping is what the
  design spec asked for — an inherited spec question, not a coding slip in this
  phase.
- **A refunded redelivery is discarded, not applied** (see the redelivery bullet
  above) — this is the same idempotency-lookup limitation stated twice because it
  costs real money if it happens: a lead refunded by Thumbtack *after* its first
  delivery already landed is never marked refunded here. Retrying the redelivery
  event by hand does not fix it either — the retry hits the same idempotency
  early-return (its `is_refunded` handling in `_persist_lead` is only reachable on
  the *first* delivery of a `negotiationID`), and `retry_event`'s heal block only
  ever runs the cost sync, never `mark_refunded`. The only fix today is manual, off
  the app.
- **`raw_payload` is admin-only, not broadly readable — and now structurally so
  everywhere it can appear.** It never appears on `LeadOut` (the list/every-other
  -route response model) at all — the field is structurally absent, not merely
  omitted by convention. `LeadDetailOut` (the schema where it does exist) has
  exactly one sanctioned constructor, `lead_service.to_lead_detail_out(lead, role)`,
  which redacts it to `null` for every role but admin when the lead's `source_type`
  is `thumbtack_api` (`lead_service.visible_raw_payload`) before returning. There
  are two callers of that constructor: `GET /leads/{id}` and
  `POST /ingest/screenshot` — the latter's `IngestResult.lead` is a `LeadDetailOut`
  too, and previously built it with a bare `LeadDetailOut.model_validate(lead)`
  that skipped the redaction step (an incidental non-leak only because a
  screenshot-sourced lead's `source_type` is never `thumbtack_api`, so there was
  nothing sensitive to redact yet — not a guarantee). Both routes now go through
  the one constructor, so the redaction holds by construction: any future caller of
  `LeadDetailOut` gets it for free rather than needing to remember
  `visible_raw_payload` itself. The stored column remains the permanent home of the
  Thumbtack business identity described above; it is just no longer something a
  supervisor or crew login can pull off a plain lead fetch or a screenshot upload —
  the captured body carries `business.accessCode`, a live `refundRequestLink` into
  Thumbtack's own refund flow, `customerID`, and `requestID`, which is a real
  privilege step-up over the name/phone/description already visible to every role
  as first-class columns.

---

### Lead pipeline & intake
- [x] Backend boots cleanly, loads `.env` (`load_dotenv` then Railway env override), prints grounding-file status on startup
- [x] Lead queue with filters (status, source type, assigned handler) and Active / Released tabs
- [x] Manual lead creation (`POST /leads`) with full field validation
- [x] Screenshot-first intake (`POST /ingest/screenshot`): upload → lead stub → OCR → auto-apply high-confidence fields
- [x] **Several screenshots per lead** (2026-09-01) — `POST /ingest/screenshot` takes up to 5 files; one lead, every shot attached, OCR on each, high-confidence fields merged. Where shots disagree, nothing is written and the conflict is shown on the upload screen and logged as a `field_conflict` event. Every file is validated before the lead is created. Both the ingest flow and the Lead Create drop zone accept several files and show conflicts
- [x] **AI review auto-fires after screenshot upload** — the client (`IngestProgressFlow.tsx`) chains upload → OCR → AI review with no manual click (failures are non-fatal; facilitator can re-run)
- [x] Claude Vision OCR extraction — 16 structured fields per screenshot with per-field confidence
- [x] Thumbtack webhook ingest (`POST /ingest/webhook/thumbtack`) with dedup by `source_reference_id`
- [x] Lead field editing (`PATCH /leads/{id}`), inline edit covering all fields, field provenance (`field_sources`: ocr/edited)
- [x] **Masked-phone handling** — Thumbtack masked values (`xxx`) are detected and skipped, never stored (`lead_service._is_valid_phone`)
- [x] Hard delete with cascade; archive (Release) as soft-delete; append-only operational notes; full event/audit trail
- [x] Tap-to-call / tap-to-text on customer phone
- [x] **Lead-cost tracking + competition capture** (Thumbtack Numbers alignment) — six `Lead` cols (`lead_cost_cents` net Total, `lead_cost_gross_cents`, `lead_cost_bonus_cents`, `lead_cost_finance_transaction_id`, `pros_contacted`, `pros_responded`); OCR reads the Thumbtack fee breakdown (Direct lead / Bonus / Total) + competition line, disambiguated from the "Estimated cost" quote, with `Decimal` money parsing; net total auto-syncs a lead-linked "Thumbtack lead fee" `FinanceTransaction` → flows into outcome realized_cost / ROI. Frontend `LeadCostCard` in the Brief panel
- [x] **Thumbtack Numbers (proxy phone)** — `Lead.customer_phone_is_proxy` + `Lead.customer_real_phone`; `contact_phone(lead)` helper (real-if-valid-else-proxy) used by Square payment SMS + exposed as computed `LeadOut.contact_phone`; proxy auto-tagged when a valid `customer_phone` is set on a Thumbtack-source lead (manual override persists). Frontend `LeadContact` ("needs a number" prompt, "Thumbtack line" badge, real # as Primary, inline edit)
- [x] **72-hour refund-eligible flagging** — `Lead.customer_responded_at` + `Lead.lead_refunded_at`; candidate-only (never auto-concludes), computed client-side (Thumbtack + early status + 72h since arrival + unresolved); four reversible resolve endpoints (`POST/DELETE /leads/{id}/customer-responded` + `/refund`), each emitting a `LeadEvent` with the acting user; marking refunded reversibly drops the lead-fee expense (realized_cost → 0) while preserving `lead_cost_cents`. Frontend `RefundBanner` (candidate → resolved chips w/ Undo → pre-empt marker) + a "Refund-eligible" queue band

### Lead state machine (contact-lock fully replaced)
- [x] States: `new → in_review → replied → waiting_on_customer → ready_for_quote → ready_for_booking → booked → released → lost`
- [x] Auto-transitions live in `lead_service.py`: open detail → `in_review`; valid phone on in_review/replied → `waiting_on_customer`; job address entered → `booked`
- [x] **`escalated` is no longer a pipeline stage** — escalation is a resolvable overlay (see below). The `escalated` enum value stays defined for legacy rows but is unreachable; a startup migration (`_migrate_escalated_status_leads`) moves any legacy `escalated` lead back to its prior stage and opens an overlay.
- [x] Old contact-lock columns (`contact_status`, `acknowledgment_sent`) removed from the model (orphaned migration default remains — see Broken/In Progress)

### Escalation overlay (risk-based, reconciled with the idle timer)
- [x] Escalation modeled as a separate `LeadEscalation` row (overlay), independent of pipeline status — a lead keeps its real stage *and* carries an open escalation
- [x] Manual raise from the lead window Log tab: level (`monitor` / `pause` / `owner_takeover`) + decision-needed + AI-prefilled Escalation Summary (`escalation_service.suggest_summary`, reuses the AI-review grounding/client helpers)
- [x] Resolve flow (owner): outcome (`approved` / `adjusted` / `owner_takeover` / `release` / `need_more_info`) + note → closes the overlay, writes a `LeadEvent`, notifies the handler
- [x] Notifications: raise → push to `["admin"]` only (supervisor dropped 2026-06-25 — they don't act on escalations / can't open leads); resolve → push to `facilitator` (best-effort, reuses `send_push_to_roles`). T2 staleness push also drops supervisor. The booked-lead / new-job-assignment push to supervisor + crew is unchanged.
- [x] **Idle ladder reconciled** — at T2 the timer raises an `auto_idle` overlay (`open_auto_escalation`, idempotent) instead of flipping `status` to escalated; the Aging/Overdue staleness signal and T1/T2 alert pings are unchanged
- [x] Surfaced on the queue as a pinned "⚠ Escalations" band + an `⚠ Escalated` badge on each lead card; endpoints in `routers/escalation.py` (`POST/GET /leads/{id}/escalation`, `/escalation/suggest`, `POST /escalations/{id}/resolve`, `GET /escalations`)

### Self-learning roadmap (4 items)
**Item 1 — outcome layer (done).** **Item 2 — retrieval grounding for the quote (done).** **Item 3 — quote-grounding eval (done).** Item 4 (regeneration/fine-tune) not built yet.

#### Item 3 — quote-grounding eval
- [x] Every `suggest_quote` call writes an append-only **`quote_suggestion_log`** row (provenance): `was_grounded`, `comparables_count`, the AI's reconciled `suggested_price_cents`, `model_used`. Best-effort — a log failure never breaks quoting.
- [x] `GET /admin/eval/quote-grounding?city_id=` (now **admin + facilitator**) reports **grounded vs ungrounded** cohorts by joining the latest log per lead to finalized outcomes: per cohort `n`, `win_rate`, `priced_n`, **`pricing_accuracy`** (mean `|suggested−realized|/realized`), **`pricing_bias`** (signed — negative = underpricing), plus `won` / `lost` exposed on `CohortMetrics`. Won+realized jobs only for pricing; `$0` realized excluded (divide-by-zero guard); null metrics with `n` shown for empty cohorts. `eval_service.compute_quote_grounding_eval`. 13 tests.
- [x] **Grounding-eval view (facilitator-friendly)** — `AdminQuoteGroundingScreen` renders plain-language metric cards (Win rate w/ won·lost, Pricing accuracy, Over/under) with sample-gated takeaway + per-metric winner marks; reached via an Admin card + a "How grounded quoting is performing" link in the Quote panel.
- [x] This is the loop's measurement: it tells you whether item-2 grounding actually improved pricing/conversion. Only evaluable once provenance + outcomes accumulate (documented).

#### Item 2 — retrieval grounding (quote)
- [x] Before drafting a quote, `quote_service` retrieves the **top-5 most similar same-city finalized outcomes** (won + lost) via `comparables_service.find_comparables` — structured attribute scoring over each outcome's frozen `scope_snapshot` (size +3, distance +2/+1, move_type +1, stairs +1), **no embeddings**, explainable.
- [x] Injects a `COMPARABLE LOCAL JOBS` block into the prompt so the AI anchors on what comparable local jobs actually sold for (`realized` price, or `quoted` fallback), labeled won/lost — not just SOP bands.
- [x] **Cold-start safe:** no comparables → no block → prompt byte-identical to before (zero regression). Retrieval never breaks quoting (`_safe_find_comparables` degrades to `[]` on any error). The comparables used are returned on `QuoteSuggestionOut.comparables`. 11 tests.
- [x] **Per-quote basis (transparency)** — `comparables_json` + `rationale` persisted on `quote_suggestion_log`; `GET /leads/{id}/quote-suggestion/latest` (city-scoped, malformed-safe) returns the latest snapshot. Frontend `QuoteBasis` section in the Quote panel shows the comparable jobs the AI anchored on (price · Realized/Quoted · Won/Lost · why-similar · tap-to-open) + grounded/cold-start badge + persisted rationale, live-first with background reconcile.

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
- [x] **Quote builder in the lead window** — inline builder + pinned quote bar; the window opens on Brief (2026-06-15/16)
- [x] **AI-assisted quote drafting** — `POST /leads/{id}/quote-suggestion` drafts total, line items, duration and rationale; "Suggest with AI" fills the builder, facilitator edits before Lock & Book (2026-06-15)

### Booking, jobs & crew
- [x] Booking confirmation flow: `confirmationText.ts` template, JobModal with View Lead + Copy Confirmation, editable confirmation, date ranges (`job_date_end`)
- [x] Jobs screen (Scheduled / In Progress) with phase tracking (dispatched → en route → arrived → started → completed), live timers, before/after photos
- [x] Crew assignment (`job_assignments` many-to-many); admin/facilitator assign crew, admin updates job status; role-gated phase locking
- [x] **Crew agenda** — for crew the Jobs tab is a single agenda: active/in-progress job pinned ("Continue job"), then Today / Tomorrow / This week / Later, with an Upcoming / Completed toggle; Calendar tab hidden for crew, office keeps it. Frontend-only (`utils/jobAgenda.ts`, `components/CrewAgenda.tsx`), reuses `GET /jobs`
- [x] **Completed Jobs view** — `GET /jobs?status=completed`; completed jobs carry `realized_revenue_cents` (live income sum) + `completed_at`; read-only Completed tab with an "N completed · $X realized" header
- [x] **My Pay & hours** — `GET /users/me/pay` returns the caller's own pay records (scoped to `user_id`) + totals (earnings, hours, job count); a "My Pay" section in Settings, all roles, own pay only (`MyPayEntry`/`MyPayOut` schemas)
- [x] **Per-job checklist (items to bring)** — `lead_checklist_item` table + `Lead.checklist_seeded_at`; lazily seeded once on first open of a booked job from a configurable standard kit (`AppSetting`, editable in Settings by admin/facilitator) + code-driven scope extras (stairs → stair dolly, large move → blankets, hauling → bags, truck unless labor-only); crew-owned per-lead item CRUD + `GET/PUT /settings/checklist-kit`. Frontend `JobChecklist` in the working modal (optimistic, scope/added tags, 44px targets) + `StandardKitEditor` in Settings

### Calendar & Google Calendar
- [x] **Week-first calendar** (default): tap-to-expand day list for the current week, today highlighted, day quote totals; **Week / Month toggle**; collapsible "needs a date" banner (added 2026-06-15)
- [x] Month view: existing grid + stat cards + selected-day detail (behind the toggle)
- [x] Google Calendar OAuth (`/admin/google` connect/callback/status), auto-sync on job date/address/notes/crew changes (`calendar_service`); booked jobs sync even with no crew assigned, crew are optional attendees (2026-06-18)
- [x] Recurring expenses render on the calendar (admin)

### Admin & finance
- [x] Admin hub + mobile bottom nav; multi-city isolation (`CityContext`, `CitySwitcher`, per-city scoping)
- [x] Admin Users (roles: admin/facilitator/supervisor/crew, hourly rate, Google email)
- [x] Finance tracking (income/expense transactions, categories, payment methods, vendor/customer, lead linking, summary)
- [x] Recurring expenses (templates, custom intervals, `/due` badge, one-tap log → FinanceTransaction + GCal event move)
- [x] Payroll (per-lead PayRecord: flat / hourly / 10% facilitator cut; AdminPayrollScreen aggregation)
- [x] Truck rentals (TruckRental model, receipts, U-Haul deep link, AdminRentalsScreen, queue badge); staged card (Reserved → Confirmed → Completed), confirmation-screenshot OCR pre-fill, auto-synced "Truck Rental" expense, line-item add in the quote builder (2026-06-15)
- [x] Admin metrics dashboard (pipeline, conversion, revenue, sources, reply time)
- [x] Follow-up scheduler with push reminders

### Notifications, auth, infra
- [x] JWT auth (python-jose + bcrypt), role guards on routes
- [x] Push notifications (VAPID/pywebpush) + service worker; availability models (per-date + weekly, weekly blocked by morning / afternoon / evening, days x periods grid in Settings); stale-subscription cleanup
- [x] **Alert ladder** — T1/T2 idle thresholds (configurable in Settings), dedup, quiet hours, backup handler (SMS/email), test-alert buttons; at T2 an `auto_idle` escalation overlay opens
- [x] Configurable alert channels per tier (push / SMS via Twilio / email via Resend+SMTP)
- [x] Square payment integration (payment links, webhook, status chips, copy-link)
- [x] Dark mode (ThemeContext, defaults dark)
- [x] 17 routers; 20 tables; SQLite async (aiosqlite); idempotent startup migrations
- [x] Deploy config: **Railway for both services** — backend (`railway.toml` + `Procfile`, uvicorn) and frontend (`serve.json` SPA rewrites, served via `serve` after `npm run build`). `vercel.json` carries the same rewrite but is vestigial; the live frontend is Railway. Production host is a `*.railway.app` domain (see `.env.example`); DB is SQLite on a Railway `/data` volume.
- [x] **SPA deep-link routing fixed** — typed/refreshed deep links 404'd in production because `serve` reads SPA rewrites from a `serve.json` *in the served dir* (`dist/`) but it lived in the project root; moved to `app/frontend/public/` so the build emits `dist/serve.json` with the `/** → /index.html` rewrite (2026-06-24)

### Help / onboarding
- [x] **Role-aware `/help` guide** — passive reference at `/help`: collapsible accordion sections (lifecycle walkthrough + glossary), reached from a "Help" entry in Settings. Content in one typed data file (`content/helpContent.ts`), no markdown dependency, static. `HELP_GUIDES{facilitator, supervisor}` + `guideForRole(role)` (admin→facilitator); the screen renders the viewer's guide
- [x] **Supervisor (on-site-lead) guide** — jobs-centric: phase tracking, crew, photos/notes, calendar, glossary. `/help` route widened to admin + facilitator + supervisor with a role-adaptive label

### Lead decision card (Phase A)

- A card at the top of the lead window, on every tab: target range, walkaway floor,
  what kind of job it is, and the unknown that decides the price rendered with what
  each answer is worth ("standard sofa $525 / sectional $650").
- Fed by optional structured fields on `AiReviewSections` (`sayability`, `target_low`,
  `target_high`, `floor`, `band_position`, `band_reason`, `range_levers`,
  `floor_defense`), derived by the model from prose sections G, H, I, and L. No
  database migration — they live inside the existing `sections_json` column.
- Money is validated at parse time and **dropped wholesale** on failure: if
  `floor <= target_low <= target_high` does not hold, all four figures become null and
  the card shows "no quotable number" with a re-run action. It never renders a partial
  set. Every drop is logged with the lead id.
- Reviews written before this feature validate unchanged and show the re-run state.
  Figures are never parsed out of legacy prose.
- When the AI review is in `hold` state (scope too unresolved to price), the card
  suppresses the target range, price levers, and floor-defense line. A `hold` review
  can carry money fields (holdover from legacy reviews), but they are not rendered.
- The A–O pricing sections are now one collapsed "Full analysis" accordion.
- `RefundBanner` moved inside the scroll region; it previously occupied permanent
  height above it on every tab.

### Lead window — Phase B (density and one-voice pricing)

- `Booking Date` renders once on Brief. The deleted row was the only path that
  wrote `job_date_requested` without `job_date_end`, so editing through it stranded a
  previously-set end date. Already-stranded values are not cleaned up — only new ones
  are prevented.
- `Est. Duration` is edited on the Quote tab and displayed read-only on Brief. Two
  controls previously wrote one field through two save paths, so a stale quote draft
  could silently revert a Brief edit.
- The intake screenshot is a 64px thumbnail row that opens full-size on tap, replacing
  a ~192px crop whose visible content duplicated the table beneath it.
- The walkaway floor renders beneath the quoted-price input, and turns to a warning
  stating the gap when the typed total is below it. **Non-blocking by design** — the
  failure being fixed is not knowing, not being allowed. Nothing renders when the
  review carries no validated floor.
- `suggest_quote` now anchors to the A-O review's validated `target_low`/`target_high`/
  `floor` when present, so the builder and the decision card cannot state different
  bands. With no structured figures the prompt is byte-identical to before, so legacy
  reviews behave exactly as they did.

**Not in Phase B:** comparables quality — four comparables spanning $200-$950, each
showing a single filled dot, under a badge reading "GROUNDED · 4 LOCAL JOBS". That is a
`find_comparables` scoring problem and has its own pass.

---

## Partially Working / Needs Live Verification

- [ ] **New week-first calendar UX** — compiles + builds clean, but not yet visually verified in the running app on tablet (spacing, expand interaction, week-range label)
- [ ] **`quote_context` use by the AI** — confirmed to reach the review snapshot (guard test), but the model's actual *use* of it not yet checked on a real lead
- [ ] AI review failure is swallowed silently in the ingest flow (`IngestProgressFlow.tsx:62-63`) — a failed review is invisible to the facilitator until they open the Quote panel
- [ ] Auto-apply accuracy: only `confidence == "high"` OCR fields apply silently — needs real-world test
- [ ] Thumbtack webhook HMAC signature verification — not implemented (TODO before production)

---

## Broken / In Progress

- [x] ~~11 backend tests failing~~ — **fixed 2026-06-15**. All were stale tests that hadn't kept up with the multi-city/payroll changes (not app bugs): `test_calendar_service.py` had an incomplete model-import list (`Lead.pay_records → "PayRecord"` unresolvable, order-dependent), `fake_get_credentials` mocks missing the `city_id` arg, and `_build_event_body` calls missing the `time_zone` arg; `test_chat.py` treated the `ChatResponse` object as a bare list. Full suite now green.
- [ ] **Orphaned schema**: startup migration still creates `contact_status` / `acknowledgment_sent` columns (`main.py`) though the model dropped them — harmless but confusing dead schema
- [ ] **Grounding file path is an absolute Windows path** in `.env` (points into the KOS vault) — not portable; will break on Railway. Deploy risk.

---

## Planned / Not Yet Built

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

- Date: 2026-10-22
- By: Claude (re-baseline: suite run, CHANGELOG/CAPABILITIES backfilled past Slice 8)
- Tests: **480 passed, 0 failed** (full backend suite, `main` at `c0288c4` plus the Google status-test isolation fix). Before that fix: 477 passed, 3 failed (`test_admin_google.py` status tests depended on the machine's `.env`).
- Frontend build not re-run in this pass.

### Previous verification

- Date: 2026-06-25
- By: Claude (crew-assist: My Pay + per-job checklist; Thumbtack Numbers alignment: lead-cost + proxy phone + 72h refund flag; quote-logic transparency: per-quote basis + grounding-eval view; role-aware /help + supervisor guide; SPA deep-link fix; escalation-push cleanup)
- Tests: **392 passed, 0 failed** (full backend suite, 2026-06-25). Frontend `tsc --noEmit` + `vite build` pass.
- Notes (2026-06-25): **Role-aware `/help`** — generalized to `HELP_GUIDES{facilitator, supervisor}` + `guideForRole`; added a supervisor (on-site-lead) guide; route widened to admin + facilitator + supervisor. **Escalation-push cleanup** — supervisors dropped from escalation-raise and T2 staleness pushes (raise now `["admin"]`); booked-lead / new-job-assignment push to supervisor + crew unchanged. **(2026-06-24)** Per-quote basis (`comparables_json` + `rationale` persisted, `GET /leads/{id}/quote-suggestion/latest`, `QuoteBasis` panel); grounding-eval view opened to facilitator (`AdminQuoteGroundingScreen`); facilitator help guide; SPA deep-link fix (`serve.json` → `app/frontend/public/`). **(2026-06-22)** 72h refund-eligible flagging (`customer_responded_at` / `lead_refunded_at`, four reversible endpoints, `RefundBanner`). **(2026-06-19, this earlier block carried below)** Crew agenda — for crew, the Jobs tab is now a single agenda: the active (in-progress) job pinned at top ("Active now" + Continue job), then upcoming jobs grouped Today / Tomorrow / This week / Later, with an Upcoming / Completed toggle; the Calendar tab is hidden for crew (office roles keep it), so crew see just Jobs + Settings. Frontend-only (`utils/jobAgenda.ts` `bucketJobsByDay` + `components/CrewAgenda.tsx`, role-branched in `JobsScreen`; reuses `GET /jobs`). Office Jobs/Calendar unchanged. First of three crew-assist features (next: pay & hours, per-job checklist). **Completed Jobs view** — the Jobs screen now has a Completed tab. `GET /jobs?status=completed` (default `booked`, unchanged) returns released jobs with `realized_revenue_cents` (live income-finance sum) + `completed_at` (from the released event), newest-first, batched (no N+1); the tab is a read-only history with a `N completed · $X realized` header. Earlier this session: **per-period weekly availability** (block morning/afternoon/evening per weekday; `UserWeeklyAvailability` gained a `period` column + expand-existing migration — note the migration index-name-collision hotfix `a64fbf4`); **Google Calendar sync no longer requires crew**; self-learning roadmap **items 1-3**; the escalation overlay. Next roadmap piece: item 4 (regeneration/fine-tune).
