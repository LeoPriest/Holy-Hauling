# Holy Hauling App SOP — Pricing-Matrix Grounded Version
**Version:** Revised grounding draft for app behavior  
**Purpose:** App-facing SOP for lead intake, AI review, gate logic, pricing posture, and quote behavior  
**Primary use:** Replace or upgrade the current `holy_hauling_sop.md` grounding file for the app

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
- preserve gate-based decision-making
- keep communication warm and clear
- move strong leads toward booking
- release bad-fit leads cleanly
- preserve an auditable record of what happened
- apply the **current pricing framework, pattern anchors, transport-path rules, and calibration logic with heavier weight than generic AI instincts**

---

# 2. Source-of-truth hierarchy

When the app or AI review engine has to choose between generic reasoning and Holy Hauling’s actual operating logic, it should follow this order:

## 2.1 Operating hierarchy
1. Current lead system / blueprint / SOP logic
2. Current pricing framework and revised pricing rules
3. Current escalation and authority boundaries
4. Current hospitality and tone standards
5. General AI reasoning last

## 2.2 Pricing hierarchy
For pricing-related guidance, the app should weight:
1. Current pricing framework
2. Current service lens  
   - Moving = time + care  
   - Hauling = volume + disposal
3. Behavior classification
4. Transport path
5. Friction / modifier profile
6. Pattern anchor
7. Gate stage
8. Confidence / missing-info state
9. Generic market assumptions last

---

# 3. Core operating philosophy

The goal is not to maximize booked jobs at all costs.

The goal is to maximize:
- profitable work
- controlled execution
- repeatable decisions
- strong customer experience
- clean handoff from intake to execution

A lead being released is sometimes the correct outcome.

The app should reinforce that philosophy, not pressure the user into chasing every lead equally.

**Priority rule:**  
When there is tension between booking fast and booking under control, the app should favor **control**.

---

# 4. Primary product rules

## 4.1 Screenshot-first intake
The default intake path should be screenshot-first.

Preferred flow:
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

## 4.2 Unified queue
All leads should normalize into the same internal queue:
- Thumbtack screenshot
- Thumbtack API / webhook
- future external sources
- manual fallback entry

## 4.3 Facilitator-first
The lead intake facilitator is the center of V1.

The app should optimize first for:
- fast lead review
- next-action clarity
- gate progression
- AI review usability
- clean notes and follow-up support

## 4.4 AI is an assistant, not the authority
The AI should:
- structure thinking
- reinforce the SOP
- apply the current pricing system
- draft useful next steps
- support consistency

The AI should not:
- override human judgment on risky jobs
- commit uncontrolled pricing
- invent rules not present in Holy Hauling docs
- flatten pricing into generic moving-company estimates

---

# 5. Lead intake workflow

## 5.1 Preferred flow
**Lead source → screenshot/API ingest → normalized lead record → queue → facilitator review → AI review → gate progression**

## 5.2 Screenshot intake behavior
For screenshot-based leads, the app should:
- create the lead record with minimal friction
- preserve the original screenshot
- run screenshot extraction when configured
- auto-apply only high-confidence fields
- present medium/low-confidence fields for review
- keep the facilitator in control before commitment

## 5.3 Webhook/API intake behavior
For API/webhook-based leads, the app should:
- preserve the raw payload
- normalize the payload into the same internal lead model
- dedupe repeated events using source reference identifiers
- place the lead in the same operational queue
- trigger the same queue / review / acknowledgment workflow

---

# 6. Queue and acknowledgment standard

## 6.1 Queue purpose
The queue exists to show what needs action now.

It should make clear:
- which leads are new
- which leads are unacknowledged
- which leads are waiting on review
- which leads are waiting on the customer
- which leads are ready for quote
- which leads are escalated
- which leads are booked or released

## 6.2 Queue ordering principle
The queue should prioritize:
1. unacknowledged leads
2. newest leads
3. operational urgency

## 6.3 Acknowledgment
A new lead should begin unacknowledged.

Acknowledgment should be distinct because later alerting and escalation depend on it.

---

# 7. Gate system

The app should preserve Holy Hauling’s gate-based control.

## 7.1 Gate 0 — Triage
Gate 0 decides effort level before heavy investment.

Possible outputs:
- Full pursuit
- Minimal effort
- Release

### Gate 0 pricing implication
Weak, vague, low-margin, or obviously misaligned leads should not receive deep quote work too early.

## 7.2 Gate 1 — Contact and basic qualification
Gate 1 is about:
- making contact
- confirming timing
- identifying the next most important missing detail

### Gate 1 pricing implication
At Gate 1, the app should usually avoid hard numbers.  
It may identify the pricing lens and missing factors, but should not push commitment pricing unless the system explicitly allows it.

## 7.3 Gate 2A — Alignment
Gate 2A is the **classification and alignment gate**.

This is where the app should confirm:
1. what the job is actually behaving like
2. what transport path applies
3. what friction points matter
4. whether customer expectations align with that reality
5. whether the pricing posture sounds true enough to move forward

### Gate 2A pricing implication
This is the main stage where the app should:
- apply the pricing framework
- choose the right service lens
- identify modifier pressure
- surface range logic
- test alignment without overcommitting

## 7.4 Gate 2B — Commitment
Gate 2B is the **commitment and locking gate**.

Only leads with enough clarity should reach this stage.

### Gate 2B pricing implication
This is the stage where the app may support:
- committed quote language
- final structure guidance
- guardrails and clauses
- owner-review triggers when needed

---

# 8. Core pricing philosophy

Holy Hauling does not price mainly by category labels or marketplace defaults.

Holy Hauling prices by:
- what the job is actually behaving like
- the transport path
- the real friction points
- whether the quote sounds true, fair, and sayable

The app should weight this pricing philosophy above generic AI instincts.

---

# 9. Pattern and framework

## 9.1 Pattern
Pattern is how Holy Hauling has actually been pricing and closing in live conversations.

It includes instincts like:
- distinguishing a few-item selective move from a true full move
- rejecting inflated numbers that do not sound true to the work
- preferring sayable prices
- separating labor-only from truck-included work
- pricing based on what the job really feels like in the field

## 9.2 Framework
Framework is the formal structure used to make that pattern repeatable, teachable, and safer.

## 9.3 Principle
The framework should be built from the pattern.  
The app should not choose between them. It should use the framework to preserve the pattern.

---

# 10. Official pricing flow

Every move should be priced in this order:

## Step 1 — Behavior classification
What is this job actually behaving like?

## Step 2 — Transport path
Who is providing the truck, and what transportation reality applies?

## Step 3 — Friction check
What is making this job slower, riskier, or more coordination-heavy than the base?

## Step 4 — Pattern anchor
What prior Holy Hauling-type jobs does this most closely resemble?

## Step 5 — Band position
Does this belong at the low end, middle, upper-middle, top, or above band?

## Step 6 — Sayability check
Would this quote sound true and confident coming out of your mouth on the phone?

## Step 7 — Quote style
Should this be a range or a firm number?

This is the official quote sequence the app should reinforce.

---

# 11. Behavior classification

Do not start with what Thumbtack or the source calls the job.

Start with what it is actually behaving like.

## Allowed behavior classes
- In-home heavy lift / room swap
- Micro carry / single-item transport
- Selective small move
- Load-only / unload-only labor job
- True 1BR move
- True 2BR move
- True 3BR+ move
- Specialty / friction-heavy move

## Reclassification rule
If a lead feels misclassified by category, reclassify by behavior before pricing.

---

# 12. Transport path rules

Holy Hauling does not sell one generic “truck included” service.

The app should think in one of these transport paths:

- Labor only
- Customer-provided / customer-rented truck
- Rental-coordinated full service
- Pickup-truck service
- Unknown / must confirm

## Core rule
Do not give a truck-included quote until the transport path is confirmed.

This matters because Holy Hauling does not own a dedicated moving truck, so transport path materially changes cost, schedule risk, and pricing lane.

## Truck-path handling principles
- Labor-only should often be the default preferred value path
- Customer-rented truck is often the better value before rental-coordinated full service
- Rental-coordinated full service must include rental burden, mileage, fuel, pickup/return time, and coordination risk
- Pickup-truck service should only be used for jobs that genuinely fit that path

---

# 13. Base pricing bands

These are internal quote lanes, not customer-facing menus.

## A. In-home heavy lift / room swap
- $175–$275

## B. Micro carry / single-item transport
- Labor / carry style: $225–$350
- With pickup transport: $275–$450

## C. Selective small move
- Labor only: $350–$550
- Pickup transport: $425–$625
- Rental-coordinated: $550–$750

## D. Load-only / unload-only labor job
- Light / standard: $350–$500
- Heavier / more friction: $450–$650

## E. True 1BR move
- Labor only: $475–$650
- Rental-coordinated: $625–$800

## F. True 2BR move
- Labor only: $625–$850
- Rental-coordinated: $775–$1,000

## G. True 3BR+ move
- Labor only: $850–$1,150
- Rental-coordinated: $1,050–$1,500+

## H. Specialty / friction-heavy
Start with the closest bucket, then apply specialty pressure.

These are pattern-calibrated starting lanes, not automatic quotes.

---

# 14. Modifier logic

Modifiers should answer one question:

**What is making this job slower, riskier, or more coordination-heavy than the base lane?**

They should be used primarily to determine where the quote sits inside the band, not as blind stacked math.

## Main modifiers
- access / stairs
- distance / zone
- transport path / truck coordination
- heavy / awkward items
- assembly / disassembly
- wrapping / protection
- elevator / building friction

## Secondary modifiers
- fragile / high-care items
- urgency / short notice
- scope confidence

## Positioning rule
Do not default to:
- +$50
- +$75
- +$100
- total it up
- send number

Instead ask:
- Is this still low end?
- Did it move to lower-middle?
- Is it middle now?
- Is upper-middle justified?
- Is top of band justified?

---

# 15. Pattern anchors

Pattern anchors are real Holy Hauling-style job families that help keep quotes honest.

The app should use anchors such as:
- in-home heavy lift / room swap
- micro carry / single-item transport
- loading-only / unloading-only labor job
- selective small move
- selective move with setup
- standard true 1BR labor-only
- standard true 1BR rental-coordinated
- standard true 2BR labor-only
- standard true 2BR rental-coordinated
- standard true 3BR+ labor-only
- standard true 3BR+ rental-coordinated
- selective storage transfer
- small hauling / haul-away

## Anchor rule
Before finalizing a quote, ask:
**What prior Holy Hauling pattern does this resemble most?**

If the number is far outside that family, pause and reclassify.

---

# 16. Sayability check

This is an official framework rule.

Before sending or saying a quote, ask:
1. Does this number sound true to the actual job?
2. Would I say it confidently on the phone?
3. Does it sound fair without sounding soft?
4. Does it match Holy Hauling’s actual pattern, not just the category label?

If the answer is no, reclassify or reposition the quote.

---

# 17. Range vs firm quote rule

## Use a range when:
- one or more major swing factors remain unclear
- the customer is planning early
- the customer is quote shopping
- truck path is not fully confirmed
- volume may change before move day

## Use a firm quote when:
- behavior bucket is clear
- transport path is clear
- friction points are mostly known
- scope is stable enough to commit
- the quote passes the sayability check

---

# 18. Required AI review structure

The AI review must follow the locked internal A–H format:

A. Quick Read  
B. Contact Strategy  
C. Gate Decisions  
D. Next Message to Send  
E. Call Plan  
F. Branch Replies  
G. Pricing Posture  
H. Escalation Notes  

## Key rule
**G. Pricing Posture is internal only.**

The app must never present it as direct customer-facing output.

## Pricing weighting inside G
When the AI generates G. Pricing Posture, it should heavily weight:
1. the current pricing framework
2. the correct service lens
3. current modifiers
4. current gate stage
5. missing-info / confidence state
6. escalation triggers

The AI should not produce vague, flattened pricing language that ignores the framework.

---

# 19. AI quote output requirements

Whenever the app or AI produces internal pricing guidance, it should include these internal elements:

- Quick Read
- Behavior Classification
- Transport Path
- Main Friction Points
- Pattern Anchor
- Pricing Band
- Band Position
- Sayability Check
- Quote Style
- Next Best Customer Message
- Call Plan
- Branch Replies
- Escalation Note
- Quote Source Label:
  - Pattern-led
  - Framework-led
  - Hybrid

This is how the app should keep pricing guidance explainable and auditable.

---

# 20. Reclassification and escalation rules

## Core rule
**Reclassify before you force a quote.**  
**Escalate before you force certainty.**

## Reclassification triggers
- category and real scope do not match
- customer language reveals the job is smaller or bigger than first assumed
- transport path changes the job family
- specialty factor dominates the job

## Escalation triggers
- truck reality is unclear, but customer wants an all-in number now
- pattern and framework disagree sharply
- quote fails the sayability check
- customer asks for commitments outside normal rails
- mixed-service jobs blur pricing lanes
- customer expectation is clearly mismatched to actual labor reality

## Escalation levels
- Level 1 — Recheck and proceed
- Level 2 — Pause before pricing / commitment
- Level 3 — Owner review / direct takeover

---

# 21. Communication and hospitality standard

Holy Hauling communication should feel:
- warm
- calm
- clear
- helpful
- concise
- controlled

The app should reduce robotic or chaotic communication.

Hospitality should shape tone without weakening structure or boundaries.

---

# 22. Notes and audit trail

The app should distinguish between:
- intake notes
- operational notes

Operational notes should be append-only and timestamped.

The event history should track actions such as:
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

# 23. Lead statuses

The app should support statuses such as:
- New / unacknowledged
- In review
- Waiting on customer
- Ready for quote
- Ready for booking
- Escalated
- Booked
- Released / closed

These should reflect real workflow, not generic CRM stages.

---

# 24. Feedback loop and calibration

Every booked job should teach the system something.

The app should support tracking:
- behavior classification used
- transport path used
- pattern anchor used
- quote style
- main expected friction points
- final close number
- actual time block
- actual friction points
- quote accuracy rating
- sayability / hindsight feel check
- customer expectation match
- revision note

## Core calibration rule
If the job felt different than the quote family, update the anchor — not just your mood.

The framework is stable, but not static.

---

# 25. What the app should avoid

The app should avoid:
- generic CRM behavior
- forcing the user to type everything manually
- over-questioning too early
- hard pricing before enough clarity exists
- exposing internal pricing guidance to customers
- hiding risk or escalation needs
- flattening the pricing framework into generic AI estimates
- treating moving and hauling as the same quoting problem

---

# 26. Minimum useful workflow standard

A meaningful working version of the app should allow the facilitator to:
1. intake a lead primarily through screenshot upload
2. preserve the original source material
3. extract and review structured lead information
4. get an A–H AI review grounded in Holy Hauling logic
5. move the lead through statuses/gates
6. add operational notes
7. preserve an audit trail
8. keep pricing posture internal
9. apply the current pricing framework with the right service lens
10. move viable leads toward booking
11. release bad-fit leads cleanly

---

# 27. Final summary

This SOP should guide the app toward being a **Holy Hauling operating system**, not a generic admin tool.

The app’s job is to help the team:
- notice leads fast
- process them with less friction
- think with more control
- communicate with calm clarity
- quote more safely
- apply the current pricing framework with heavier weight
- escalate risk earlier
- preserve a clean audit trail
- support repeatable execution
