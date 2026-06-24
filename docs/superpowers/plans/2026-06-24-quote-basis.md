# Quote Basis ("What This Quote Is Based On") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist each AI quote draft's basis (comparables + rationale) and surface it in the Quote panel — the comparable jobs it anchored on (price · won/lost · why-similar · tap-to-open) + a grounded/cold-start badge + the rationale — live-first on draft, reconciled from the persisted snapshot on reload.

**Architecture:** Extend the existing `quote_suggestion_log` row with `comparables_json` + `rationale` (no new table); `_log_suggestion` writes them best-effort. A `GET /leads/{id}/quote-suggestion/latest` endpoint returns the latest snapshot. The Quote panel renders a `QuoteBasis` component fed live-first from the suggest response, with the persisted snapshot query reconciling in the background.

**Tech Stack:** FastAPI + SQLAlchemy async, Pydantic v2; pytest-asyncio (`asyncio_mode=auto`); React 18 + TS + Vite + Tailwind + TanStack Query. Frontend verification: `tsc && vite build`.

**Reference spec:** `docs/superpowers/specs/2026-06-24-quote-basis-design.md`

---

## File Structure

**Backend**
- Modify: `app/backend/app/models/quote_suggestion_log.py` — two Text columns.
- Modify: `app/backend/main.py` — migration + lifespan registration.
- Modify: `app/backend/app/services/quote_service.py` — `_log_suggestion` writes the basis; `get_latest_suggestion_snapshot`.
- Modify: `app/backend/app/schemas/quote_suggestion.py` — `QuoteSuggestionSnapshotOut`.
- Modify: `app/backend/app/routers/leads.py` — `GET /{lead_id}/quote-suggestion/latest`.
- Test: `app/backend/tests/test_quote_basis.py`.

**Frontend**
- Modify: `app/frontend/src/services/api.ts` — add `comparables` to `QuoteSuggestion`; `QuoteSnapshot` type + `getQuoteBasis`.
- Modify: `app/frontend/src/hooks/useLeads.ts` — `useQuoteBasis`; `useSuggestQuote` invalidates `['quote-basis', leadId]`.
- Create: `app/frontend/src/components/QuoteBasis.tsx`.
- Modify: `app/frontend/src/screens/panels/QuotePanel.tsx` — live-first basis state + mount `QuoteBasis` (replacing the standalone rationale box).

---

## Task 1: Backend — persist the basis on the log row

**Files:** `app/backend/app/models/quote_suggestion_log.py`, `app/backend/main.py`, `app/backend/app/services/quote_service.py`
**Test:** `app/backend/tests/test_quote_basis.py`

- [ ] **Step 1: Add the two columns**

In `app/backend/app/models/quote_suggestion_log.py`, add `Text` to the sqlalchemy import (`from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text`) and add two columns after `model_used`:

```python
    comparables_json = Column(Text, nullable=True)  # JSON-serialized list of ComparableOut the draft anchored on
    rationale = Column(Text, nullable=True)          # the AI's rationale for the draft
```

- [ ] **Step 2: Migration in `main.py`**

Add near the other `_migrate_*` functions:

```python
async def _migrate_quote_log_add_basis_columns(conn) -> None:
    """Add comparables_json + rationale to quote_suggestion_logs. Idempotent."""
    result = await conn.execute(text("PRAGMA table_info(quote_suggestion_logs)"))
    rows = result.fetchall()
    if not rows:
        return  # table not created yet; create_all builds the new shape
    existing = _existing_columns(rows)
    if "comparables_json" not in existing:
        await conn.execute(text("ALTER TABLE quote_suggestion_logs ADD COLUMN comparables_json TEXT"))
        print("[startup] quote_suggestion_logs: added comparables_json column")
    if "rationale" not in existing:
        await conn.execute(text("ALTER TABLE quote_suggestion_logs ADD COLUMN rationale TEXT"))
        print("[startup] quote_suggestion_logs: added rationale column")
```

Register in the lifespan just before `await conn.run_sync(Base.metadata.create_all)`, after `await _migrate_leads_add_refund_columns(conn)`:

```python
        await _migrate_quote_log_add_basis_columns(conn)
```

- [ ] **Step 3: Write the failing test**

Create `app/backend/tests/test_quote_basis.py`:

```python
from __future__ import annotations

import json

from sqlalchemy import select

from app.models.lead import Lead, LeadSourceType, LeadStatus, ServiceType
from app.models.quote_suggestion_log import QuoteSuggestionLog
from app.schemas.quote_suggestion import ComparableOut, QuoteSuggestionOut
from app.services import quote_service
from datetime import datetime, timezone


def _factory(client):
    from main import app
    return app.state.test_session_factory


async def _make_lead(factory) -> str:
    async with factory() as s:
        lead = Lead(
            source_type=LeadSourceType.manual, status=LeadStatus.ready_for_quote,
            service_type=ServiceType.moving, urgency_flag=False, customer_name="Basis Test",
            city_id="st-louis", created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc),
        )
        s.add(lead); await s.commit(); await s.refresh(lead)
        return lead.id


def _comparable(lead_id="cmp-1", score=5):
    return ComparableOut(lead_id=lead_id, conversion="won", price_cents=131000,
                         price_basis="realized", score=score, move_size_label="4 bedroom home",
                         move_distance_miles=8.0, move_type="labor_only")


async def test_log_suggestion_persists_comparables_and_rationale(client):
    factory = _factory(client)
    lead_id = await _make_lead(factory)
    comps = [_comparable("cmp-1"), _comparable("cmp-2", score=3)]
    suggestion = QuoteSuggestionOut(quoted_price_total=1240.0, estimated_duration_minutes=390,
                                    rationale="Anchored on 2 won 4-bed jobs.", comparables=comps)
    async with factory() as s:
        lead = (await s.execute(select(Lead).where(Lead.id == lead_id))).scalar_one()
        await quote_service._log_suggestion(s, lead, comps, suggestion, model="test-model")
    async with factory() as s:
        row = (await s.execute(select(QuoteSuggestionLog).where(QuoteSuggestionLog.lead_id == lead_id))).scalar_one()
    assert row.rationale == "Anchored on 2 won 4-bed jobs."
    assert row.comparables_count == 2
    assert row.was_grounded is True
    decoded = json.loads(row.comparables_json)
    assert len(decoded) == 2
    assert decoded[0]["lead_id"] == "cmp-1"
    assert decoded[0]["conversion"] == "won"
    assert decoded[0]["price_cents"] == 131000
```

Run: `cd app/backend && python -m pytest tests/test_quote_basis.py -v` → FAIL (columns/args missing).

- [ ] **Step 4: Persist in `_log_suggestion`**

In `app/backend/app/services/quote_service.py`, confirm `import json` is present (add it if not). In `_log_suggestion`, add the two fields to the `QuoteSuggestionLog(...)` constructor:

```python
        db.add(QuoteSuggestionLog(
            id=str(uuid.uuid4()),
            lead_id=lead.id,
            city_id=lead.city_id,
            was_grounded=len(comparables) > 0,
            comparables_count=len(comparables),
            suggested_price_cents=round(price * 100) if price is not None else None,
            model_used=model,
            comparables_json=json.dumps([c.model_dump() for c in comparables]),
            rationale=suggestion.rationale or None,
        ))
```

(Best-effort semantics unchanged — the whole body is already wrapped in try/except with rollback.)

- [ ] **Step 5: Run the test + import check**

Run: `cd app/backend && python -m pytest tests/test_quote_basis.py -v` → PASS.
Run: `cd app/backend && python -c "import main; print('ok')"` → `ok`.

- [ ] **Step 6: Commit**

```bash
git add app/backend/app/models/quote_suggestion_log.py app/backend/main.py app/backend/app/services/quote_service.py app/backend/tests/test_quote_basis.py
git commit -m "feat(quote-basis): persist comparables + rationale on the quote suggestion log"
```

---

## Task 2: Backend — latest-snapshot schema + read endpoint

**Files:** `app/backend/app/schemas/quote_suggestion.py`, `app/backend/app/services/quote_service.py`, `app/backend/app/routers/leads.py`
**Test:** `app/backend/tests/test_quote_basis.py` (append)

- [ ] **Step 1: Append the failing tests**

Append to `app/backend/tests/test_quote_basis.py`:

```python
async def test_latest_snapshot_returns_deserialized_basis(client):
    factory = _factory(client)
    lead_id = await _make_lead(factory)
    comps = [_comparable("cmp-1")]
    suggestion = QuoteSuggestionOut(quoted_price_total=890.0, estimated_duration_minutes=240,
                                    rationale="SOP base rate.", comparables=comps)
    async with factory() as s:
        lead = (await s.execute(select(Lead).where(Lead.id == lead_id))).scalar_one()
        await quote_service._log_suggestion(s, lead, comps, suggestion, model="m")

    r = await client.get(f"/leads/{lead_id}/quote-suggestion/latest")
    assert r.status_code == 200
    body = r.json()
    assert body["rationale"] == "SOP base rate."
    assert body["was_grounded"] is True
    assert body["comparables_count"] == 1
    assert body["comparables"][0]["lead_id"] == "cmp-1"
    assert body["comparables"][0]["price_basis"] == "realized"


async def test_latest_snapshot_returns_most_recent(client):
    factory = _factory(client)
    lead_id = await _make_lead(factory)
    async with factory() as s:
        lead = (await s.execute(select(Lead).where(Lead.id == lead_id))).scalar_one()
        await quote_service._log_suggestion(s, lead, [], QuoteSuggestionOut(
            quoted_price_total=100.0, estimated_duration_minutes=60, rationale="first", comparables=[]), model="m")
        await quote_service._log_suggestion(s, lead, [_comparable()], QuoteSuggestionOut(
            quoted_price_total=200.0, estimated_duration_minutes=60, rationale="second", comparables=[_comparable()]), model="m")
    r = await client.get(f"/leads/{lead_id}/quote-suggestion/latest")
    assert r.json()["rationale"] == "second"
    assert r.json()["comparables_count"] == 1


async def test_latest_snapshot_null_when_never_drafted(client):
    factory = _factory(client)
    lead_id = await _make_lead(factory)
    r = await client.get(f"/leads/{lead_id}/quote-suggestion/latest")
    assert r.status_code == 200
    assert r.json() is None


async def test_latest_snapshot_tolerates_malformed_json(client):
    factory = _factory(client)
    lead_id = await _make_lead(factory)
    async with factory() as s:
        s.add(QuoteSuggestionLog(lead_id=lead_id, city_id="st-louis", was_grounded=True,
                                 comparables_count=1, rationale="ok", comparables_json="{not json"))
        await s.commit()
    r = await client.get(f"/leads/{lead_id}/quote-suggestion/latest")
    assert r.status_code == 200
    assert r.json()["comparables"] == []      # malformed → empty, not 500
    assert r.json()["rationale"] == "ok"
```

Run: `cd app/backend && python -m pytest tests/test_quote_basis.py -k snapshot -v` → FAIL (endpoint 404).

- [ ] **Step 2: Add the snapshot schema**

In `app/backend/app/schemas/quote_suggestion.py` (it imports `List`, `Optional`, `BaseModel`, `Field`; add `from datetime import datetime` at the top):

```python
class QuoteSuggestionSnapshotOut(BaseModel):
    suggested_price_cents: Optional[int] = None
    was_grounded: bool
    comparables_count: int
    rationale: str = ""
    comparables: List[ComparableOut] = Field(default_factory=list)
    created_at: datetime
```

- [ ] **Step 3: Add the service function**

In `app/backend/app/services/quote_service.py` (uses `select`, `json`, already imported; import `QuoteSuggestionSnapshotOut` from the schema and `QuoteSuggestionLog` from the model — add to the existing imports):

```python
async def get_latest_suggestion_snapshot(db: AsyncSession, lead_id: str) -> Optional[QuoteSuggestionSnapshotOut]:
    result = await db.execute(
        select(QuoteSuggestionLog)
        .where(QuoteSuggestionLog.lead_id == lead_id)
        .order_by(QuoteSuggestionLog.created_at.desc())
        .limit(1)
    )
    row = result.scalar_one_or_none()
    if row is None:
        return None
    comparables: list[ComparableOut] = []
    if row.comparables_json:
        try:
            comparables = [ComparableOut.model_validate(x) for x in json.loads(row.comparables_json)]
        except Exception:
            comparables = []  # legacy/malformed blob → degrade to empty, never 500
    return QuoteSuggestionSnapshotOut(
        suggested_price_cents=row.suggested_price_cents,
        was_grounded=row.was_grounded,
        comparables_count=row.comparables_count,
        rationale=row.rationale or "",
        comparables=comparables,
        created_at=row.created_at,
    )
```

(Confirm `Optional` is imported in quote_service; if not, `from typing import Optional`.)

- [ ] **Step 4: Add the endpoint**

In `app/backend/app/routers/leads.py` (where `quote_service` and the `POST /{lead_id}/quote-suggestion` endpoint already live), add the schema import and the route:

```python
from app.schemas.quote_suggestion import QuoteSuggestionSnapshotOut  # alongside existing quote schema imports


@router.get("/{lead_id}/quote-suggestion/latest", response_model=Optional[QuoteSuggestionSnapshotOut])
async def get_quote_basis(
    lead_id: str,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    return await quote_service.get_latest_suggestion_snapshot(db, lead_id)
```

(`response_model=Optional[...]` returns `null` with 200 when there's no snapshot — matches the tests.)

- [ ] **Step 5: Run the tests + full suite**

Run: `cd app/backend && python -m pytest tests/test_quote_basis.py -v` → all PASS.
Run: `cd app/backend && python -m pytest -q` → full suite green (385 baseline + new). Report counts.

- [ ] **Step 6: Commit**

```bash
git add app/backend/app/schemas/quote_suggestion.py app/backend/app/services/quote_service.py app/backend/app/routers/leads.py app/backend/tests/test_quote_basis.py
git commit -m "feat(quote-basis): latest-snapshot read endpoint (deserializes comparables, malformed-safe)"
```

---

## Task 3: Frontend — `QuoteBasis` in the Quote panel (live-first)

**Files:** `app/frontend/src/services/api.ts`, `app/frontend/src/hooks/useLeads.ts`, `app/frontend/src/components/QuoteBasis.tsx`, `app/frontend/src/screens/panels/QuotePanel.tsx`

- [ ] **Step 1: Types + fetcher in `api.ts`**

Add `comparables` to the existing `QuoteSuggestion` interface, and add the comparable + snapshot types + fetcher:

```ts
export interface Comparable {
  lead_id: string
  conversion: string        // won | lost
  price_cents: number
  price_basis: string       // realized | quoted
  score: number
  move_size_label?: string | null
  move_distance_miles?: number | null
  move_type?: string | null
}

export interface QuoteSnapshot {
  suggested_price_cents: number | null
  was_grounded: boolean
  comparables_count: number
  rationale: string
  comparables: Comparable[]
  created_at: string
}
```

In the existing `QuoteSuggestion` interface, add:
```ts
  comparables: Comparable[]
```

And a fetcher (returns `null` when never drafted):
```ts
export async function getQuoteBasis(leadId: string): Promise<QuoteSnapshot | null> {
  const r = await apiFetch(`${BASE}/${leadId}/quote-suggestion/latest`)
  if (!r.ok) throw new Error('Failed to load quote basis')
  return r.json()
}
```

- [ ] **Step 2: Hooks in `useLeads.ts`**

Add a query hook, and make `useSuggestQuote` invalidate the basis on success so the persisted snapshot reconciles (`useQuery`/`useQueryClient` are already imported; add `getQuoteBasis`, `type QuoteSnapshot` to the `services/api` import):

```ts
export function useQuoteBasis(leadId: string) {
  return useQuery<QuoteSnapshot | null>({
    queryKey: ['quote-basis', leadId],
    queryFn: () => getQuoteBasis(leadId),
  })
}
```

Replace the existing `useSuggestQuote` with:
```ts
export function useSuggestQuote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (leadId: string) => suggestQuote(leadId),
    onSuccess: (_d, leadId) => qc.invalidateQueries({ queryKey: ['quote-basis', leadId] }),
  })
}
```

- [ ] **Step 3: Create `QuoteBasis`**

Create `app/frontend/src/components/QuoteBasis.tsx`. Takes `{ comparables, rationale }` (the shared shape from either the live response or the snapshot); renders the grounded/cold-start badge, the comparable rows (tap-to-open), and the rationale. Returns null when there's nothing to show.

```tsx
import { useNavigate } from 'react-router-dom'
import type { Comparable } from '../services/api'

const fmtUsd = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100)

function MatchDots({ score }: { score: number }) {
  const filled = Math.max(1, Math.min(4, Math.ceil(score / 2)))  // score ~0-7 → 1-4 dots
  return (
    <div className="flex shrink-0 gap-0.5" title="match strength" aria-label={`match strength ${filled} of 4`}>
      {[0, 1, 2, 3].map(i => (
        <span key={i} className={`h-1.5 w-1.5 rounded-full ${i < filled ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
      ))}
    </div>
  )
}

function Row({ c, onOpen }: { c: Comparable; onOpen: () => void }) {
  const won = c.conversion === 'won'
  const why = [c.move_size_label, c.move_distance_miles != null ? `${c.move_distance_miles} mi` : null, c.move_type]
    .filter(Boolean).join(' · ')
  return (
    <button type="button" onClick={onOpen}
      className="flex min-h-11 w-full items-center gap-3 border-t border-gray-100 px-3 py-2 text-left first:border-t-0 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/40">
      <div className="w-[72px] shrink-0">
        <div className="font-bold tabular-nums text-gray-900 dark:text-white">{fmtUsd(c.price_cents)}</div>
        <div className="text-[10px] uppercase tracking-wide text-gray-400">{c.price_basis}</div>
      </div>
      <div className="min-w-0 flex-1">
        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
          won ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
              : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'}`}>{c.conversion}</span>
        <div className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">{why || '—'}</div>
      </div>
      <MatchDots score={c.score} />
      <span className="shrink-0 text-gray-300 dark:text-gray-600">›</span>
    </button>
  )
}

export function QuoteBasis({ comparables, rationale }: { comparables: Comparable[]; rationale: string }) {
  const navigate = useNavigate()
  if (!comparables.length && !rationale) return null
  const grounded = comparables.length > 0

  return (
    <div className="mb-3 space-y-3">
      <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-700">
          <span className="text-xs font-bold text-gray-700 dark:text-gray-200">🧭 What this quote is based on</span>
          <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
            grounded ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                     : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300'}`}>
            {grounded ? `Grounded · ${comparables.length} local jobs` : 'Cold start'}
          </span>
        </div>
        {grounded ? (
          comparables.map(c => <Row key={c.lead_id} c={c} onOpen={() => navigate(`/leads/${c.lead_id}`)} />)
        ) : (
          <p className="px-3 py-4 text-center text-xs text-gray-500 dark:text-gray-400">
            No comparable local jobs yet — priced from the SOP &amp; AI pricing guidance only. As more jobs finalize, comparables appear here.
          </p>
        )}
      </div>
      {rationale && (
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 dark:border-violet-800 dark:bg-violet-900/20">
          <p className="text-xs font-semibold text-violet-700 dark:text-violet-300">✨ AI rationale — review before booking</p>
          <p className="mt-1 text-sm leading-relaxed text-gray-700 dark:text-gray-200">{rationale}</p>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Wire into `QuotePanel` (live-first, replace the standalone rationale box)**

In `app/frontend/src/screens/panels/QuotePanel.tsx`:
- Add imports: `import { QuoteBasis } from '../../components/QuoteBasis'` and add `useQuoteBasis` to the `../../hooks/useLeads` import. Add `import type { Comparable } from '../../services/api'` (adjust relative depth to match the file's other imports).
- Replace the `const [rationale, setRationale] = useState('')` line with live-basis state:
```tsx
  const [liveBasis, setLiveBasis] = useState<{ comparables: Comparable[]; rationale: string } | null>(null)
  const { data: snapshot } = useQuoteBasis(leadId)
```
- In `handleSuggest`'s `onSuccess`, replace `setRationale(s.rationale)` with:
```tsx
        setLiveBasis({ comparables: s.comparables ?? [], rationale: s.rationale })
```
(`useSuggestQuote` already invalidates `['quote-basis', leadId]`, so the snapshot reconciles in the background.)
- Replace the existing rationale block (the `{rationale && ( … )}` violet box, ~lines 227-232) with:
```tsx
        {(() => {
          const basis = liveBasis ?? (snapshot ? { comparables: snapshot.comparables, rationale: snapshot.rationale } : null)
          return basis ? <QuoteBasis comparables={basis.comparables} rationale={basis.rationale} /> : null
        })()}
```
Keep the `{suggestError && …}` line as-is. Do not change the AI Pricing Guidance F–L cards or the quote builder fields.

- [ ] **Step 5: Type-check + build**

Run: `cd app/frontend && npx tsc --noEmit` → no errors.
Run: `cd app/frontend && npm run build` → succeeds (pre-existing chunk-size warning is not an error).

- [ ] **Step 6: Commit**

```bash
git add app/frontend/src/services/api.ts app/frontend/src/hooks/useLeads.ts app/frontend/src/components/QuoteBasis.tsx app/frontend/src/screens/panels/QuotePanel.tsx
git commit -m "feat(quote-basis): QuoteBasis in the Quote panel (live-first comparables + rationale, reconciled)"
```

---

## Self-Review

**Spec coverage:**
- Persist comparables + rationale on the existing log row → Task 1.
- Latest-snapshot read endpoint, deserialized, malformed-safe, null when never drafted → Task 2 (with tests for latest-of-many + malformed + empty).
- `QuoteBasis` with grounded/cold-start badge, comparable rows (price · Realized/Quoted · Won/Lost · why-similar · dot match-strength · tap-to-open), persisted rationale → Task 3.
- Live-first render + background reconcile → Task 3 (`liveBasis ?? snapshot`; `useSuggestQuote` invalidates `['quote-basis']`).
- Cold-start honesty (no fake grounded badge) → `QuoteBasis` derives `grounded` from `comparables.length`.
- Internal-only (auth-gated endpoint; lives in the Quote panel beside the existing Internal pricing guidance).
- Out of scope (aggregate eval = B, full history, score number, backfill) → not in any task.

**Placeholder scan:** The "inspect/adjust" notes are import-depth + confirming existing imports (`json`, `Optional`, `quote_service`) — each with the contract. All model/service/router/schema/test/component code is complete. No TODO/TBD.

**Type/name consistency:** `comparables_json`/`rationale` consistent across model, `_log_suggestion`, `get_latest_suggestion_snapshot`, `QuoteSuggestionSnapshotOut`, the `QuoteSnapshot`/`Comparable` TS types, and `QuoteBasis`. The live `QuoteSuggestion.comparables` and the snapshot's `comparables` share the `Comparable` shape, so `QuoteBasis` renders both via one `{comparables, rationale}` prop. `['quote-basis', leadId]` is the single query key (invalidated by `useSuggestQuote`, read by `useQuoteBasis`). `grounded` is derived from `comparables.length`, never a stored bool the UI trusts blindly.

**Note for implementer:** the live response renders instantly from `liveBasis`; the persisted snapshot fetch (invalidated on suggest success) reconciles to identical data a beat later — both produce the same `{comparables, rationale}` shape, so there's no visual flip. The old standalone `rationale` state/box is fully replaced by `QuoteBasis` (which now also makes the rationale survive reload).
