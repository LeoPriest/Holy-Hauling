# Lead-Cost Tracking (+ Competition Capture) — Design Spec

**Date:** 2026-06-19
**Status:** Approved direction, pre-implementation
**Author:** Ron + Claude

## Problem

The app records what we *charge* a customer (`quote_cents`, `quoted_price_total`) but nothing about what a lead *costs us*. Thumbtack bills a per-lead fee — shown at the bottom of each lead as a `Direct lead / Bonus / Total` breakdown — and that fee is invisible to our economics. As a result, the self-learning outcome layer's `realized_cost_cents` never includes lead-acquisition cost, so per-lead profit and source ROI are overstated, and we can't answer "is Thumbtack worth it?"

This is the first of two Thumbtack-alignment specs (the second, "Thumbtack Numbers" proxy-phone handling, is separate). Scope here: capture the lead fee (full breakdown) per lead, with minimal facilitator friction, and feed it into the existing ROI economics. A secondary, capture-only addition records the lead's competition stats (`Contacted N pros • M responded`) from the same screenshot.

Real sample (`docs/lead samples/lead 1.1.png`, `1.2.png`): a "Direct lead" split across two overlapping screenshots — the fee breakdown (`Direct lead $14.44 / Bonus −$7.39 / Total $7.05`) and competition line (`Contacted 2 pros • 0 responded`) sit at the bottom, often cut off from a single screenshot. The same screen also shows `Estimated cost: $120/Hour, 2 hour minimum` — that is our *quote to the customer*, NOT the lead fee, and must not be mistaken for it.

## Goals

1. Capture the Thumbtack lead fee per lead — full breakdown (gross, bonus, net total) for historical depth.
2. Minimal facilitator friction: OCR auto-fills the fee from a screenshot (reusing existing multi-screenshot OCR); manual entry as the reliable fallback.
3. Feed the net total into the existing outcome/finance economics so per-lead profit and source ROI become real.
4. Secondary, capture-only: record `pros_contacted` / `pros_responded`.

Explicit non-goal (future **phase C**): an acquisition-cost dashboard — CAC by source/city/time, refund accounting, competition win-rate, trend charts. This spec captures the data so phase C has history; it builds no analytics surface.

## Decisions locked during brainstorming

- **Goal = capture + wire into existing economics** (option A), not a dashboard (C, deferred).
- **Capture = OCR cost extraction + manual override** on one shared field set. **No configurable default** (Thumbtack fees vary $15–80+; a usually-wrong prefill adds correction friction).
- **Full breakdown** (gross + bonus + total), not just total — for future history.
- **Economics via a synced finance expense** (reuse the truck-rental pattern), not a direct outcome edit.
- **Bonus stored as a positive magnitude** (a discount); `gross − bonus = total`.
- **Competition capture** (`pros_contacted`, `pros_responded`) included as a tightly-scoped, capture-only rider.

## Architecture

### Data model — new `Lead` columns (all nullable)

| Column | Type | Notes |
|---|---|---|
| `lead_cost_cents` | Integer | **Net total paid** (authoritative; the number economics use). 705 in the sample. |
| `lead_cost_gross_cents` | Integer | "Direct lead" gross. 1444. |
| `lead_cost_bonus_cents` | Integer | "Bonus" discount as a positive magnitude. 739. (`gross − bonus = total`.) |
| `lead_cost_finance_transaction_id` | String | FK to the synced `FinanceTransaction` (mirrors truck rental's `finance_transaction_id`); null until synced. |
| `pros_contacted` | Integer | Competition: pros Thumbtack contacted. Capture-only. |
| `pros_responded` | Integer | Competition: pros who responded. Capture-only. |

A startup migration in `main.py` adds the six columns with the established `_existing_columns` guard. The breakdown is stored for history; only `lead_cost_cents` drives economics. `lead_cost_bonus_cents` is informational; it is not separately summed anywhere.

### OCR cost + competition extraction

Extend the existing per-screenshot OCR (`ocr_service.py`) — **no new multi-photo plumbing**; the system already supports multiple screenshots per lead (`POST /leads/{id}/screenshots`) with per-screenshot extract/apply, and applies fields to the shared lead. Changes:

- **Prompt:** add a section instructing the model to read, *when present*, the Thumbtack lead-fee breakdown (`Direct lead` gross, `Bonus`, `Total`) and the competition line (`Contacted N pros • M responded`). It must **explicitly ignore** `Estimated cost` / `$X/Hour` / `X hour minimum` (the pro's own quote to the customer) and the customer's budget — those are not the lead fee. Emit dollar values; the apply step converts to cents.
- **Fields list / parsing:** add `lead_cost_total`, `lead_cost_gross`, `lead_cost_bonus`, `pros_contacted`, `pros_responded` to the OCR field set. In `apply_ocr_fields`, parse currency strings (`$7.05`, `7.05`, `−$7.39`) → cents via a small helper (strip `$`, sign, commas), and integers for the pro counts. Map `lead_cost_total → lead_cost_cents`, etc. Bonus stored as positive magnitude.
- **Auto-apply:** the cost/competition fields auto-apply at **high** confidence like existing fields (they remain editable, and the UI shows a "From photo" badge). Medium/low stays a suggestion. Provenance recorded in `field_sources` as `ocr`, consistent with current behavior.
- **Robustness:** if only the gross or only the total is legible, apply what's found; never fabricate. If `Total` is absent but `gross`/`bonus` present, do not compute silently — leave `lead_cost_cents` unset (facilitator confirms). (Kept simple: the apply step maps whatever fields OCR returns; it does not back-derive total.)

### Economics wiring — synced finance expense

Reuse the truck-rental finance-sync pattern. A small `lead_cost_service` owns it:

- `sync_lead_cost_finance(db, lead)`: when `lead_cost_cents` is set/changed, **upsert** a lead-linked `FinanceTransaction` — `transaction_type=expense`, `category="Thumbtack lead fee"`, `amount = lead_cost_cents`, `lead_id = lead.id` — storing its id in `lead.lead_cost_finance_transaction_id`. When `lead_cost_cents` is cleared (null/0), **delete** the synced transaction and null the id. Idempotent (update in place when the id already exists).
- Trigger: `lead_service.update_lead` calls the sync when any cost field changes (same hook style as the existing calendar-sync trigger on booked-field changes).
- Because `outcome_service._realized_amounts()` already sums lead-linked expense transactions into `realized_cost_cents`, the lead fee flows into per-lead realized cost and ROI automatically — no change to the outcome layer. (A lead's realized cost may now include both a truck-rental expense and a lead-fee expense; both are real costs — correct.)

### Schemas

- `LeadUpdate` gains the six fields (optional) so editing flows through the existing `PATCH /leads/{id}`.
- `LeadOut` exposes them for the UI.
- No new endpoints — cost edits use the existing lead-update route; OCR uses the existing extract/apply routes.

### Frontend

- `components/LeadCostCard.tsx` in the Brief panel (`screens/.../panels/BriefPanel.tsx`): renders the `Direct lead / Bonus / Total paid` breakdown, a **"From photo"** (OCR) vs **"Manual"** badge (derived from `field_sources`), and actions **Scan cost photo** (jumps to the existing add-screenshot/extract flow) and **Edit manually**. Manual entry is three currency inputs (Total required; gross/bonus optional, blank when no bonus). Writes via the lead-update mutation.
- Competition: a small read-only line in the Brief (`Contacted {pros_contacted} pros · {pros_responded} responded`) shown when present. No interaction.
- Action states (the write path): saving indicator on Save, success confirmation, failure → rollback + error. OCR auto-fill shows the "From photo" badge; manual edit shows "Manual".

## Data flow

```
Facilitator captures lead -> uploads main screenshot (existing intake OCR)
   adds bottom-of-lead screenshot -> existing per-screenshot OCR
   OCR reads Direct lead/Bonus/Total + Contacted N/M -> apply (high-confidence auto)
     -> lead_cost_gross/bonus/cents + pros_contacted/responded set on the lead
   update_lead -> sync_lead_cost_finance -> upsert "Thumbtack lead fee" expense (lead_id)
     -> outcome_service realized_cost_cents includes the fee -> per-lead profit / source ROI

Facilitator (no cost in any photo) -> Edit manually -> three inputs -> PATCH /leads/{id}
   -> same finance sync.
Cost wrong / refunded -> facilitator edits Total down (or clears) -> sync updates/deletes the expense.
```

## Error / empty states

- No cost captured yet → card shows an empty state with "Scan cost photo" / "Edit manually".
- OCR mis-reads or grabs the quote → facilitator edits manually (badge flips to "Manual"); the disambiguation prompt minimizes this.
- `lead_cost_cents` cleared → synced finance expense deleted, `realized_cost` drops accordingly.
- Refund (72h) → handled manually by editing the Total down for now; automated refund handling belongs to the Thumbtack-Numbers spec.
- Partial OCR (gross but no total) → only present fields applied; total left for the facilitator to confirm.
- Competition line absent → `pros_contacted`/`pros_responded` stay null; the line isn't shown.

## Testing

### Backend (pytest)

- Migration adds the six columns idempotently.
- OCR parsing: `parse currency` helper (`$7.05`→705, `−$7.39`→739 magnitude, `1,234.50`→123450, junk→None); the prompt/apply maps `lead_cost_total→lead_cost_cents`, gross, bonus, and integer pro counts; an input containing both "Estimated cost $120/Hour" and a "Total $7.05" applies 705 (not 12000) — the disambiguation case.
- `sync_lead_cost_finance`: setting `lead_cost_cents` creates one `expense` `FinanceTransaction` (category "Thumbtack lead fee", amount = total, lead_id set) and stores its id; changing it updates in place (no duplicate); clearing it deletes the transaction and nulls the id; idempotent on repeat.
- Outcome integration: a finalized lead with a synced lead-fee expense has `realized_cost_cents` including the fee (alongside any truck-rental expense).
- `PATCH /leads/{id}` with cost fields persists them and triggers the sync; `LeadOut` returns them.
- Competition fields round-trip via update + OCR apply.

### Frontend

- `tsc && vite build` green with the new card + Brief wiring.
- (Structural) breakdown renders gross/bonus/total; "From photo" vs "Manual" badge by provenance; manual entry validates Total; competition line renders only when present; the three action states on save. No JS test runner — verification is type-check + build + backend contract tests; visual confirmation manual.

## Out of scope

- **Phase C dashboard:** CAC by source/city/time, refund accounting, competition win-rate, trend charts — future; this spec only captures the data.
- **Automated 72-hour refund handling** — belongs to the Thumbtack-Numbers spec; refunds handled here by manual edit.
- **Configurable default lead cost** — deferred (deliberately omitted to avoid wrong-prefill friction).
- **Thumbtack-Numbers proxy-phone handling** — separate spec.
- **Competition analytics / logic** — only capture + read-only display now.
- **Back-deriving total from gross − bonus in OCR** — not done; total is captured directly or entered.
