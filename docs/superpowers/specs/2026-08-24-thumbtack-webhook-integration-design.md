# Thumbtack Webhook Integration — Design Spec

**Date:** 2026-08-24
**Status:** Approved direction, pre-implementation
**Author:** Ron + Claude
**Branch:** `feat/thumbtack-webhooks`

## Problem

Thumbtack leads are worked by hand. A lead arrives in the Thumbtack app, someone screenshots it, uploads it to this app, OCR extracts the fields, and only then does it enter the facilitator queue. That delay costs conversion — speed-to-response is the single biggest driver of close rate on this channel — and every hand-off is a chance for a lead to be dropped entirely.

Thumbtack now offers **self-serve webhooks** at `thumbtack.com/pro/webhooks/create`: an endpoint URL, an optional authorization type, one business profile per webhook, and three event checkboxes (Lead details, Messages, Reviews). No partnership approval is required.

This supersedes `06_Projects/holy-hauling-app/thumbtack-api-outreach.md` in the Knowledge Operating System, which planned an outreach email to `teampartnerships@thumbtack.com` to request Pro Partner API access. That path is no longer a prerequisite for inbound lead delivery. It remains the only route to **outbound** messaging (see Non-goals).

## Why the existing receiver cannot be used as-is

`POST /ingest/webhook/thumbtack` already exists in `app/routers/ingest.py`, with normalization and dedup in `ingest_service.ingest_thumbtack_webhook`. It has never received a real delivery, and in its current form it cannot. Five defects:

1. **It requires a logged-in user.** The route declares `current_user: User = Depends(require_auth)`, which demands a JWT bearer token. Thumbtack sends an unauthenticated server-to-server POST. Every delivery would 401.
2. **The payload schema is wrong.** `ThumbTackWebhookPayload` requires a top-level `event` string and nests the lead under a `lead` key. Thumbtack's actual lead webhook has no `event` wrapper — `leadID`, `createTimestamp`, `request`, `customer`, and `business` are all top-level. Pydantic would 422 before the normalizer ran, and the lead would silently never exist.
3. **City comes from the authenticated user.** `city_for_create(current_user, city_id)` cannot resolve a city when there is no user.
4. **No business tagging.** Holy Hauling and Holy Handy are separate Thumbtack accounts. Nothing on the lead records which one a webhook lead came from.
5. **It bypasses proxy-phone tagging.** The service constructs `Lead(...)` directly with normalized fields, so `lead_service._tag_proxy_on_phone_set` never fires. A Thumbtack proxy number would be saved as though it were the customer's real number — exactly the misrepresentation `2026-06-19-thumbtack-numbers-design.md` was written to prevent.

The current code is therefore a starting point for the mapping logic, not a working receiver.

## Reference payloads

Taken from the Thumbtack API reference (`https://pro-api.thumbtack.com/docs/`). These document the **Partner** API. The self-serve webhook product may differ; Phase 1 exists specifically to confirm the real shape before any mapping is written against it.

**Lead**

```
leadID, createTimestamp, leadType, leadPrice, chargeState
request: { requestID, category, categoryID, title, description, schedule,
           location: { address1, address2, city, state, zipCode },
           travelPreferences,
           details: [ { question, answer } ],
           attachments: [ { fileName, fileSize, mimeType, url, description } ] }
customer: { customerID, name, phone }
business: { businessID, name }
```

**Message**

```
leadID, customerID, businessID
message: { messageID, createTimestamp, text,
           attachments: [ { fileName, fileSize, mimeType, url, description } ] }
```

**Review** (out of scope this build, documented so it slots in later)

```
review: { reviewID, businessID, leadID, categoryID, rating, text,
          reviewerNickname, createTime, modifyTime, verified, photos: [...] }
reviewEventType
```

Authorization on the Partner API is HTTP Basic. The self-serve form's "Authorization type (optional)" dropdown is presumed to offer the same; the design does not depend on it (see Security).

## Goals

1. A Thumbtack lead lands in the facilitator queue in real time, with no screenshot and no OCR.
2. Every webhook lead is tagged with the business it came from (Holy Hauling / Holy Handy) and is filterable by it.
3. Each webhook is pinned to one city, configured in the app, not in environment variables.
4. Lead cost is populated from Thumbtack's own `leadPrice` rather than typed by hand, and stays consistent with the existing finance sync.
5. Customer photos attached to a lead are visible on the lead before quoting.
6. A customer message on a Thumbtack lead appears on that lead and notifies the facilitator.
7. A webhook that stops delivering is **visible**, not silent.

## Non-goals

- **Replying to Thumbtack from this app.** Self-serve webhooks are inbound only. Outbound messaging requires the Pro Partner API and OAuth. The lead screen will state this plainly rather than imply a reply is possible.
- **Reviews.** Deliberately deferred. The data model and event ledger are shaped so reviews are additive later, with no rework of the receiver.
- **OCR on webhook leads.** Webhook leads arrive structured; there is nothing to extract.
- **Backfilling historical Thumbtack leads.** Webhooks deliver forward only.

## Decisions locked during brainstorming

| Decision | Choice | Rationale |
|---|---|---|
| City routing | One webhook per city, pinned to that city in the app | Ron's choice. Simpler and exact; no zip-to-metro guessing and no wrong-city cleanup. |
| Two accounts | Tag on the lead, shown and filterable in the queue | One shared queue is still the working surface; the tag preserves the lead-budget separation for reporting. |
| Connection config | Records managed in the app, not env vars | Ron creates webhooks himself on a tablet and needs copyable credentials. Env-var config is applied by a running process and drifts from live state. |
| Messages | Stored on the lead **and** notify | Speed-to-response is the stated close-rate driver; a silent inbox defeats the purpose. |
| Reviews | Deferred | Ron's call, superseding an earlier "all three". Reviews remain additive. |
| Lead cost | Auto-filled from `leadPrice` | Removes manual entry and makes cost-per-lead trustworthy. |
| Photos | Downloaded and attached to the lead | Thumbtack attachment URLs may expire; copies are needed to be useful at quoting time. |
| Receiver posture | Capture-first: store raw, always 200, then parse | The self-serve payload shape is unconfirmed. An unparsed lead visible in a list beats a 422 and a lead that never existed. |

### Assumption requiring confirmation

**AI review runs automatically on webhook leads.** Webhook leads arrive with structured data and skip OCR entirely, but the A–O review grounded in the pricing SOP is what produces quote guidance, so withholding it would make webhook leads *less* useful than screenshot leads. This spec assumes auto-run. If Ron would rather trigger it manually, that is a one-line change in the ingest path and no structural rework.

## Architecture

### Data model

Three new tables. All are created by `create_all` at startup, so they carry **no migration risk** — no table rebuild, no `ALTER` on a populated table.

**`thumbtack_connections`** — one row per webhook created in Thumbtack.

| Column | Type | Notes |
|---|---|---|
| `id` | String PK | uuid |
| `label` | String | e.g. "Holy Hauling — St. Louis" |
| `city_id` | String FK → cities | The pin. Every lead from this connection gets this city. |
| `business` | String | `holy_hauling` \| `holy_handy` |
| `business_id` | String, nullable | Thumbtack `business.businessID`, learned from the first payload |
| `auth_username` | String, unique | Basic-auth username Thumbtack sends, when it can send one. Not the lookup key — see the receiver. |
| `auth_secret_hash` | String | Hashed, never stored or displayed in plaintext after creation |
| `url_token` | String, unique | Unguessable path segment; the fallback identifier if Thumbtack cannot send credentials |
| `is_active` | Boolean | Disable without deleting |
| `last_event_at` | DateTime, nullable | Drives the health indicator |
| `last_error_at` | DateTime, nullable | Drives the health indicator |
| `created_at` | DateTime | |

**`thumbtack_webhook_events`** — the capture-first ledger. Every accepted request lands here before anything is parsed.

| Column | Type | Notes |
|---|---|---|
| `id` | String PK | |
| `connection_id` | String FK | |
| `kind` | String | `lead` \| `message` \| `review` \| `unknown` |
| `external_id` | String, nullable | `leadID` / `messageID` once known |
| `raw_body` | Text | Verbatim request body |
| `status` | String | `received` \| `processed` \| `duplicate` \| `orphaned` \| `failed` \| `ignored` |
| `error` | Text, nullable | Parse or processing failure detail |
| `lead_id` | String FK, nullable | Set once linked |
| `received_at` | DateTime | |
| `processed_at` | DateTime, nullable | |

**`lead_customer_messages`** — the Thumbtack conversation.

| Column | Type | Notes |
|---|---|---|
| `id` | String PK | |
| `lead_id` | String FK → leads | |
| `external_message_id` | String, unique | Idempotency key |
| `direction` | String | `inbound` only for now; the column exists so outbound is additive if the Partner API is ever obtained |
| `text` | Text | |
| `sent_at` | DateTime | Thumbtack's `createTimestamp` |
| `received_at` | DateTime | |

This table is deliberately **separate from `lead_chat_messages`**, which is the AI assistant thread (`role` = user/assistant, FK to `ai_reviews`). Mixing a customer conversation into that table would corrupt the AI chat context and the review linkage.

**Additive columns on `leads`** — via a new `_migrate_leads_add_thumbtack_columns(conn)` in `main.py`, following the existing `_migrate_leads_add_v7_columns` pattern (`ALTER TABLE ... ADD COLUMN`, guarded by a column-presence check, no rebuild):

| Column | Type | Notes |
|---|---|---|
| `source_business` | String, nullable | `holy_hauling` \| `holy_handy` |
| `thumbtack_business_id` | String, nullable | From `business.businessID` |

Everything else reuses existing columns: `source_reference_id` (leadID), `source_type` (`thumbtack_api`), `lead_cost_cents`, `lead_refunded_at`, `customer_phone_is_proxy`, `raw_payload`.

**`screenshots.screenshot_type`** gains a third value, `customer_photo`, alongside `intake` and `correspondence`. No schema change — the column is already a free-text `VARCHAR` with a default.

### The receiver

One public route, modelled directly on `app/routers/square_router.py`, which is the repo's existing hardened inbound-webhook pattern (raw body, signature verify, fail-closed in production, `include_in_schema=False`).

```
POST /ingest/webhook/thumbtack/{url_token}
```

The token is in the path so the endpoint works whether or not Thumbtack can send an Authorization header. Order of operations:

1. **Identify the connection** by `url_token`, then, if an `Authorization` header is present, verify the Basic credential against `auth_secret_hash` using `hmac.compare_digest`. Unknown token or bad credential → **401, nothing stored.** Storing unauthenticated bodies would let anyone fill the ledger.
2. **Read the raw body**, capped at a sane size limit.
3. **Write a `thumbtack_webhook_events` row with `status='received'` and commit.**
4. **Return 200.** Everything past this point is best-effort and can never turn a delivered event into a lost one.
5. **Classify by body shape**, since the Thumbtack form sends all checked event types to one URL:
   - a `message` object present → message
   - `review` or `reviewEventType` present → review (recorded, `status='ignored'` this build)
   - `leadID` with a `request` object → lead
   - anything else → `unknown`, left in the ledger for inspection
6. **Process**, updating the event row to `processed` / `duplicate` / `orphaned` / `failed` with the error text on failure. Update `last_event_at` or `last_error_at` on the connection.

**Idempotency** is on Thumbtack's own identifiers: a lead whose `leadID` already exists for this connection is a `duplicate` and creates nothing; a message whose `external_message_id` exists is a `duplicate`. Retried deliveries are therefore safe.

### Lead mapping

Built on the existing `_normalize_thumbtack`, corrected for the real payload and extended.

| Thumbtack | Lead |
|---|---|
| `leadID` | `source_reference_id` (+ `source_type = thumbtack_api`) |
| connection | `city_id`, `source_business` |
| `business.businessID` | `thumbtack_business_id` |
| `customer.name` | `customer_name` |
| `customer.phone` | `customer_phone` — **routed through the proxy-tagging path**, see below |
| `request.title` / `description` | description fields |
| `request.category` | category |
| `request.location.*` | address, city, state, zip |
| `request.schedule` | requested service date |
| `request.details[]` | Q&A pairs appended to the lead's detail text |
| `leadPrice` | `lead_cost_cents` |
| `chargeState` | `lead_refunded_at` when refunded |
| whole body | `raw_payload` |

**Proxy phone.** A Thumbtack-sourced phone is a proxy line, not the customer's number. The mapping must set `customer_phone_is_proxy = True` explicitly, or route through `lead_service._tag_proxy_on_phone_set`, rather than constructing the `Lead` with a bare `customer_phone`. Masked intake values (`314-xxx-xxxx`) must continue to be rejected by the existing `_is_valid_phone()` and leave the lead in the "needs a number" state that spec defined.

**Lead cost.** `leadPrice` populates `lead_cost_cents` and then calls the existing `lead_cost_service.sync_lead_cost_expense`, which creates the linked `FinanceTransaction`. Two constraints, because this is a money path:

- The sync must be **idempotent** — a redelivered webhook must not create a second expense. `lead_cost_finance_transaction_id` already exists for exactly this and must be honoured.
- If `leadPrice` is absent, malformed, or in an unexpected unit, the cost is **left unset and the event flagged**, never guessed. A missing figure that is visibly missing is safe; a wrong figure silently entering the books is not.

`chargeState` indicating a refund sets `lead_refunded_at` through the existing `lead_service.mark_refunded` path so the audit event is written.

**Photos.** `request.attachments[]` are downloaded and stored as `Screenshot` rows with `screenshot_type = 'customer_photo'` and `ocr_status` left `NULL`. OCR must **not** run on them: the OCR service extracts lead fields from Thumbtack *screenshots*, and pointing it at a photo of a customer's garage produces garbage fields with false provenance. Download failures are non-fatal — the lead is still created, and the failure is recorded on the event row.

**AI review** runs automatically after the lead is created, per the assumption above.

### Messages

A message is attached to the lead with the matching `source_reference_id` **and** connection. If no such lead exists — a message on a lead that predates the integration — the event is marked `orphaned` and kept, not dropped. Thumbtack's documentation notes partners may return 202 for this case; the ledger already gives us a place to see them and, later, to reconcile.

On a successfully attached message, `push_service.send_push_to_roles` notifies the facilitator role scoped to the connection's city. Message attachments follow the same `customer_photo` path.

The lead detail screen gains a **customer conversation** section: read-only, newest last, with an explicit note that replies must be sent in the Thumbtack app. It must not present a text input that cannot send.

### Admin screen — Settings → Thumbtack

A list of connections, each showing label, city, business, a health indicator derived from `last_event_at` / `last_error_at`, and relative last-received time.

**Add connection:** label, city, business. On save the app generates the URL and credentials and shows them **once**, with copy buttons. Per the repo's tablet-first rule, every control is at least 44px and nothing depends on hover.

Per house rules, all three action states ship in the same pass for every write: an in-progress indicator, an explicit success confirmation, and a recoverable failure path. This applies to create, disable, delete, and retry.

**Delete and disable are both in scope.** Disable stops processing while keeping history; delete removes the connection and is confirmed before it runs.

**Recent events:** the last 50 events with kind, status, time, and — for `failed` and `unknown` rows — the raw body and a **retry** action. This is what turns an unknown payload shape into a five-minute fix instead of a silent outage.

### Security

- Credentials are stored hashed and compared with `hmac.compare_digest`. The plaintext secret is shown once at creation and never again.
- The `url_token` is generated with `secrets.token_urlsafe` and is unguessable on its own.
- Unknown token or failed credential check → 401 with nothing written.
- Request bodies are size-capped.
- Raw bodies contain customer PII (name, phone, address). They are stored in the ledger, which is admin-only, and must **not** be written to application logs at `info` level.
- The ledger needs a retention policy so PII does not accumulate indefinitely; events older than **90 days** are pruned.

## Phasing

The self-serve payload shape is the largest unknown in this build. The phasing exists to convert it into a fact before anything depends on it.

**Phase 1 — Connect and capture.** Connections table, admin screen, receiver, event ledger. Nothing is parsed; every event lands as `unknown`. Ron creates one real webhook in Thumbtack against the deployed URL. We read real payloads from the events list.

*Exit criterion:* a real Thumbtack delivery is visible in the app with its raw body, and the connection shows a recent last-received time.

**Phase 2 — Leads.** Mapping written against the confirmed payload, including business tag, proxy phone, lead cost + finance sync, and `details[]`. AI review auto-runs.

*Exit criterion:* a real Thumbtack lead appears in the facilitator queue, correctly tagged and costed, with the phone marked as a Thumbtack line.

**Phase 3 — Photos.** Attachment download, `customer_photo` storage, display on the lead.

**Phase 4 — Messages.** Message model, attachment to lead, orphan handling, push notification, conversation section on the lead screen.

Reviews remain deferred; the ledger already records them as `ignored`, so enabling them later is a handler, not a redesign.

## Testing

Backend, pytest. The baseline is **392 collected tests** (`python -m pytest --collect-only -q`, 2026-08-24) and must not regress. Note that `CLAUDE.md` still claims 108; it is stale.

**Receiver**
- Unknown `url_token` → 401, no event row written
- Valid token, wrong Basic credential → 401, no event row written
- Valid credential, malformed JSON body → **200**, event row stored with `status='failed'` and the error
- Valid credential, unrecognised body shape → 200, `kind='unknown'`, raw body retrievable
- Body over the size cap → rejected without processing

**Leads**
- Documented lead payload creates a lead in the connection's city with the correct `source_business`
- Redelivery of the same `leadID` → `duplicate`, exactly one lead
- The same `leadID` arriving on two different connections is treated per connection scope
- `customer.phone` is stored with `customer_phone_is_proxy = True`
- A masked `314-xxx-xxxx` value is rejected and the lead is left needing a number
- `leadPrice` sets `lead_cost_cents` and creates exactly one `FinanceTransaction`; redelivery creates none
- Missing or malformed `leadPrice` leaves cost unset and flags the event — and never writes a guessed figure
- Refunded `chargeState` sets `lead_refunded_at` and writes the audit event

**Messages**
- Message attaches to the correct lead and creates one `lead_customer_message`
- Redelivered `messageID` → `duplicate`, no second row
- Message for an unknown `leadID` → `orphaned`, retained, no crash
- A successful attach triggers one push to the facilitator role for the connection's city

**Migration**
- Per Rule: the migration test must recreate the **old** `leads` table with its named indexes and foreign keys, not just its columns, before applying the additive migration. A startup-migration crash is a total outage.
- `_migrate_leads_add_thumbtack_columns` is idempotent across repeated startups

**Frontend**
- Connection create shows in-progress, success, and a recoverable failure
- Delete confirms before running
- Conversation section renders read-only with no send affordance

## Risks

| Risk | Mitigation |
|---|---|
| **One Thumbtack profile covers both metros** | City pinning assumes a separate Thumbtack business profile per metro. The form attaches a webhook to a *profile*, and that profile's leads go to every webhook registered against it — so if one profile serves both St. Louis and Chicago, two pinned webhooks would each receive *all* its leads and mis-assign half of them. **Confirm in Phase 1.** If one profile covers both, fall back to routing on `request.location` city/zip with the connection's city as the fallback; the mapping already reads that field, so this is a routing change, not a redesign. |
| Self-serve payload differs from the Partner API docs | Phase 1 exists solely to confirm it; capture-first means no lead is lost while we find out |
| Thumbtack's form offers no usable authorization type | The `url_token` in the path is the primary identifier; Basic auth is an added layer, not a dependency |
| Attachment URLs expire before download | Download inline during processing; failures are non-fatal and recorded |
| A duplicate finance expense from a redelivered lead | `lead_cost_finance_transaction_id` guard, plus an explicit idempotency test |
| A webhook silently stops delivering | `last_event_at` health indicator on the connections screen |
| Raw bodies accumulate customer PII | Admin-only access, no info-level logging, retention window |

## Related

- `docs/superpowers/specs/2026-06-19-thumbtack-numbers-design.md` — proxy phone handling this build must honour
- `app/routers/square_router.py` — the inbound-webhook pattern this follows
- `06_Projects/holy-hauling-app/thumbtack-api-outreach.md` (Knowledge Operating System) — **superseded** for inbound leads; still the only route to outbound messaging
