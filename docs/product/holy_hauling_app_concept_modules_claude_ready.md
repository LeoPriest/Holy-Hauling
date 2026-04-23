# Holy Hauling App Concept Modules — Claude-Ready Source of Truth
**Purpose:** High-context product definition for Claude Code planning and execution  
**Status:** Working source-of-truth concept draft  
**Primary use:** Reference file for architecture, roadmap refinement, feature scoping, and implementation decisions  
**Project type:** Internal mobile-first operations app for Holy Hauling

---

# 0. How Claude Should Use This File

This file is not a generic brainstorm dump.  
Treat it as a **working source-of-truth product context document** for the Holy Hauling app.

## Instructions for Claude
When using this file:
- treat the confirmed decisions in this file as current product direction
- do **not** redesign this as a generic CRM
- prefer the **smallest useful vertical slice**
- preserve Holy Hauling’s real operating model:
  - fast lead handling
  - call-priority workflows
  - gate-based control
  - controlled pricing
  - hospitality-forward communication
- keep facilitator workflow at the center of V1
- keep field worker experience simpler than facilitator experience
- separate internal pricing logic from customer-facing messaging
- recommend one best next step instead of many equal options unless tradeoffs truly matter
- when in doubt, optimize for:
  1. faster response
  2. better control
  3. cleaner execution
  4. stronger auditability

## What this file should influence
- product planning
- feature scoping
- architecture decisions
- implementation order
- AI workflow design
- role/permission design
- alerting/escalation logic
- queue design
- quoting workflow
- roadmap updates

---

# 1. Product Summary

Holy Hauling’s app should be a **mobile-first internal command system** for lead handling and operations.

It should:

- ingest leads from **Thumbtack API first** when possible
- preserve **screenshot/OCR intake as a failsafe**
- alert the right people quickly when a lead is waiting
- guide the lead handler through Holy Hauling’s SOP-based workflow
- protect pricing discipline and escalation boundaries
- convert booked leads into clean operational jobs
- support field execution, media capture, and closeout
- improve over time through outcome and quote-vs-actual feedback

This is **not** a generic CRM.  
It is a Holy Hauling operating system.

---

# 2. Product North Star

Build an internal app that helps Holy Hauling:

- respond faster to new leads
- reduce friction in lead handling
- quote with more control and consistency
- escalate risk before overcommitting
- move smoothly from lead to booked job
- support the crew with clean job execution info
- close jobs cleanly with payment, photos, and follow-up complete
- learn from completed jobs over time

---

# 3. What Good Looks Like

A strong version of this app should make these things true:

- new leads are noticed fast
- the lead intake guy does not have to babysit a dashboard constantly
- API leads and screenshot leads land in one operational queue
- the facilitator can process a lead in one main workspace
- AI output follows Holy Hauling’s structure and actual SOPs
- quotes become more disciplined, not looser
- risky jobs surface clearly instead of being freestyled
- booked leads become clean jobs without duplicate entry
- crew members only see what they need
- before/after photos are actually captured
- closeout and payment are visible
- the system becomes smarter through structured capture, not vague AI hype

---

# 4. Product Principles

## 4.1 This is not a generic CRM
Do not build generic pipeline software with Holy Hauling branding on top.

## 4.2 Speed matters
Time-sensitive leads should be surfaced and acted on quickly.

## 4.3 Calls matter
For viable leads, the system should support the real call-first operating model.

## 4.4 Not every lead deserves equal effort
The system should preserve triage, release, and controlled pursuit.

## 4.5 Pricing must stay controlled
The app should help guide pricing, not cause premature commitments.

## 4.6 Hospitality is strategic
Communication should feel calm, helpful, and human without losing structure.

## 4.7 Operational simplicity matters
Field workers should get simple execution views, not intake complexity.

## 4.8 Auditability matters
The system should preserve source material, actions taken, and why decisions happened.

## 4.9 Structured learning beats black-box learning
Capture clean operational data first. Do not jump into speculative machine learning too early.

---

# 5. Locked Operating Truths

These are currently treated as core truths unless explicitly revised.

- The goal is not to maximize booked jobs at all costs.
- The goal is to maximize profitable, controlled work with repeatable execution.
- Releasing a bad-fit or misaligned lead is a valid success outcome.
- Moving and hauling require different pricing lenses.
- **Moving = time + care**
- **Hauling = volume + disposal**
- AI should support judgment, not replace it.
- The facilitator is the primary V1 user.
- API-first with screenshot fallback is the desired ingestion strategy.
- New leads should be actively surfaced, not passively left in a queue.
- Quote confidence matters.
- Role-based views matter.
- Unprocessed lead escalation matters.

---

# 6. Primary Users

## 6.1 Facilitator / Lead Intake Handler
Primary V1 user.

### Main responsibilities
- review new leads
- process API or screenshot intake
- run AI review
- handle gate progression
- send messages / attempt calls
- use controlled quote tools
- book or release leads
- escalate when needed

## 6.2 Owner / Admin
Oversight and approval user.

### Main responsibilities
- monitor operations
- review escalations
- approve risky commitments
- view dashboards
- review quote quality and patterns
- manage thresholds, roles, and rules

## 6.3 Crew / Field Worker
Execution user.

### Main responsibilities
- view assigned jobs
- see timing and access notes
- see equipment needs
- upload before/after photos
- update simple status
- complete jobs cleanly

---

# 7. Core Workflows

## 7.1 Lead Intake Workflow
lead arrives → source captured → queue entry created → acknowledgment timer starts → alerting begins → lead reviewed → AI run (when appropriate) → gate workflow begins

## 7.2 Lead Handling Workflow
Gate 0 → Gate 1 → Gate 2A → Gate 2B → book / release / escalate

## 7.3 Booking Workflow
approved lead → booked details confirmed → job created → schedule visible → crew info prepared → reconfirmation support

## 7.4 Field Workflow
assigned job visible → before photos → in progress → after photos → completion notes → payment confirmation / closeout

## 7.5 Feedback Workflow
job complete → outcome tagged → quote vs actual captured → friction notes logged → future intelligence improved

---

# 8. Glossary / Shared Terms

## Lead
A new inbound opportunity from Thumbtack API, screenshot/OCR, or future sources.

## Queue
The unified operational view of leads requiring action.

## Gate 0
Initial triage that determines effort level and whether the lead deserves active pursuit.

## Gate 1
Contact and basic qualification stage.

## Gate 2A
Alignment stage where seriousness, fit, and expectation alignment are tested.

## Gate 2B
Commitment stage where quote and schedule get locked with sufficient control.

## A–H output
The required internal AI response structure:
A. Quick Read  
B. Contact Strategy  
C. Gate Decisions  
D. Next Message to Send  
E. Call Plan  
F. Branch Replies  
G. Pricing Posture  
H. Escalation Notes  

## Quote confidence
A signal showing how controlled or risky the current pricing posture is:
- high
- medium
- low

## Owner review
A workflow state where commitment should pause until approved.

## Failsafe intake
Screenshot/OCR-based intake path used when direct API access is unavailable or unreliable.

---

# 9. Confirmed Decisions

These are actively confirmed directions from current brainstorming.

## Confirmed yes
- implement all major practical suggested features unless later deprioritized
- use Thumbtack API as the preferred primary lead-ingestion path if accessible at acceptable cost/terms
- preserve screenshot/OCR ingestion as a failsafe
- place API and screenshot leads into one unified queue
- use automatic escalation for unprocessed leads
- support quiet hours for new-lead phone-call alerts
- support backup handler routing
- include quote confidence scoring
- separate facilitator / owner / crew modes
- keep pricing posture internal-only
- preserve owner oversight for higher-risk situations
- keep this system facilitator-first for V1

## Not fully locked yet
- exact conditions for automatic owner-review triggers
- exact alert escalation timing thresholds
- exact priority of push vs SMS vs phone in all scenarios
- exact backend choice
- exact frontend/mobile implementation choice

## Recommended but not fully locked
- automatic owner-review should exist, but only through **rule-based triggers**
- avoid blanket owner review for ordinary leads
- alert hierarchy should be configurable

---

# 10. Non-Goals / Things to Avoid Early

These should generally be treated as early non-goals unless deliberately approved.

- building a generic CRM
- overbuilding field-worker UX before facilitator flow is strong
- relying only on screenshot intake if API access becomes feasible
- relying only on API access without a failsafe
- exposing raw internal pricing posture directly to customers
- black-box pricing AI before clean historical data exists
- broad analytics before core workflow data is reliable
- cluttered admin-heavy field views
- overcomplicated automation before lead handling basics are working
- deep external-platform expansion before Thumbtack flow is solid

---

# 11. Module Map

The app should be thought of as modules, not a giant undifferentiated product.

1. Lead Ingestion  
2. Unified Lead Queue  
3. Alerting and Escalation  
4. AI Lead Handling Engine  
5. Gate Workflow and Lead Command Center  
6. Quoting and Pricing Control  
7. Owner Review and Approval Controls  
8. Roles and Permissions  
9. Booking and Scheduling  
10. Field Execution  
11. Photo and Media Capture  
12. Payments and Closeout  
13. Outcome Tracking and Intelligence  
14. Communication Tools and Hospitality Layer  
15. Dashboard and Daily Operations View  

Each module is defined below.

---

# Module 1. Lead Ingestion

## Purpose
Create a reliable intake system that can capture new leads quickly and normalize them into one internal workflow.

## Primary direction
- **Primary:** Thumbtack direct API ingestion if access can be obtained at little to no cost and acceptable approval terms
- **Failsafe:** screenshot upload + OCR/parsing when API access is unavailable, limited, delayed, or interrupted

## Core requirements
- all lead sources should flow into the **same normalized internal lead model**
- the rest of the app should not care whether a lead came from API, screenshot, or manual entry
- preserve original source material for auditability
- source ingestion should not block the rest of the workflow if one intake path fails

## Intake sources
- Thumbtack API
- Thumbtack screenshot upload
- future: Yelp
- future: Google Business Profile
- future: website form
- future: manual entry

## Key features
- API-based lead ingestion
- webhook/event-aware ingestion if available
- screenshot upload
- OCR extraction
- structured parsing
- editable human review before final save
- source tagging
- raw source preservation
- ingestion error handling and retry visibility

## Suggested stored data
- lead source
- raw payload or raw OCR text
- original screenshot/image
- parsed fields
- ingest timestamp
- ingest success/failure status
- confidence flags

## Why it matters
This protects the business from dependency risk while still aiming for the fastest and cleanest lead path possible.

---

# Module 2. Unified Lead Queue

## Purpose
Give the intake team and owner a clear operational queue showing what actually needs attention.

## Core requirements
- API leads and screenshot leads land in the **same queue**
- queue should reflect urgency and next action
- queue should be operational, not just informational
- queue should support filters and aging indicators

## Suggested lead states
- New / unacknowledged
- In review
- Waiting on customer
- Ready for quote
- Ready for booking
- Escalated
- Booked
- Released / closed

## Key features
- visible queue
- filtering by status, urgency, source, assigned handler
- acknowledgment timer
- owner/facilitator view of what needs action now
- aging indicators for stale leads
- clear “process now” prioritization

## Suggested stored data
- current status
- assigned handler
- acknowledgment timestamp
- last action timestamp
- escalation state
- next recommended action

## Why it matters
This gives structure to live lead handling and prevents new leads from disappearing into message chaos.

---

# Module 3. Alerting and Escalation

## Purpose
Make sure time-sensitive leads get noticed and acted on fast.

## Locked direction
The app should not rely only on passive notifications.  
It should actively escalate when leads are sitting unprocessed.

## Core requirements
- new leads trigger alerts
- acknowledgment countdown begins when lead arrives
- alerts escalate if not acknowledged
- system supports quiet hours
- system supports backup handler routing
- system can escalate to owner/admin if needed
- alerting should be configurable, not hardcoded forever

## Alert hierarchy
Potential order:
1. in-app alert
2. push notification
3. SMS
4. automated phone call
5. backup handler
6. owner escalation

## Confirmed preferences
- yes to automatic escalation after threshold
- yes to quiet hours
- yes to backup handler support

## Key features
- immediate new-lead call option to intake guy
- repeated alert attempts if lead remains untouched
- configurable escalation thresholds
- quiet hours / after-hours behavior
- fallback routing to backup handler
- owner/admin escalation for unacknowledged leads
- acknowledgment stop condition

## Suggested stored data
- alert attempts
- channel used
- acknowledgment received
- escalation path taken
- quiet-hours rule applied
- fallback routing outcome

## Why it matters
Marketplace leads are time-sensitive.  
Speed to contact can directly affect close rate.

---

# Module 4. AI Lead Handling Engine

## Purpose
Turn Holy Hauling’s SOPs into a real in-app operating assistant.

## Core requirements
- AI must be grounded in Holy Hauling docs
- AI should support the lead handler, not replace judgment
- AI output should follow the locked internal structure
- internal pricing posture must remain clearly separated

## Locked AI structure
A. Quick Read  
B. Contact Strategy  
C. Gate Decisions  
D. Next Message to Send  
E. Call Plan  
F. Branch Replies  
G. Pricing Posture  
H. Escalation Notes

## Key features
- one-button AI review
- A–H output generation
- copy/edit next-message support
- internal-only pricing posture section
- AI run history saved to lead
- prompt/version traceability
- link AI run to source lead data used

## Suggested stored data
- prompt version
- grounding source/version
- AI output body
- created timestamp
- handler edits
- accepted/rejected suggestions

## Why it matters
This turns the current manual AI process into an integrated operational workflow.

---

# Module 5. Gate Workflow and Lead Command Center

## Purpose
Create the main working screen for live lead handling.

## Core requirements
- one screen should centralize the most important lead information
- gate progression should be clear and usable
- the app should support the way Holy Hauling actually works
- call-first actions should be easy to execute/log

## Core workflow
- Gate 0 triage
- Gate 1 contact/basic qualification
- Gate 2A alignment
- Gate 2B commitment
- book / release / escalate

## Key features
- screenshots/API details
- parsed lead details
- AI panel
- gate status
- next recommended action
- message/call log
- quote status
- escalation status
- call-first action buttons
- “process now” workflow
- owner-review flag visibility

## Suggested stored data
- gate status
- gate decisions
- action history
- notes
- call attempts
- messages sent
- escalation history
- release reason

## Why it matters
This is likely the operational heart of the app.

---

# Module 6. Quoting and Pricing Control

## Purpose
Help the team quote quickly without losing pricing discipline.

## Confirmed preferences
- yes to quote confidence scoring before quoting
- keep pricing posture internal-only
- preserve owner oversight when risk is high

## Core requirements
- separate internal pricing logic from customer-facing wording
- reflect Holy Hauling pricing lenses:
  - Moving = time + care
  - Hauling = volume + disposal
- support alignment ranges before firm commitments
- identify low-confidence quoting situations

## Key features
- internal quote builder
- modifier checklist
- quote confidence indicator:
  - high
  - medium
  - low
- missing-info flags
- risk notes
- customer-safe wording builder
- structure options:
  - alignment range
  - hourly/minimum
  - flat rate with guardrail
  - tiered hauling range
  - committed quote

## Suggested pricing modifiers
- stairs/access
- distance/zone
- heavy/awkward items
- assembly/disassembly
- wrapping/protection
- truck coordination
- elevator/building friction
- urgency
- scope confidence

## Suggested stored data
- service type
- selected structure
- modifiers applied
- estimate range
- committed quote
- quote confidence
- missing details
- customer-safe message draft

## Why it matters
This protects margin while helping the lead handler move faster.

---

# Module 7. Owner Review and Approval Controls

## Purpose
Protect the business when certain jobs exceed normal handling boundaries.

## Current direction
Automatic owner review is not fully locked yet, but rule-based triggers are strongly recommended.

## Recommendation
Use **automatic owner-review triggers** only for clearly defined risk situations.

## Possible triggers
- same-day lead with high uncertainty
- high quoted dollar amount
- large haul-out / multiple loads
- unclear access with heavy items
- specialty or high-risk items
- unusual customer demands
- low quote confidence
- flat-rate attempt with unclear truck control

## Key features
- “needs owner review” flag
- quote/commitment lock when triggered
- owner approval workflow
- visible reason for escalation
- approval / reject / request-more-info actions

## Suggested stored data
- trigger reason
- approval state
- owner notes
- blocked actions
- final disposition

## Why it matters
This preserves delegation without letting risky jobs slip through uncontrolled.

---

# Module 8. Roles and Permissions

## Purpose
Make the app usable by different users without forcing everyone into the same interface.

## Confirmed preference
Yes to separate modes for facilitator, owner, and crew.

## Suggested roles

### Facilitator mode
- intake
- AI review
- gate workflow
- quoting
- communication support
- booking

### Owner mode
- oversight
- escalations
- approvals
- dashboard visibility
- pricing review
- performance review
- settings/rules management

### Crew mode
- assigned jobs
- addresses
- timing
- access notes
- equipment needs
- photos
- completion status

## Key features
- role-specific navigation
- role-specific permissions
- visibility boundaries
- safe delegation controls

## Why it matters
Different users need different levels of detail and control.

---

# Module 9. Booking and Scheduling

## Purpose
Turn booked leads into organized jobs without duplicate entry.

## Core requirements
- booked leads should convert into jobs cleanly
- schedules should be visible and manageable
- field team should get a simplified execution view

## Key features
- lead-to-job conversion
- date/time capture
- address capture
- crew assignment
- truck/equipment notes
- customer notes
- reconfirmation workflow
- schedule/calendar views

## Suggested stored data
- scheduled date/time
- crew assignment
- service scope summary
- equipment notes
- reconfirmation status
- linked quote
- linked lead

## Why it matters
This creates the bridge from sales workflow to operational execution.

---

# Module 10. Field Execution

## Purpose
Help the crew execute well without exposing them to unnecessary admin complexity.

## Core requirements
- field view should be simpler than facilitator view
- crews should see only what they need
- app should support weak-signal environments

## Key features
- crew-ready job card
- addresses and timing
- access notes
- equipment checklist
- customer contact
- “en route / arrived / in progress / complete / issue” buttons
- offline access to assigned job info

## Suggested stored data
- job status
- crew timestamps
- issue flags
- equipment checklist state
- offline sync state

## Why it matters
The crew needs clarity, not clutter.

---

# Module 11. Photo and Media Capture

## Purpose
Enforce quality control, document work, and create useful business records.

## Core requirements
- before/after media capture should be part of the workflow, not optional clutter
- uploads should still work when signal is weak

## Key features
- required before photos before “start”
- required after photos before “complete”
- optional issue/damage photos
- offline upload queue
- sync status visibility
- media attached to job record

## Suggested stored data
- photo type
- timestamp
- sync state
- uploader
- linked job stage
- optional caption/notes

## Why it matters
This helps operations, protects the company, and creates future marketing assets.

---

# Module 12. Payments and Closeout

## Purpose
Finish the job loop from booking to money collected and follow-up completed.

## Core requirements
- payment state should be visible
- job closeout should require key records
- post-job follow-up should be supported

## Key features
- deposit tracking
- final payment tracking
- payment method
- balance due
- closeout checklist
- review/referral prompts
- archived completed record

## Suggested stored data
- payment status
- amount due
- amount paid
- method
- closeout completion state
- review/referral sent state

## Why it matters
A finished job is not really finished until the record, payment, and follow-up are clean.

---

# Module 13. Outcome Tracking and Intelligence

## Purpose
Help the system get smarter over time using Holy Hauling’s own data.

## Core requirements
- do not jump to black-box AI learning early
- start with structured data capture
- use historical outcomes to improve quoting and process decisions later

## Key features
- lead outcome tagging
- quote vs actual tracking
- actual duration vs estimated duration
- actual scope vs expected scope
- friction encountered
- final price changes
- review outcome
- source quality tracking

## Suggested stored data
- close reason
- actual duration
- actual scope notes
- margin-confidence notes
- underbid/overbid indicators
- source quality rating
- review received

## Why it matters
This is how future pricing refinement and operational intelligence become real instead of theoretical.

---

# Module 14. Communication Tools and Hospitality Layer

## Purpose
Keep communication fast, consistent, and on-brand.

## Core requirements
- customer-facing communication should reflect Holy Hauling’s hospitality standard
- the app should reduce freestyle inconsistency
- communication tools should support speed, not create friction

## Key features
- smart message library
- reusable templates:
  - first response
  - missed-call text
  - Gate 2A follow-up
  - release message
  - reconfirmation
  - review request
- hospitality notes
- customer context flags where appropriate
- customer-safe message editing support

## Suggested stored data
- template usage
- custom edits
- hospitality/context notes
- message history

## Why it matters
The app should reinforce Holy Hauling’s voice, not flatten it into robotic messaging.

---

# Module 15. Dashboard and Daily Operations View

## Purpose
Give owner and facilitator a quick picture of operational reality.

## Key features
- new leads today
- unprocessed leads
- waiting on customer
- booked today
- jobs today
- unpaid jobs
- jobs missing photos
- escalated leads
- aging leads

## Why it matters
This helps leadership and staff focus on what matters most right now.

---

# 12. Module Dependencies and Build Logic

Some modules depend on others. Claude should factor this into sequencing.

## Core early dependencies
- Lead Ingestion supports Unified Lead Queue
- Unified Lead Queue supports Alerting and Lead Command Center
- AI Lead Handling depends on intake data + source preservation
- Gate Workflow depends on lead queue + AI + action logging
- Quoting depends on gate workflow + structured lead details
- Booking depends on committed lead state
- Field Execution depends on booking
- Photo/Media depends on jobs
- Payments/Closeout depends on jobs
- Outcome Tracking depends on closeout-quality data

## Practical early build order
1. lead ingestion foundation
2. unified queue
3. alerting and acknowledgment
4. lead command center
5. AI A–H engine
6. quoting / confidence workflow
7. booking conversion
8. crew job view
9. media capture
10. payments / closeout
11. dashboard / intelligence refinement

---

# 13. V1 / Phase 2 / Later-Stage Recommendation

This is a current recommendation, not an absolute lock.

## V1 must-have
- Lead Ingestion
- Unified Lead Queue
- Alerting and Escalation
- AI Lead Handling Engine
- Gate Workflow and Lead Command Center
- Quoting and Pricing Control
- Roles and basic Permissions
- Booking and Scheduling basics
- Field Execution basics
- Photo and Media Capture basics
- Payments and Closeout basics

## Phase 2
- Owner Review and Approval Controls (fuller automation)
- Dashboard and Daily Operations View
- Outcome Tracking and Intelligence
- richer Communication Tools and Hospitality Layer
- more advanced scheduling/reconfirmation flows

## Later-stage
- broader multi-source platform expansion
- advanced analytics
- deeper automation
- more refined intelligence layers
- optimization workflows beyond core operations

---

# 14. Manual-First vs Automated-First Guidance

Claude should not automate everything at once.

## Prefer manual-first early for:
- owner review trigger fine-tuning
- quote confidence rules refinement
- hospitality/context note usage
- release reason taxonomy refinement
- source-quality interpretation
- advanced pricing optimization

## Prefer automated-first early for:
- new lead acknowledgment timer
- alert triggering
- queue aging
- API/screenshot normalization
- AI A–H formatting
- basic gate/status tracking
- before/after photo enforcement
- closeout checklist enforcement

---

# 15. Acceptance Criteria for an “Operationally Useful Early Version”

A meaningful early version of the app should satisfy something like this:

- a lead can enter from API or screenshot
- the lead lands in a unified queue
- acknowledgment timing starts automatically
- the right person can be alerted
- the facilitator can open one lead workspace
- the facilitator can run or view A–H analysis
- gate/state progression is visible
- quote posture can be captured with confidence level
- booked leads can become jobs
- crew can see assigned job basics
- before/after photos can be attached
- payment/closeout status can be tracked

If those things work, the app is already operationally valuable.

---

# 16. Risks and Constraints

These should stay visible during planning.

## 16.1 Thumbtack API access risk
Direct API access may depend on approval, terms, or limitations.

**Implication:** never build as if API access is guaranteed without fallback.

## 16.2 Alert fatigue risk
Over-alerting could become noise.

**Implication:** alert thresholds, quiet hours, and escalation logic must be configurable.

## 16.3 Over-automation risk
Too much automation too early could create brittleness.

**Implication:** keep human review and controlled checkpoints in early versions.

## 16.4 Scope creep risk
This app could easily expand into too many directions.

**Implication:** preserve module boundaries and phase discipline.

## 16.5 Field complexity risk
Field UX can get overloaded with admin logic.

**Implication:** simplify crew view aggressively.

## 16.6 Data quality risk
Historical intelligence is only useful if capture is structured and consistent.

**Implication:** outcome capture and required workflow fields matter.

---

# 17. Suggested Internal Data Domains

Claude can use this to think about schema/domain modeling.

Potential top-level entities:
- users
- roles
- leads
- lead_sources
- lead_events
- source_payloads
- screenshots
- OCR_results
- AI_runs
- gate_states
- quotes
- owner_reviews
- jobs
- schedules
- crew_assignments
- media
- payments
- closeouts
- outcome_tags
- alerts
- notification_attempts
- settings / rules

This is not a locked schema.  
It is a product/domain hint.

---

# 18. Suggested Settings / Configurability Areas

These areas should likely be configurable over time:

- alert hierarchy
- quiet hours
- escalation timing thresholds
- backup handler routing
- owner-review trigger thresholds
- quote confidence thresholds
- source enable/disable settings
- role permissions
- communication templates
- closeout requirements

This will reduce hardcoded behavior.

---

# 19. Current Product Shape

Holy Hauling’s app is shaping into:

**A mobile-first internal command system that ingests leads from Thumbtack API or screenshot fallback, alerts the right people fast, guides structured SOP-based AI handling, protects pricing and escalation discipline, converts booked leads into jobs, supports field execution and required media capture, tracks payment and closeout, and improves over time through operational feedback.**

---

# 20. Recommended Next Planning Steps

Before finalizing the roadmap again, the next useful planning steps are:

1. lock the V1 module boundary
2. decide the first operational vertical slice
3. define minimum owner-review trigger rules
4. define minimum alert/escalation timing rules
5. define the normalized lead model
6. decide which settings should be hardcoded first vs configurable first

---

# 21. Claude-Ready Execution Prompt Snippet

Claude can use this file together with a repo assessment prompt like:

> Assess the current repo against this Holy Hauling app concept file.  
> Do not restate background.  
> Recommend one best next vertical slice.  
> Keep facilitator-first workflow at the center.  
> Preserve API-first with screenshot fallback.  
> List only the files that matter, the acceptance criteria, and the risks.

---

# 22. Final Summary

This app should be built as a **Holy Hauling operating system**, not a generic admin app.

Its core job is to:

- capture leads fast
- alert the right people fast
- guide controlled lead handling
- protect pricing and escalation discipline
- convert cleanly into execution
- support the crew simply
- close the loop with payment, photos, and outcomes
- get smarter from real operational data over time
