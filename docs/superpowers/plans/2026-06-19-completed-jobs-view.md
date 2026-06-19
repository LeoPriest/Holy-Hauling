# Completed Jobs View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Completed" tab on the Jobs screen listing released (completed) jobs newest-first, each card showing the operational record + quoted price + realized revenue, with a header total (count + total realized revenue).

**Architecture:** Extend `GET /jobs` with a `status` param (`booked` default | `completed`). For completed, attach `realized_revenue_cents` (batched sum of income finance txns) and `completed_at` (batched min of the `status_changed→released` event), sorted newest-first. The Jobs screen gains a third tab fetching `?status=completed` and renders read-only cards + a running total.

**Tech Stack:** FastAPI, SQLAlchemy 2.x async; React 18 + TS + Tailwind + TanStack Query.

**Spec:** `docs/superpowers/specs/2026-06-19-completed-jobs-view-design.md`

---

## File Structure

**Backend — modify:**
- `app/backend/app/schemas/jobs.py` — `JobOut` += `realized_revenue_cents`, `completed_at`
- `app/backend/app/routers/jobs.py` — `status` param, completed branch, batched helpers, `_to_job_out` params
- `app/backend/tests/test_jobs.py` — completed-view tests

**Frontend — modify:**
- `app/frontend/src/hooks/useJobs.ts` — `useJobs(status)` + `Job` fields
- `app/frontend/src/screens/JobsScreen.tsx` — Completed tab + header total + read-only cards

---

## Task 1: Schema — `JobOut` additions

**Files:**
- Modify: `app/backend/app/schemas/jobs.py`

- [ ] **Step 1: Add the two fields**

In `app/backend/app/schemas/jobs.py`, add to `JobOut` (after `started_at`, before `model_config`):

```python
    realized_revenue_cents: Optional[int] = None
    completed_at: Optional[str] = None  # ISO datetime; set for completed jobs
```

- [ ] **Step 2: Verify it imports**

Run: `cd app/backend ; python -c "from app.schemas.jobs import JobOut ; print('realized_revenue_cents' in JobOut.model_fields and 'completed_at' in JobOut.model_fields)"`
Expected: prints `True`.

- [ ] **Step 3: Commit**

```bash
git add app/backend/app/schemas/jobs.py
git commit -m "feat(jobs): JobOut += realized_revenue_cents, completed_at"
```

---

## Task 2: Backend — `status` param + completed branch

**Files:**
- Modify: `app/backend/app/routers/jobs.py`
- Modify: `app/backend/tests/test_jobs.py`

- [ ] **Step 1: Write the failing tests**

Append to `app/backend/tests/test_jobs.py` (model on the existing `_seed_lead` / `_seed_user` / `_seed_assignment` / `supervisor_client` helpers in that file — READ them first; if a helper signature differs from what's used below, adapt the calls but keep the assertions):

```python
async def test_jobs_completed_returns_released_not_booked(supervisor_client):
    from datetime import date
    client, factory = supervisor_client
    booked = await _seed_lead(factory, status="booked", job_date_requested=date(2026, 5, 1))
    completed = await _seed_lead(factory, status="released", job_date_requested=date(2026, 5, 2))

    r = await client.get("/jobs?status=completed")
    assert r.status_code == 200, r.text
    ids = {j["id"] for j in r.json()}
    assert completed.id in ids
    assert booked.id not in ids

    # default (booked) view unchanged
    d = await client.get("/jobs")
    dids = {j["id"] for j in d.json()}
    assert booked.id in dids
    assert completed.id not in dids


async def test_jobs_status_invalid_400(supervisor_client):
    client, _ = supervisor_client
    r = await client.get("/jobs?status=bogus")
    assert r.status_code == 400


async def test_jobs_completed_realized_revenue_is_income_sum(supervisor_client):
    import uuid
    from datetime import date, datetime, timezone
    from app.models.finance import FinanceTransaction, FinanceTransactionType
    client, factory = supervisor_client
    lead = await _seed_lead(factory, status="released", job_date_requested=date(2026, 5, 2))
    async with factory() as s:
        s.add(FinanceTransaction(
            id=str(uuid.uuid4()), city_id=lead.city_id, occurred_on=date(2026, 5, 2),
            transaction_type=FinanceTransactionType.income, category="job", amount_cents=72000,
            lead_id=lead.id, created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc),
        ))
        s.add(FinanceTransaction(
            id=str(uuid.uuid4()), city_id=lead.city_id, occurred_on=date(2026, 5, 2),
            transaction_type=FinanceTransactionType.expense, category="fuel", amount_cents=5000,
            lead_id=lead.id, created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc),
        ))
        await s.commit()

    r = await client.get("/jobs?status=completed")
    job = next(j for j in r.json() if j["id"] == lead.id)
    assert job["realized_revenue_cents"] == 72000  # income only; expense excluded


async def test_jobs_completed_null_revenue_when_no_income(supervisor_client):
    from datetime import date
    client, factory = supervisor_client
    lead = await _seed_lead(factory, status="released", job_date_requested=date(2026, 5, 2))
    r = await client.get("/jobs?status=completed")
    job = next(j for j in r.json() if j["id"] == lead.id)
    assert job["realized_revenue_cents"] is None


async def test_jobs_completed_sorted_most_recent_first(supervisor_client):
    import uuid
    from datetime import date, datetime, timezone
    from app.models.lead_event import LeadEvent
    client, factory = supervisor_client
    older = await _seed_lead(factory, status="released", job_date_requested=date(2026, 5, 1))
    newer = await _seed_lead(factory, status="released", job_date_requested=date(2026, 5, 9))
    async with factory() as s:
        s.add(LeadEvent(id=str(uuid.uuid4()), lead_id=older.id, event_type="status_changed",
                        to_status="released", created_at=datetime(2026, 5, 1, 12, 0, tzinfo=timezone.utc)))
        s.add(LeadEvent(id=str(uuid.uuid4()), lead_id=newer.id, event_type="status_changed",
                        to_status="released", created_at=datetime(2026, 5, 9, 12, 0, tzinfo=timezone.utc)))
        await s.commit()

    jobs = (await client.get("/jobs?status=completed")).json()
    order = [j["id"] for j in jobs if j["id"] in {older.id, newer.id}]
    assert order == [newer.id, older.id]  # most-recent completed first
    newer_job = next(j for j in jobs if j["id"] == newer.id)
    assert newer_job["completed_at"] is not None


async def test_jobs_booked_has_null_completed_fields(supervisor_client):
    from datetime import date
    client, factory = supervisor_client
    lead = await _seed_lead(factory, status="booked", job_date_requested=date(2026, 5, 2))
    job = next(j for j in (await client.get("/jobs")).json() if j["id"] == lead.id)
    assert job["realized_revenue_cents"] is None
    assert job["completed_at"] is None
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd app/backend ; python -m pytest tests/test_jobs.py -q -k "completed or status_invalid or booked_has_null"`
Expected: failures (no `status` param yet; completed view returns booked-only / 422 default).

- [ ] **Step 3: Edit `app/backend/app/routers/jobs.py`**

(a) Imports — change `from sqlalchemy import select` to `from sqlalchemy import func, select`; add:
```python
from app.models.finance import FinanceTransaction, FinanceTransactionType
from app.models.lead_event import LeadEvent
```
(`HTTPException` is already imported; `_iso` already exists.)

(b) Add two batched helpers (near `_get_crew`):
```python
async def _income_by_lead(db: AsyncSession, lead_ids: list[str]) -> dict[str, int]:
    if not lead_ids:
        return {}
    result = await db.execute(
        select(FinanceTransaction.lead_id, func.sum(FinanceTransaction.amount_cents))
        .where(
            FinanceTransaction.lead_id.in_(lead_ids),
            FinanceTransaction.transaction_type == FinanceTransactionType.income,
        )
        .group_by(FinanceTransaction.lead_id)
    )
    return {lead_id: int(total) for lead_id, total in result.all()}


async def _completed_at_by_lead(db: AsyncSession, lead_ids: list[str]) -> dict:
    if not lead_ids:
        return {}
    result = await db.execute(
        select(LeadEvent.lead_id, func.min(LeadEvent.created_at))
        .where(
            LeadEvent.lead_id.in_(lead_ids),
            LeadEvent.event_type == "status_changed",
            LeadEvent.to_status == "released",
        )
        .group_by(LeadEvent.lead_id)
    )
    return {lead_id: ts for lead_id, ts in result.all()}
```

(c) Add the two optional params to `_to_job_out`. Change its signature:
```python
async def _to_job_out(
    db: AsyncSession, lead: Lead, role: str, cities: dict[str, City] | None = None,
    realized_revenue_cents: int | None = None, completed_at: str | None = None,
) -> JobOut:
```
and add to the `JobOut(...)` construction (anywhere among the kwargs):
```python
        realized_revenue_cents=realized_revenue_cents,
        completed_at=completed_at,
```

(d) Rewrite `get_jobs` to accept `status` and branch. Replace the whole function body:
```python
@router.get("", response_model=list[JobOut])
async def get_jobs(
    city_id: str | None = None,
    status: str = "booked",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_auth),
):
    status_map = {"booked": LeadStatus.booked, "completed": LeadStatus.released}
    if status not in status_map:
        raise HTTPException(status_code=400, detail="status must be 'booked' or 'completed'")
    target = status_map[status]

    effective_city_id = city_scope(current_user, city_id)
    sort_order = (
        Lead.job_date_requested.is_(None),
        Lead.job_date_requested,
        Lead.appointment_time_slot.is_(None),
        Lead.appointment_time_slot,
        Lead.created_at,
    )
    if current_user.role in ("supervisor", "admin", "facilitator"):
        q = select(Lead).where(Lead.status == target)
        if effective_city_id:
            q = q.where(Lead.city_id == effective_city_id)
        result = await db.execute(q.order_by(*sort_order))
    else:
        result = await db.execute(
            select(Lead)
            .join(JobAssignment, Lead.id == JobAssignment.lead_id)
            .where(
                Lead.status == target,
                JobAssignment.user_id == current_user.id,
                Lead.city_id == effective_city_id,
            )
            .order_by(*sort_order)
        )
    leads = result.scalars().all()
    cities = await _city_map(db)

    if target == LeadStatus.released:
        lead_ids = [lead.id for lead in leads]
        revenue = await _income_by_lead(db, lead_ids)
        completed = await _completed_at_by_lead(db, lead_ids)
        jobs = [
            await _to_job_out(
                db, lead, current_user.role, cities,
                realized_revenue_cents=revenue.get(lead.id),
                completed_at=_iso(completed.get(lead.id)),
            )
            for lead in leads
        ]
        jobs.sort(key=lambda j: j.completed_at or "", reverse=True)  # most-recent first; None last
        return jobs

    return [await _to_job_out(db, lead, current_user.role, cities) for lead in leads]
```

- [ ] **Step 4: Run the tests to green**

Run: `cd app/backend ; python -m pytest tests/test_jobs.py -q`
Expected: all pass (existing job tests + the 6 new ones). The existing booked-job tests MUST still pass.

- [ ] **Step 5: Commit**

```bash
git add app/backend/app/routers/jobs.py app/backend/tests/test_jobs.py
git commit -m "feat(jobs): GET /jobs?status=completed with realized revenue + completed_at, newest-first"
```

---

## Task 3: Frontend — Completed tab

**Files:**
- Modify: `app/frontend/src/hooks/useJobs.ts`
- Modify: `app/frontend/src/screens/JobsScreen.tsx`

- [ ] **Step 1: Extend the hook + `Job` type (`useJobs.ts`)**

Add the two fields to the `Job` interface (after `started_at`):
```ts
  realized_revenue_cents?: number | null
  completed_at?: string | null
```

Change `useJobs` to accept a status and include it in the key + URL:
```ts
export function useJobs(status: 'booked' | 'completed' = 'booked') {
  const { cityQueryId } = useCity()
  return useQuery<Job[]>({
    queryKey: ['jobs', status, cityQueryId],
    queryFn: async () => {
      const params = new URLSearchParams({ status })
      if (cityQueryId) params.set('city_id', cityQueryId)
      const r = await apiFetch(`/jobs?${params.toString()}`)
      if (!r.ok) throw new Error('Failed to fetch jobs')
      return r.json()
    },
  })
}
```
Note: the query key gains `status`, so existing `qc.invalidateQueries({ queryKey: ['jobs'] })` calls still match (prefix match) and refresh both views.

- [ ] **Step 2: Add the Completed tab to `JobsScreen.tsx`**

READ `JobsScreen.tsx` first. The screen has `type JobView = 'scheduled' | 'in_progress'`, a `useJobs()` call, tab buttons for the two views, and groups jobs by phase. Make these changes:

(a) Widen the view type: `type JobView = 'scheduled' | 'in_progress' | 'completed'`.

(b) Fetch completed jobs alongside the active ones. Where it calls `const { data: jobs = [] } = useJobs()`, add:
```tsx
const { data: completedJobs = [] } = useJobs('completed')
```
(Keep the existing `useJobs()` for scheduled/in_progress.)

(c) Add a third tab button "Completed" next to the existing Scheduled / In-Progress tab buttons (match their styling/`aria` pattern), setting the view to `'completed'`.

(d) When `view === 'completed'`, render a dedicated read-only section instead of the phase groups:
- A header summary line:
```tsx
{view === 'completed' && (
  <div className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">
    {completedJobs.length} completed · {fmtMoney(completedJobs.reduce((sum, j) => sum + (j.realized_revenue_cents ?? 0), 0) / 100)} realized
  </div>
)}
```
  (Add a small `fmtMoney` helper if the file doesn't already have one: `new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)`.)
- A list of completed cards, each showing: customer name, service type, crew, on-site duration if available, the completed date (`completed_at`), the quoted price (`quoted_price_total`), and the realized revenue (`realized_revenue_cents`, shown as currency or "—" when null). Reuse the existing card's presentational layout where practical, but WITHOUT the phase timers/dispatch controls (completed jobs are read-only). Tapping a card navigates to the lead detail exactly like the active job cards do (`navigate(`/leads/${job.id}`)` or whatever the existing card uses).
- Empty state when `completedJobs.length === 0`: "No completed jobs yet."

Keep the existing Scheduled / In-Progress rendering untouched for those two views.

- [ ] **Step 3: Build**

Run: `cd app/frontend ; npm run build`
Expected: build succeeds, no TS errors.

- [ ] **Step 4: Commit**

```bash
git add app/frontend/src/hooks/useJobs.ts app/frontend/src/screens/JobsScreen.tsx
git commit -m "feat(jobs): Completed tab on the Jobs screen (read-only history + realized-revenue total)"
```

---

## Task 4: Docs + full suite green

**Files:**
- Modify: `CAPABILITIES.md`

- [ ] **Step 1: Run the full backend suite**

Run: `cd app/backend ; python -m pytest -q`
Expected: all pass (prior 330 + the 6 new job tests). Diagnose any unrelated break.

- [ ] **Step 2: Update `CAPABILITIES.md`**

Note that the Jobs screen now has a Completed tab: `GET /jobs?status=completed` returns released jobs with `realized_revenue_cents` (live income sum) + `completed_at` (from the released event), newest-first; the tab shows a read-only history with a count + total-realized-revenue header. Update the test count.

- [ ] **Step 3: Commit**

```bash
git add CAPABILITIES.md
git commit -m "docs(jobs): capabilities + suite green"
```

---

## Self-Review Notes (addressed)

- **Spec coverage:** schema (T1), `status` param + completed branch + batched revenue/completed_at + sort + 400 (T2), frontend tab + header total + read-only cards (T3), docs/suite (T4). Every spec section maps to a task.
- **No N+1:** `_income_by_lead` and `_completed_at_by_lead` are single grouped queries over the result set.
- **Backward compatible:** `status` defaults to `booked`; the booked branch is byte-unchanged behavior and carries null completed fields; `test_jobs_booked_has_null_completed_fields` + the existing job tests guard it.
- **Sort:** ISO-string lexical sort = chronological; `reverse=True` → newest first, `None → ""` sorts last. Covered by `test_jobs_completed_sorted_most_recent_first`.
- **Type consistency:** `realized_revenue_cents` / `completed_at` identical across `JobOut`, the frontend `Job` type, and tests; `useJobs(status)` key includes `status` so invalidations still match by prefix.
