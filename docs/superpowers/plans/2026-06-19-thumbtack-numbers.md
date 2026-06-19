# Thumbtack Numbers (Proxy Phone Handling) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Represent a Thumbtack proxy phone vs. the customer's real number — auto-tag proxies by source, capture the real number, prefer it for all contact via one helper, and prompt the facilitator when a Thumbtack lead has no usable number yet.

**Architecture:** Two new `Lead` columns (`customer_phone_is_proxy`, `customer_real_phone`). `customer_phone` keeps its role. A `contact_phone(lead)` helper (real-if-valid-else-proxy) becomes the single source for "the number to use" — consumed by the Square SMS router and exposed as a computed `LeadOut.contact_phone` for the frontend. Proxy auto-tagging runs when `customer_phone` is set on a Thumbtack-source lead (in `update_lead` + OCR apply). A `LeadContact` component renders the four contact states.

**Tech Stack:** FastAPI + SQLAlchemy async, Pydantic v2; pytest-asyncio (`asyncio_mode=auto`); React 18 + TS + Vite + Tailwind + TanStack Query. Frontend verification: `tsc && vite build`.

**Reference spec:** `docs/superpowers/specs/2026-06-19-thumbtack-numbers-design.md`

---

## File Structure

**Backend**
- Modify: `app/backend/app/models/lead.py` — two columns.
- Modify: `app/backend/main.py` — migration + lifespan registration.
- Modify: `app/backend/app/schemas/lead.py` — `LeadUpdate` fields, `LeadOut` fields + computed `contact_phone`.
- Modify: `app/backend/app/services/lead_service.py` — `_THUMBTACK_SOURCES`, `contact_phone()`, `_tag_proxy_on_phone_set()`, `update_lead` wiring (proxy tag + `customer_real_phone` validation).
- Modify: `app/backend/app/services/ocr_service.py` — proxy tag when `customer_phone` applied.
- Modify: `app/backend/app/routers/square_router.py` — source the SMS phone from `contact_phone`.
- Test: `app/backend/tests/test_thumbtack_numbers.py` — helper, auto-tag, validation, LeadOut.

**Frontend**
- Modify: `app/frontend/src/types/lead.ts` — `Lead` + `LeadUpdate` fields + `contact_phone`.
- Create: `app/frontend/src/components/LeadContact.tsx`.
- Modify: `app/frontend/src/screens/panels/BriefPanel.tsx` — replace the Phone `FieldRow` with `<LeadContact>`.

---

## Task 1: Backend model + migration + schemas

**Files:** `app/backend/app/models/lead.py`, `app/backend/main.py`, `app/backend/app/schemas/lead.py`

- [ ] **Step 1: Add the two `Lead` columns**

In `app/backend/app/models/lead.py`, near `customer_phone` (line ~55). `Boolean` and `String` are already imported:

```python
    customer_phone_is_proxy = Column(Boolean, nullable=False, default=False)  # customer_phone is a Thumbtack line
    customer_real_phone = Column(String, nullable=True)                       # customer's real number once captured
```

- [ ] **Step 2: Migration in `main.py`**

Add near the other `_migrate_leads_*` functions:

```python
async def _migrate_leads_add_phone_proxy_columns(conn) -> None:
    """Add Thumbtack-Numbers phone columns to leads. Idempotent."""
    result = await conn.execute(text("PRAGMA table_info(leads)"))
    rows = result.fetchall()
    if not rows:
        return
    existing = _existing_columns(rows)
    if "customer_phone_is_proxy" not in existing:
        await conn.execute(text("ALTER TABLE leads ADD COLUMN customer_phone_is_proxy BOOLEAN NOT NULL DEFAULT 0"))
        print("[startup] leads: added customer_phone_is_proxy column")
    if "customer_real_phone" not in existing:
        await conn.execute(text("ALTER TABLE leads ADD COLUMN customer_real_phone VARCHAR"))
        print("[startup] leads: added customer_real_phone column")
```

Register in the lifespan just before `await conn.run_sync(Base.metadata.create_all)`, after `await _migrate_leads_add_cost_columns(conn)`:

```python
        await _migrate_leads_add_phone_proxy_columns(conn)
```

- [ ] **Step 3: Schema fields + computed `contact_phone`**

In `app/backend/app/schemas/lead.py`:

(a) Add to `LeadUpdate`:
```python
    customer_phone_is_proxy: Optional[bool] = None
    customer_real_phone: Optional[str] = None
```

(b) Ensure `computed_field` is imported from pydantic (add it to the existing `from pydantic import ...` line).

(c) Add to `LeadOut` — the two raw fields plus the computed preference:
```python
    customer_phone_is_proxy: bool = False
    customer_real_phone: Optional[str] = None

    @computed_field
    @property
    def contact_phone(self) -> Optional[str]:
        # Stored values are already validated on write, so truthy preference is sufficient.
        return self.customer_real_phone or self.customer_phone
```

(Place the `@computed_field` property inside `LeadOut`, after its fields and before/around `model_config`.)

- [ ] **Step 4: Verify import**

Run: `cd app/backend && python -c "import main; from app.schemas.lead import LeadOut, LeadUpdate; print('ok')"`
Expected: prints `ok`.

- [ ] **Step 5: Commit**

```bash
git add app/backend/app/models/lead.py app/backend/main.py app/backend/app/schemas/lead.py
git commit -m "feat(thumbtack-numbers): proxy/real phone columns, schema fields, computed contact_phone"
```

---

## Task 2: Backend logic — contact helper, proxy auto-tag, validation, Square

**Files:** `app/backend/app/services/lead_service.py`, `app/backend/app/services/ocr_service.py`, `app/backend/app/routers/square_router.py`
**Test:** `app/backend/tests/test_thumbtack_numbers.py`

- [ ] **Step 1: Write the failing tests**

Create `app/backend/tests/test_thumbtack_numbers.py`:

```python
from __future__ import annotations

from app.services import lead_service


async def _create_lead(client, source_type="manual") -> str:
    r = await client.post("/leads", json={
        "source_type": source_type,
        "customer_name": "Phone Test",
        "service_type": "moving",
    })
    assert r.status_code == 201
    return r.json()["id"]


# --- contact_phone helper (pure-ish; build a lightweight stand-in) -----------

class _L:
    def __init__(self, real=None, phone=None):
        self.customer_real_phone = real
        self.customer_phone = phone


def test_contact_phone_prefers_real():
    assert lead_service.contact_phone(_L(real="(314) 555-7788", phone="(314) 555-0142")) == "(314) 555-7788"


def test_contact_phone_falls_back_to_phone():
    assert lead_service.contact_phone(_L(real=None, phone="(314) 555-0142")) == "(314) 555-0142"


def test_contact_phone_ignores_masked_real():
    # masked real → fall back to the valid proxy
    assert lead_service.contact_phone(_L(real="314-xxx-xxxx", phone="(314) 555-0142")) == "(314) 555-0142"


def test_contact_phone_none_when_neither_valid():
    assert lead_service.contact_phone(_L(real=None, phone=None)) is None


# --- proxy auto-tag ----------------------------------------------------------

async def test_proxy_autotagged_on_thumbtack_lead(client):
    lead_id = await _create_lead(client, source_type="thumbtack_screenshot")
    r = await client.patch(f"/leads/{lead_id}", json={"customer_phone": "(314) 555-0142"})
    assert r.status_code == 200
    body = r.json()
    assert body["customer_phone_is_proxy"] is True
    assert body["contact_phone"] == "(314) 555-0142"


async def test_proxy_not_tagged_on_manual_lead(client):
    lead_id = await _create_lead(client, source_type="manual")
    r = await client.patch(f"/leads/{lead_id}", json={"customer_phone": "(314) 555-0142"})
    assert r.status_code == 200
    assert r.json()["customer_phone_is_proxy"] is False


async def test_manual_proxy_override_persists(client):
    lead_id = await _create_lead(client, source_type="thumbtack_screenshot")
    await client.patch(f"/leads/{lead_id}", json={"customer_phone": "(314) 555-0142"})
    # Override: mark NOT a proxy, without changing the phone → must stick
    r = await client.patch(f"/leads/{lead_id}", json={"customer_phone_is_proxy": False})
    assert r.status_code == 200
    assert r.json()["customer_phone_is_proxy"] is False


# --- real-number capture + preference ---------------------------------------

async def test_real_phone_persists_and_becomes_contact(client):
    lead_id = await _create_lead(client, source_type="thumbtack_screenshot")
    await client.patch(f"/leads/{lead_id}", json={"customer_phone": "(314) 555-0142"})
    r = await client.patch(f"/leads/{lead_id}", json={"customer_real_phone": "(314) 555-7788"})
    assert r.status_code == 200
    body = r.json()
    assert body["customer_real_phone"] == "(314) 555-7788"
    assert body["contact_phone"] == "(314) 555-7788"   # real preferred over proxy


async def test_masked_real_phone_is_noop(client):
    lead_id = await _create_lead(client, source_type="thumbtack_screenshot")
    r = await client.patch(f"/leads/{lead_id}", json={"customer_real_phone": "314-xxx-xxxx"})
    assert r.status_code == 200
    assert r.json()["customer_real_phone"] is None
```

- [ ] **Step 2: Run, expect FAIL** (`contact_phone` missing; columns/tag not wired):

Run: `cd app/backend && python -m pytest tests/test_thumbtack_numbers.py -v`

- [ ] **Step 3: Add the helper + source set + tag function to `lead_service.py`**

Near `_is_valid_phone` / `LeadSourceType` import (confirm `LeadSourceType` is imported in lead_service; if not, add `from app.models.lead import LeadSourceType`):

```python
_THUMBTACK_SOURCES = {LeadSourceType.thumbtack_api, LeadSourceType.thumbtack_screenshot}


def contact_phone(lead) -> str | None:
    """The number to actually use: the customer's real number if valid, else the (proxy) customer_phone."""
    if _is_valid_phone(getattr(lead, "customer_real_phone", None)):
        return lead.customer_real_phone
    if _is_valid_phone(getattr(lead, "customer_phone", None)):
        return lead.customer_phone
    return None


def _tag_proxy_on_phone_set(lead) -> None:
    """A valid customer_phone on a Thumbtack-source lead is a Thumbtack proxy line."""
    if lead.source_type in _THUMBTACK_SOURCES and _is_valid_phone(lead.customer_phone):
        lead.customer_phone_is_proxy = True
```

- [ ] **Step 4: Wire into `update_lead`**

In `update_lead`, the loop has a `customer_phone` masked-rejection (around line 238: `if field == "customer_phone" and value is not None and not _is_valid_phone(...)：continue`). Extend that guard to also cover `customer_real_phone`:

```python
        if field in ("customer_phone", "customer_real_phone") and value is not None and not _is_valid_phone(str(value)):
            continue
```

Then, inside `if changed:` (after the setattr loop, before the final commit — e.g. right after the provenance block), add the proxy auto-tag, respecting an explicit override in the same patch:

```python
        # Auto-tag a Thumbtack proxy when the phone itself changed (unless the caller set the flag explicitly)
        if "customer_phone" in changed and "customer_phone_is_proxy" not in updates:
            _tag_proxy_on_phone_set(lead)
```

- [ ] **Step 5: Proxy tag on OCR apply**

In `app/backend/app/services/ocr_service.py` `apply_ocr_fields`, after the apply loop where `applied` is built (before/after the provenance block), add:

```python
        if "customer_phone" in applied:
            lead_service._tag_proxy_on_phone_set(lead)
```

(`lead_service` is already imported in ocr_service.)

- [ ] **Step 6: Square SMS uses `contact_phone`**

In `app/backend/app/routers/square_router.py`, change the phone source (line ~73) from:
```python
    phone = payload.phone_override or lead.customer_phone
```
to:
```python
    phone = payload.phone_override or lead_service.contact_phone(lead)
```
(Confirm `lead_service` is imported in square_router; if not, `from app.services import lead_service`.)

- [ ] **Step 7: Run the tests, then the full suite**

Run: `cd app/backend && python -m pytest tests/test_thumbtack_numbers.py -v` → all PASS.
Run: `cd app/backend && python -m pytest -q` → full suite green (370 baseline + new). Report counts.

- [ ] **Step 8: Commit**

```bash
git add app/backend/app/services/lead_service.py app/backend/app/services/ocr_service.py app/backend/app/routers/square_router.py app/backend/tests/test_thumbtack_numbers.py
git commit -m "feat(thumbtack-numbers): contact_phone helper, proxy auto-tag, real-phone validation, Square uses preferred number"
```

---

## Task 3: Frontend — `LeadContact` in the Brief panel

**Files:** `app/frontend/src/types/lead.ts`, `app/frontend/src/components/LeadContact.tsx`, `app/frontend/src/screens/panels/BriefPanel.tsx`

- [ ] **Step 1: Add fields to the lead types**

In `app/frontend/src/types/lead.ts`, add to the `Lead` read interface:
```ts
  customer_phone_is_proxy?: boolean
  customer_real_phone?: string | null
  contact_phone?: string | null
```
and to `LeadUpdate`:
```ts
  customer_phone_is_proxy?: boolean
  customer_real_phone?: string | null
```
Confirm `source_type` is already on the `Lead` type (it is used elsewhere); it's needed to detect Thumbtack leads.

- [ ] **Step 2: Create `LeadContact`**

Create `app/frontend/src/components/LeadContact.tsx`. Renders the four states; writes via the panel's `save(field, value)` helper (passed in).

```tsx
import { useState } from 'react'
import type { Lead } from '../types/lead'

const isThumbtack = (s?: string | null) => !!s && s.startsWith('thumbtack')

function CallText({ phone }: { phone: string }) {
  return (
    <div className="flex shrink-0 gap-1">
      <a href={`tel:${phone}`} className="min-h-11 flex items-center rounded-lg bg-green-600 px-3 text-xs font-medium text-white hover:bg-green-700">Call</a>
      <a href={`sms:${phone}`} className="min-h-11 flex items-center rounded-lg bg-blue-600 px-3 text-xs font-medium text-white hover:bg-blue-700">Text</a>
    </div>
  )
}

function NumberSaver({ label, placeholder, onSave }: { label: string; placeholder: string; onSave: (v: string) => void }) {
  const [v, setV] = useState('')
  return (
    <div className="flex items-center gap-2">
      <input
        value={v}
        onChange={e => setV(e.target.value)}
        inputMode="tel"
        placeholder={placeholder}
        className="min-h-11 flex-1 rounded-lg border border-gray-200 bg-white px-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        aria-label={label}
      />
      <button type="button" onClick={() => { if (v.trim()) onSave(v.trim()) }} disabled={!v.trim()}
        className="min-h-11 rounded-lg bg-emerald-500 px-4 text-sm font-semibold text-white disabled:opacity-40">Save</button>
    </div>
  )
}

export function LeadContact({ lead, save }: { lead: Lead; save: (field: string, value: string) => void }) {
  const tt = isThumbtack(lead.source_type)
  const hasContact = !!lead.contact_phone
  const real = lead.customer_real_phone
  const proxy = lead.customer_phone

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Contact</p>

      {/* Needs a number: Thumbtack lead, nothing usable yet */}
      {tt && !hasContact && (
        <div className="space-y-2">
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
            ⚠ <b>Reply on Thumbtack to get the customer's number</b> — it's hidden until you respond. Once it shows, add it here.
          </div>
          <NumberSaver label="Customer number" placeholder="Customer's number (once revealed)…" onSave={v => save('customer_phone', v)} />
        </div>
      )}

      {/* Real number present → Primary */}
      {real && (
        <div className="rounded-lg border border-gray-200 p-2 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <span className="font-semibold tabular-nums">{real}</span>
            <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-950">Primary</span>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">Real #</span>
            <div className="ml-auto"><CallText phone={real} /></div>
          </div>
        </div>
      )}

      {/* The customer_phone row (proxy or plain) */}
      {proxy && (
        <div className="rounded-lg border border-gray-200 p-2 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <span className={`tabular-nums ${real ? 'text-sm text-gray-500 dark:text-gray-400' : 'font-semibold'}`}>{proxy}</span>
            {lead.customer_phone_is_proxy && (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-blue-700 dark:bg-blue-900/40 dark:text-blue-200">Thumbtack line</span>
            )}
            {!real && <div className="ml-auto"><CallText phone={proxy} /></div>}
          </div>
          {lead.customer_phone_is_proxy && (
            <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">Routes to the customer through Thumbtack — may stop working after the job.</p>
          )}
        </div>
      )}

      {/* Add/replace the real number (shown once a proxy/number exists) */}
      {hasContact && !real && (
        <NumberSaver label="Real number" placeholder="Customer's real number…" onSave={v => save('customer_real_phone', v)} />
      )}
    </div>
  )
}
```

- [ ] **Step 3: Wire into `BriefPanel`**

In `app/frontend/src/screens/panels/BriefPanel.tsx`, add `import { LeadContact } from '../../components/LeadContact'` (adjust relative path to the real depth of the panels dir). Replace the entire `<FieldRow label="Phone"> … </FieldRow>` block (the one with the `EditableField value={lead.customer_phone}` + Call/Text links, ~lines 568-589) with:

```tsx
          <FieldRow label="Phone">
            <LeadContact lead={lead} save={save} />
          </FieldRow>
```

Confirm the `save` helper in this panel has signature `save(field, value)` (it's used as `onSave={v => save('customer_phone', v)}`). Do not change other `FieldRow`s.

- [ ] **Step 4: Type-check + build**

Run: `cd app/frontend && npx tsc --noEmit` → no errors.
Run: `cd app/frontend && npm run build` → succeeds (pre-existing chunk-size warning is not an error).

- [ ] **Step 5: Commit**

```bash
git add app/frontend/src/types/lead.ts app/frontend/src/components/LeadContact.tsx app/frontend/src/screens/panels/BriefPanel.tsx
git commit -m "feat(thumbtack-numbers): LeadContact in Brief panel (proxy badge, real #, needs-a-number prompt)"
```

---

## Self-Review

**Spec coverage:**
- Two columns + migration + computed `contact_phone` → Task 1.
- `contact_phone` helper (real-if-valid-else-proxy), proxy auto-tag by Thumbtack source (update_lead + OCR apply), manual-override persistence, real-phone validation, Square SMS routed through the helper → Task 2 (with tests for each).
- Four-state `LeadContact` UI (needs-a-number prompt, proxy "Thumbtack line" badge + caption, real # Primary, plain number) → Task 3.
- Contact preference A (real once captured) → `contact_phone` everywhere; both numbers visible/labeled.
- Out of scope (72h refund, expiry, real-# OCR, AI-review phone) → not in any task.

**Placeholder scan:** The only "inspect real code" notes are integration points (the `update_lead` masked-guard line, the `save` helper signature, the panels import depth, confirming `LeadSourceType`/`lead_service` imports) — each with the contract and example. All service/schema/component/test code is complete. No TODO/TBD.

**Type/name consistency:** `customer_phone_is_proxy` / `customer_real_phone` / `contact_phone` are consistent across model, `LeadUpdate`, `LeadOut` (computed), the `contact_phone()` helper, the TS types, and `LeadContact`. The backend helper uses `_is_valid_phone` for robustness; the `LeadOut.contact_phone` computed field uses truthy preference (stored values are pre-validated on write, so they agree). Proxy auto-tag fires only on a `customer_phone` change and is skipped when `customer_phone_is_proxy` is in the same patch (manual override).

**Note for implementer:** `LeadOut.contact_phone` is a Pydantic v2 `@computed_field` — it serializes automatically under `response_model=LeadOut`; no router change needed. The Square recipient change (Task 2 Step 6) is covered structurally + by the `contact_phone` helper unit tests (a full Square send test would require mocking Square + Twilio; not added here).
