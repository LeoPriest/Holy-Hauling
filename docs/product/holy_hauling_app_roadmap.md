# Holy Hauling App Development Roadmap
**Purpose:** A build roadmap for Claude Code to execute against  
**Project:** Holy Hauling internal operations app  
**Primary users (V1):** Lead intake facilitator first, field crew second  
**Guiding principle:** Build the quoting and lead-control engine first, then layer operations, field, and growth features on top.

---

## 1. Product North Star

Build an internal mobile-first operations app for Holy Hauling that:

- ingests leads from screenshots instead of depending on brittle marketplace APIs
- turns company SOPs into structured AI-assisted lead handling
- helps the facilitator move a lead from intake to booking to payment
- supports field execution with job details, required media capture, and offline resilience
- improves quoting over time using real job outcomes and notes

This is not a generic CRM.  
This is an **operations system shaped by Holy Hauling’s actual lead logic, pricing discipline, and hospitality standard**.

---

## 2. Locked Product Principles

These should guide all technical and product decisions.

### 2.1 OCR-first intake, not API dependency
V1 should be built around screenshot ingestion and OCR parsing, especially for Thumbtack-style workflows.

### 2.2 The facilitator workflow is the center of gravity
The lead intake facilitator is the most important user in V1.  
Field features matter, but the first win is reducing friction in intake, quoting, follow-up, and booking.

### 2.3 AI must be grounded in company documents
The app should not invent business logic.  
It must reflect the Holy Hauling SOPs, gate logic, pricing lenses, and hospitality tone.

### 2.4 A–H structure is the AI contract
AI outputs inside the app should follow the locked internal response structure:
- Quick Read
- Contact Strategy
- Gate Decisions
- Next Message
- Call Plan
- Branch Replies
- Pricing Posture
- Escalation Notes

### 2.5 Pricing stays controlled
The system should help think through pricing, not blurt out uncontrolled numbers too early.

### 2.6 Offline reliability is required for field operations
Field workers must be able to access job details and upload data even with poor service.

### 2.7 Completed jobs should improve future quoting
Job notes, final price, scope reality, time taken, and complications should feed back into pricing intelligence over time.

---

## 3. Recommended Product Scope by Stage

## Stage 0 — Foundation / Discovery Lock
**Goal:** Translate Holy Hauling’s documents into an app-ready system map before building too much UI.

### Outcomes
- define the app’s domain model
- define the exact facilitator workflow
- define the minimum AI contract
- define the data capture needed for future pricing improvement
- define what V1 explicitly will not include

### Deliverables
1. **System architecture brief**
   - frontend, backend, storage, OCR flow, AI flow, integrations
2. **Core domain model**
   - leads
   - customers
   - jobs
   - quotes
   - screenshots
   - messages
   - call attempts
   - follow-ups
   - job notes
   - photos
   - payments
   - escalation records
3. **User roles**
   - owner/admin
   - facilitator
   - field crew
4. **State model**
   - lead stages
   - job stages
   - quote stages
5. **Success metrics**
   - quote turnaround time
   - lead-to-contact time
   - lead-to-book rate
   - booked-job gross margin confidence
   - completion data capture rate
6. **V1 non-goals**
   - no heavy external marketplace integrations
   - no overbuilt analytics suite
   - no customer-facing polished portal before internal workflow works

### Claude Code build instruction
Have Claude produce:
- `docs/product/system-map.md`
- `docs/product/domain-model.md`
- `docs/product/user-roles.md`
- `docs/product/state-model.md`
- `docs/product/v1-scope.md`

---

## Stage 1 — App Skeleton + Core Data Layer
**Goal:** Stand up the app shell and persistent data model.

### Outcomes
- mobile-first app structure exists
- backend and storage are ready
- basic auth/roles are in place
- core entities can be created, updated, and retrieved

### Core work
1. **Frontend shell**
   - React app
   - Tailwind layout system
   - mobile-first navigation
   - facilitator dashboard shell
   - field view shell

2. **Backend foundation**
   - API routes for leads, jobs, quotes, notes, media, users
   - validation layer
   - structured service layer

3. **Database schema**
   - users
   - leads
   - lead_events
   - screenshots
   - ai_runs
   - quotes
   - jobs
   - job_notes
   - media
   - payments
   - audit_log

4. **Role-aware permissions**
   - admin/owner can see everything
   - facilitator can manage leads and booking workflow
   - field crew sees assigned jobs and upload workflows

### Exit criteria
- a lead can be manually created
- a lead can move through statuses
- a job can be created from a lead
- the app has stable internal IDs and auditability

### Claude Code build instruction
Have Claude create:
- project structure
- database schema
- API scaffolding
- seed data
- route tests
- a minimal dashboard with placeholder screens

---

## Stage 2 — Screenshot Intake + OCR Pipeline
**Goal:** Make screenshot-first intake real.

### Outcomes
- facilitator can upload screenshots
- the system extracts text and metadata
- parsed information becomes a structured lead draft
- human review stays in the loop

### Core work
1. **Screenshot upload flow**
   - upload from phone or desktop
   - attach multiple screenshots to one lead
   - preserve original image

2. **OCR + parsing pipeline**
   - OCR text extraction
   - parser for dates, service type, locations, item clues, urgency, notes
   - confidence scoring by field

3. **Human review screen**
   - show screenshot
   - show extracted text
   - show parsed fields
   - allow quick corrections before saving

4. **Source abstraction**
   - initial source: Thumbtack screenshot
   - architecture should allow future source types:
     - Yelp
     - Google Business Profile
     - website form
     - manual entry

### Exit criteria
- facilitator can create a lead from screenshots in under a few minutes
- parser output is editable before committing
- original screenshot remains linked to the lead

### Claude Code build instruction
Have Claude build:
- upload UI
- OCR service wrapper
- parser module
- confidence flags
- review-and-confirm screen
- tests for extracted structured fields

---

## Stage 3 — SOP Engine + AI Lead Assistant
**Goal:** Turn Holy Hauling’s documents into an in-app operating assistant.

### Outcomes
- AI outputs are shaped by the company SOPs
- lead handler gets structured guidance inside the app
- AI suggestions are traceable, editable, and not blindly trusted

### Core work
1. **Document grounding layer**
   - load Holy Hauling source docs into a structured knowledge base
   - separate:
     - operating rules
     - pricing rules
     - tone/hospitality rules
     - escalation rules

2. **AI output contract**
   - A–H response structure
   - internal-only vs customer-facing separation
   - pricing posture clearly marked internal

3. **Lead analysis action**
   - facilitator presses “Run AI Review”
   - app generates:
     - Quick Read
     - Contact Strategy
     - Gate Decisions
     - Next Message
     - Call Plan
     - Branch Replies
     - Pricing Posture
     - Escalation Notes

4. **Operator controls**
   - copy next message
   - edit before sending
   - mark AI suggestion used / not used
   - save AI run to lead history

5. **Prompt/version control**
   - store prompt version used
   - store source docs version or digest
   - make AI behavior auditable over time

### Exit criteria
- AI output matches Holy Hauling structure consistently
- facilitator can use AI suggestions without leaving the app
- AI runs are saved to the lead record

### Claude Code build instruction
Have Claude build:
- grounded AI service
- prompt templates
- A–H schema
- AI run history
- facilitator review UI
- tests for response structure validity

---

## Stage 4 — Gate Workflow + Lead Handling Workspace
**Goal:** Build the real operating screen for live lead handling.

### Outcomes
- the facilitator can work a lead end-to-end in one workspace
- gate logic is visible and enforced
- follow-up discipline is built into the system

### Core work
1. **Lead workspace**
   - lead summary
   - screenshots
   - extracted details
   - AI panel
   - manual notes
   - next actions

2. **Gate workflow support**
   - Gate 0 triage
   - Gate 1 contact/basic qualification
   - Gate 2A alignment
   - Gate 2B commitment
   - book / release / escalate outcomes

3. **Action logging**
   - message sent
   - call attempted
   - missed-call text sent
   - follow-up sent
   - pricing discussed
   - escalated
   - booked
   - released

4. **Follow-up automation support**
   - reminders for next touch
   - guardrails for one follow-up after Gate 2A
   - release prompt when sequence is complete

5. **Template tools**
   - quick message templates
   - call script helpers
   - release scripts
   - hospitality-forward tone suggestions

### Exit criteria
- a facilitator can work a live lead entirely in-app
- lead status changes are logged
- follow-up timing is visible
- escalation is explicit, not improvised

### Claude Code build instruction
Have Claude build the “Lead Command Center” screen first.  
This is probably the single most important V1 screen.

---

## Stage 5 — Pricing Intelligence + Quote Builder
**Goal:** Help the facilitator quote with discipline and speed.

### Outcomes
- the system reflects Holy Hauling’s pricing lenses
- quote generation is structured, not freestyle
- internal pricing posture is separated from customer messaging

### Core work
1. **Pricing engine foundation**
   - moving = time + care
   - hauling = volume + disposal
   - modifiers:
     - stairs/access
     - distance/zone
     - heavy/awkward items
     - assembly/disassembly
     - wrapping/protection
     - truck coordination
     - elevator/building friction
     - urgency
     - scope confidence

2. **Quote builder UI**
   - service type
   - bucket/path selection
   - modifiers
   - range guidance
   - internal notes
   - customer-facing wording builder

3. **Quote modes**
   - alignment range
   - hourly/minimum
   - flat rate with guardrail
   - tiered hauling range
   - final committed quote

4. **Learning capture**
   - expected time vs actual time
   - estimated scope vs actual scope
   - hidden friction flags
   - dump fee reality
   - final price changes
   - profitability notes

### Exit criteria
- facilitator can build a quote without freehanding everything
- pricing logic reflects company docs
- completed jobs can feed back into quote accuracy later

### Claude Code build instruction
Have Claude keep V1 pricing rules explicit and editable.  
Do **not** jump to black-box ML too early.

---

## Stage 6 — Scheduling, Booking, and Job Creation
**Goal:** Move from “good lead handling” to “operational execution.”

### Outcomes
- booked leads become structured jobs
- schedule and crew planning begin to live in-app
- execution handoff becomes clean

### Core work
1. **Booking conversion**
   - convert lead to job
   - capture:
     - addresses
     - date/time
     - confirmed scope
     - quote
     - crew needs
     - truck/equipment needs
     - payment status

2. **Calendar/schedule view**
   - daily jobs
   - weekly jobs
   - assigned crew
   - timing windows

3. **Job packet**
   - summary of scope
   - risk notes
   - access notes
   - required equipment
   - before/after photo requirement
   - customer notes
   - payment method

4. **Reconfirmation workflow**
   - arrival reminder
   - parking/loading notes
   - day-of readiness confirmation

### Exit criteria
- booked leads reliably become jobs
- the crew sees a clean version of what they need
- the facilitator can manage the schedule without scattered notes

---

## Stage 7 — Field App + Offline Operations
**Goal:** Give the crew a simple, reliable field experience.

### Outcomes
- field crew can view assigned jobs
- field workflow works in poor-signal environments
- required media capture is enforced

### Core work
1. **Field worker view**
   - today’s jobs
   - job details
   - navigation/address links
   - equipment checklist
   - hazard/safety notes

2. **Media capture**
   - before photos
   - after photos
   - optional damage/risk photo notes
   - upload queue if offline

3. **Offline-first behavior**
   - cached assigned jobs
   - local photo queue
   - sync when signal returns
   - visible sync status

4. **Completion workflow**
   - mark arrival
   - mark in progress
   - mark complete
   - capture completion notes
   - capture final add-ons or issues

### Exit criteria
- crew can complete a job workflow even with weak service
- before/after photos are hard to skip
- sync reliability is visible and trustworthy

---

## Stage 8 — Payments + Closeout
**Goal:** Finish the loop from lead to cash collected.

### Outcomes
- payment state is visible
- Square or payment flow is connected
- completion and closeout are logged properly

### Core work
1. **Payment capture**
   - deposit tracking
   - final payment tracking
   - method used
   - balance due
   - payment confirmation

2. **Closeout checklist**
   - photos complete
   - notes complete
   - payment complete
   - review/referral ask triggered
   - job archived

3. **Post-job prompts**
   - review request
   - referral request
   - internal notes for pricing improvement

### Exit criteria
- facilitator can see unpaid vs paid jobs
- each finished job has a complete record
- post-job actions are not forgotten

---

## Stage 9 — Feedback Loop + Intelligence Layer
**Goal:** Make the system smarter using Holy Hauling’s own job history.

### Outcomes
- job results improve future quoting and triage
- the app starts surfacing patterns
- leadership gains decision support without bloated BI work

### Core work
1. **Outcome capture normalization**
   - final price
   - actual duration
   - margin confidence
   - friction encountered
   - dump fee reality
   - customer quality
   - review outcome

2. **Insight dashboards**
   - quote accuracy by job type
   - frequent underbid patterns
   - win/loss patterns
   - release reasons
   - source quality
   - top friction modifiers

3. **Prompt/pricing refinement support**
   - identify rules worth updating
   - identify recurring misreads in OCR
   - identify common escalation causes

### Exit criteria
- leadership can learn from completed work
- pricing and prompts can be revised using actual data
- the system becomes more disciplined over time

---

## 4. Suggested Technical Build Order

This is the recommended implementation order for Claude Code:

1. docs and domain model
2. app shell and database schema
3. lead CRUD + status flow
4. screenshot upload + OCR review
5. grounded AI review engine
6. lead command center
7. pricing builder
8. booking + job conversion
9. schedule/calendar
10. field workflow + offline sync
11. payments + closeout
12. analytics and feedback loop

This order follows the product truth:
**lead control first, operations second, intelligence third**

---

## 5. Recommended Folder / Workstream Structure

```text
docs/
  product/
  architecture/
  workflows/
  prompts/

app/
  frontend/
  backend/

backend/
  api/
  services/
  models/
  ai/
  ocr/
  pricing/
  scheduling/
  media/
  auth/

frontend/
  screens/
  components/
  hooks/
  services/
  state/

tests/
  unit/
  integration/
  e2e/
```

---

## 6. Suggested V1 Milestone Definition

A strong V1 is **not** “everything in the brainstorm.”

A strong V1 is:

- screenshot upload works
- OCR-to-lead draft works
- facilitator can run AI review in A–H format
- lead command center works
- quote builder works
- booking conversion works
- field crew can view assigned jobs and upload before/after photos
- basic offline support works
- payment status and job closeout work

That is enough to create real business value.

---

## 7. What Not to Overbuild Early

Avoid these too early:

- advanced customer portal
- deep automation with external lead platforms
- black-box pricing AI
- complicated dispatch optimization
- broad analytics before core data quality exists
- overdesigned field worker UX before facilitator flow is stable

---

## 8. Quality Gates for Development

Every major phase should satisfy these checks:

### Product fidelity
Does this reflect the actual Holy Hauling SOP and not generic CRM thinking?

### Operator speed
Does this reduce clicks, retyping, and app switching for the facilitator?

### Auditability
Can we see what happened, who changed it, and what AI produced?

### Control
Does this preserve pricing discipline, escalation boundaries, and release logic?

### Mobile usability
Can this realistically be used from a phone?

### Offline reliability
If this touches field operations, what happens when service drops?

---

## 9. Claude Code Execution Strategy

Use Claude Code in **small vertical slices**, not giant abstract phases.

Example slice order:
1. create lead model + API + minimal screen
2. add screenshot upload to the lead
3. add OCR extraction to uploaded screenshots
4. add review-and-confirm parsed fields
5. add AI review button and A–H response object
6. add lead action log
7. add gate controls
8. add quote builder panel
9. add booking conversion
10. add crew job screen

This will keep the app testable at every step.

---

## 10. Recommended First Claude Code Prompt

```md
You are helping build the Holy Hauling internal app.

Start by producing the foundational product and engineering docs before implementation.

Context:
- This is a mobile-first internal operations app for Holy Hauling, a moving and junk removal company.
- The V1 primary user is the lead intake facilitator.
- The app must be OCR-first for screenshot lead ingestion, not dependent on Thumbtack’s API.
- AI behavior must be grounded in the company SOPs and return a structured A–H response format.
- The system must support the full lead lifecycle through booking, field execution, payment, and post-job feedback.
- The app should later support field crew views, required before/after photos, and offline operation.

Produce the following:
1. a system map
2. a domain model
3. a state model for leads/jobs/quotes
4. a V1 scope and non-goals doc
5. an architecture proposal aligned to the current stack
6. a phased implementation plan using small vertical slices

Constraints:
- Do not design this like a generic CRM.
- Keep the facilitator workflow at the center.
- Preserve pricing control and escalation boundaries.
- Separate internal pricing logic from customer-facing messaging.
- Prefer practical, testable slices over broad abstract plans.
```

---

## 11. Final Recommendation

If you want the cleanest start, begin Claude Code with:

**Phase 1 target: Lead Command Center foundation**

That means:
- lead model
- screenshot upload
- OCR review
- AI A–H output
- lead status flow
- action log

That will give you the operational heart of the app early, and almost every later feature will build naturally from it.
