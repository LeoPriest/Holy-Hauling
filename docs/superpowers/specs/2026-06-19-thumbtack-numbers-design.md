# Thumbtack Numbers — Proxy Phone Handling — Design Spec

**Date:** 2026-06-19
**Status:** Approved direction, pre-implementation
**Author:** Ron + Claude

## Problem

Thumbtack's 2026 "Thumbtack Numbers" rollout stopped giving pros the customer's direct phone number. Each lead now exposes a **masked number at intake** (`314-xxx-xxxx`, "shown after you reply") and, once the pro replies, a **Thumbtack proxy number** — a real, dialable 10-digit number that routes calls/texts to the customer but is **not the customer's real number** and may stop working after the job.

The app treats `customer_phone` as a single, permanent, real number with no awareness of any of this. `_is_valid_phone()` correctly rejects the old `xxx`-style mask, so a masked intake number is never saved — but a captured proxy is a clean 10-digit number that passes validation and is then displayed, dialed, and saved as if it were the customer's own. Two concrete gaps:

1. **Misrepresentation:** staff see/save the proxy as the customer's permanent contact and can lose the customer when the proxy expires after the job.
2. **No real number:** there's nowhere to record the customer's actual number when they share it in conversation.

This is the second of two Thumbtack-alignment specs (the first, lead-cost tracking, shipped). Scope here: represent and label the proxy, capture the customer's real number, prefer the real number for all contact, and prompt the facilitator when a lead has no usable number yet.

## Goals

1. Know whether `customer_phone` is a Thumbtack proxy, and label it as a "Thumbtack line" in the UI.
2. Capture the customer's **real** number (manual entry) and keep it on the lead.
3. **Once captured, the real number is used by default** for all calling/texting (decision A); the proxy stays as a labeled fallback.
4. When a Thumbtack lead has **no usable number yet**, show an action prompt nudging the facilitator to reply on Thumbtack to reveal it.

Out of scope (separate concerns): 72-hour "no response → refund-eligible" flagging, proxy *expiry* detection/tracking, and OCR extraction of the real number (it surfaces in conversation, not a structured field).

## Decisions locked during brainstorming

- **`customer_phone` keeps its current role** (the working/Thumbtack number) — we layer on top, no rename, minimal disruption to existing consumers.
- **Proxy auto-tagging by source:** a valid number on a Thumbtack-source lead is auto-tagged a proxy; manual override available.
- **Real number = manual capture** (validated), no OCR.
- **Contact preference = real-if-present, else proxy** (decision A) — every consumer routes through one helper.
- **"Needs a number" prompt** shows whenever a Thumbtack lead has no usable number and clears when one is saved.

## Architecture

### Data model — new `Lead` columns

| Column | Type | Notes |
|---|---|---|
| `customer_phone_is_proxy` | Boolean | `nullable=False, default=False` — `customer_phone` is a Thumbtack line. |
| `customer_real_phone` | String | nullable — the customer's real number once captured. |

A startup migration in `main.py` adds both (`_existing_columns` guard; boolean column added with a `DEFAULT 0`).

### Proxy auto-tagging

`THUMBTACK_SOURCES = {LeadSourceType.thumbtack_api, LeadSourceType.thumbtack_screenshot}`.

A small helper in `lead_service` — `_tag_proxy_on_phone_set(lead)` — sets `customer_phone_is_proxy = True` when `lead.source_type` is a Thumbtack source and `customer_phone` holds a valid number. It is called from the two places that set a *valid* `customer_phone` post-intake:
- `update_lead` — when `"customer_phone"` is in `changed`.
- `ocr_service.apply_ocr_fields` — when `customer_phone` is applied.

(Intake/ingest does not set it: at intake the number is masked and rejected by `_is_valid_phone`, so `customer_phone` is empty there.)

The tag only fires when `customer_phone` itself changes. A **manual override** is a direct PATCH of `customer_phone_is_proxy` alone (no `customer_phone` change) — it persists because the auto-tag never runs on that edit. `customer_phone_is_proxy` is in `LeadUpdate`.

### Real-number capture

`customer_real_phone` is added to `LeadUpdate` and written via the existing `PATCH /leads/{id}`. It is validated the same way as `customer_phone`: in `update_lead`, a masked/short value (failing `_is_valid_phone`) is treated as a no-op (not an error) — mirroring the existing `customer_phone` guard.

### Contact preference helper

`lead_service.contact_phone(lead) -> str | None` returns `customer_real_phone` if it is a valid number, else `customer_phone` (if valid), else `None`. This is the single source of "the number to actually use."

Consumers routed through it:
- **Backend — Square payment SMS** (`square_service`): send to `contact_phone(lead)` instead of `customer_phone` directly. The recorded `sent_to_phone` reflects what was actually texted.
- **Frontend — click-to-call / click-to-text** (Brief panel `tel:` / `sms:`): use a computed contact number (below).

`LeadOut` exposes the raw fields (`customer_phone`, `customer_real_phone`, `customer_phone_is_proxy`) **and** a read-only computed `contact_phone` so the frontend has one authoritative "number to dial" without re-implementing the preference. (`contact_phone` is computed in the lead→LeadOut serialization, not stored.)

### Frontend — `LeadContact` component

Extract the phone area of `BriefPanel` into `app/frontend/src/components/LeadContact.tsx`, rendering the contact section by state (matches the mockup):

- **Needs-a-number** (Thumbtack source AND `contact_phone` empty/invalid): an amber prompt — "Reply on Thumbtack to get the customer's number — it's hidden until you respond. Once it shows, add it here." — with an inline save field that writes the revealed number to **`customer_phone`** (the post-reply proxy), which then auto-tags as a Thumbtack line. (A real number shared later goes in the separate Real # field.)
- **Proxy present** (`customer_phone_is_proxy`, no real yet): show `customer_phone` with a **"Thumbtack line"** badge + the "may stop working after the job" caption; Call / Text actions use `contact_phone` (= the proxy here).
- **Real captured** (`customer_real_phone` set): show it as **Primary / Real #**; Call / Text use it. The proxy renders beneath as a labeled fallback with a "Text via Thumbtack" action + an Edit affordance.
- Non-Thumbtack leads with a normal number: a plain number row + Call/Text (no badges, no prompt) — current behavior preserved.

All actions are ≥44px tap targets. The real-number save carries the three action states (saving / success / failure-recovery) via the existing lead-update mutation.

### Schemas

- `LeadUpdate` gains `customer_phone_is_proxy: Optional[bool]` and `customer_real_phone: Optional[str]`.
- `LeadOut` gains `customer_phone_is_proxy: bool`, `customer_real_phone: Optional[str]`, and the computed `contact_phone: Optional[str]`.
- No new endpoints — all writes use the existing `PATCH /leads/{id}`.

## Data flow

```
Intake (Thumbtack): number masked -> _is_valid_phone rejects -> customer_phone empty
   UI: "Needs a number" prompt (reply on Thumbtack to reveal)
Pro replies -> proxy number visible -> facilitator saves it to customer_phone (manual / OCR)
   update_lead: customer_phone changed + Thumbtack source -> customer_phone_is_proxy = True
   UI: "Thumbtack line" badge; Call/Text use it (contact_phone = proxy)
Customer shares real number -> facilitator saves customer_real_phone (validated)
   UI: Real # becomes Primary; contact_phone = real
   Square SMS + click-to-call/text now use the real number; proxy kept as fallback
```

## Error / empty states

- Masked/short value entered into either phone field → no-op (rejected by `_is_valid_phone`), consistent with today.
- Thumbtack lead, no usable number → amber "needs a number" prompt until one is saved.
- Real number cleared → `contact_phone` falls back to the proxy; UI returns to the proxy state.
- Manual `is_proxy` toggle → persists (auto-tag only runs on `customer_phone` change).
- Non-Thumbtack lead → `is_proxy` stays false, no badges/prompt, behavior unchanged.

## Testing

### Backend (pytest)

- Migration adds both columns idempotently; `customer_phone_is_proxy` defaults False.
- Auto-tag: PATCH a valid `customer_phone` on a `thumbtack_screenshot` lead → `customer_phone_is_proxy` becomes True; same PATCH on a `manual` lead → stays False.
- Manual override: PATCH only `customer_phone_is_proxy=False` on a Thumbtack lead with a phone → stays False (not re-flipped, since `customer_phone` didn't change).
- OCR apply sets the proxy tag for a Thumbtack lead when `customer_phone` is applied.
- `customer_real_phone` validation: a masked/short value is a no-op; a valid value persists.
- `contact_phone(lead)`: returns `customer_real_phone` when valid; falls back to `customer_phone`; `None` when neither valid.
- `LeadOut.contact_phone` reflects the preference (real over proxy).
- Square payment SMS sends to `contact_phone` (real number when present, else proxy) — assert the recipient/`sent_to_phone`.

### Frontend

- `tsc && vite build` green with `LeadContact`.
- (Structural) the four contact states render correctly; Call/Text `tel:`/`sms:` targets use `contact_phone`; the needs-a-number prompt shows for a Thumbtack lead with no number and clears after save; the proxy "Thumbtack line" badge and real-# "Primary" badge render per state. No JS test runner — verification is type-check + build + backend contract tests; visual confirmation manual.

## Out of scope

- **72-hour refund-eligible flagging** (reusing the Aging/Overdue timers) — its own small spec.
- **Proxy expiry detection** — we caption the risk; no tracking/automation.
- **OCR of the real number** — manual capture only.
- **AI-review context phone** — `ai_review_service` may keep passing `customer_phone` (informational only); not switched to `contact_phone` in this spec.
- **Secondary/multiple real numbers, contact history** — single real number only.
