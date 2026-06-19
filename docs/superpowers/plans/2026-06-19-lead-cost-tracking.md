# Lead-Cost Tracking (+ Competition Capture) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the Thumbtack lead fee per lead (gross/bonus/net total) via OCR + manual entry, feed the net total into the existing outcome/finance ROI economics, and capture competition stats (`pros_contacted`/`pros_responded`) — all with minimal facilitator friction.

**Architecture:** Six new nullable `Lead` columns. A `lead_cost_service` syncs the net total to a lead-linked "Thumbtack lead fee" `FinanceTransaction` (mirroring truck rentals) so it flows into `outcome` `realized_cost` automatically. The existing per-screenshot OCR is extended to read the fee breakdown + competition line (disambiguated from the pro's "Estimated cost" quote); a shared coerce helper maps OCR dollar strings → cents columns in both apply paths. Frontend adds a `LeadCostCard` in the Brief panel; the existing dynamic OCR review applies the new fields unchanged.

**Tech Stack:** FastAPI + SQLAlchemy async, Pydantic v2, anthropic vision; pytest-asyncio (`asyncio_mode=auto`); React 18 + TS + Vite + Tailwind + TanStack Query. Frontend verification: `tsc && vite build`.

**Reference spec:** `docs/superpowers/specs/2026-06-19-lead-cost-tracking-design.md`

---

## File Structure

**Backend**
- Modify: `app/backend/app/models/lead.py` — six new columns.
- Modify: `app/backend/main.py` — migration `_migrate_leads_add_cost_columns` + lifespan registration.
- Modify: `app/backend/app/schemas/lead.py` — `LeadUpdate` + `LeadOut` fields.
- Modify: `app/backend/app/schemas/ocr.py` — `OcrApply` fields + int coercion.
- Create: `app/backend/app/services/lead_cost_service.py` — finance-expense sync.
- Modify: `app/backend/app/services/lead_service.py` — cost-change trigger; `_PROVENANCE_FIELDS`.
- Modify: `app/backend/app/services/ocr_service.py` — prompt, `_APPLICABLE_FIELDS`, `_PROVENANCE_FIELDS`, coerce helper, `apply_ocr_fields`.
- Modify: `app/backend/app/services/ingest_service.py` — `_AUTO_APPLY_FIELDS` + coerce in auto-apply.
- Create: `app/backend/tests/test_lead_cost.py` — coerce, sync, update-trigger, outcome integration.

**Frontend**
- Modify: `app/frontend/src/hooks/useLeads.ts` (or the lead types module) — `Lead` + `LeadUpdate` fields.
- Create: `app/frontend/src/components/LeadCostCard.tsx`.
- Modify: `app/frontend/src/screens/panels/BriefPanel.tsx` — mount the card + competition line.

The dynamic OCR review in `LogPanel.tsx` needs **no change** — it renders/applies whatever fields OCR returns.

---

## Task 1: Backend model + migration + schemas

**Files:**
- Modify: `app/backend/app/models/lead.py`, `app/backend/main.py`, `app/backend/app/schemas/lead.py`

- [ ] **Step 1: Add the six `Lead` columns**

In `app/backend/app/models/lead.py`, add near the quote columns (after `quote_modifiers`, around line 82). `Integer` is already imported:

```python
    # Lead acquisition cost (Thumbtack fee). Net total drives ROI; gross/bonus kept for history.
    lead_cost_cents = Column(Integer, nullable=True)         # net "Total paid"
    lead_cost_gross_cents = Column(Integer, nullable=True)   # "Direct lead" gross
    lead_cost_bonus_cents = Column(Integer, nullable=True)   # "Bonus" discount, positive magnitude
    lead_cost_finance_transaction_id = Column(String, nullable=True)  # synced FinanceTransaction id
    # Competition (capture-only): "Contacted N pros • M responded"
    pros_contacted = Column(Integer, nullable=True)
    pros_responded = Column(Integer, nullable=True)
```

- [ ] **Step 2: Add the migration in `main.py`**

Add near the other `_migrate_leads_*` functions:

```python
async def _migrate_leads_add_cost_columns(conn) -> None:
    """Add lead-cost + competition columns to leads. Idempotent."""
    result = await conn.execute(text("PRAGMA table_info(leads)"))
    rows = result.fetchall()
    if not rows:
        return
    existing = _existing_columns(rows)
    cols = {
        "lead_cost_cents": "INTEGER",
        "lead_cost_gross_cents": "INTEGER",
        "lead_cost_bonus_cents": "INTEGER",
        "lead_cost_finance_transaction_id": "VARCHAR",
        "pros_contacted": "INTEGER",
        "pros_responded": "INTEGER",
    }
    for name, sqltype in cols.items():
        if name not in existing:
            await conn.execute(text(f"ALTER TABLE leads ADD COLUMN {name} {sqltype}"))
            print(f"[startup] leads: added {name} column")
```

Register it in the lifespan just before `await conn.run_sync(Base.metadata.create_all)` (after `_migrate_leads_add_checklist_seeded_at(conn)`):

```python
        await _migrate_leads_add_cost_columns(conn)
```

- [ ] **Step 3: Add fields to `LeadUpdate` and `LeadOut`**

In `app/backend/app/schemas/lead.py`, add to **both** `LeadUpdate` and `LeadOut` (all optional):

```python
    lead_cost_cents: Optional[int] = None
    lead_cost_gross_cents: Optional[int] = None
    lead_cost_bonus_cents: Optional[int] = None
    pros_contacted: Optional[int] = None
    pros_responded: Optional[int] = None
```

(Do NOT expose `lead_cost_finance_transaction_id` in the API — it is internal sync state.)

- [ ] **Step 4: Verify import**

Run: `cd app/backend && python -c "import main; print('ok')"`
Expected: prints `ok`.

- [ ] **Step 5: Commit**

```bash
git add app/backend/app/models/lead.py app/backend/main.py app/backend/app/schemas/lead.py
git commit -m "feat(lead-cost): lead cost + competition columns, migration, schema fields"
```

---

## Task 2: `lead_cost_service` finance sync + update_lead trigger

**Files:**
- Create: `app/backend/app/services/lead_cost_service.py`
- Modify: `app/backend/app/services/lead_service.py`
- Test: `app/backend/tests/test_lead_cost.py`

- [ ] **Step 1: Write the failing tests**

Create `app/backend/tests/test_lead_cost.py`:

```python
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select

from app.models.finance import FinanceTransaction, FinanceTransactionType
from app.models.lead import Lead, LeadSourceType, LeadStatus, ServiceType
from app.services import lead_cost_service


async def _make_lead(factory, **kw) -> str:
    async with factory() as s:
        lead = Lead(
            source_type=LeadSourceType.manual,
            status=kw.get("status", LeadStatus.booked),
            service_type=ServiceType.moving,
            urgency_flag=False,
            customer_name="Cost Test",
            city_id="st-louis",
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        s.add(lead)
        await s.commit()
        await s.refresh(lead)
        return lead.id


async def _load_lead(factory, lead_id) -> Lead:
    async with factory() as s:
        return (await s.execute(select(Lead).where(Lead.id == lead_id))).scalar_one()


async def _expenses(factory, lead_id):
    async with factory() as s:
        r = await s.execute(
            select(FinanceTransaction).where(FinanceTransaction.lead_id == lead_id)
        )
        return r.scalars().all()


async def test_sync_creates_expense_when_cost_set(client):
    from main import app
    factory = app.state.test_session_factory
    lead_id = await _make_lead(factory)
    async with factory() as s:
        lead = (await s.execute(select(Lead).where(Lead.id == lead_id))).scalar_one()
        lead.lead_cost_cents = 705
        await lead_cost_service.sync_lead_cost_expense(s, lead)
        await s.commit()
        await s.refresh(lead)
        assert lead.lead_cost_finance_transaction_id is not None
    txns = await _expenses(factory, lead_id)
    assert len(txns) == 1
    assert txns[0].transaction_type == FinanceTransactionType.expense
    assert txns[0].category == "Thumbtack lead fee"
    assert txns[0].amount_cents == 705


async def test_sync_updates_in_place(client):
    from main import app
    factory = app.state.test_session_factory
    lead_id = await _make_lead(factory)
    async with factory() as s:
        lead = (await s.execute(select(Lead).where(Lead.id == lead_id))).scalar_one()
        lead.lead_cost_cents = 705
        await lead_cost_service.sync_lead_cost_expense(s, lead)
        await s.commit()
    async with factory() as s:
        lead = (await s.execute(select(Lead).where(Lead.id == lead_id))).scalar_one()
        lead.lead_cost_cents = 1444
        await lead_cost_service.sync_lead_cost_expense(s, lead)
        await s.commit()
    txns = await _expenses(factory, lead_id)
    assert len(txns) == 1            # updated, not duplicated
    assert txns[0].amount_cents == 1444


async def test_sync_deletes_when_cleared(client):
    from main import app
    factory = app.state.test_session_factory
    lead_id = await _make_lead(factory)
    async with factory() as s:
        lead = (await s.execute(select(Lead).where(Lead.id == lead_id))).scalar_one()
        lead.lead_cost_cents = 705
        await lead_cost_service.sync_lead_cost_expense(s, lead)
        await s.commit()
    async with factory() as s:
        lead = (await s.execute(select(Lead).where(Lead.id == lead_id))).scalar_one()
        lead.lead_cost_cents = None
        await lead_cost_service.sync_lead_cost_expense(s, lead)
        await s.commit()
        await s.refresh(lead)
        assert lead.lead_cost_finance_transaction_id is None
    assert await _expenses(factory, lead_id) == []


async def test_update_lead_triggers_sync(client):
    # PATCH the cost via the lead-update path → expense appears
    lead_id = await _make_lead(client_factory(client))
    r = await client.patch(f"/leads/{lead_id}", json={"lead_cost_cents": 705})
    assert r.status_code == 200
    assert r.json()["lead_cost_cents"] == 705
    txns = await _expenses(client_factory(client), lead_id)
    assert len(txns) == 1 and txns[0].amount_cents == 705


def client_factory(client):
    from main import app
    return app.state.test_session_factory
```

- [ ] **Step 2: Run, expect FAIL** (`lead_cost_service` missing):

Run: `cd app/backend && python -m pytest tests/test_lead_cost.py -v`
Expected: FAIL on import / missing attribute.

- [ ] **Step 3: Implement `lead_cost_service`**

Create `app/backend/app/services/lead_cost_service.py` (mirrors `truck_rental._sync_rental_expense`):

```python
from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.finance import FinanceTransaction, FinanceTransactionType
from app.models.lead import Lead

_CATEGORY = "Thumbtack lead fee"
_VENDOR = "Thumbtack"


async def sync_lead_cost_expense(db: AsyncSession, lead: Lead) -> None:
    """Keep a single lead-linked 'Thumbtack lead fee' expense in sync with lead_cost_cents.
    Caller commits. Mutates lead.lead_cost_finance_transaction_id."""
    cost = lead.lead_cost_cents

    async def _load_tx() -> FinanceTransaction | None:
        if not lead.lead_cost_finance_transaction_id:
            return None
        res = await db.execute(
            select(FinanceTransaction).where(
                FinanceTransaction.id == lead.lead_cost_finance_transaction_id
            )
        )
        return res.scalar_one_or_none()

    # No (or zero) cost -> drop any linked expense
    if not cost or cost <= 0:
        tx = await _load_tx()
        if tx is not None:
            await db.delete(tx)
        lead.lead_cost_finance_transaction_id = None
        return

    occurred = lead.created_at.date() if lead.created_at else date.today()

    tx = await _load_tx()
    if tx is None:
        tx = FinanceTransaction(
            city_id=lead.city_id,
            transaction_type=FinanceTransactionType.expense,
            category=_CATEGORY,
            lead_id=lead.id,
            amount_cents=cost,
            occurred_on=occurred,
            vendor_customer=_VENDOR,
        )
        db.add(tx)
        await db.flush()  # assign tx.id
        lead.lead_cost_finance_transaction_id = tx.id
    else:
        tx.amount_cents = cost
        tx.vendor_customer = _VENDOR
        tx.updated_at = datetime.now(timezone.utc)
```

- [ ] **Step 4: Trigger the sync from `update_lead`**

In `app/backend/app/services/lead_service.py` `update_lead`, after the existing `await db.commit()` / `await db.refresh(lead)` (around line 300, alongside the calendar-sync block), add:

```python
        # Lead-cost finance sync: keep the "Thumbtack lead fee" expense in sync on cost change
        _COST_FIELDS = {"lead_cost_cents", "lead_cost_gross_cents", "lead_cost_bonus_cents"}
        if any(f in _COST_FIELDS for f in changed):
            from app.services import lead_cost_service
            try:
                await lead_cost_service.sync_lead_cost_expense(db, lead)
                await db.commit()
                await db.refresh(lead)
            except Exception as exc:
                _log.error("lead cost finance sync failed: %s", exc)
```

- [ ] **Step 5: Run the tests, expect PASS**

Run: `cd app/backend && python -m pytest tests/test_lead_cost.py -v`
Expected: all 4 PASS.

- [ ] **Step 6: Add an outcome-integration test**

Append to `tests/test_lead_cost.py` — confirm the synced expense flows into `realized_cost_cents`:

```python
async def test_synced_expense_feeds_outcome_realized_cost(client):
    from main import app
    from app.services import outcome_service
    factory = app.state.test_session_factory
    lead_id = await _make_lead(factory, status=LeadStatus.released)
    async with factory() as s:
        lead = (await s.execute(select(Lead).where(Lead.id == lead_id))).scalar_one()
        lead.lead_cost_cents = 705
        await lead_cost_service.sync_lead_cost_expense(s, lead)
        await s.commit()
    async with factory() as s:
        _rev, cost = await outcome_service._realized_amounts(s, lead_id)
    assert cost == 705
```

Run: `cd app/backend && python -m pytest tests/test_lead_cost.py -v` → all PASS.

- [ ] **Step 7: Commit**

```bash
git add app/backend/app/services/lead_cost_service.py app/backend/app/services/lead_service.py app/backend/tests/test_lead_cost.py
git commit -m "feat(lead-cost): sync net cost to a Thumbtack-lead-fee expense feeding ROI"
```

---

## Task 3: OCR cost + competition extraction

**Files:**
- Modify: `app/backend/app/services/ocr_service.py`, `app/backend/app/schemas/ocr.py`, `app/backend/app/services/ingest_service.py`
- Test: `app/backend/tests/test_lead_cost.py` (append)

- [ ] **Step 1: Write the failing coerce/apply tests**

Append to `app/backend/tests/test_lead_cost.py`:

```python
from app.services import ocr_service


def test_parse_cents():
    assert ocr_service.parse_cents("$7.05") == 705
    assert ocr_service.parse_cents("−$7.39") == 739       # minus stripped → positive magnitude
    assert ocr_service.parse_cents("1,234.50") == 123450
    assert ocr_service.parse_cents("14.44") == 1444
    assert ocr_service.parse_cents("") is None
    assert ocr_service.parse_cents(None) is None
    assert ocr_service.parse_cents("n/a") is None


def test_coerce_extracted_field_maps_cost_to_columns():
    assert ocr_service.coerce_extracted_field("lead_cost_total", "$7.05") == ("lead_cost_cents", 705)
    assert ocr_service.coerce_extracted_field("lead_cost_gross", "14.44") == ("lead_cost_gross_cents", 1444)
    assert ocr_service.coerce_extracted_field("lead_cost_bonus", "-7.39") == ("lead_cost_bonus_cents", 739)
    assert ocr_service.coerce_extracted_field("pros_contacted", "2") == ("pros_contacted", 2)
    assert ocr_service.coerce_extracted_field("pros_responded", "0") == ("pros_responded", 0)
    assert ocr_service.coerce_extracted_field("customer_name", "Bob") is None   # not a cost field


def test_prompt_disambiguates_estimated_cost():
    # The prompt must tell the model to ignore the pro's quote, not capture it as the fee.
    assert "Estimated cost" in ocr_service._EXTRACTION_PROMPT
    assert "Direct lead" in ocr_service._EXTRACTION_PROMPT
```

Note `pros_responded == 0` must coerce to `0`, not `None` — `parse_count` returns `0` for `"0"`.

- [ ] **Step 2: Run, expect FAIL** (`parse_cents`/`coerce_extracted_field` missing, prompt strings absent):

Run: `cd app/backend && python -m pytest tests/test_lead_cost.py -k "parse_cents or coerce or prompt" -v`

- [ ] **Step 3: Add helpers + prompt + applicable fields to `ocr_service.py`**

(a) Add `import re` at the top of `ocr_service.py` (it currently does not import `re`).

(b) Add the coerce helpers near the top-level helpers:

```python
_OCR_COST_COLUMN = {
    "lead_cost_total": "lead_cost_cents",
    "lead_cost_gross": "lead_cost_gross_cents",
    "lead_cost_bonus": "lead_cost_bonus_cents",
}
_OCR_COUNT_FIELDS = {"pros_contacted", "pros_responded"}


def parse_cents(value) -> Optional[int]:
    """'$7.05' -> 705, '−$7.39' -> 739 (magnitude), junk -> None."""
    if value is None:
        return None
    s = re.sub(r"[^\d.]", "", str(value))
    if not s or s == ".":
        return None
    try:
        return round(float(s) * 100)
    except ValueError:
        return None


def parse_count(value) -> Optional[int]:
    if value is None:
        return None
    s = re.sub(r"[^\d]", "", str(value))
    if s == "":
        return None
    try:
        return int(s)
    except ValueError:
        return None


def coerce_extracted_field(field: str, value) -> Optional[tuple[str, int]]:
    """Map an OCR cost/competition field to (lead_column, value). None if not a cost/competition field."""
    if field in _OCR_COST_COLUMN:
        cents = parse_cents(value)
        return (_OCR_COST_COLUMN[field], cents) if cents is not None else None
    if field in _OCR_COUNT_FIELDS:
        n = parse_count(value)
        return (field, n) if n is not None else None
    return None
```

(c) Extend `_APPLICABLE_FIELDS` with the OCR field names:

```python
    "lead_cost_total", "lead_cost_gross", "lead_cost_bonus",
    "pros_contacted", "pros_responded",
```

(d) Add `"lead_cost_cents"` to `_PROVENANCE_FIELDS` in `ocr_service.py` (so the badge tracks provenance under the net-total column).

(e) Extend `_EXTRACTION_PROMPT`: add these field lines inside the `"fields": [...]` list (before the closing `]`):

```
    {"field": "lead_cost_total", "value": "<the lead-fee TOTAL we paid, e.g. 7.05>", "confidence": "high"},
    {"field": "lead_cost_gross", "value": "<the 'Direct lead' gross fee, e.g. 14.44>", "confidence": "high"},
    {"field": "lead_cost_bonus", "value": "<the 'Bonus' credit as a positive number, e.g. 7.39>", "confidence": "high"},
    {"field": "pros_contacted", "value": "<integer pros contacted, e.g. 2>", "confidence": "medium"},
    {"field": "pros_responded", "value": "<integer pros who responded, e.g. 0>", "confidence": "medium"},
```

And add this guidance paragraph after the `accept_and_pay` instruction:

```
For lead cost: capture ONLY the platform's lead-fee breakdown shown to the pro — the "Direct lead" gross, the "Bonus" credit (as a positive number), and the "Total". Do NOT use "Estimated cost", "$/Hour", "X hour minimum", or the customer's budget — those are the customer-facing quote, NOT the lead fee. Omit these fields if no lead-fee breakdown is visible.
For pros_contacted / pros_responded: read a line like "Contacted N pros • M responded". Omit if absent.
```

(f) In `apply_ocr_fields`, add the coerce branch — place it right after the `if field == "actor" or field not in _APPLICABLE_FIELDS: continue` / `if value is None: continue` guards and **before** the `customer_phone` check:

```python
        coerced = coerce_extracted_field(field, value)
        if coerced is not None:
            col, coerced_val = coerced
            setattr(lead, col, coerced_val)
            applied.append(col)
            continue
```

(`applied` now may contain `lead_cost_cents`, which is in `_PROVENANCE_FIELDS`, so the provenance loop records `sources["lead_cost_cents"]="ocr"`.)

- [ ] **Step 4: Accept the new fields in `OcrApply`**

In `app/backend/app/schemas/ocr.py`, add to `OcrApply`:

```python
    lead_cost_total: Optional[str] = None
    lead_cost_gross: Optional[str] = None
    lead_cost_bonus: Optional[str] = None
    pros_contacted: Optional[int] = None
    pros_responded: Optional[int] = None
```

and extend the existing `_coerce_int` validator's field list to include the two counts:

```python
    @field_validator("load_stairs", "unload_stairs", "pros_contacted", "pros_responded", mode="before")
```

(The cost fields stay raw `str`; `apply_ocr_fields` parses them to cents via `coerce_extracted_field`.)

- [ ] **Step 5: Auto-apply cost at intake (ingest)**

In `app/backend/app/services/ingest_service.py`: add the five OCR field names to `_AUTO_APPLY_FIELDS`, and in the auto-apply loop (around line 124-128) use the shared coerce before the raw `setattr`:

```python
                    if entry.get("confidence") != "high" or field not in _AUTO_APPLY_FIELDS:
                        continue
                    value = entry.get("value")
                    if value is None:
                        continue
                    coerced = ocr_service.coerce_extracted_field(field, value)
                    if coerced is not None:
                        col, coerced_val = coerced
                        setattr(stub, col, coerced_val)
                        continue
                    setattr(stub, field, value)
```

(Confirm `ingest_service` imports `ocr_service`; it already uses it to trigger extraction. If the loop variable names differ, adapt to the real code — the contract is: high-confidence cost fields coerce to cents columns, others set raw.)

- [ ] **Step 6: Add `lead_cost_cents` to `lead_service._PROVENANCE_FIELDS`**

In `app/backend/app/services/lead_service.py`, add `"lead_cost_cents"` to `_PROVENANCE_FIELDS` (keep it in sync with `ocr_service`, as the comment there notes) so a manual edit records `sources["lead_cost_cents"]="edited"`.

- [ ] **Step 7: Run cost OCR tests + full suite**

Run: `cd app/backend && python -m pytest tests/test_lead_cost.py -v` → all PASS.
Run: `cd app/backend && python -m pytest -q` → full suite green (361 baseline + new). Report counts.

- [ ] **Step 8: Commit**

```bash
git add app/backend/app/services/ocr_service.py app/backend/app/schemas/ocr.py app/backend/app/services/ingest_service.py app/backend/app/services/lead_service.py app/backend/tests/test_lead_cost.py
git commit -m "feat(lead-cost): OCR extracts fee breakdown + competition (disambiguated from quote)"
```

---

## Task 4: Frontend — types + LeadCostCard in Brief panel

**Files:**
- Modify: `app/frontend/src/hooks/useLeads.ts` (Lead/LeadUpdate types) — confirm the actual type location first
- Create: `app/frontend/src/components/LeadCostCard.tsx`
- Modify: `app/frontend/src/screens/panels/BriefPanel.tsx`

- [ ] **Step 1: Add the fields to the frontend lead types**

Find the TS interface for a lead (the type backing `BriefPanel`'s `lead` prop and the lead-update mutation). Add (matching the existing optional style):

```ts
  lead_cost_cents?: number | null
  lead_cost_gross_cents?: number | null
  lead_cost_bonus_cents?: number | null
  pros_contacted?: number | null
  pros_responded?: number | null
```

to both the read type (`Lead`/`LeadDetail`) and the update payload type used by the lead `save`/PATCH mutation. Confirm the exact interface names in the file before editing.

- [ ] **Step 2: Create `LeadCostCard`**

Create `app/frontend/src/components/LeadCostCard.tsx`. Reads cents fields, edits via the lead-update mutation passed in as `onSave`. The provenance badge derives from `field_sources` (a JSON string on the lead; key `lead_cost_cents` → `ocr` | `edited`).

```tsx
import { useState } from 'react'

interface LeadCostCardProps {
  leadCostCents?: number | null
  leadCostGrossCents?: number | null
  leadCostBonusCents?: number | null
  prosContacted?: number | null
  prosResponded?: number | null
  fieldSources?: string | null
  // Persists the three cost fields (cents); returns a promise so we can show saving/saved/error.
  onSave: (patch: {
    lead_cost_cents: number | null
    lead_cost_gross_cents: number | null
    lead_cost_bonus_cents: number | null
  }) => Promise<unknown>
}

const fmt = (cents?: number | null) =>
  cents == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)

const toCents = (s: string): number | null => {
  const n = parseFloat(s.replace(/[^\d.]/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) : null
}

export function LeadCostCard(props: LeadCostCardProps) {
  const { leadCostCents, leadCostGrossCents, leadCostBonusCents, prosContacted, prosResponded, fieldSources } = props
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const [total, setTotal] = useState('')
  const [gross, setGross] = useState('')
  const [bonus, setBonus] = useState('')

  const hasCost = leadCostCents != null
  let badge: 'ocr' | 'edited' | null = null
  try {
    const src = fieldSources ? JSON.parse(fieldSources) : {}
    badge = src.lead_cost_cents ?? null
  } catch { badge = null }

  const beginEdit = () => {
    setTotal(leadCostCents != null ? (leadCostCents / 100).toFixed(2) : '')
    setGross(leadCostGrossCents != null ? (leadCostGrossCents / 100).toFixed(2) : '')
    setBonus(leadCostBonusCents != null ? (leadCostBonusCents / 100).toFixed(2) : '')
    setError(false)
    setEditing(true)
  }

  const save = async () => {
    setSaving(true); setError(false)
    try {
      await props.onSave({
        lead_cost_cents: toCents(total),
        lead_cost_gross_cents: gross.trim() ? toCents(gross) : null,
        lead_cost_bonus_cents: bonus.trim() ? toCents(bonus) : null,
      })
      setEditing(false)
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3 rounded-xl border bg-white p-4 dark:bg-gray-800 dark:border-gray-700">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Lead cost</p>
        {hasCost && badge && (
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            badge === 'ocr' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200'
                            : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300'}`}>
            {badge === 'ocr' ? 'From photo' : 'Manual'}
          </span>
        )}
      </div>

      {!editing && (
        <>
          {hasCost ? (
            <div className="text-sm">
              <div className="flex justify-between py-0.5"><span className="text-gray-500 dark:text-gray-400">Direct lead</span><span>{fmt(leadCostGrossCents)}</span></div>
              <div className="flex justify-between py-0.5"><span className="text-gray-500 dark:text-gray-400">Bonus</span><span className="text-emerald-600 dark:text-emerald-400">{leadCostBonusCents != null ? `−${fmt(leadCostBonusCents)}` : '—'}</span></div>
              <div className="mt-1 flex justify-between border-t border-gray-100 pt-1 dark:border-gray-700"><span className="font-semibold">Total paid</span><span className="text-lg font-extrabold">{fmt(leadCostCents)}</span></div>
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">No lead cost captured yet.</p>
          )}
          {(prosContacted != null || prosResponded != null) && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Contacted {prosContacted ?? '—'} pros · {prosResponded ?? '—'} responded
            </p>
          )}
          <button type="button" onClick={beginEdit} className="min-h-11 rounded-lg bg-gray-100 px-3 text-sm font-semibold text-gray-700 dark:bg-gray-700 dark:text-white">
            {hasCost ? 'Edit cost' : 'Add cost'}
          </button>
        </>
      )}

      {editing && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-gray-400">Direct lead
              <input value={gross} onChange={e => setGross(e.target.value)} inputMode="decimal" className="min-h-11 rounded-lg border border-gray-200 bg-white px-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white" /></label>
            <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-gray-400">Bonus
              <input value={bonus} onChange={e => setBonus(e.target.value)} inputMode="decimal" className="min-h-11 rounded-lg border border-gray-200 bg-white px-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white" /></label>
          </div>
          <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-gray-400">Total paid
            <input value={total} onChange={e => setTotal(e.target.value)} inputMode="decimal" className="min-h-11 rounded-lg border border-emerald-400 bg-white px-2 text-sm dark:bg-gray-700 dark:text-white" /></label>
          <div className="flex items-center gap-2">
            <button type="button" onClick={save} disabled={saving || !total.trim()} className="min-h-11 rounded-lg bg-emerald-500 px-4 text-sm font-semibold text-white disabled:opacity-40">{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={() => setEditing(false)} className="min-h-11 rounded-lg bg-gray-100 px-4 text-sm font-semibold text-gray-700 dark:bg-gray-700 dark:text-white">Cancel</button>
            {error && <span className="text-xs text-red-500">Couldn't save. Try again.</span>}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Mount in `BriefPanel`**

In `app/frontend/src/screens/panels/BriefPanel.tsx`, import the card and render it within the Brief content (a sensible spot is near the source/contact info, before or after the existing contact rows). Wire `onSave` to the existing lead-update mutation the panel already uses for `save('customer_name', v)` — call it with the cost-field patch (the panel's `save`/update mutation hits `PATCH /leads/{id}`, which triggers the finance sync). Pass `fieldSources={lead.field_sources}` and the cost/competition props from `lead`. Example shape:

```tsx
<LeadCostCard
  leadCostCents={lead.lead_cost_cents}
  leadCostGrossCents={lead.lead_cost_gross_cents}
  leadCostBonusCents={lead.lead_cost_bonus_cents}
  prosContacted={lead.pros_contacted}
  prosResponded={lead.pros_responded}
  fieldSources={lead.field_sources}
  onSave={(patch) => updateLead.mutateAsync({ id: lead.id, ...patch })}
/>
```

Match the panel's actual update-mutation call signature (inspect how `save(...)` is implemented and reuse it — it may wrap a single-field PATCH; if so, extend it to accept a multi-field patch or call the underlying mutation directly with the three fields). Do not change unrelated Brief content.

- [ ] **Step 4: Type-check + build**

Run: `cd app/frontend && npx tsc --noEmit` → no errors.
Run: `cd app/frontend && npm run build` → succeeds (pre-existing chunk-size warning is not an error).

- [ ] **Step 5: Commit**

```bash
git add app/frontend/src/hooks/useLeads.ts app/frontend/src/components/LeadCostCard.tsx app/frontend/src/screens/panels/BriefPanel.tsx
git commit -m "feat(lead-cost): Lead cost card in Brief panel (breakdown, badge, manual edit)"
```

---

## Self-Review

**Spec coverage:**
- Six new `Lead` fields + migration → Task 1.
- Net total → synced "Thumbtack lead fee" expense → outcome `realized_cost`/ROI → Task 2 (with the outcome-integration test).
- OCR reads gross/bonus/total + competition, disambiguated from "Estimated cost" → Task 3 (prompt + coerce + both apply paths; parse + disambiguation-guard tests).
- Manual override + breakdown display + provenance badge + competition line + action states → Task 4.
- Auto-apply "like existing fields": cost auto-applies at intake (`_AUTO_APPLY_FIELDS`) and rides the existing review-then-apply for added screenshots (dynamic `LogPanel`, no change) — consistent with every other field.
- Phase-C dashboard / 72h-refund automation / configurable default → out of scope (spec), not in any task.

**Placeholder scan:** The only "inspect the real code" instructions are integration points (the frontend lead-type interface name, the Brief panel's update-mutation signature, the ingest auto-apply loop's exact variable names) — each with the contract stated and example code. All service/schema/test/component code is complete. No TODO/TBD.

**Type/name consistency:** OCR field names (`lead_cost_total/gross/bonus`, `pros_contacted/responded`) vs. Lead columns (`lead_cost_cents/gross_cents/bonus_cents`, `pros_*`) are bridged by `coerce_extracted_field` (the single source of the mapping, used by both apply paths). `OcrApply` carries the OCR field names; `LeadUpdate`/`LeadOut`/TS types carry the column names. Bonus is a positive magnitude end-to-end (`parse_cents` strips the sign). The synced expense category `"Thumbtack lead fee"` is constant in service + tests. Provenance is keyed on `lead_cost_cents` in both `_PROVENANCE_FIELDS` copies and read by the card.

**Note for implementer:** `parse_count` must return `0` (not `None`) for `"0"` so `pros_responded: 0` is captured — the test asserts this. The finance sync runs after `update_lead`'s commit and commits again; it's wrapped in try/except so a sync failure never breaks the lead update.
