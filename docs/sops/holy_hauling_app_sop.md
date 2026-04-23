# Holy Hauling App SOP — App-Facing Operating Standard
**Version:** Draft for app grounding and in-app behavior  
**Purpose:** Define the operating standard the Holy Hauling app should follow during lead intake, AI review, and early workflow execution  
**Primary use:** AI grounding, product reference, and implementation guidance  
**Primary user (V1):** Lead intake facilitator  

---

# 1. What this SOP is

This SOP defines how the Holy Hauling app should behave during live lead handling.

It is not a generic CRM workflow.  
It is a Holy Hauling operating workflow translated into app behavior.

The app should help the team:

- respond quickly
- stay controlled
- protect margin
- support call-first handling
- keep communication warm and clear
- move strong leads toward booking
- release bad-fit leads cleanly
- preserve an auditable record of what happened

---

# 2. Core operating philosophy

The goal is not to maximize booked jobs at all costs.

The goal is to maximize:
- profitable work
- controlled execution
- repeatable decisions
- strong customer experience
- clean handoff from intake to execution

A lead being released is sometimes the correct outcome.

The app should reinforce that philosophy, not pressure the user into chasing every lead equally.

---

# 3. Primary product rules

## 3.1 Screenshot-first intake
The default intake path should be screenshot-first.

The preferred lead flow is:
1. screenshot arrives
2. screenshot is uploaded
3. extraction runs
4. extracted fields are reviewed
5. lead enters the queue
6. AI review runs on the cleaned lead record

Manual typing should be limited to:
- corrections
- missing fields
- fallback-only situations

## 3.2 Unified queue
All leads should normalize into the same internal queue, regardless of source:
- Thumbtack screenshot
- Thumbtack API / webhook
- future external source
- manual fallback entry

## 3.3 Facilitator-first
The lead intake facilitator is the center of V1.

The app should optimize first for:
- fast lead review
- next-action clarity
- gate progression
- AI review usability
- clean note-taking and follow-up support

## 3.4 AI is an assistant, not the authority
The AI should:
- structure thinking
- reinforce the SOP
- draft useful next steps
- support consistency

The AI should not:
- override human judgment on risky jobs
- commit uncontrolled pricing
- invent rules not present in Holy Hauling’s docs

---

# 4. Lead intake workflow

## 4.1 Preferred flow
The preferred intake flow is:

**Lead source → screenshot/API ingest → normalized lead record → queue → facilitator review → AI review → gate progression**

## 4.2 Screenshot intake behavior
For screenshot-based leads, the app should:

- create the lead record with minimal friction
- preserve the original screenshot
- run screenshot extraction when configured
- auto-apply only high-confidence fields
- present medium/low-confidence fields for review
- keep the facilitator in control before commitment

## 4.3 Webhook/API intake behavior
For API/webhook-based leads, the app should:

- preserve the raw payload
- normalize the payload into the same internal lead model
- dedupe repeated events using source reference identifiers
- place the lead in the same operational queue
- trigger the same queue / review / acknowledgment workflow

---

# 5. Queue and acknowledgment standard

## 5.1 Queue purpose
The queue exists to show what needs action now.

It should make clear:
- which leads are new
- which leads are unacknowledged
- which leads are waiting on review
- which leads are waiting on the customer
- which leads are ready for quote
- which leads are escalated
- which leads are booked or released

## 5.2 Queue ordering principle
The queue should prioritize:
1. unacknowledged leads
2. newest leads
3. operational urgency

## 5.3 Acknowledgment
A new lead should begin unacknowledged.

Acknowledgment should be a distinct action/state because later alerting and escalation depend on it.

---

# 6. Alerting and escalation standard

## 6.1 New leads should be actively surfaced
The app should not rely only on passive visibility.

The system should support:
- in-app alerting
- push/SMS/call escalation later
- backup handler routing
- owner escalation for unprocessed leads

## 6.2 Quiet hours and routing
Alert behavior should eventually respect:
- quiet hours
- backup handler routing
- owner escalation thresholds

The app should be designed so those rules can be configured later.

---

# 7. Gate system

The app should preserve Holy Hauling’s gate-based control.

## 7.1 Gate 0 — Triage
Gate 0 decides effort level before heavy investment.

Possible outcomes:
- Full pursuit
- Minimal effort
- Release

Not every lead deserves the same time and attention.

## 7.2 Gate 1 — Contact and basic qualification
Gate 1 is about:
- making contact
- confirming timing
- identifying the next most important missing detail

It is intentionally light.  
It is not full discovery.

## 7.3 Gate 2A — Alignment
Gate 2A checks:
- seriousness
- fit
- expectation alignment
- likely budget posture
- operational viability

This is where ranges and guardrails may be used before locking anything.

## 7.4 Gate 2B — Commitment
Gate 2B is where the lead moves toward:
- committed structure
- timing
- quote framework
- booking decision

Only controlled leads should reach this stage.

---

# 8. AI review standard

## 8.1 Required structure
The AI review must follow the locked internal A–H format:

A. Quick Read  
B. Contact Strategy  
C. Gate Decisions  
D. Next Message to Send  
E. Call Plan  
F. Branch Replies  
G. Pricing Posture  
H. Escalation Notes  

## 8.2 AI output purpose
Each section should help the facilitator act.

### A. Quick Read
Summarize what kind of lead this is and what stands out.

### B. Contact Strategy
Advise whether to call now, message first, or handle lightly.

### C. Gate Decisions
State the current gate posture and what matters next.

### D. Next Message to Send
Give a customer-facing message that is usable now.

### E. Call Plan
State what the call is meant to accomplish.

### F. Branch Replies
Prepare likely responses and exact next replies.

### G. Pricing Posture
Internal-only guidance on quote structure, risk, and control.

### H. Escalation Notes
Clarify whether the lead is standard, monitor-level, pause-before-commitment, or owner-review territory.

## 8.3 Internal-only rule
**G. Pricing Posture is internal only.**

The app should present it clearly as internal guidance, never as direct customer-facing output.

## 8.4 Auditability
Every AI review run should store:
- provider
- model
- grounding source
- prompt version
- input snapshot
- structured output
- timestamp

---

# 9. Pricing standard

## 9.1 Core pricing lens
The app should preserve these pricing lenses:

- **Moving = time + care**
- **Hauling = volume + disposal**

## 9.2 Pricing discipline
The app should not encourage premature hard pricing.

The review and quote workflow should support:
- structure discussion
- alignment ranges
- guardrails
- missing-info identification
- confidence signaling

## 9.3 Quote confidence
The app should surface quote confidence in a useful way.

Typical confidence levels:
- High
- Medium
- Low

Confidence should drop when important facts are unclear, such as:
- access
- stairs/elevator
- truck control
- real volume
- heavy/motorized items
- disposal unknowns

## 9.4 Modifier awareness
The app should support the main friction/modifier categories, including:
- access / stairs
- distance / zone
- heavy / awkward items
- assembly / disassembly
- wrapping / protection
- truck coordination
- elevator / building friction
- urgency
- scope confidence

---

# 10. Owner review and escalation controls

The app should preserve safe delegation.

Certain leads should trigger stronger review or pause logic, such as:
- same-day leads with high uncertainty
- large haul-outs
- unusual/high-risk items
- unclear access with heavy items
- low quote confidence
- unusually high pricing exposure
- flat-rate attempts with unclear truck control
- unusual customer demands

The app should allow normal leads to move smoothly while flagging risky leads for review.

---

# 11. Communication and hospitality standard

Holy Hauling communication should feel:

- warm
- calm
- clear
- helpful
- concise
- controlled

The app should reduce robotic or chaotic communication.

It should support:
- clear next-step messaging
- thoughtful missed-call follow-up
- low-friction review requests
- calm, confidence-building language

Hospitality should shape the tone without weakening structure or boundaries.

---

# 12. Notes and audit trail

## 12.1 Intake notes vs operational notes
The app should distinguish between:
- **intake notes**: original context captured during lead creation/intake
- **operational notes**: call notes, follow-up notes, live handling notes

Operational notes should be append-only and timestamped.

## 12.2 Event history
The audit trail should record important actions such as:
- lead created
- screenshot added
- extraction run
- fields applied from extraction
- fields manually updated
- acknowledged
- note added
- status changed
- AI review run
- booking/release actions

The goal is to make lead handling traceable.

---

# 13. Lead statuses

The app should support statuses such as:
- New / unacknowledged
- In review
- Waiting on customer
- Ready for quote
- Ready for booking
- Escalated
- Booked
- Released / closed

These statuses should reflect real workflow, not generic CRM stages.

---

# 14. Booking and handoff standard

Once a lead is controlled and booked, the app should support clean handoff into the next phase.

The booking transition should preserve:
- date/time
- service type
- addresses
- scope summary
- quote / structure
- special notes
- risk notes
- customer communication notes

This SOP is focused mainly on lead handling, but the app should hand off cleanly to later job execution features.

---

# 15. What the app should avoid

The app should avoid:

- generic CRM behavior
- forcing the user to type everything manually
- over-questioning the customer too early
- hard pricing before enough clarity exists
- exposing internal pricing guidance to customers
- hiding risk or escalation needs
- cluttering the crew experience with intake complexity
- losing the history of what happened

---

# 16. Minimum standard for a useful app workflow

A meaningful working version of the app should allow the facilitator to:

1. intake a lead primarily through screenshot upload
2. preserve the original source material
3. extract and review structured lead information
4. get an A–H AI review grounded in Holy Hauling logic
5. move the lead through statuses/gates
6. add operational notes
7. preserve an audit trail
8. keep pricing posture internal
9. move viable leads toward booking
10. release bad-fit leads cleanly

---

# 17. Final summary

This SOP should guide the app toward being a **Holy Hauling operating system**, not a generic admin tool.

The app’s job is to help the team:
- notice leads fast
- process them with less friction
- think with more control
- communicate with calm clarity
- quote more safely
- escalate risk earlier
- preserve a clean audit trail
- support repeatable execution
