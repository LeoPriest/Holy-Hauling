# My Pay & Hours Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every user a read-only "My Pay" view of their own pay records — headline totals (earned, hours, job count) over a newest-first per-job list — served by a new `GET /users/me/pay` endpoint and surfaced as a section in Settings.

**Architecture:** One new caller-scoped read endpoint reusing `PayRecord` + `Lead` (no new model). It returns the authenticated user's own pay records joined to their leads, plus computed totals. The frontend adds a `useMyPay()` hook and a `MyPay` presentational component rendered inside `SettingsScreen` for all roles.

**Tech Stack:** FastAPI + SQLAlchemy async (aiosqlite), Pydantic v2, pytest-asyncio; React 18 + TS + Vite + Tailwind + TanStack Query. No JS test runner — frontend verification is `tsc && vite build`.

**Reference spec:** `docs/superpowers/specs/2026-06-19-my-pay-hours-design.md`

---

## File Structure

**Backend**
- Modify: `app/backend/app/schemas/pay_record.py` — add `MyPayEntry` + `MyPayOut`.
- Modify: `app/backend/app/routers/payroll.py` — add `_my_pay_out()` helper + `me_router` with `GET /users/me/pay`, included into `router`.
- Create: `app/backend/tests/test_my_pay.py` — endpoint tests with a crew-auth fixture.

**Frontend**
- Modify: `app/frontend/src/services/api.ts` — `MyPayEntry` / `MyPay` types + `getMyPay()`.
- Create: `app/frontend/src/hooks/useMyPay.ts` — TanStack Query hook.
- Create: `app/frontend/src/components/MyPay.tsx` — summary + per-job list (presentational).
- Modify: `app/frontend/src/screens/SettingsScreen.tsx` — render `<MyPay />` in a section (all roles).

No `main.py` change: `me_router` is included into `payroll.router`, which is already wired via `app.include_router(payroll.router)`.

---

## Task 1: Backend schema — `MyPayEntry` + `MyPayOut`

**Files:**
- Modify: `app/backend/app/schemas/pay_record.py`

- [ ] **Step 1: Add the two schemas**

The file already imports `from datetime import date` and `from app.models.pay_record import PayType`. Append these classes to the end of `app/backend/app/schemas/pay_record.py`:

```python
class MyPayEntry(BaseModel):
    lead_id: str
    customer_name: str | None
    job_date: date | None
    pay_type: PayType
    hours_worked: float | None
    amount_cents: int


class MyPayOut(BaseModel):
    total_earnings_cents: int
    total_hours: float
    job_count: int
    entries: list[MyPayEntry]
```

- [ ] **Step 2: Sanity import check**

Run: `cd app/backend && python -c "from app.schemas.pay_record import MyPayOut, MyPayEntry; print('ok')"`
Expected: prints `ok` with no import error.

- [ ] **Step 3: Commit**

```bash
git add app/backend/app/schemas/pay_record.py
git commit -m "feat(my-pay): add MyPayEntry/MyPayOut schemas"
```

---

## Task 2: Backend endpoint — `GET /users/me/pay`

**Files:**
- Test: `app/backend/tests/test_my_pay.py` (create)
- Modify: `app/backend/app/routers/payroll.py`

- [ ] **Step 1: Write the failing tests**

Create `app/backend/tests/test_my_pay.py` with a crew-auth fixture (mirrors `crew_client` in `test_jobs.py`) and direct DB seeding. The mock crew user (id `mock-crew`) need not be a DB row — the endpoint only filters `PayRecord.user_id`. Pay records are seeded directly via the session factory.

```python
from __future__ import annotations

import os
os.environ.setdefault("JWT_SECRET", "test-secret-32-characters-long!!!")

from datetime import date, datetime, timezone

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base, get_db
from app.dependencies import require_auth
from app.models.lead import Lead, LeadSourceType, LeadStatus, ServiceType
from app.models.pay_record import PayRecord, PayType
from app.models.user import User

TEST_DB = "sqlite+aiosqlite:///:memory:"


def _mock_user(role="crew", user_id="mock-crew"):
    return User(
        id=user_id,
        username=user_id,
        credential_hash="x",
        role=role,
        city_id="st-louis",
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )


@pytest_asyncio.fixture
async def crew_client():
    from main import app
    engine = create_async_engine(TEST_DB)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async def override_get_db():
        async with Factory() as s:
            yield s

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[require_auth] = lambda: _mock_user("crew")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac, Factory

    app.dependency_overrides.clear()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


async def _seed_lead(factory, customer_name="Maria Lopez", job_date=None):
    async with factory() as s:
        lead = Lead(
            source_type=LeadSourceType.manual,
            status=LeadStatus.released,
            service_type=ServiceType.hauling,
            urgency_flag=False,
            customer_name=customer_name,
            customer_phone="555-000-0000",
            quote_context="x",
            job_date_requested=job_date,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        s.add(lead)
        await s.commit()
        await s.refresh(lead)
        return lead.id


async def _seed_pay(factory, lead_id, user_id, pay_type, amount_cents, hours_worked=None):
    async with factory() as s:
        rec = PayRecord(
            lead_id=lead_id,
            user_id=user_id,
            pay_type=PayType(pay_type),
            hours_worked=hours_worked,
            amount_cents=amount_cents,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        s.add(rec)
        await s.commit()
        await s.refresh(rec)
        return rec.id


async def test_my_pay_empty_when_no_records(crew_client):
    client, _factory = crew_client
    r = await client.get("/users/me/pay")
    assert r.status_code == 200
    body = r.json()
    assert body == {
        "total_earnings_cents": 0,
        "total_hours": 0.0,
        "job_count": 0,
        "entries": [],
    }


async def test_my_pay_returns_only_callers_records(crew_client):
    client, factory = crew_client
    lead_id = await _seed_lead(factory, customer_name="Maria Lopez", job_date=date(2026, 6, 19))
    await _seed_pay(factory, lead_id, "mock-crew", "hourly", 12000, hours_worked=6.0)
    await _seed_pay(factory, lead_id, "other-user", "flat", 99999, hours_worked=None)

    r = await client.get("/users/me/pay")
    assert r.status_code == 200
    body = r.json()
    assert body["job_count"] == 1
    assert len(body["entries"]) == 1
    assert body["entries"][0]["amount_cents"] == 12000
    assert body["entries"][0]["customer_name"] == "Maria Lopez"
    assert body["entries"][0]["job_date"] == "2026-06-19"


async def test_my_pay_totals_sum_amounts_and_hours_ignoring_null(crew_client):
    client, factory = crew_client
    lead_a = await _seed_lead(factory, customer_name="A", job_date=date(2026, 6, 19))
    lead_b = await _seed_lead(factory, customer_name="B", job_date=date(2026, 6, 17))
    await _seed_pay(factory, lead_a, "mock-crew", "hourly", 12000, hours_worked=6.0)
    await _seed_pay(factory, lead_b, "mock-crew", "flat", 45000, hours_worked=None)

    r = await client.get("/users/me/pay")
    body = r.json()
    assert body["total_earnings_cents"] == 57000   # 12000 + 45000 (flat counts)
    assert body["total_hours"] == 6.0              # null-hours flat job excluded
    assert body["job_count"] == 2


async def test_my_pay_orders_newest_job_first_nulls_last(crew_client):
    client, factory = crew_client
    lead_old = await _seed_lead(factory, customer_name="Old", job_date=date(2026, 6, 10))
    lead_new = await _seed_lead(factory, customer_name="New", job_date=date(2026, 6, 19))
    lead_undated = await _seed_lead(factory, customer_name="Undated", job_date=None)
    await _seed_pay(factory, lead_old, "mock-crew", "flat", 1000)
    await _seed_pay(factory, lead_new, "mock-crew", "flat", 2000)
    await _seed_pay(factory, lead_undated, "mock-crew", "flat", 3000)

    r = await client.get("/users/me/pay")
    names = [e["customer_name"] for e in r.json()["entries"]]
    assert names == ["New", "Old", "Undated"]
    assert r.json()["entries"][-1]["job_date"] is None
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app/backend && python -m pytest tests/test_my_pay.py -v`
Expected: FAIL — `404 Not Found` (route doesn't exist yet) on the non-empty assertions; the empty test also fails on the 404.

- [ ] **Step 3: Implement the helper + endpoint**

In `app/backend/app/routers/payroll.py`:

(a) Extend the schema import to include the new schemas:

```python
from app.schemas.pay_record import (
    MyPayOut,
    MyPayEntry,
    PayRecordOut,
    PayRecordUpsert,
    PayrollJobEntry,
    PayrollUserSummary,
)
```

(b) Add `from datetime import date` to the existing datetime import line at the top. It currently reads:

```python
from datetime import datetime, timezone
```

Change it to:

```python
from datetime import date, datetime, timezone
```

(c) Add the builder helper near the other module-level helpers (e.g. after `_record_out`):

```python
def _my_pay_out(records: list[PayRecord]) -> MyPayOut:
    def sort_key(rec: PayRecord):
        jd = rec.lead.job_date_requested if rec.lead else None
        # newest job first; undated (None) jobs last; tie-break by created_at
        return (jd is not None, jd or date.min, rec.created_at)

    ordered = sorted(records, key=sort_key, reverse=True)

    entries = [
        MyPayEntry(
            lead_id=rec.lead_id,
            customer_name=rec.lead.customer_name if rec.lead else None,
            job_date=rec.lead.job_date_requested if rec.lead else None,
            pay_type=rec.pay_type,
            hours_worked=rec.hours_worked,
            amount_cents=rec.amount_cents,
        )
        for rec in ordered
    ]
    total_earnings = sum(rec.amount_cents for rec in records)
    total_hours = sum(rec.hours_worked for rec in records if rec.hours_worked is not None)
    return MyPayOut(
        total_earnings_cents=total_earnings,
        total_hours=float(total_hours),
        job_count=len(records),
        entries=entries,
    )
```

(d) Add the `me_router` and route just above the `# -- Wire sub-routers` section:

```python
# -- Current-user pay view ----------------------------------------------------

me_router = APIRouter(prefix="/users/me", tags=["payroll"])


@me_router.get("/pay", response_model=MyPayOut)
async def get_my_pay(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_auth),
):
    result = await db.execute(
        select(PayRecord)
        .options(selectinload(PayRecord.lead))
        .where(PayRecord.user_id == current_user.id)
    )
    records = list(result.scalars().all())
    return _my_pay_out(records)
```

(e) Wire `me_router` into `router` in the `# -- Wire sub-routers` block (alongside the existing includes):

```python
router.include_router(lead_router)
router.include_router(admin_router)
router.include_router(me_router)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app/backend && python -m pytest tests/test_my_pay.py -v`
Expected: all 4 tests PASS.

- [ ] **Step 5: Run the full backend suite for regressions**

Run: `cd app/backend && python -m pytest -q`
Expected: full suite green (prior baseline 337 + the 4 new = 341), no failures.

- [ ] **Step 6: Commit**

```bash
git add app/backend/app/routers/payroll.py app/backend/tests/test_my_pay.py
git commit -m "feat(my-pay): GET /users/me/pay returns caller's own pay + totals"
```

---

## Task 3: Frontend — types, API function, and `useMyPay` hook

**Files:**
- Modify: `app/frontend/src/services/api.ts`
- Create: `app/frontend/src/hooks/useMyPay.ts`

- [ ] **Step 1: Add types + fetcher to `api.ts`**

Append to `app/frontend/src/services/api.ts` (it already exports `apiFetch` and `API_BASE`):

```ts
export interface MyPayEntry {
  lead_id: string
  customer_name: string | null
  job_date: string | null
  pay_type: 'hourly' | 'flat' | 'facilitator_pct'
  hours_worked: number | null
  amount_cents: number
}

export interface MyPay {
  total_earnings_cents: number
  total_hours: number
  job_count: number
  entries: MyPayEntry[]
}

export async function getMyPay(): Promise<MyPay> {
  const r = await apiFetch('/users/me/pay')
  if (!r.ok) throw new Error('Failed to load pay')
  return r.json()
}
```

- [ ] **Step 2: Create the hook**

Create `app/frontend/src/hooks/useMyPay.ts`:

```ts
import { useQuery } from '@tanstack/react-query'
import { getMyPay, type MyPay } from '../services/api'

export function useMyPay() {
  return useQuery<MyPay>({
    queryKey: ['my-pay'],
    queryFn: getMyPay,
  })
}
```

- [ ] **Step 3: Type-check**

Run: `cd app/frontend && npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add app/frontend/src/services/api.ts app/frontend/src/hooks/useMyPay.ts
git commit -m "feat(my-pay): MyPay types, getMyPay fetcher, useMyPay hook"
```

---

## Task 4: Frontend — `MyPay` component + Settings wiring

**Files:**
- Create: `app/frontend/src/components/MyPay.tsx`
- Modify: `app/frontend/src/screens/SettingsScreen.tsx`

- [ ] **Step 1: Create the `MyPay` component**

Create `app/frontend/src/components/MyPay.tsx`. Renders the summary card + per-job list with loading/error/empty states. `job_date` is a date-only string (`YYYY-MM-DD`) — parse it by splitting (not `new Date(...)`) to avoid timezone off-by-one.

```tsx
import { useMyPay } from '../hooks/useMyPay'
import type { MyPayEntry } from '../services/api'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

const PAY_TYPE_LABEL: Record<MyPayEntry['pay_type'], string> = {
  hourly: 'Hourly',
  flat: 'Flat',
  facilitator_pct: 'Percentage',
}

function PayDate({ iso }: { iso: string | null }) {
  if (!iso) {
    return <div className="w-11 text-center text-gray-400 dark:text-gray-500">—</div>
  }
  const [, m, d] = iso.split('-').map(Number)
  return (
    <div className="w-11 text-center">
      <div className="text-lg font-bold leading-none text-gray-900 dark:text-white">{d}</div>
      <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {MONTHS[(m ?? 1) - 1]}
      </div>
    </div>
  )
}

function PayRow({ entry }: { entry: MyPayEntry }) {
  return (
    <div className="flex min-h-11 items-center gap-3 border-t border-gray-100 px-3 py-2 first:border-t-0 dark:border-gray-700">
      <PayDate iso={entry.job_date} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-gray-900 dark:text-white">
          {entry.customer_name ?? 'Unknown customer'}
        </div>
        <div className="mt-0.5">
          <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:bg-gray-700 dark:text-gray-300">
            {PAY_TYPE_LABEL[entry.pay_type]}
          </span>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="font-bold text-gray-900 dark:text-white">{fmtMoney(entry.amount_cents)}</div>
        <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          {entry.hours_worked != null ? `${entry.hours_worked} hrs` : '— no hrs'}
        </div>
      </div>
    </div>
  )
}

export function MyPay() {
  const { data, isLoading, isError } = useMyPay()

  if (isLoading) {
    return <div className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">Loading…</div>
  }
  if (isError || !data) {
    return <div className="py-6 text-center text-sm text-amber-600 dark:text-amber-400">Couldn't load your pay.</div>
  }

  const hours = Number.isInteger(data.total_hours) ? data.total_hours : data.total_hours.toFixed(1)

  return (
    <div>
      <div className="rounded-xl border border-gray-200 bg-gradient-to-br from-emerald-50 to-white p-4 dark:border-gray-700 dark:from-gray-800 dark:to-gray-800">
        <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Total earned</div>
        <div className="mt-1 text-3xl font-extrabold text-emerald-600 dark:text-emerald-400">
          {fmtMoney(data.total_earnings_cents)}
        </div>
        <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          <span className="font-semibold text-gray-700 dark:text-gray-200">{hours}</span> hrs logged
          <span className="px-2 opacity-40">•</span>
          <span className="font-semibold text-gray-700 dark:text-gray-200">{data.job_count}</span>{' '}
          {data.job_count === 1 ? 'job' : 'jobs'}
        </div>
      </div>

      {data.entries.length === 0 ? (
        <div className="mt-3 rounded-xl border border-gray-200 py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          No pay recorded yet.
          <br />
          Completed jobs with pay will show up here.
        </div>
      ) : (
        <div className="mt-3 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
          {data.entries.map((e) => (
            <PayRow key={e.lead_id} entry={e} />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Render `MyPay` in Settings (all roles)**

In `app/frontend/src/screens/SettingsScreen.tsx`:

Add the import near the other component imports (after `import { CitySwitcher } from '../components/CitySwitcher'`):

```tsx
import { MyPay } from '../components/MyPay'
```

Then add a **My Pay** section. Wrap `<MyPay />` in the SAME section/card container the other Settings sections use — mirror the outer wrapper and heading markup of the existing Availability section so the chrome matches. The inner content is just:

```tsx
{/* My Pay — visible to all roles; each user sees only their own pay */}
<section className="<same classes as the other Settings section wrappers>">
  <h2 className="<same heading classes as other sections>">My Pay</h2>
  <MyPay />
</section>
```

Place it among the existing sections (a sensible spot is just above or below the Availability section). No role guard — it renders for every role.

- [ ] **Step 3: Type-check**

Run: `cd app/frontend && npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 4: Production build**

Run: `cd app/frontend && npm run build`
Expected: `tsc` + `vite build` succeed with no errors.

- [ ] **Step 5: Commit**

```bash
git add app/frontend/src/components/MyPay.tsx app/frontend/src/screens/SettingsScreen.tsx
git commit -m "feat(my-pay): My Pay section in Settings (summary + per-job list)"
```

---

## Self-Review

**Spec coverage:**
- `GET /me/pay` caller-scoped, totals + entries → Task 2 (path mounted at `/users/me/pay`, the codebase's current-user convention, as the spec allowed the plan to settle).
- Totals semantics (earnings sum all; hours sum non-null; job_count) → `_my_pay_out`, Task 2; verified by `test_my_pay_totals_sum_amounts_and_hours_ignoring_null`.
- Newest-first, nulls last → `sort_key`, Task 2; verified by `test_my_pay_orders_newest_job_first_nulls_last`.
- Caller isolation (never others' pay) → `where(PayRecord.user_id == current_user.id)`; verified by `test_my_pay_returns_only_callers_records`.
- Empty state → `test_my_pay_empty_when_no_records` (backend) + empty branch in `MyPay` (frontend).
- All-roles Settings section, no new nav/screen → Task 4, no role guard.
- Read-only rows, flat job shows "— no hrs", money from cents → `PayRow`, Task 4.
- Loading + error states → `MyPay` branches, Task 4.

**Placeholder scan:** The only deliberate "match existing" instruction is the Settings section wrapper chrome in Task 4 Step 2 (an existing-codebase integration point); the component and all logic are fully specified. No TODO/TBD left.

**Type consistency:** `MyPayOut`/`MyPayEntry` field names match across backend schema, response, frontend `MyPay`/`MyPayEntry` types, and component usage. `pay_type` literals (`hourly | flat | facilitator_pct`) match the `PayType` enum values. `job_date` is an ISO date string on the wire (Pydantic serializes `date`), parsed by string-split on the frontend.

**Note for implementer:** `total_hours` is summed in Python; an all-flat (null-hours) set yields `0` → cast to `float`. The frontend renders whole hours without a decimal and fractional hours to one decimal place.
