# 72-Hour Refund-Eligible Flagging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface candidate refund-eligible Thumbtack leads (72h+, no engagement) without ever auto-concluding, let the facilitator resolve each (Customer responded / Refunded), and reconcile the lead cost on refund — reversibly.

**Architecture:** Two nullable `Lead` timestamps (`customer_responded_at`, `lead_refunded_at`). Candidacy is computed client-side (mirroring the Aging/Overdue band) from fields already on `LeadOut` — no scheduler, no stored flag. Two reversible resolve endpoints (mirroring `acknowledge_lead`) write the timestamps; refund reuses `sync_lead_cost_expense` (extended to drop the lead-fee expense when refunded, preserving `lead_cost_cents`). UI adds a lead-window `RefundBanner` and a "Refund-eligible" queue band.

**Tech Stack:** FastAPI + SQLAlchemy async, Pydantic v2; pytest-asyncio (`asyncio_mode=auto`); React 18 + TS + Vite + Tailwind + TanStack Query. Frontend verification: `tsc && vite build`.

**Reference spec:** `docs/superpowers/specs/2026-06-19-refund-eligible-flagging-design.md`

---

## File Structure

**Backend**
- Modify: `app/backend/app/models/lead.py` — two timestamp columns.
- Modify: `app/backend/main.py` — migration + lifespan registration.
- Modify: `app/backend/app/schemas/lead.py` — `LeadOut` exposes both.
- Modify: `app/backend/app/services/lead_cost_service.py` — drop expense when refunded.
- Modify: `app/backend/app/services/lead_service.py` — `mark_customer_responded`, `mark_refunded`.
- Modify: `app/backend/app/routers/leads.py` — 4 resolve endpoints.
- Test: `app/backend/tests/test_refund_flagging.py`.

**Frontend**
- Modify: `app/frontend/src/types/lead.ts` — two fields on `Lead`.
- Create: `app/frontend/src/utils/refund.ts` — `REFUND_WINDOW_HOURS` + `isRefundCandidate`.
- Modify: `app/frontend/src/hooks/useLeads.ts` (or a sibling hooks file) — `useMarkCustomerResponded`, `useMarkRefunded`.
- Create: `app/frontend/src/components/RefundBanner.tsx`.
- Modify: `app/frontend/src/screens/LeadCommandCenter.tsx` — mount `RefundBanner`.
- Modify: `app/frontend/src/screens/LeadQueue.tsx` — "Refund-eligible" band.

---

## Task 1: Backend model + migration + schema + sync guard

**Files:** `app/backend/app/models/lead.py`, `app/backend/main.py`, `app/backend/app/schemas/lead.py`, `app/backend/app/services/lead_cost_service.py`

- [ ] **Step 1: Add the two `Lead` columns**

In `app/backend/app/models/lead.py`, near the other timestamp columns (`DateTime` is imported):

```python
    customer_responded_at = Column(DateTime, nullable=True)  # manual "customer responded" marker; suppresses refund candidacy
    lead_refunded_at = Column(DateTime, nullable=True)        # set when the lead fee was refunded
```

- [ ] **Step 2: Migration in `main.py`**

Add near the other `_migrate_leads_*` functions:

```python
async def _migrate_leads_add_refund_columns(conn) -> None:
    """Add refund-flagging timestamp columns to leads. Idempotent."""
    result = await conn.execute(text("PRAGMA table_info(leads)"))
    rows = result.fetchall()
    if not rows:
        return
    existing = _existing_columns(rows)
    if "customer_responded_at" not in existing:
        await conn.execute(text("ALTER TABLE leads ADD COLUMN customer_responded_at DATETIME"))
        print("[startup] leads: added customer_responded_at column")
    if "lead_refunded_at" not in existing:
        await conn.execute(text("ALTER TABLE leads ADD COLUMN lead_refunded_at DATETIME"))
        print("[startup] leads: added lead_refunded_at column")
```

Register in the lifespan just before `await conn.run_sync(Base.metadata.create_all)`, after `await _migrate_leads_add_phone_proxy_columns(conn)`:

```python
        await _migrate_leads_add_refund_columns(conn)
```

- [ ] **Step 3: Expose on `LeadOut`**

In `app/backend/app/schemas/lead.py`, add to `LeadOut` (typed `datetime` to match `created_at`; FastAPI serializes to ISO):

```python
    customer_responded_at: Optional[datetime] = None
    lead_refunded_at: Optional[datetime] = None
```

- [ ] **Step 4: Drop the lead-fee expense when refunded**

In `app/backend/app/services/lead_cost_service.py` `sync_lead_cost_expense`, change the delete guard (line ~30) from:
```python
    if not cost or cost <= 0:
```
to:
```python
    # Refunded leads carry no realized acquisition cost (the original lead_cost_cents is preserved on the lead).
    if not cost or cost <= 0 or lead.lead_refunded_at is not None:
```

- [ ] **Step 5: Verify import**

Run: `cd app/backend && python -c "import main; from app.schemas.lead import LeadOut; print('ok')"`
Expected: prints `ok`.

- [ ] **Step 6: Commit**

```bash
git add app/backend/app/models/lead.py app/backend/main.py app/backend/app/schemas/lead.py app/backend/app/services/lead_cost_service.py
git commit -m "feat(refund-flagging): refund timestamp columns, LeadOut fields, refunded drops lead-fee expense"
```

---

## Task 2: Backend resolve endpoints + service

**Files:** `app/backend/app/services/lead_service.py`, `app/backend/app/routers/leads.py`
**Test:** `app/backend/tests/test_refund_flagging.py`

- [ ] **Step 1: Write the failing tests**

Create `app/backend/tests/test_refund_flagging.py`:

```python
from __future__ import annotations

from sqlalchemy import select

from app.models.finance import FinanceTransaction


async def _create_lead(client, source_type="thumbtack_screenshot") -> str:
    r = await client.post("/leads", json={
        "source_type": source_type,
        "customer_name": "Refund Test",
        "service_type": "moving",
    })
    assert r.status_code == 201
    return r.json()["id"]


def _factory(client):
    from main import app
    return app.state.test_session_factory


async def _expenses(client, lead_id):
    async with _factory(client)() as s:
        r = await s.execute(select(FinanceTransaction).where(FinanceTransaction.lead_id == lead_id))
        return r.scalars().all()


async def test_mark_and_unmark_customer_responded(client):
    lead_id = await _create_lead(client)
    r = await client.post(f"/leads/{lead_id}/customer-responded")
    assert r.status_code == 200
    assert r.json()["customer_responded_at"] is not None
    r = await client.delete(f"/leads/{lead_id}/customer-responded")
    assert r.status_code == 200
    assert r.json()["customer_responded_at"] is None


async def test_customer_responded_missing_lead_404(client):
    r = await client.post("/leads/nope/customer-responded")
    assert r.status_code == 404


async def test_mark_refunded_drops_expense_preserves_cost(client):
    lead_id = await _create_lead(client)
    # Set a lead cost → finance sync creates the "Thumbtack lead fee" expense
    await client.patch(f"/leads/{lead_id}", json={"lead_cost_cents": 705})
    assert len(await _expenses(client, lead_id)) == 1

    r = await client.post(f"/leads/{lead_id}/refund")
    assert r.status_code == 200
    body = r.json()
    assert body["lead_refunded_at"] is not None
    assert body["lead_cost_cents"] == 705               # original cost preserved on the lead
    assert await _expenses(client, lead_id) == []        # expense dropped → realized cost 0


async def test_unmark_refunded_restores_expense(client):
    lead_id = await _create_lead(client)
    await client.patch(f"/leads/{lead_id}", json={"lead_cost_cents": 705})
    await client.post(f"/leads/{lead_id}/refund")
    assert await _expenses(client, lead_id) == []

    r = await client.delete(f"/leads/{lead_id}/refund")
    assert r.status_code == 200
    assert r.json()["lead_refunded_at"] is None
    exp = await _expenses(client, lead_id)
    assert len(exp) == 1 and exp[0].amount_cents == 705   # restored from preserved cost


async def test_refunded_realized_cost_is_zero(client):
    from app.services import outcome_service
    lead_id = await _create_lead(client)
    await client.patch(f"/leads/{lead_id}", json={"lead_cost_cents": 705})
    await client.post(f"/leads/{lead_id}/refund")
    async with _factory(client)() as s:
        _rev, cost = await outcome_service._realized_amounts(s, lead_id)
    assert not cost   # None or 0 — no realized acquisition cost after refund
```

- [ ] **Step 2: Run, expect FAIL** (endpoints 404):

Run: `cd app/backend && python -m pytest tests/test_refund_flagging.py -v`

- [ ] **Step 3: Add the service functions**

In `app/backend/app/services/lead_service.py` (uses the existing `get_lead`, `_now`, `_id`, `LeadEvent`):

```python
async def mark_customer_responded(db: AsyncSession, lead_id: str, on: bool, city_id: Optional[str] = None) -> Lead:
    lead = await get_lead(db, lead_id, city_id=city_id)
    lead.customer_responded_at = _now() if on else None
    db.add(LeadEvent(
        id=_id(), lead_id=lead_id,
        event_type="customer_responded" if on else "customer_responded_cleared",
        actor="system",
    ))
    await db.commit()
    await db.refresh(lead)
    return lead


async def mark_refunded(db: AsyncSession, lead_id: str, on: bool, city_id: Optional[str] = None) -> Lead:
    lead = await get_lead(db, lead_id, city_id=city_id)
    lead.lead_refunded_at = _now() if on else None
    db.add(LeadEvent(
        id=_id(), lead_id=lead_id,
        event_type="lead_refunded" if on else "lead_refund_cleared",
        actor="system",
    ))
    from app.services import lead_cost_service
    await lead_cost_service.sync_lead_cost_expense(db, lead)  # drops (on) or restores (off) the lead-fee expense
    await db.commit()
    await db.refresh(lead)
    return lead
```

(These deliberately do NOT touch `updated_at` — the refund flags are orthogonal to the Aging/Overdue timer.)

- [ ] **Step 4: Add the endpoints**

In `app/backend/app/routers/leads.py`, mirroring `acknowledge_lead` (POST returning `LeadOut`, `city_scope(current_user)`):

```python
@router.post("/{lead_id}/customer-responded", response_model=LeadOut)
async def mark_customer_responded(
    lead_id: str,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    return await lead_service.mark_customer_responded(db, lead_id, on=True, city_id=city_scope(current_user))


@router.delete("/{lead_id}/customer-responded", response_model=LeadOut)
async def unmark_customer_responded(
    lead_id: str,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    return await lead_service.mark_customer_responded(db, lead_id, on=False, city_id=city_scope(current_user))


@router.post("/{lead_id}/refund", response_model=LeadOut)
async def mark_refunded(
    lead_id: str,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    return await lead_service.mark_refunded(db, lead_id, on=True, city_id=city_scope(current_user))


@router.delete("/{lead_id}/refund", response_model=LeadOut)
async def unmark_refunded(
    lead_id: str,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    return await lead_service.mark_refunded(db, lead_id, on=False, city_id=city_scope(current_user))
```

(`get_lead` raises 404 for a missing lead, satisfying `test_customer_responded_missing_lead_404`. Confirm `require_auth`, `city_scope`, `get_db`, `User`, `LeadOut` are already imported in leads.py — they are, used by sibling endpoints.)

- [ ] **Step 5: Run the tests, then the full suite**

Run: `cd app/backend && python -m pytest tests/test_refund_flagging.py -v` → all PASS.
Run: `cd app/backend && python -m pytest -q` → full suite green (379 baseline + new). Report counts.

- [ ] **Step 6: Commit**

```bash
git add app/backend/app/services/lead_service.py app/backend/app/routers/leads.py app/backend/tests/test_refund_flagging.py
git commit -m "feat(refund-flagging): customer-responded + refund resolve endpoints (reversible, cost-reconciling)"
```

---

## Task 3: Frontend — candidate helper, hooks, banner, queue band

**Files:** `app/frontend/src/types/lead.ts`, `app/frontend/src/utils/refund.ts`, `app/frontend/src/hooks/useLeads.ts`, `app/frontend/src/components/RefundBanner.tsx`, `app/frontend/src/screens/LeadCommandCenter.tsx`, `app/frontend/src/screens/LeadQueue.tsx`

- [ ] **Step 1: Add fields to the `Lead` type**

In `app/frontend/src/types/lead.ts`, add to the `Lead` interface (ISO strings):

```ts
  customer_responded_at?: string | null
  lead_refunded_at?: string | null
```

- [ ] **Step 2: Candidate helper**

Create `app/frontend/src/utils/refund.ts`:

```ts
import type { Lead } from '../types/lead'

export const REFUND_WINDOW_HOURS = 72  // Thumbtack's fixed refund window

const EARLY_STATUSES = new Set(['new', 'in_review', 'replied', 'waiting_on_customer'])
const isThumbtack = (s?: string | null) => !!s && s.startsWith('thumbtack')

/** A Thumbtack lead that's sat 72h+ since arrival with no engagement and isn't resolved.
 *  A CANDIDATE only — never an assertion that the customer didn't respond. */
export function isRefundCandidate(lead: Lead, now: Date = new Date()): boolean {
  if (!isThumbtack(lead.source_type)) return false
  if (!EARLY_STATUSES.has(lead.status)) return false
  if (lead.customer_responded_at) return false
  if (lead.lead_refunded_at) return false
  if (!lead.created_at) return false
  const ageHours = (now.getTime() - new Date(lead.created_at).getTime()) / 3_600_000
  return ageHours >= REFUND_WINDOW_HOURS
}
```

- [ ] **Step 3: Resolve hooks**

Add to `app/frontend/src/hooks/useLeads.ts` (leadId travels in the mutate arg so the hooks work in both the queue list and the lead window):

```ts
export function useMarkCustomerResponded() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ leadId, on }: { leadId: string; on: boolean }) => {
      const r = await apiFetch(`/leads/${leadId}/customer-responded`, { method: on ? 'POST' : 'DELETE' })
      if (!r.ok) throw new Error('Failed to update')
      return r.json()
    },
    onSuccess: (_d, { leadId }) => {
      qc.invalidateQueries({ queryKey: ['leads'] })
      qc.invalidateQueries({ queryKey: ['lead', leadId] })
    },
  })
}

export function useMarkRefunded() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ leadId, on }: { leadId: string; on: boolean }) => {
      const r = await apiFetch(`/leads/${leadId}/refund`, { method: on ? 'POST' : 'DELETE' })
      if (!r.ok) throw new Error('Failed to update')
      return r.json()
    },
    onSuccess: (_d, { leadId }) => {
      qc.invalidateQueries({ queryKey: ['leads'] })
      qc.invalidateQueries({ queryKey: ['lead', leadId] })
    },
  })
}
```

Confirm `useMutation`, `useQueryClient`, `apiFetch` are already imported in `useLeads.ts` (they are — used by existing mutations). Confirm the lead-detail query key is `['lead', id]` (match whatever `useLead` uses; adjust if different).

- [ ] **Step 4: `RefundBanner` (lead window)**

Create `app/frontend/src/components/RefundBanner.tsx`:

```tsx
import type { Lead } from '../types/lead'
import { isRefundCandidate } from '../utils/refund'
import { useMarkCustomerResponded, useMarkRefunded } from '../hooks/useLeads'

const isThumbtack = (s?: string | null) => !!s && s.startsWith('thumbtack')

export function RefundBanner({ lead }: { lead: Lead }) {
  const responded = useMarkCustomerResponded()
  const refunded = useMarkRefunded()
  const busy = responded.isPending || refunded.isPending

  // Resolved chips
  if (lead.lead_refunded_at) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-3 text-sm dark:border-gray-700 dark:bg-gray-800">
        <span>💸</span>
        <div>
          <div className="font-medium text-emerald-600 dark:text-emerald-400">Refunded — lead cost zeroed</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">ROI updated: this lead now cost $0.</div>
        </div>
        <button type="button" disabled={busy} onClick={() => refunded.mutate({ leadId: lead.id, on: false })}
          className="ml-auto text-xs text-gray-400 underline disabled:opacity-40">Undo</button>
      </div>
    )
  }
  if (lead.customer_responded_at) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-3 text-sm dark:border-gray-700 dark:bg-gray-800">
        <span>✓</span>
        <div>
          <div className="font-medium">Customer responded</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Won't be flagged for refund.</div>
        </div>
        <button type="button" disabled={busy} onClick={() => responded.mutate({ leadId: lead.id, on: false })}
          className="ml-auto text-xs text-gray-400 underline disabled:opacity-40">Undo</button>
      </div>
    )
  }

  // Candidate banner
  if (isRefundCandidate(lead)) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-900/20">
        <div className="text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">Possible refund</div>
        <div className="mt-1 font-semibold text-gray-900 dark:text-white">Customer hasn't responded in 3+ days</div>
        <p className="mt-0.5 text-xs text-amber-800/80 dark:text-amber-200/80">
          This Thumbtack lead arrived 72h+ ago and never moved forward. If the customer truly didn't respond it's likely refund-eligible — only you know for sure.
        </p>
        <div className="mt-2 flex gap-2">
          <button type="button" disabled={busy} onClick={() => responded.mutate({ leadId: lead.id, on: true })}
            className="min-h-11 flex-1 rounded-lg border border-gray-300 bg-white text-sm font-semibold dark:border-gray-600 dark:bg-gray-700 dark:text-white disabled:opacity-40">✓ Customer responded</button>
          <button type="button" disabled={busy} onClick={() => refunded.mutate({ leadId: lead.id, on: true })}
            className="min-h-11 flex-1 rounded-lg bg-emerald-500 text-sm font-semibold text-white disabled:opacity-40">💸 Mark refunded</button>
        </div>
        {(responded.isError || refunded.isError) && <p className="mt-1 text-xs text-red-500">Couldn't update. Try again.</p>}
      </div>
    )
  }

  // Pre-empt: Thumbtack lead, not yet a candidate and unresolved → let them mark responded early
  if (isThumbtack(lead.source_type)) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-dashed border-gray-300 p-2.5 text-xs text-gray-500 dark:border-gray-600 dark:text-gray-400">
        <span>📞</span>
        <span>Customer already replied? Mark it so this lead is never flagged.</span>
        <button type="button" disabled={busy} onClick={() => responded.mutate({ leadId: lead.id, on: true })}
          className="ml-auto min-h-9 rounded-lg border border-gray-300 px-3 text-xs font-semibold dark:border-gray-600 dark:text-white disabled:opacity-40">✓ Responded</button>
      </div>
    )
  }

  return null
}
```

- [ ] **Step 5: Mount in `LeadCommandCenter`**

In `app/frontend/src/screens/LeadCommandCenter.tsx`, add `import { RefundBanner } from '../components/RefundBanner'` and render it right after `<EscalationCard leadId={lead.id} />` (line ~329):

```tsx
      <EscalationCard leadId={lead.id} />
      <RefundBanner lead={lead} />
```

(`lead` is already in scope there. Match the surrounding spacing/wrapper.)

- [ ] **Step 6: "Refund-eligible" band in `LeadQueue`**

In `app/frontend/src/screens/LeadQueue.tsx`:
- Add imports: `import { isRefundCandidate } from '../utils/refund'` and `import { useMarkCustomerResponded, useMarkRefunded } from '../hooks/useLeads'`.
- Near the other hooks/derived state (by `displayLeads` / the `openEscalations` block ~line 66), add:
```tsx
  const respondMut = useMarkCustomerResponded()
  const refundMut = useMarkRefunded()
  const [refundBandOpen, setRefundBandOpen] = useState(true)
  const refundCandidates = useMemo(
    () => displayLeads.filter(l => isRefundCandidate(l)),
    [displayLeads],
  )
```
- Render a band as a sibling of the existing Escalations `<section>` (after it, ~line 231), mirroring that band's markup:
```tsx
        {view === 'active' && refundCandidates.length > 0 && (
          <section className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-900/20">
            <button type="button" onClick={() => setRefundBandOpen(o => !o)} aria-expanded={refundBandOpen}
              className="flex w-full items-center gap-2 px-4 py-2.5">
              <span className="font-semibold text-amber-800 dark:text-amber-200">
                💸 Refund-eligible <span className="text-amber-600 dark:text-amber-400">{refundCandidates.length}</span>
              </span>
              <span className={`ml-auto text-amber-500 transition-transform ${refundBandOpen ? 'rotate-90' : ''}`} aria-hidden="true">›</span>
            </button>
            {refundBandOpen && (
              <div className="border-t border-amber-200 dark:border-amber-900/50">
                {refundCandidates.map(l => (
                  <div key={l.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-gray-900 dark:text-white">{l.customer_name ?? 'Unknown'}</div>
                      <div className="text-xs text-amber-700 dark:text-amber-300">Thumbtack · no response 72h+</div>
                    </div>
                    <button type="button" onClick={() => respondMut.mutate({ leadId: l.id, on: true })}
                      className="min-h-9 rounded-lg border border-gray-300 px-2.5 text-xs font-semibold dark:border-gray-600 dark:text-white">Responded</button>
                    <button type="button" onClick={() => refundMut.mutate({ leadId: l.id, on: true })}
                      className="min-h-9 rounded-lg bg-emerald-500 px-2.5 text-xs font-semibold text-white">Refunded</button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
```
Match the real surrounding markup (the Escalations band's exact classes/structure) — adapt the snippet to the file's actual indentation and the `view`/`displayLeads`/`useMemo`/`useState` already in scope. Confirm `useState`/`useMemo` are imported (they are). Do not change the Escalations band or the groups list.

- [ ] **Step 7: Type-check + build**

Run: `cd app/frontend && npx tsc --noEmit` → no errors.
Run: `cd app/frontend && npm run build` → succeeds (pre-existing chunk-size warning is not an error).

- [ ] **Step 8: Commit**

```bash
git add app/frontend/src/types/lead.ts app/frontend/src/utils/refund.ts app/frontend/src/hooks/useLeads.ts app/frontend/src/components/RefundBanner.tsx app/frontend/src/screens/LeadCommandCenter.tsx app/frontend/src/screens/LeadQueue.tsx
git commit -m "feat(refund-flagging): RefundBanner + refund-eligible queue band (candidate-only, reversible)"
```

---

## Self-Review

**Spec coverage:**
- Two timestamp columns + migration; candidacy never stored → Task 1.
- Refunded drops the lead-fee expense, `lead_cost_cents` preserved, reversible → Task 1 (sync guard) + Task 2 (`mark_refunded` calls sync) + tests proving drop/restore/realized-cost-0.
- Candidate detection (Thumbtack + early status + 72h arrival + unresolved), computed client-side → Task 3 `isRefundCandidate`.
- Resolve via reversible endpoints, each with a `LeadEvent` audit trail, never auto-concluding → Task 2.
- One-tap "Customer responded" preempt on any Thumbtack lead → Task 3 `RefundBanner` pre-empt branch.
- Lead-window banner + resolved chips with Undo, queue band → Task 3.
- Out of scope (notifications, auto-detection, configurable window, server-side scan) → not in any task.

**Placeholder scan:** "Inspect real code" notes are integration points (the lead-detail query key, the Escalations-band exact markup, confirming imports) — each with the contract and example. All model/service/router/test/component code is complete. No TODO/TBD.

**Type/name consistency:** `customer_responded_at` / `lead_refunded_at` are consistent across model, `LeadOut`, the service functions, the resolve endpoints, the TS `Lead` type, `isRefundCandidate`, and `RefundBanner`. Endpoints POST=set / DELETE=clear map to `on=True/False`. The mutate-arg `{leadId, on}` shape is identical in both hooks and both call sites (banner + queue band). `EARLY_STATUSES` matches the spec's status set; `REFUND_WINDOW_HOURS = 72` is the single constant.

**Note for implementer:** `mark_refunded` sets `lead_refunded_at` then calls `sync_lead_cost_expense` in the same transaction (one commit) — the sync's refunded-guard (Task 1) drops the expense; on un-refund it recreates from the preserved `lead_cost_cents`. The resolve functions intentionally don't touch `updated_at`, keeping refund flags orthogonal to the Aging/Overdue timer.
