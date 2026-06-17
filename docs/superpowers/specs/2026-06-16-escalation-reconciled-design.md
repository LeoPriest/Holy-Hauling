# Escalation, Reconciled — Design Spec

**Date:** 2026-06-16
**Status:** Approved, pre-implementation
**Author:** Ron + Claude

## Problem

The app has two conflicting notions of "escalation" sharing one word:

1. **What's built** — a *time-based staleness ladder*. `alert_service.py` runs on a scheduler: a lead idle past `t1_minutes` pings the primary handler; past `t2_minutes` it pings the backup **and auto-sets `lead.status = LeadStatus.escalated`**. "Escalated" therefore just means "untouched for a while."
2. **What the company SOP describes** (`company_docs/Lead intake system/08_escalation_contact_workflow.md`) — a *risk-based, manual* action. A handler hits a wall (job bigger than described, pricing risk, difficult customer, AI says pause) and deliberately raises the lead to the owner with a structured **Escalation Summary** at one of three levels (Monitor / Pause-before-quote / Owner-takeover). It is a human decision, not a timer.

The root defect: `escalated` lives **inside** the linear pipeline (`… ready_for_booking → escalated → booked …`) as if it were a stage. Escalation is actually *orthogonal* to stage — a lead at `ready_for_quote` can need a pricing escalation while still being at that stage. Forcing it into the status enum is why the timer "hijacks" the lead and why un-escalating has nowhere to return to.

## Decision

Model escalation as a **separate overlay**, not a pipeline status. A lead keeps its real stage **and** can carry an independent, resolvable escalation. Reconcile the timer so it *feeds* this overlay instead of overwriting status.

## Architecture

### 1. Data model — new `LeadEscalation` table

Mirrors the existing `LeadAlert` / `LeadEvent` pattern (separate table, not columns on `Lead`) so escalation history survives resolution.

| Field | Type | Notes |
|-------|------|-------|
| `id` | str (uuid) | PK |
| `lead_id` | str FK → leads.id | |
| `level` | enum | `monitor` \| `pause` \| `owner_takeover` |
| `source` | enum | `manual` \| `auto_idle` |
| `decision_needed` | str | the ask (e.g. price / schedule / truck / release / owner takeover) |
| `summary` | text | the AI-assembled Escalation Summary brief |
| `raised_by` | str | actor identifier (`alert_scheduler` for auto) |
| `raised_at` | datetime (naive UTC) | |
| `status` | enum | `open` \| `resolved` |
| `outcome` | enum, nullable | `approved` \| `adjusted` \| `owner_takeover` \| `release` \| `need_more_info` |
| `resolution_note` | text, nullable | owner's one-line decision |
| `resolved_by` | str, nullable | |
| `resolved_at` | datetime, nullable | |

A lead's **current escalation** = its latest row where `status = open`. A lead has at most one open escalation at a time (enforced in service logic, not a DB constraint).

### 2. `escalated` leaves the pipeline

- `LeadStatus.escalated` enum value **stays defined** so existing rows and `LeadEvent` history don't break.
- It becomes **unreachable**: removed from the UI status dropdown (`LogPanel.tsx` `STATUS_ORDER` / labels) and from normal transition paths.
- A lead now carries its real stage **plus** an optional open escalation overlay.

### 3. Migration (startup, idempotent)

Add `_migrate_escalated_status_leads` to `main.py`, called alongside the other startup migrations.

For every lead with `status = LeadStatus.escalated`:
1. Determine the real stage to restore — read the most recent `LeadEvent` of type `status_changed` where `to_status = "escalated"`, use its `from_status`. Fallback: `in_review`.
2. Set `lead.status` back to that stage.
3. If the lead has no `open` `LeadEscalation`, create one: `source = auto_idle`, `level = monitor`, `decision_needed = "review"`, `summary = "Migrated from legacy escalated status."`, `raised_by = "migration"`.
4. Write a `LeadEvent` recording the migration.

Idempotent: after the first run no leads remain at `status = escalated`, so subsequent runs are no-ops.

### 4. Timer reconciliation (`alert_service.py`)

Unchanged: T1/T2 idle ping logic, quiet hours, dedup, push, and the Aging/Overdue staleness signal (`useStaleLeads`) on the queue.

The **only** change is the T2 block that currently does:

```python
if is_t2 and lead.status != LeadStatus.escalated:
    lead.status = LeadStatus.escalated
    ...
```

It is replaced with: **open a `LeadEscalation`** (`source = auto_idle`, `level = monitor`, `decision_needed = "review"`, AI/auto summary, `raised_by = "alert_scheduler"`) **if the lead has no open escalation already.** Status is never touched. Dedup reuses the "is there already an open escalation for this lead" check so it won't re-raise every tick. A `LeadEvent` is still written for audit.

### 5. AI-prefilled summary (`escalation_service.py`)

New `suggest_summary(db, lead) -> str` assembles the SOP's Escalation Summary from the lead's existing fields + latest AI review, reusing helpers from `ai_review_service` (lead type, gate stage, scope, access/risk, AI posture). Returns the editable brief text. Same shape as the existing quote-builder AI flow.

For `auto_idle` escalations the timer calls this too (best-effort; on failure it falls back to a static "Idle past threshold — review" summary so a failed model call never blocks raising the flag).

### 6. Backend endpoints (`routers/escalation.py`)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/leads/{id}/escalation/suggest` | AI-prefill the summary for the escalate sheet |
| `POST` | `/leads/{id}/escalation` | Raise — body: level, decision_needed, summary |
| `POST` | `/escalations/{id}/resolve` | Resolve — body: outcome, resolution_note |
| `GET` | `/escalations?status=open` | List open escalations (for the queue band) |

Each raise and resolve writes a `LeadEvent` for the audit trail. Raise rejects if the lead already has an open escalation (returns the existing one).

### 7. Frontend

- **Escalate action** — a control in the lead window **Log** tab (where status changes live). Opens a sheet: level picker, decision-needed picker, AI-prefilled summary (editable, with a "Suggest with AI" affordance matching the quote builder), Escalate button. All three action states ship together: in-progress spinner, success confirmation, failure recovery.
- **Resolve** — when a lead has an open escalation, the lead window shows an escalation card (level, source, who raised, raised-at, summary, decision-needed) with a **Resolve** control: outcome picker (`Approved` / `Adjusted` / `Owner taking over` / `Release` / `Need more info`) + note. All three action states.
- **Queue** — collapsible "⚠ Escalations · N open" band pinned above the stage groups, each row: lead name, level, decision-needed, source, who raised, age; tap opens the lead. A small escalation badge also appears on the `LeadCard` wherever the lead sits in its normal stage group.

### 8. Notifications / routing

Reuse `push_service.send_push_to_roles` and the existing alert send helpers; no new infra.

- **On raise** → push to `["admin", "supervisor"]` (the owner).
- **On resolve** → push to `["facilitator"]` so the handler gets the decision back.

### 9. Data flow

```
Handler hits risk
  → Log tab → Escalate sheet (AI-prefilled summary)
  → POST /leads/{id}/escalation
  → LeadEscalation(open) + LeadEvent + push to owner
  → appears in queue "Escalations" band + badge on card

Idle past T2 (no human action)
  → alert_service opens LeadEscalation(open, source=auto_idle, monitor)
  → push (existing ladder) ; status untouched

Owner reviews
  → lead window escalation card → Resolve (outcome + note)
  → POST /escalations/{id}/resolve
  → LeadEscalation(resolved) + LeadEvent + push to facilitator
  → drops out of the queue band ; badge clears
```

## Error handling

- AI summary failure on manual raise: surface the error in the sheet, let the handler type the summary manually and still escalate.
- AI summary failure on auto raise: fall back to a static summary string; never block the flag.
- Raise when an open escalation already exists: return the existing one (no duplicate).
- Resolve a non-open escalation: 409 / no-op with clear message.
- Push failures: logged, non-fatal (same posture as the existing alert ladder).

## Testing

**Backend:**
- Migration moves `status=escalated` leads back to a real stage and opens an overlay; idempotent on re-run.
- Timer opens a `LeadEscalation` instead of flipping status; does not re-raise when one is already open.
- Raise lifecycle: creates open row + `LeadEvent`; rejects duplicate open.
- Resolve lifecycle: sets outcome/note/resolved_at + `LeadEvent`; resolving non-open is a no-op/409.
- `suggest_summary` returns a non-empty brief assembled from lead + AI review.
- Resolve notifies facilitator role; raise notifies owner roles (assert `send_push_to_roles` called with expected roles).

**Frontend:**
- Type-check + build green.
- Escalate and Resolve each render all three action states.

## Out of scope (this pass)

- Per-level differentiated notification channels (SMS/email vs push) — start with push only on the overlay; the existing T1/T2 SMS/email ladder is unchanged.
- A dedicated Escalations screen (decided against — band-in-queue only).
- Escalation analytics / reporting.
