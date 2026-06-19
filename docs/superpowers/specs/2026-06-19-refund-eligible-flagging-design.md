# 72-Hour Refund-Eligible Flagging — Design Spec

**Date:** 2026-06-19
**Status:** Approved direction, pre-implementation
**Author:** Ron + Claude

## Problem

Thumbtack's "Thumbtack Numbers" change pairs a ~10% lead-price increase with a **72-hour refund** when the customer doesn't respond. Whether that refund is automatic or request-based is uncertain and varies by category. Either way, the app has no awareness of it: a lead the customer ghosted still shows as active (the facilitator keeps chasing it) and its lead fee still counts against ROI even if Thumbtack refunded it.

This is the final slice of Thumbtack alignment (after lead-cost tracking and Thumbtack Numbers). It surfaces likely refund-eligible leads, lets the facilitator resolve each, and — when marked refunded — reconciles the lead cost so ROI stays honest.

**Hard constraint (from Ron):** the system must **never assume** the customer didn't respond. A lead sitting in an early status for 72h is only a *proxy* for "ghosted" and can be wrong (the reply may not be reflected in our status, or the chat is on Thumbtack where we can't see it). So the flag is a **candidate to review, never an automatic conclusion** — the human always makes the call.

## Goals

1. Surface **candidate** refund-eligible leads (Thumbtack, 72h+, no engagement) without ever asserting the customer ghosted or auto-marking a refund.
2. Let the facilitator resolve each candidate: **"Customer responded"** (dismiss + preempt) or **"Refunded"** (record + reconcile cost).
3. A one-tap **"Customer responded"** marker settable on any Thumbtack lead, anytime — once set, the lead is never a candidate.
4. **Refunded → zero the lead cost** for ROI, reversibly, without destroying the recorded cost.

Out of scope: push/SMS notifications for candidates (visual-only for now), auto-detecting customer responses (explicitly manual), and per-category window tuning (72h is Thumbtack's fixed policy, not a business knob).

## Decisions locked during brainstorming

- **Candidate-only, never auto-conclude** — the system raises a hand; the human resolves.
- **Anchor on arrival** (`created_at`), not last activity — the clock is about the customer never engaging, and a last-activity anchor would reset whenever the pro touches the lead.
- **72h hardcoded** as a named constant (Thumbtack's fixed policy), not a Settings knob.
- **Refunded zeroes the lead cost** via the existing finance sync, **reversibly**, while preserving `lead_cost_cents` on the lead for history.
- **Candidacy is computed, never stored** — no persisted "is_candidate" flag (so no assumption is baked in).

## Architecture

### Data model — new `Lead` columns

| Column | Type | Notes |
|---|---|---|
| `customer_responded_at` | DateTime | nullable — the manual "Customer responded" marker. When set, the lead is never a refund candidate. |
| `lead_refunded_at` | DateTime | nullable — set when the lead is marked refunded. |

A startup migration in `main.py` adds both (`_existing_columns` guard). No stored candidacy flag.

### Candidate detection (computed, frontend — mirrors Aging/Overdue)

`LeadOut` exposes the two new timestamps alongside the existing `source_type`, `status`, `created_at`. A pure frontend helper:

```
isRefundCandidate(lead, now) =
     isThumbtack(lead.source_type)
  && lead.status ∈ {new, in_review, replied, waiting_on_customer}
  && hoursSince(lead.created_at, now) >= REFUND_WINDOW_HOURS   // const = 72
  && !lead.customer_responded_at
  && !lead.lead_refunded_at
```

Computed from the leads already loaded in the queue — **no new endpoint, no scheduler, no push alerts**. `REFUND_WINDOW_HOURS = 72` is a single named constant. (This mirrors how the existing Aging/Overdue band is computed client-side from `updated_at` + thresholds.)

### Resolve actions (dedicated endpoints, reversible)

Two toggle endpoints on the leads router, each writing a timestamp and emitting a `LeadEvent` for the audit trail:

- **`POST /leads/{id}/customer-responded`** → set `customer_responded_at = now`. **`DELETE`** → clear it. Dismisses the candidate and preempts future flagging. Idempotent.
- **`POST /leads/{id}/refund`** → set `lead_refunded_at = now`, then run the cost reconciliation. **`DELETE`** → clear it and re-run reconciliation (restores the cost). Idempotent.

Service functions in `lead_service`: `mark_customer_responded(db, lead_id, on)` and `mark_refunded(db, lead_id, on)`.

### Cost reconciliation (reuses the finance sync)

`lead_cost_service.sync_lead_cost_expense` is extended so the lead-fee expense is dropped when the lead is **refunded** — change the delete guard from "`not cost or cost <= 0`" to "`not cost or cost <= 0 or lead.lead_refunded_at is not None`". Then:

- **Mark refunded** → `lead_refunded_at = now` + `sync_lead_cost_expense` → the "Thumbtack lead fee" expense is deleted → `outcome` `realized_cost` drops to reflect $0 acquisition cost. `lead_cost_cents` is **untouched** (the original cost stays on file).
- **Unmark refunded** → `lead_refunded_at = null` + `sync_lead_cost_expense` → the expense is recreated from the preserved `lead_cost_cents`. Fully reversible.

### Schemas

- `LeadOut` gains `customer_responded_at: Optional[str]` (ISO) and `lead_refunded_at: Optional[str]`.
- No changes to `LeadUpdate` — these are set only through the dedicated resolve endpoints, not free-form PATCH.
- The resolve endpoints return the updated `LeadOut`.

### Frontend

- `utils/refund.ts` — `REFUND_WINDOW_HOURS = 72` + `isRefundCandidate(lead, now)`.
- `hooks` — `useMarkCustomerResponded(leadId)` and `useMarkRefunded(leadId)` mutations (POST/DELETE), invalidating the lead + jobs queries.
- `components/RefundBanner.tsx` — in the lead window: the amber candidate banner with **Customer responded** / **Mark refunded**; a resolved chip (Refunded → "lead cost zeroed", with **Undo**; Responded → "won't be flagged", with Undo); and, for a Thumbtack lead that isn't yet a candidate and isn't resolved, the small pre-empt "✓ Responded" marker.
- Lead queue — a **"Refund-eligible (N)"** band (mirroring the Aging/Overdue band component) listing candidates computed from the loaded leads, each with inline Responded / Refunded buttons. 44px tap targets; the three action states (in-progress / success / failure-recovery) on every write.

## Data flow

```
Scheduler/queue loads leads -> frontend computes isRefundCandidate per lead
  Candidate (Thumbtack, 72h+, early status, not responded, not refunded):
     -> "Refund-eligible" queue band + lead-window banner
  Facilitator resolves:
     "Customer responded" -> POST /customer-responded -> customer_responded_at=now -> no longer a candidate (and preempts)
     "Mark refunded"       -> POST /refund -> lead_refunded_at=now -> sync drops the lead-fee expense -> realized_cost = $0
                              (lead_cost_cents preserved; Undo via DELETE restores the expense)
Pre-empt: facilitator taps "Responded" on a Thumbtack lead before 72h -> never becomes a candidate
```

## Error / empty states

- No candidates → the queue band doesn't render; lead window shows no banner.
- Non-Thumbtack lead, or progressed past `waiting_on_customer`, or `< 72h` → never a candidate.
- `customer_responded_at` set (manually or via resolve) → excluded from candidacy, banner shows the resolved chip.
- `lead_refunded_at` set → excluded; expense removed; chip shows "Refunded — cost zeroed".
- Resolve endpoint on a missing lead → 404. Toggling an already-set state is idempotent (no error).
- A refunded lead with no prior `lead_cost_cents` → reconciliation is a no-op (nothing to drop); still records the refund.

## Testing

### Backend (pytest)

- Migration adds both columns idempotently.
- `POST /leads/{id}/customer-responded` sets `customer_responded_at`; `DELETE` clears it; emits a `LeadEvent`; 404 on missing lead.
- `POST /leads/{id}/refund` sets `lead_refunded_at`; with a prior synced lead-fee expense, the expense is **deleted** and `lead_cost_cents` is **unchanged**; `outcome_service._realized_amounts` returns cost 0 afterward.
- `DELETE /leads/{id}/refund` clears `lead_refunded_at` and **recreates** the expense from the preserved `lead_cost_cents`.
- `sync_lead_cost_expense` drops the expense when `lead_refunded_at` is set even if `lead_cost_cents > 0`.
- `LeadOut` exposes `customer_responded_at` and `lead_refunded_at`.

### Frontend

- `isRefundCandidate` unit-style cases: Thumbtack + early status + 72h+ + unresolved → true; each exclusion (non-Thumbtack, status `ready_for_quote`/`booked`/`lost`, `< 72h`, `customer_responded_at` set, `lead_refunded_at` set) → false; boundary at exactly 72h.
- `tsc && vite build` green with the helper, hooks, `RefundBanner`, and the queue band.
- (Structural) the band lists only candidates; the banner shows resolve actions and the resolved chips with Undo; pre-empt marker renders on a non-candidate Thumbtack lead. No JS test runner — verification is type-check + build + backend contract tests; visual confirmation manual.

## Out of scope

- **Push / SMS notifications** for candidates — visual surfacing only; can reuse the alert infra later.
- **Auto-detecting customer responses** (from correspondence screenshots, inbound messages, or status changes) — explicitly manual, to honor "never assume."
- **Configurable refund window** — 72h is Thumbtack's fixed policy; a named constant, not a Setting.
- **Bulk resolve** across many candidates at once — per-lead resolve only.
- **A server-side candidate query/endpoint or scheduled scan** — candidacy is computed client-side from loaded leads.
