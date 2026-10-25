# Direct Booking Front Door — Design

**Date:** 2026-09-29
**Status:** Draft, awaiting Ron's review
**Scope built now:** Stage 1 only. Stages 2 and 3 are specified so Stage 1's data model does not box them in.

---

## 1. Why

Every Holy Hauling lead arrives through Thumbtack, or is typed in by hand from Thumbtack, Yelp, or Google screenshots. Thumbtack charges per lead, sends the same lead to several pros, hides the customer's real number behind a proxy line, and changes its rules. Ron's words: *"it feels like I have to play defensively with Thumbtack because they will do whatever it takes to get your money."*

The app already covers the back office: lead queue, AI review with target range and walkaway floor, decision card, Square payments, calendar sync, crew pay, and lead-cost tracking. What Holy Hauling does not own is the **front door**, the place a homeowner lands when they need junk gone.

**Goal:** Thumbtack becomes optional. It becomes a channel Ron can turn down, not the thing that decides the week.

**Success looks like:**
- Most booked jobs arrive through channels Holy Hauling owns.
- Ron can see that in the numbers, because every lead records where it came from and what it cost.
- Thumbtack spend can be cut without revenue falling.

## 2. The three stages

| Stage | What it is | Built now? |
|---|---|---|
| **1. Own front door** | Public booking page on Holy Hauling's own domain, a Google Business Profile feeding it, a business phone number, review requests, and a by-channel scoreboard. | **Yes** |
| **2. Overflow to partner pros** | When Holy Hauling can't take a job (capacity, date, distance), the lead is handed to a vetted partner pro. Holy Hauling takes a cut **per booked job**. | No — data model prepared |
| **3. Open marketplace** | Pros sign up, set service areas, and receive jobs. | No |

**Rules that carry into Stages 2 and 3, and are the pitch to pros:**
- Pros pay **per booked job, never per lead**.
- Each lead goes to **one pro**, never broadcast to several.
- The customer's real contact details go to the pro who takes the job.

Demand comes first: a marketplace with pros and no customers is dead on arrival. Stage 1 builds the customer stream Stage 2 hands off from.

## 3. Stage 1 — the customer's journey

Persona: Denise, Florissant, on her phone, standing in a garage with a dead couch and about 20 boxes.

1. **Lands.** From Google (the Business Profile "Website" button) or a direct link. The page loads fast and shows who Holy Hauling is in one line (local, faith-run, real crew), real reviews, one primary button **Get my price**, and a tap-to-call button.
2. **Describes the job.** The camera opens. She adds 1–6 photos; each shows its own upload progress. A failed upload stays on screen marked **Failed · Retry**; it never silently disappears. She types a short description, her address, and a preferred date or taps **I'm flexible**.
3. **Gets a price.** She sees "Checking your photos…" while pricing runs (see §5.3). Then one of:
   - **Confident:** "$275–$350. Final price confirmed on site before we lift anything." The range is never below the walkaway floor.
   - **Unsure, or pricing failed or timed out:** "We'll text you an exact price within 30 minutes" (during business hours; see §3.1). She sees the same screen whatever the cause. She never sees an error because the AI failed, and the lead is saved either way.
4. **Hands over contact.** Name, her real mobile number, and a required checkbox: "OK to text me about this pickup." Button **Request this pickup**, then "Sending…", then:
   - **Success:** "Got it, Denise. Holy Hauling will text you within 30 minutes to lock in your time." It shows a summary of what she asked for, plus **Call us instead**.
   - **Failure:** everything she typed stays in place, a **Try again** button appears, and the business number is shown with "or call us."
5. **Hears back.** The intern texts her from the business number to confirm a time. Booking and payment then follow the existing flow (decision card, Lock & Book, Square).
6. **After the job.** When the job is marked complete, she gets one text asking for a Google review, with a link.

**Moving requests:** Stage 1 prices junk removal and hauling only. The page has a secondary link, "Need moving help instead?", that collects name, phone, origin, destination, date, and notes and creates a lead with no instant price ("We'll text you a quote within 30 minutes"). Instant pricing for moves is later work; it is left out of Stage 1 because moves depend on distance and stairs, which photos don't show.

### 3.1 Business hours and the reply promise

- **Hours:** Monday–Saturday, 9:00am–6:00pm, America/Chicago. Closed Sunday. Stored as settings, not hard-coded.
- **Inside hours:** the promise is "within 30 minutes."
- **Outside hours:** the promise is "We'll text you first thing tomorrow morning" (or "Monday morning" from Saturday 6pm through Sunday). The reply timer starts when the next business window opens.
- The page's promise text and the timer read from the **same** hours setting, so they cannot disagree.

## 4. Stage 1 — the team's side

**Who answers:** the intern, working in the existing **facilitator** role. They can quote and book on their own, with the decision card's walkaway floor as the guardrail. Ron (admin) keeps full access.

1. **Arrival.** A push notification goes to facilitators: "New DIRECT lead · $0 fee · Florissant · $275–$350." The lead appears in the existing queue with a **Direct** tag, the photos, the price shown to the customer (or "No price shown — manual price needed"), her real number, and her text-consent flag.
2. **Reply timer.** A direct lead has a reply deadline: 30 business-hour minutes from arrival, or from the next business window if it arrived after hours. At **20 minutes** with no outbound text or logged call, it escalates to Ron (admin) through the existing escalation overlay (`LeadEscalation`, the Aging/Overdue queue). At 30 minutes it is marked **Overdue**. Sending a text or logging a call stops the timer.
3. **Texting from the lead.** The lead has a message thread. Outbound texts go from the business number through Twilio. Inbound texts from her number attach to the lead. Every message is saved, and every outbound send shows **Sending… → Sent** or **Not sent — [reason]** with **Retry** and a one-tap **Call her** fallback.
4. **Calls.** Calls to the business number forward to a configured phone (Ron's cell by default). Each inbound call is logged on the matching lead by caller number. A call from an unknown number creates a minimal lead with source **Google call** or **Direct call**.
5. **The rest is unchanged.** Working the lead uses the existing decision card, AI review, Lock & Book, Square, calendar sync, and crew assignment.

## 5. Stage 1 — what gets built

### 5.1 Public booking page (frontend)
- A new public route in the existing React app (for example `/book`), reachable at Holy Hauling's own domain. No login, phone-first, fast on a cellular connection.
- Screens: landing → photos and details → price → contact → confirmation, plus the moving-request form. All states from §3 are shown, including each failure state.
- The form keeps its state across a failed submit and a page refresh (stored in the browser session), so nothing she typed is lost.
- The page is a separate lightweight bundle, or code-split from the staff app, so customers don't download staff screens.

### 5.2 Public intake endpoints (backend)
- `POST /public/requests/photos` — accepts one image and returns an upload token. Images only (JPEG, PNG, HEIC, WebP), maximum 10 MB each, maximum 6 per request. Files are stored under a **non-public** path.
- `POST /public/requests/price` — takes a description, address, date or flexible, and upload tokens. Returns `{kind: "range", low, high}` or `{kind: "manual"}`. It never returns an error for a pricing failure; any failure returns `{kind: "manual"}`.
- `POST /public/requests` — creates the lead. `source_type = website_form` (this value already exists in `LeadSourceType`) and `city_id` is resolved from the address, falling back to the default city. It stores the price shown, the consent flag, and a `reply_due_at`, then fires the notification and returns a confirmation id. It is **idempotent** on a client-generated request id, so a retry after a timeout never creates two leads.
- `POST /public/requests/{id}/cancel?token=…` — the customer cancels through the signed link in her confirmation text. The lead moves to `lost` with reason "customer cancelled" and a `LeadEvent` is written.
- **Abuse protection on all public endpoints:** a hidden honeypot field, per-IP and per-phone rate limits (for example 5 requests per hour per phone), a request size cap, and US-format phone validation. Rejections return a plain message, never a stack trace.

### 5.3 Instant pricing
- Pricing runs the existing AI review (`ai_review_service.trigger_review`) on the new lead, **extended to accept the customer's photos as image input**. Today the review reads text only, and "point your camera at the pile" is the promise.
- The range shown is the review's `target_low`–`target_high`, and only when **all** of these hold: `sayability` is not `hold`, all three figures (`target_low`, `target_high`, `floor`) are integers, and `target_low >= floor`. Otherwise the result is `manual`.
- **Time budget:** 20 seconds. If it runs over, the result is `manual`; the review may still finish in the background and attach to the lead for staff.
- The price shown to the customer is recorded on the lead (`public_price_low_cents`, `public_price_high_cents`, or null when manual), so staff know exactly what she was told.

### 5.4 Lead model changes
New columns on `Lead` (all nullable or defaulted; **additive only, no table rebuild**):

| Column | Purpose |
|---|---|
| `channel` | Where the customer came from: `thumbtack`, `direct_web`, `google_call`, `direct_call`, `yelp`, `referral`, `manual`. Backfilled from `source_type` for existing leads. `source_type` stays as the *intake mechanism*; `channel` is the *acquisition source* the scoreboard groups by. |
| `business_id` | Which business owns and fulfils the lead. Defaults to Holy Hauling. **This is the Stage 2 hook**: handing off a lead to a partner pro changes this value. |
| `sms_consent_at` | When she agreed to texts. Outbound SMS is refused when this is null. |
| `sms_opted_out_at` | Set when she replies STOP. Outbound SMS is refused after this is set. |
| `reply_due_at` | The reply-promise deadline (§4.2). |
| `public_price_low_cents`, `public_price_high_cents` | The range the customer was shown. |
| `public_request_id` | Client idempotency key; unique. |
| `cancel_token_hash` | For the customer's cancel link. |

A `businesses` table is added with a single row (Holy Hauling). Stage 2 adds partner rows. No Stage 2 behaviour is built.

A `lead_messages` table is added for the customer SMS and call log: lead_id, direction (in/out), kind (sms/call), body, Twilio SID, status (queued/sent/delivered/failed/received), error, created_at. It is kept separate from `lead_chat_messages`, which is the internal AI chat.

Migrations follow the repo rule: **additive `ALTER TABLE ADD COLUMN`**, with tests that recreate the production-shape old table (named indexes and foreign keys) before migrating.

### 5.5 Business phone (Twilio)
- Twilio is already a dependency and `alert_service` already sends staff alert SMS through it. The customer-facing number reuses the same account with a **separate** `TWILIO_CUSTOMER_NUMBER`, so staff alerts and customer texts never share a number.
- Inbound SMS and voice webhooks are verified with Twilio's request signature and **fail closed in production** (the same rule as the Square webhook fix).
- Voice: forward to the configured phone and log the call. No IVR or voicemail transcription in Stage 1.
- STOP / START / HELP keywords are honoured and recorded (`sms_opted_out_at`).
- **Carrier registration (A2P 10DLC)** is required before customer texting works. Until it is approved, outbound customer SMS returns **Not sent — texting not yet approved** with the **Call her** fallback. It never looks sent when it wasn't.

### 5.6 Review requests
- When a lead moves to `released` (job complete) and has SMS consent and no opt-out, whatever its channel, one review-request text goes out with the configured Google review link.
- Sent at most once per lead. Its status (sent / not sent + reason) shows on the completed job, with a **Resend** button.
- If no Google review link is configured yet, nothing is sent, and the completed job says "Review request off: no Google review link set."

### 5.7 "Where my jobs come from" scoreboard
- A view for Ron (admin): for a chosen period, by `channel` — leads, booked jobs, booking rate, revenue (from existing finance links), lead cost (from existing `lead_cost_cents`), and **cost per booked job**.
- It extends the existing `metrics_service`, which already labels `website_form` as "Website".
- A channel with zero leads still shows as a row with zeros, so a dead channel is visible instead of absent.

### 5.8 Photo privacy fix (required before launch)
- Today `main.py` mounts `/uploads` as public static files, so anyone with a URL can open any uploaded file. Customer photos of their homes must not be public.
- **Change:** remove the public `/uploads` mount. Serve files through an authenticated route that checks the user is logged in and allowed to see the lead. The frontend's existing screenshot and receipt image views move to the authenticated route in the same change.
- Customer photos from leads that never booked are deleted automatically **90 days** after the lead closes as `lost`. Photos on booked jobs are kept with the job.

## 6. Removal and undo (every add has a matching remove)

| Thing | Added by | Removed by | What happens |
|---|---|---|---|
| Customer request | Customer submits | Customer taps cancel link | Lead → `lost` ("customer cancelled"), `LeadEvent` written; staff see it in the queue as cancelled. |
| Customer request | Customer submits | Staff: **Spam / not a real request** | Lead soft-deleted from the queue; photos deleted immediately; `LeadEvent` written. Undo available for 10 seconds. |
| Real lead | Any intake | Staff (admin): **Delete lead** | Confirmation dialog, then the lead, photos, and messages are deleted. Uses the existing `DELETE /leads/{lead_id}`, extended to also delete the lead's photos and `lead_messages`. |
| Photo | Customer upload | Customer taps ✕ before submitting | Upload token discarded; file deleted by cleanup of unclaimed uploads after 24 hours. |
| Text consent | Customer checkbox | Customer replies STOP | `sms_opted_out_at` set; all outbound customer SMS for that number refused; staff see "Opted out of texts — call only." |
| Review request | Job released | Staff: never sent twice; **Resend** only after a failure | — |
| Business hours / review link / forward-to number | Admin settings | Admin clears or edits in settings | Page promise and timer follow the new value immediately. |

## 7. When things go wrong

| Failure | Customer sees | Staff see |
|---|---|---|
| Photo upload fails | That photo marked **Failed · Retry** | — |
| Pricing fails or times out | "We'll text you an exact price…" | Lead flagged **Manual price needed** |
| Submit fails (network) | Form kept, **Try again**, call-us number | — |
| Duplicate submit | Same confirmation as the first | One lead, not two |
| Twilio down / not approved | — | **Not sent — [reason]**, **Retry**, **Call her** |
| Reply deadline missed | — | Escalation to Ron at 20 min; **Overdue** at 30 min |
| Rate limit / honeypot hit | "Too many requests — please call us" with the number | Nothing created |
| Review text fails | — | **Not sent** on completed job, **Resend** |

## 8. Testing and verification

- **Backend tests** for every endpoint and every row of §6 and §7, including idempotent submit, the pricing clamp (hold → manual, partial figures → manual, low below floor → manual, timeout → manual), consent and opt-out refusal, Twilio signature fail-closed, reply-deadline math across after-hours and Sunday, and the authenticated uploads route (unauthenticated → 401).
- **Each key test is proven able to fail:** mutate the guarded line and confirm that exact test goes red.
- **Migration tests** rebuild the production-shape old `leads` table before migrating.
- **Frontend:** every state from §3 rendered and screenshotted at 375 px wide, including each failure state.
- **Live check before calling it done:** a real submission from a real phone lands in the queue tagged Direct, with the notification delivered.
- **Ledger checks for Ron** (one per thing he can see): the booking page on his phone; a request landing in the queue tagged Direct; the scoreboard showing channels; a text sent from a lead showing Sent or Not sent honestly.

## 9. Setup only Ron can do (not code)

In this order, because the texting approval is the slow step:

1. **Twilio customer number + A2P 10DLC registration** (about $2/month for the number; about $20 once plus a few dollars a month for registration; approval takes days to weeks).
2. **Buy the domain** (about $12/year) and point it at the app.
3. **Create and verify the Google Business Profile** (video or postcard verification), set its website to the booking page, and copy its review link into settings.
4. **Claim the existing Yelp listing** (`yelp.com/biz/holy-hauling-saint-louis`) and point it to the booking page.
5. **Give the intern a facilitator login** if they don't have one.

A step-by-step checklist for these ships with the implementation plan.

## 10. Out of Stage 1

- Deposits or payment at request time (payment stays the existing Square flow at booking).
- Instant calendar self-booking.
- Instant pricing for moves.
- Partner pros, pro sign-up, payouts to pros, and per-booked-job billing (Stages 2 and 3).
- Paid ads (Google Local Services Ads), which come after the scoreboard shows what direct leads convert at.
- Voicemail transcription or phone menus.

## 11. Timing note

TATO's canonical store-launch date is 2026-10-10. Ron's non-code setup (§9, especially 10DLC) can start immediately, since it runs on carrier and Google timelines, not engineering time.
