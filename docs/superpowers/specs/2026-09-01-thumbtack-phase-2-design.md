# Thumbtack Webhooks — Phase 2 (Leads and Alerts) Design Spec

**Date:** 2026-09-01
**Status:** Approved direction, pre-implementation
**Author:** Ron + Claude
**Supersedes:** the Phase 2 section and the "Reference payloads" section of
`docs/superpowers/specs/2026-08-24-thumbtack-webhook-integration-design.md`

## Problem

Phase 1 shipped a receiver that stores every Thumbtack delivery verbatim and creates nothing. Ron
connected the webhooks and, correctly, reported that the app never told him anything. His words:
*"im not sure what the webhooks are supposed to do in the app… theyre not alerting me from the app
in any way."*

That is exactly what was built. `/admin/thumbtack` is a filing cabinet, not an inbox: a delivery
arrives, is stored, is labelled `lead`/`message`/`review`/`unknown`, and nothing reads it again.

**Phase 2 turns a stored delivery into a lead in the queue and a notification on his phone.**

## What the payload actually looks like

Phase 1 existed to replace guesswork with an observed body. It earned its place — the real payload
differs from both Thumbtack documents in seven ways, every one of which would have produced a lead
with silently missing fields.

```jsonc
{
  "event": {
    "eventType": "NegotiationCreatedV4",
    "webhookID": "588474365069058060",
    "triggeredAt": "2026-09-01T15:05:50Z"
  },
  "data": {
    "negotiationID": "589129524549820420",
    "createdAt": "2026-09-01T15:05:24Z",
    "customer":  { "customerID": "…", "firstName": "…", "lastName": "…", "phone": "9342257638" },
    "business":  { "businessID": "561924958510514187", "name": "Holy Handy", "accessCode": "…" },
    "request": {
      "requestID": "…",
      "description": "…free text, and the ONLY place the street address appears…",
      "category":   { "categoryID": "…", "name": "Furniture Moving and Heavy Lifting" },
      "proposedTimes": [ { "start": "2026-09-01T05:00:00Z", "end": "2026-09-02T04:59:00Z" } ],
      "location":   { "address1": "", "address2": "", "city": "Saint Louis", "state": "MO", "zipCode": "63144" },
      "travelPreferences": [ "ProviderTravelToCustomer" ],
      "details":     [ { "question": "Move distance", "answer": "Less than 5 miles" } ],
      "attachments": []
    },
    "estimate":  { "type": "PerUnit", "pricePerUnit": "120.00", "unitName": "Hour", "total": "$120/hour" },
    "status": "Open",
    "leadPrice": "$15.88",
    "leadPriceBreakdown": { "subtotal": "$15.88", "salesTax": "$0.00" },
    "chargeState": "Charged",
    "refundRequestLink": "https://www.thumbtack.com/generic-survey/REQUEST_A_REFUND?negotiation-pk=…"
  }
}
```

**Corrections to the Phase 1 spec.** Each of these was wrong there and is authoritative here:

| Phase 1 assumed | Reality |
|---|---|
| `customer.name` | `firstName` + `lastName`, separate |
| `request.category` is a string | an object; the label is `category.name` |
| `request.title` | does not exist |
| `request.schedule` string | `proposedTimes[]`, ISO start/end ranges |
| `leadPrice` numeric | `"$15.88"` — a string carrying a currency symbol |
| `chargeState: "CHARGED"` | `"Charged"` |
| `location.address1` holds the street | **empty**; the street is only in `description` prose |

## The test ping

The first delivery Ron ever received classified as `unknown`. It is Thumbtack's **synthetic test
lead**, sent on webhook creation: an attachment named `test_request_attachment.jpg` of 20 bytes, a
zip code of `"95010, 78901"`, `chargeState: "Created"`, and a lawn-care category Holy Hauling does
not serve.

**No special handling is needed.** Phase 2 maps only events already classified `lead`; the test ping
sits at `unknown` and is excluded by construction. This is recorded so nobody later "fixes" the
classifier into accepting it.

## Goals

1. A delivery classified `lead` becomes a Lead in the facilitator queue, with city pinned from its
   connection and business tagged from the payload.
2. Lead cost is populated from `leadPrice` and flows into the existing finance sync.
3. The customer's phone is recorded as a **Thumbtack proxy line**, never as their real number.
4. Ron's phone is notified the moment a lead lands.
5. A lead whose description points somewhere other than its stated service area is **flagged, not
   hidden**.
6. Re-delivery of the same `negotiationID` never creates a second lead.

## Non-goals

- **Photos.** `request.attachments[]` is real but was empty on the observed lead. Downloading and
  attaching them stays Phase 3. Nothing here blocks it.
- **Messages.** `MessageCreatedV4` events are already captured and classified. Attaching them to a
  lead and notifying stays Phase 4.
- **Replying to Thumbtack.** Still impossible on self-serve webhooks; needs the Partner API.
- **Backfilling the deliveries already sitting in the ledger.** See Open question.
- **Parsing the street address out of the description.** See Risks.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Notification scope | **Every lead, with odd ones flagged in the notification text** | Ron's choice. Speed-to-response is his close-rate driver, so suppression risks losing a real lead. Flagging lets him triage at a glance without the app deciding for him. |
| Out-of-area leads | Created and flagged, never suppressed | He paid for the lead. Hiding it loses both the job and the refund case. |
| Customer name | `f"{firstName} {lastName}".strip()` | Two fields, one column. |
| Service type | Mapped from `category.name`, defaulting to `unknown` | The enum is `moving`/`hauling`/`both`/`unknown`; an unrecognised category must land on `unknown`, never a guess. |
| Lead cost | `parse_cents(leadPrice)`, reusing the existing helper | It already handles `"$15.88"` with Decimal half-up. No new money parsing. |
| Idempotency | On `negotiationID` in `source_reference_id` | Thumbtack retries; a duplicate lead is worse than a missed one. |

## Architecture

### Mapping

| Payload | Lead column |
|---|---|
| `data.negotiationID` | `source_reference_id` (+ `source_type = thumbtack_api`) |
| connection's `city_id` | `city_id` |
| connection's `business`, `data.business.businessID` | `source_business`, `thumbtack_business_id` |
| `data.customer.firstName` + `lastName` | `customer_name` |
| `data.customer.phone` | `customer_phone`, **with `customer_phone_is_proxy = True`** |
| `data.request.description` | `scope_notes` |
| `data.request.category.name` | `service_type` (mapped; unrecognised → `unknown`) |
| `data.request.location.city`, `state`, `zipCode` | `job_location` |
| `data.request.details[]` | appended to `quote_context` as `Q: … / A: …` |
| `data.request.proposedTimes[]` | `move_date_options` (JSON array of date strings) |
| `data.leadPrice` | `lead_cost_cents` via `parse_cents` |
| `data.leadPriceBreakdown.subtotal` | `lead_cost_gross_cents` via `parse_cents` |
| `data.chargeState == "Refunded"` | `lead_refunded_at` |
| whole body | `raw_payload` |

**The proxy phone is not optional.** `customer.phone` on a Thumbtack lead is a routing line, not the
customer's number. The mapping must set `customer_phone_is_proxy = True` explicitly, or route through
`lead_service._tag_proxy_on_phone_set`. Constructing the `Lead` with a bare `customer_phone` — which
is what the old, never-used receiver did — bypasses that and misrepresents a proxy as the customer's
own number. That is the exact defect `2026-06-19-thumbtack-numbers-design.md` was written to prevent.

**Lead cost flows into finance.** After `lead_cost_cents` is set, `lead_cost_service.sync_lead_cost_expense`
runs, as it does for a manually-entered cost. It is idempotent via `lead_cost_finance_transaction_id`;
a redelivered lead must not create a second expense.

**A cost that will not parse is left unset**, and the event is marked. `parse_cents` returning `None`
means the figure is not trustworthy; writing a guess would be the silent-money failure this codebase
has been burned by repeatedly. Verified against the real string: `parse_cents("$15.88") == 1588`.

**Zero is a real cost here, not a rejection.** `parse_cents("$0.00")` returns `0`, and Thumbtack does
issue free leads, so `lead_cost_cents = 0` is a legitimate value that must be written. Do **not**
import the `0 < value` guard from `ai_review_service._validate_money` — that one governs quote
targets and floors, where zero is impossible. Here it is not. `sync_lead_cost_expense` already treats
a zero cost as "no expense" and removes any linked transaction, which is the correct behaviour for a
free lead.

### The location mismatch flag

`location` carries the **search area**. The street address, when present at all, is only in
`description` prose. On the observed lead these disagreed sharply: `location` said Saint Louis, MO
63144 while the description gave an address in Newtown, CT 06470 — roughly a thousand miles apart —
and `chargeState` was `Charged`.

Detection is deliberately narrow, because a false positive on this is cheap and a false negative is
not:

- Scan `description` for **5-digit zips** and **2-letter state codes**.
- Flag when a found zip differs from `location.zipCode` **and** its first digit differs (so
  `63144` vs `63105` — same metro — does not fire), or when a found state code differs from
  `location.state`.
- Record the flag on the lead and name it in the notification. **Nothing is suppressed or altered.**

This is a heuristic over free text and is stated as such. It will miss some and occasionally
misfire; that is acceptable for a flag that only ever adds a warning.

### Notification

On a successfully mapped lead, `push_service.send_push_to_roles` notifies the facilitator role scoped
to the connection's city — the same path the app already uses for job assignment.

Body: customer first name, category, city, and — when flagged — a plain warning, e.g.
`Ashley E. · Furniture Moving · St. Louis` or
`Handyman A. · Furniture Moving · ⚠ address may be out of area`.

A push failure must not roll back the lead. The lead is the valuable artifact; the notification is a
convenience on top, and losing it is recoverable by opening the app.

### Where this runs

Mapping happens inside `thumbtack_service.record_event`, after the raw body is committed and the
event is classified — the same position the Phase 1 design reserved for it. The commit-first ordering
is unchanged: a mapping failure marks the event `failed` with its error and leaves the raw body
intact for retry. **A delivery is never lost because mapping broke.**

The admin events list gains the **retry** action Phase 1 deferred, now that there is a parser to
re-run.

## Testing

Backend baseline is **480 collected tests** (2026-09-01, verified on merged `main`).

**Mapping** — against the real captured body, checked into the test file as a fixture:
- every column in the mapping table lands
- `customer_name` joins first and last
- `customer_phone_is_proxy` is `True`
- `service_type` maps a known category, and an unknown category yields `unknown`
- `"$15.88"` → `1588` cents; a malformed `leadPrice` leaves cost unset and flags the event
- `proposedTimes` become `move_date_options`
- `details[]` reach `quote_context`
- redelivery of the same `negotiationID` creates no second lead and no second finance expense
- `chargeState: "Refunded"` sets `lead_refunded_at`

**The test ping** — the captured `unknown` body creates no lead.

**Mismatch flag** — the real CT-in-a-MO-lead body flags; a same-metro zip does not; a description
with no zip or state does not.

**Failure paths** — a mapping exception marks the event `failed`, keeps the raw body, and creates no
partial lead; a push failure still leaves the lead.

## Risks

| Risk | Mitigation |
|---|---|
| The street address exists only in prose, so `job_location` is city-level | Accepted and stated. The description is on the lead in full; the facilitator reads it. Extracting an address from free text is its own project. |
| The mismatch heuristic misfires | It only ever adds a warning. Nothing is suppressed. |
| `category.name` vocabulary is unknown beyond one sample | Unrecognised categories fall to `unknown` rather than guessing. The mapping table is data, easy to extend as categories appear. |
| A redelivery creating a duplicate finance expense | Guarded by `lead_cost_finance_transaction_id` and an explicit test. |
| Push notification permissions not granted on Ron's phone | Out of this spec's control; the lead still lands. Worth confirming during the device pass. |

## Open question

**The deliveries already in the ledger are not backfilled.** Everything captured since the webhook
was connected stays as raw rows, and Phase 2 only maps deliveries arriving after it ships. Backfill
is a small script over `thumbtack_webhook_events` and can be added once mapping is proven correct on
live traffic — doing it first would mean debugging the mapping against a batch instead of one lead at
a time. Ron should decide whether he wants those leads recovered.

## A finding that is not a code change

The observed lead is `firstName: "Handyman", lastName: "Amenify"` — a property-services aggregator,
not a person — with a `location` in St. Louis and an address in Connecticut, `Charged` at $15.88.
Whether that is a one-off or a pattern is a **business question worth answering separately from this
build**: if a meaningful share of Thumbtack spend is going to broker leads outside the service area,
that is a refund case and a targeting problem, and it costs money today regardless of what this spec
ships. `refundRequestLink` in the payload links straight into Thumbtack's refund flow.

## Related

- `docs/superpowers/specs/2026-08-24-thumbtack-webhook-integration-design.md` — Phase 1; its payload
  section is superseded here
- `docs/superpowers/specs/2026-06-19-thumbtack-numbers-design.md` — the proxy-phone handling this
  mapping must honour
- `docs/superpowers/specs/2026-06-19-refund-eligible-flagging-design.md` — `lead_refunded_at` and the
  refund path
