# Quote Grounding Eval View (Feature B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the existing quote-grounding eval as a facilitator-friendly admin screen — two cohorts (grounded vs SOP-only) with plain-language metrics, won/lost counts, and a sample-gated takeaway — reachable by admins (Admin card) and facilitators (Quote-panel link).

**Architecture:** Tiny backend add (expose already-computed `won`/`lost` on `CohortMetrics`; open the endpoint to facilitator). The rest is frontend: a query hook, an `AdminQuoteGroundingScreen`, an Admin card, a route (admin+facilitator), and a Quote-panel link.

**Tech Stack:** FastAPI + SQLAlchemy async, Pydantic v2; pytest-asyncio (`asyncio_mode=auto`); React 18 + TS + Vite + Tailwind + TanStack Query. Frontend verification: `tsc && vite build`.

**Reference spec:** `docs/superpowers/specs/2026-06-24-grounding-eval-view-design.md`

---

## File Structure

**Backend**
- Modify: `app/backend/app/schemas/eval.py` — `won`/`lost` on `CohortMetrics`.
- Modify: `app/backend/app/services/eval_service.py` — pass `won`/`lost`.
- Modify: `app/backend/app/routers/eval.py` — allow facilitator.
- Test: `app/backend/tests/test_eval_api.py` (append).

**Frontend**
- Modify: `app/frontend/src/services/api.ts` — types + `fetchQuoteGroundingEval`.
- Modify: `app/frontend/src/hooks/useLeads.ts` (or a sibling) — `useQuoteGroundingEval`.
- Create: `app/frontend/src/screens/AdminQuoteGroundingScreen.tsx`.
- Modify: `app/frontend/src/screens/AdminScreen.tsx` — add the card.
- Modify: `app/frontend/src/App.tsx` — add the route (admin+facilitator).
- Modify: `app/frontend/src/screens/panels/QuotePanel.tsx` — facilitator link.

---

## Task 1: Backend — expose won/lost + open to facilitator

**Files:** `app/backend/app/schemas/eval.py`, `app/backend/app/services/eval_service.py`, `app/backend/app/routers/eval.py`
**Test:** `app/backend/tests/test_eval_api.py`

- [ ] **Step 1: Append the failing tests**

Append to `app/backend/tests/test_eval_api.py` (it already has `_seed`, imports `uuid`, and the `client`/`db_session` fixtures):

```python
async def test_eval_exposes_won_lost(client, db_session):
    await _seed(db_session, str(uuid.uuid4()), grounded=True, conversion="won", suggested=70000, realized=70000)
    await _seed(db_session, str(uuid.uuid4()), grounded=True, conversion="lost", suggested=0, realized=0)
    r = await client.get("/admin/eval/quote-grounding")
    assert r.status_code == 200, r.text
    g = r.json()["grounded"]
    assert g["won"] == 1
    assert g["lost"] == 1
    assert g["n"] == 2


async def test_eval_access_by_role(client):
    from datetime import datetime, timezone
    from main import app
    from app.dependencies import require_auth
    from app.models.user import User

    def _mk(role):
        return lambda: User(
            id=f"u-{role}", username=role, credential_hash="x", role=role,
            city_id="st-louis", is_active=True, created_at=datetime.now(timezone.utc),
        )

    for role, expect in [("admin", 200), ("facilitator", 200), ("supervisor", 403), ("crew", 403)]:
        app.dependency_overrides[require_auth] = _mk(role)
        r = await client.get("/admin/eval/quote-grounding")
        assert r.status_code == expect, f"{role}: got {r.status_code}"
```

Run: `cd app/backend && python -m pytest tests/test_eval_api.py -k "won_lost or access" -v`
Expected: FAIL — `won`/`lost` absent from the response; facilitator gets 403 (endpoint still admin-only).

- [ ] **Step 2: Add `won`/`lost` to the schema**

In `app/backend/app/schemas/eval.py`, add to `CohortMetrics` (after `n`):

```python
    won: int = 0
    lost: int = 0
```

- [ ] **Step 3: Pass them in the service**

In `app/backend/app/services/eval_service.py` `_cohort_metrics`, the `won`/`lost` locals already exist (computed near the top). Add them to the `CohortMetrics(...)` return:

```python
    return CohortMetrics(
        n=n, won=won, lost=lost, win_rate=win_rate, priced_n=priced_n,
        pricing_accuracy=accuracy, pricing_bias=bias,
    )
```

- [ ] **Step 4: Open the endpoint to facilitator**

In `app/backend/app/routers/eval.py`, change the dependency on `quote_grounding_eval` from:
```python
    _: User = Depends(require_role("admin")),
```
to:
```python
    _: User = Depends(require_role("admin", "facilitator")),
```

- [ ] **Step 5: Run the tests + full suite**

Run: `cd app/backend && python -m pytest tests/test_eval_api.py -v` → all PASS.
Run: `cd app/backend && python -m pytest -q` → full suite green (390 baseline + 2 new). Report counts.

- [ ] **Step 6: Commit**

```bash
git add app/backend/app/schemas/eval.py app/backend/app/services/eval_service.py app/backend/app/routers/eval.py app/backend/tests/test_eval_api.py
git commit -m "feat(grounding-eval): expose won/lost on CohortMetrics + open endpoint to facilitator"
```

---

## Task 2: Frontend — screen, card, route, hook, facilitator link

**Files:** `app/frontend/src/services/api.ts`, `app/frontend/src/hooks/useLeads.ts`, `app/frontend/src/screens/AdminQuoteGroundingScreen.tsx`, `app/frontend/src/screens/AdminScreen.tsx`, `app/frontend/src/App.tsx`, `app/frontend/src/screens/panels/QuotePanel.tsx`

- [ ] **Step 1: Types + fetcher in `api.ts`**

```ts
export interface CohortMetrics {
  n: number
  won: number
  lost: number
  win_rate: number | null
  priced_n: number
  pricing_accuracy: number | null
  pricing_bias: number | null
}

export interface QuoteGroundingEval {
  grounded: CohortMetrics
  ungrounded: CohortMetrics
}

export async function fetchQuoteGroundingEval(cityId: string | null): Promise<QuoteGroundingEval> {
  const qs = cityId ? `?city_id=${encodeURIComponent(cityId)}` : ''
  const r = await apiFetch(`/admin/eval/quote-grounding${qs}`)
  if (!r.ok) throw new Error('Failed to load grounding stats')
  return r.json()
}
```

- [ ] **Step 2: Hook in `useLeads.ts`**

Add `fetchQuoteGroundingEval`, `type QuoteGroundingEval` to the `../services/api` import, then:

```ts
export function useQuoteGroundingEval(cityId: string | null) {
  return useQuery<QuoteGroundingEval>({
    queryKey: ['grounding-eval', cityId],
    queryFn: () => fetchQuoteGroundingEval(cityId),
  })
}
```

- [ ] **Step 3: Create `AdminQuoteGroundingScreen`**

Create `app/frontend/src/screens/AdminQuoteGroundingScreen.tsx`:

```tsx
import { BottomNav } from '../components/BottomNav'
import { useCity } from '../context/CityContext'
import { useQuoteGroundingEval } from '../hooks/useLeads'
import type { CohortMetrics } from '../services/api'

const MIN_COHORT_N = 10   // win rate / takeaway need this many finished quotes per cohort
const MIN_PRICED_N = 5    // pricing metrics need this many priced (won) jobs per cohort

const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`)

type Better = 'higher' | 'lower' | 'even'

function winnerSide(better: Better, g: number | null, u: number | null, gOk: boolean, uOk: boolean): 'g' | 'u' | null {
  if (g == null || u == null || !gOk || !uOk) return null
  const gv = better === 'even' ? Math.abs(g) : g
  const uv = better === 'even' ? Math.abs(u) : u
  if (gv === uv) return null
  const gWins = better === 'higher' ? gv > uv : gv < uv  // 'lower' and 'even' both want the smaller number
  return gWins ? 'g' : 'u'
}

function Side({ label, value, detail, win }: { label: string; value: string; detail: string; win: boolean }) {
  return (
    <div className={`flex-1 p-3 ${label === 'Grounded' ? 'border-r border-gray-100 dark:border-gray-700' : ''}`}>
      <div className={`text-[10px] font-bold uppercase tracking-wide ${label === 'Grounded' ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}`}>{label}</div>
      <div className={`mt-0.5 flex items-center gap-1.5 text-2xl font-extrabold tabular-nums ${win ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-900 dark:text-white'}`}>
        {win && <span className="text-sm">✓</span>}{value}
      </div>
      <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">{detail}</div>
    </div>
  )
}

function MetricCard({ name, explain, hint, better, g, u, gVal, uVal, gOk, uOk, gDetail, uDetail }: {
  name: string; explain: string; hint: string; better: Better
  g: CohortMetrics; u: CohortMetrics
  gVal: number | null; uVal: number | null; gOk: boolean; uOk: boolean
  gDetail: string; uDetail: string
}) {
  const win = winnerSide(better, gVal, uVal, gOk, uOk)
  return (
    <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-baseline gap-2 px-4 pt-3">
        <span className="text-sm font-bold text-gray-900 dark:text-white">{name}</span>
        <span className="ml-auto text-[10.5px] text-gray-400">{hint}</span>
      </div>
      <p className="px-4 pb-2 pt-0.5 text-xs leading-snug text-gray-500 dark:text-gray-400">{explain}</p>
      <div className="flex border-t border-gray-100 dark:border-gray-700">
        <Side label="Grounded" value={pct(gVal)} detail={gDetail} win={win === 'g'} />
        <Side label="SOP-only" value={pct(uVal)} detail={uDetail} win={win === 'u'} />
      </div>
    </div>
  )
}

function Takeaway({ grounded, ungrounded }: { grounded: CohortMetrics; ungrounded: CohortMetrics }) {
  const enough = grounded.n >= MIN_COHORT_N && ungrounded.n >= MIN_COHORT_N
  if (!enough) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-900/20">
        <div className="text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">⏳ Too early to tell</div>
        <div className="mt-1 font-bold text-gray-900 dark:text-white">Keep quoting — this sharpens as jobs finish.</div>
        <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-200/80">Need about {MIN_COHORT_N} finished quotes in each group before the comparison means anything. Counts below show it filling in.</p>
      </div>
    )
  }
  const gw = grounded.win_rate ?? 0, uw = ungrounded.win_rate ?? 0
  const helping = gw > uw
  return (
    <div className={`rounded-xl border p-4 ${helping ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-900/20' : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'}`}>
      <div className={`text-[10px] font-bold uppercase tracking-wide ${helping ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500'}`}>◎ Takeaway</div>
      <div className="mt-1 font-bold text-gray-900 dark:text-white">
        {helping ? 'Grounded quotes are landing more.' : 'Grounding isn’t pulling ahead on win rate yet.'}
      </div>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {helping
          ? 'Keep leaning on the “What this quote is based on” comparables when they’re there — they’re outperforming SOP-only quotes.'
          : 'Grounded quotes aren’t winning more than SOP-only so far. Worth watching as more jobs finish.'}
      </p>
    </div>
  )
}

export function AdminQuoteGroundingScreen() {
  const { cityQueryId } = useCity()
  const { data, isLoading, isError } = useQuoteGroundingEval(cityQueryId ?? null)

  return (
    <div className="min-h-screen bg-gray-50 pb-20 dark:bg-gray-900">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
        <h1 className="text-lg font-bold text-gray-900 dark:text-white">Quote grounding</h1>
      </header>

      <div className="space-y-3 p-4">
        <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          When the AI drafts a quote it either anchors on <b className="text-gray-700 dark:text-gray-200">similar past jobs</b> (“grounded”) or falls back to the SOP only. This compares how those two groups actually turn out.
        </p>

        {isLoading && <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">Loading…</p>}
        {isError && <p className="py-8 text-center text-sm text-amber-600 dark:text-amber-400">Couldn’t load the grounding stats.</p>}

        {data && (data.grounded.n === 0 && data.ungrounded.n === 0) && (
          <p className="rounded-xl border border-gray-200 py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
            No finished quotes yet — this fills in as jobs are won or lost.
          </p>
        )}

        {data && (data.grounded.n > 0 || data.ungrounded.n > 0) && (() => {
          const g = data.grounded, u = data.ungrounded
          const gWinOk = g.n >= MIN_COHORT_N, uWinOk = u.n >= MIN_COHORT_N
          const gPriceOk = g.priced_n >= MIN_PRICED_N, uPriceOk = u.priced_n >= MIN_PRICED_N
          const biasDetail = (m: CohortMetrics) => m.pricing_bias == null ? `${m.priced_n} jobs` : (m.pricing_bias < 0 ? 'under-quoting' : 'over-quoting')
          return (
            <>
              <Takeaway grounded={g} ungrounded={u} />
              <MetricCard name="Win rate" hint="higher is better" better="higher"
                explain="Of quotes that finished, how many became booked jobs."
                g={g} u={u} gVal={g.win_rate} uVal={u.win_rate} gOk={gWinOk} uOk={uWinOk}
                gDetail={`won ${g.won} · lost ${g.lost}`} uDetail={`won ${u.won} · lost ${u.lost}`} />
              <MetricCard name="Pricing accuracy" hint="lower error is tighter" better="lower"
                explain="On won jobs, how far the quote was from what the job actually brought in. Lower = closer to reality."
                g={g} u={u} gVal={g.pricing_accuracy} uVal={u.pricing_accuracy} gOk={gPriceOk} uOk={uPriceOk}
                gDetail={`off, avg · ${g.priced_n} jobs`} uDetail={`off, avg · ${u.priced_n} jobs`} />
              <MetricCard name="Over / under" hint="closer to even is better" better="even"
                explain="Do you tend to quote too low (leaving money on the table) or too high? Near 0 = balanced."
                g={g} u={u} gVal={g.pricing_bias} uVal={u.pricing_bias} gOk={gPriceOk} uOk={uPriceOk}
                gDetail={biasDetail(g)} uDetail={biasDetail(u)} />
              <p className="text-[11px] leading-relaxed text-gray-400">
                <b>Grounded</b> = anchored on comparable local jobs · <b>SOP-only</b> = no comparables were available yet. Win rate = won ÷ (won+lost); pricing is measured against realized revenue on won jobs. No “winner” marks until both groups clear the sample threshold.
              </p>
            </>
          )
        })()}
      </div>
      <BottomNav />
    </div>
  )
}
```

- [ ] **Step 4: Add the Admin card**

In `app/frontend/src/screens/AdminScreen.tsx`, add an entry to the `CARDS` array (mirror an existing entry's shape; pick a chart-ish icon — reuse the Metrics bar icon or a target). Place it after Metrics:

```tsx
  {
    path: '/admin/quote-grounding',
    label: 'Quote grounding',
    description: 'Is AI grounding winning more / pricing tighter?',
    color: 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
        <path d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
      </svg>
    ),
  },
```

- [ ] **Step 5: Add the route**

In `app/frontend/src/App.tsx`, add the import `import { AdminQuoteGroundingScreen } from './screens/AdminQuoteGroundingScreen'` and a route — note the broader RoleGuard (admin **+ facilitator**), placed with the other `/admin/*` routes:

```tsx
      <Route path="/admin/quote-grounding" element={<AuthGuard><RoleGuard roles={['admin', 'facilitator']}><AdminQuoteGroundingScreen /></RoleGuard></AuthGuard>} />
```

- [ ] **Step 6: Facilitator entry point in the Quote panel**

In `app/frontend/src/screens/panels/QuotePanel.tsx`, add `import { Link } from 'react-router-dom'` (if not already imported), and render a small link right after the `QuoteBasis` IIFE block (~line 232, after the `})()}`):

```tsx
        <Link to="/admin/quote-grounding" className="mb-3 inline-block text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">
          How grounded quoting is performing →
        </Link>
```

(This is how facilitators reach the screen, since the Admin tab itself stays admin-only. Confirm the exact insertion sits inside the panel's returned JSX, a sibling of the QuoteBasis block.)

- [ ] **Step 7: Type-check + build**

Run: `cd app/frontend && npx tsc --noEmit` → no errors.
Run: `cd app/frontend && npm run build` → succeeds (pre-existing chunk-size warning is not an error).

- [ ] **Step 8: Commit**

```bash
git add app/frontend/src/services/api.ts app/frontend/src/hooks/useLeads.ts app/frontend/src/screens/AdminQuoteGroundingScreen.tsx app/frontend/src/screens/AdminScreen.tsx app/frontend/src/App.tsx app/frontend/src/screens/panels/QuotePanel.tsx
git commit -m "feat(grounding-eval): AdminQuoteGroundingScreen + admin card, route, facilitator quote-panel link"
```

---

## Self-Review

**Spec coverage:**
- Expose won/lost; open endpoint to facilitator → Task 1 (with won/lost + role-access tests).
- Facilitator-friendly screen (intro, takeaway, plain-language metric cards w/ won·lost + counts, footnote) → Task 2 Step 3.
- Threshold gating (`MIN_COHORT_N`/`MIN_PRICED_N`; takeaway + per-metric winners only when earned; `—` for null) → `Takeaway` + `winnerSide` + `pct`.
- Two entry points: Admin card + Quote-panel link (route is admin+facilitator) → Steps 4-6.
- Out of scope (drill-down, configurable thresholds, trends, eval recompute) → not in any task.

**Placeholder scan:** The "mirror existing"/"confirm insertion" notes are integration points (the AdminScreen card shape, the QuotePanel link placement) with the exact snippet given. All schema/service/router/screen/hook/test code is complete. No TODO/TBD.

**Type/name consistency:** `won`/`lost` consistent across `CohortMetrics` (backend schema + frontend type), `_cohort_metrics`, and the screen. `win_rate`/`pricing_accuracy`/`pricing_bias` are fractions → `pct()` renders them; `winnerSide('lower'|'even')` picks the smaller/closer-to-zero correctly. `['grounding-eval', cityId]` query key. The route `roles={['admin','facilitator']}` matches the endpoint's `require_role("admin","facilitator")`.

**Note for implementer:** the screen reads the global city via `useCity().cityQueryId` (same as `AdminMetricsScreen`) — no embedded CitySwitcher. Winner marks compare grounded vs SOP-only and only render when BOTH cohorts clear the metric's threshold (`n` for win rate, `priced_n` for the two pricing metrics); ties and nulls show no winner.
