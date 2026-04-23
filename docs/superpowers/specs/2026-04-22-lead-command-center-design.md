# Lead Command Center — Design Spec
**Date:** 2026-04-22
**Project:** Holy Hauling Internal App
**Status:** Approved for implementation

---

## Problem

The current `LeadDetail` is a modal that stacks all lead information vertically in one long scroll. The facilitator cannot see scope details and AI pricing guidance together without hunting through 15+ sections. Screenshot upload is buried in the workflow. There is no way to challenge or refine the AI review in context.

---

## Goal

Replace the `LeadDetail` modal with a full-screen **Lead Command Center** that:

1. Makes screenshot upload the primary entry point for new leads
2. Auto-runs OCR and AI review immediately after upload (fast lane)
3. Surfaces scope details and AI pricing guidance in the same view
4. Provides a persistent AI chat for challenging and refining pricing output
5. Works well on mobile (primary device)

---

## Navigation

Add `react-router-dom`. Two routes:

| Route | Screen |
|---|---|
| `/` | `LeadQueue` |
| `/leads/:id` | `LeadCommandCenter` |

Clicking a lead card navigates to `/leads/:id`. The command center has a back arrow returning to `/`. The existing `LeadDetail` modal is retired — all its logic moves into the command center panels.

---

## Entry Point — LeadQueue Changes

- Primary button: **"📷 New from Screenshot"** — large, prominent
- Secondary link: **"Manual Entry"** — smaller, below or adjacent
- All other queue behavior (filters, lead cards, unacked count) unchanged

---

## Fast Lane Ingest Flow

Triggered when the facilitator taps "New from Screenshot":

1. File picker / camera roll opens
2. Facilitator selects the Thumbtack screenshot
3. App runs three steps in sequence, showing inline progress:
   ```
   Uploading screenshot…   ✓
   Extracting lead data…   ✓
   Running AI review…      ✓
   ```
4. On completion: navigate automatically to `/leads/:id`
5. On partial failure: navigate anyway, flag the failed step inline with a retry button

The frontend chains the calls:
- `POST /ingest/screenshot` → creates lead, runs OCR, returns `lead_id`
- `POST /leads/:id/ai-review` → runs AI review using extracted fields

No backend changes required for the ingest flow itself.

---

## Lead Command Center Layout

### Fixed Header (never scrolls)

- Back arrow → `/`
- Customer name
- Status badge + urgency flag
- Gate position indicator: `Gate 0 → 1 → 2A → 2B` (visual progress, derived from lead status)
- **"Run AI Review"** button always accessible

### Three-Tab Navigation (fixed below header)

Tabs: **Brief · Quote · Log**

Default tab on open: **Brief**

---

### Tab 1 — Brief

Purpose: situational awareness at a glance.

- Tappable screenshot thumbnail (full-size view on tap)
- Customer name, phone — tap to call, tap to text
- Acknowledgment banner (unacknowledged = red; acknowledged = green)
- Gate position (visual indicator)
- **AI Quick Read (M)** — plain-language situation summary
- **AI Next Best Message (A)** — prominent display with one-tap copy button
- "Re-run AI Review" shortcut button

If AI review has not run yet: show a prompt — *"AI review not run yet — tap Run AI Review in the header."*

---

### Tab 2 — Quote

Purpose: everything needed to think through and price a job, in one scroll.

**Scope (top half)**

- Service type
- Origin → Destination (moving) or Location (hauling)
- Date options
- Move size label, move type
- Move distance (miles)
- Load stairs / Unload stairs
- Scope notes

- `quote_context` textarea — *"Add context before re-running review (elevator type, items, access, complications…)"*

**AI Pricing Output (bottom half)**

Divider: *"— AI Pricing Guidance (Internal) —"*

AI sections F–L displayed in order:
- F. Pricing Band
- G. Band Position
- H. Main Friction Points
- I. Sayability Check
- J. Quote Style
- K. Quote Source Label
- L. Internal Pricing Guidance

All sections marked **Internal Only** with orange tint (consistent with current styling).

**Persistent AI Chat**

Sits directly below the pricing sections.

- Scrollable message thread — alternating facilitator and AI bubbles
- Timestamps on each message
- Input bar at bottom: *"Challenge this or add context…"*
- Send button
- Each message pair (facilitator + AI) is saved to the lead record immediately
- AI responses are focused replies grounded in: current lead data + current AI review sections + full prior chat history — not a full A-O re-run
- Full "Re-run AI Review" (in header) still available for a complete refresh with updated `quote_context`

---

### Tab 3 — Log

Purpose: take action, record what happened, manage the lead lifecycle.

- **Status transition buttons** — all non-current statuses as tappable chips
- **Operational note input** — textarea + "Add Note" button
- **Add Screenshot** button — for correspondence screenshots added after initial ingest (screenshot_type = "correspondence")
- Existing screenshot list with extract/apply controls
- **Activity history** — full event log (collapsible, collapsed by default)
- Archive (Release) and Delete actions at the bottom

---

## Backend Additions

### New table: `lead_chat_messages`

```sql
CREATE TABLE lead_chat_messages (
    id          VARCHAR PRIMARY KEY,
    lead_id     VARCHAR NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    ai_review_id VARCHAR REFERENCES ai_reviews(id),  -- review in context when sent, nullable
    role        VARCHAR NOT NULL,  -- 'user' | 'assistant'
    content     TEXT NOT NULL,
    created_at  DATETIME NOT NULL
);
```

### New endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/leads/:id/chat` | Send a facilitator message; AI responds; both saved |
| `GET` | `/leads/:id/chat` | Return full conversation history for the lead |

**`POST /leads/:id/chat` behavior:**
- Accepts `{ message: string, ai_review_id?: string }`
- Builds AI context: lead fields + current pricing sections (F-L) + prior chat messages
- Calls Claude (same model as AI review) for a focused pricing-refinement response
- Saves facilitator message (`role: user`) and AI response (`role: assistant`) to `lead_chat_messages`
- Returns both messages

**Why a separate table (not embedded in ai_reviews):**
Messages need to be queryable across leads for future pricing matrix analysis — pattern matching on what facilitators challenge most frequently.

---

## Component Map

### New

| Component | Location | Purpose |
|---|---|---|
| `LeadCommandCenter` | `screens/LeadCommandCenter.tsx` | Top-level screen, tab controller |
| `BriefPanel` | `screens/panels/BriefPanel.tsx` | Brief tab content |
| `QuotePanel` | `screens/panels/QuotePanel.tsx` | Quote tab: scope + pricing + chat |
| `LogPanel` | `screens/panels/LogPanel.tsx` | Log tab: actions + history |
| `AiChatThread` | `components/AiChatThread.tsx` | Chat message thread + input |
| `GateIndicator` | `components/GateIndicator.tsx` | Visual Gate 0→1→2A→2B progress |
| `IngestProgressFlow` | `components/IngestProgressFlow.tsx` | Upload → OCR → AI progress UI |

### Updated

| Component | Change |
|---|---|
| `App.tsx` | Add React Router, define routes |
| `LeadQueue` | Replace modal trigger with router navigation; add screenshot upload button + ingest flow |

### Retired

| Component | Reason |
|---|---|
| `LeadDetail` | All logic moves into the three panels |
| `LeadCreate` | Replaced by IngestProgressFlow (fast lane) + manual entry form in LogPanel or LeadQueue |

### Unchanged

All hooks (`useLeads`, `useTriggerAiReview`, etc.), `api.ts`, all backend services, all types, all badge/indicator components.

---

## Gate Indicator Logic

Gate position is derived from lead status:

| Lead Status | Gate |
|---|---|
| `new` | Gate 0 |
| `in_review`, `waiting_on_customer` | Gate 1 |
| `ready_for_quote` | Gate 2A |
| `ready_for_booking` | Gate 2B |
| `booked` | Booked |
| `released`, `escalated` | — |

---

## Mobile Behavior

- All three tabs are full-screen scrollable columns
- Fixed header + fixed tab bar bracket the scrollable content
- Tab bar is at the bottom of the screen (native mobile feel)
- Screenshot thumbnail in Brief tab is tappable → full-screen image view
- Call and text links use `tel:` and `sms:` protocols
- Chat input stays above the keyboard when focused (standard mobile behavior)

---

## What This Does Not Include

- Quote builder (Stage 5 — separate spec)
- Booking conversion (Stage 6)
- Field crew view (Stage 7)
- Automated follow-up scheduling
- Pricing matrix analysis dashboard (Stage 9 — chat messages are captured now for use later)

---

## Success Criteria

- Facilitator can go from screenshot → AI pricing guidance in under 30 seconds
- Scope details and pricing sections (F-L) are visible in the same scroll without switching views
- Facilitator can challenge the AI review and see a response without leaving the Quote tab
- All conversations are saved and retrievable per lead
- The gate position is always visible without scrolling
- The app feels fast and native on mobile
