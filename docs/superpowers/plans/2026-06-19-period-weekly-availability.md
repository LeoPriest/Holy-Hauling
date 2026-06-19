# Period-Level Weekly Availability — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let crew block recurring weekly availability per period (morning/afternoon/evening) of each weekday, instead of whole-day only — model + idempotent migration that preserves existing all-day blocks, a weekday→periods API, a coarse admin rollup, and a 7×3 Settings grid.

**Architecture:** `UserWeeklyAvailability` gains a `period` column with unique `(user_id, weekday, period)`. A startup migration expands each existing `(user, weekday)` row into three period rows. `GET/PUT /users/me/weekly-availability` exchange a `{blocks: {weekday: [periods]}}` map. The admin user-list reports a weekday unavailable only when all three periods are blocked. The Settings screen becomes a days×periods grid.

**Tech Stack:** FastAPI, SQLAlchemy 2.x async + aiosqlite, Pydantic v2; React 18 + TS + Tailwind + TanStack Query.

**Spec:** `docs/superpowers/specs/2026-06-19-period-weekly-availability-design.md`

---

## File Structure

**Backend — modify:**
- `app/backend/app/models/user_weekly_availability.py` — add `period` + `PERIODS`; constraint
- `app/backend/main.py` — startup migration `_migrate_weekly_availability_add_period`
- `app/backend/app/schemas/user.py` — `Period`; `blocks`-map Out/Update
- `app/backend/app/routers/users.py` — GET/PUT rewrite + admin rollup

**Backend — create:**
- `app/backend/tests/test_weekly_availability.py` — migration + endpoint + rollup tests

**Frontend — modify:**
- `app/frontend/src/services/api.ts` — `WeeklyAvailability` type + `saveMyAvailability`
- `app/frontend/src/hooks/useAvailability.ts` — types
- `app/frontend/src/screens/SettingsScreen.tsx` — the days×periods grid

---

## Task 1: Model + `PERIODS` + migration

**Files:**
- Modify: `app/backend/app/models/user_weekly_availability.py`
- Modify: `app/backend/main.py`
- Create: `app/backend/tests/test_weekly_availability.py` (migration tests only this task)

- [ ] **Step 1: Update the model**

Replace `app/backend/app/models/user_weekly_availability.py` with:

```python
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import relationship

from app.database import Base

# Period buckets for a weekday block (labels only — no specific hours)
PERIODS = ("morning", "afternoon", "evening")


class UserWeeklyAvailability(Base):
    __tablename__ = "user_weekly_availability"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "weekday", "period",
            name="uq_user_weekly_availability_user_weekday_period",
        ),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    weekday = Column(String, nullable=False)
    period = Column(String, nullable=False)  # morning | afternoon | evening
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="weekly_availability_entries")
```

- [ ] **Step 2: Add the migration to `main.py`**

In `app/backend/main.py`, add this function near the other `_migrate_*` functions (e.g. after `_migrate_users_add_hourly_rate_cents`):

```python
async def _migrate_weekly_availability_add_period(conn) -> None:
    """Add a `period` column to user_weekly_availability, expanding each existing
    all-day block into three period rows (morning/afternoon/evening). Idempotent.
    """
    result = await conn.execute(text("PRAGMA table_info(user_weekly_availability)"))
    rows = result.fetchall()
    if not rows:
        return  # table not created yet; create_all builds the new shape
    if "period" in _existing_columns(rows):
        return  # already migrated

    await conn.execute(text("ALTER TABLE user_weekly_availability RENAME TO _uwa_old"))
    await conn.execute(text("""
        CREATE TABLE user_weekly_availability (
            id VARCHAR NOT NULL PRIMARY KEY,
            user_id VARCHAR NOT NULL,
            weekday VARCHAR NOT NULL,
            period VARCHAR NOT NULL,
            created_at DATETIME NOT NULL,
            CONSTRAINT uq_user_weekly_availability_user_weekday_period UNIQUE (user_id, weekday, period),
            FOREIGN KEY(user_id) REFERENCES users (id)
        )
    """))
    await conn.execute(text("CREATE INDEX ix_user_weekly_availability_user_id ON user_weekly_availability (user_id)"))
    await conn.execute(text("""
        INSERT INTO user_weekly_availability (id, user_id, weekday, period, created_at)
        SELECT old.id || '-' || p.period, old.user_id, old.weekday, p.period, old.created_at
        FROM _uwa_old old
        CROSS JOIN (SELECT 'morning' AS period UNION ALL SELECT 'afternoon' UNION ALL SELECT 'evening') p
    """))
    await conn.execute(text("DROP TABLE _uwa_old"))
    print("[startup] user_weekly_availability: added period column (expanded existing blocks to all periods)")
```

Then call it inside `lifespan`, in the migrations block **before** `await conn.run_sync(Base.metadata.create_all)` (alongside the other `await _migrate_...(conn)` calls):

```python
        await _migrate_weekly_availability_add_period(conn)
```

- [ ] **Step 3: Write the migration tests**

Create `app/backend/tests/test_weekly_availability.py`:

```python
"""Period-level weekly availability — migration tests (standalone engine)."""

from __future__ import annotations

import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from main import _migrate_weekly_availability_add_period


@pytest_asyncio.fixture
async def raw_conn():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        yield conn
    await engine.dispose()


async def _old_table_with_row(conn):
    # The pre-period shape: one row per (user_id, weekday)
    await conn.execute(text("""
        CREATE TABLE user_weekly_availability (
            id VARCHAR NOT NULL PRIMARY KEY,
            user_id VARCHAR NOT NULL,
            weekday VARCHAR NOT NULL,
            created_at DATETIME NOT NULL,
            CONSTRAINT uq_user_weekly_availability_user_weekday UNIQUE (user_id, weekday)
        )
    """))
    await conn.execute(text(
        "INSERT INTO user_weekly_availability (id, user_id, weekday, created_at) "
        "VALUES ('row1', 'user-1', 'sunday', '2026-01-01 00:00:00')"
    ))


async def test_migration_expands_existing_block_to_three_periods(raw_conn):
    await _old_table_with_row(raw_conn)
    await _migrate_weekly_availability_add_period(raw_conn)

    rows = (await raw_conn.execute(text(
        "SELECT weekday, period FROM user_weekly_availability WHERE user_id = 'user-1' ORDER BY period"
    ))).fetchall()
    periods = sorted(r[1] for r in rows)
    assert {r[0] for r in rows} == {"sunday"}
    assert periods == ["afternoon", "evening", "morning"]


async def test_migration_is_idempotent(raw_conn):
    await _old_table_with_row(raw_conn)
    await _migrate_weekly_availability_add_period(raw_conn)
    await _migrate_weekly_availability_add_period(raw_conn)  # second run: period exists -> no-op
    count = (await raw_conn.execute(text("SELECT COUNT(*) FROM user_weekly_availability"))).scalar_one()
    assert count == 3  # not re-expanded


async def test_migration_noop_when_table_absent(raw_conn):
    # No user_weekly_availability table yet -> returns cleanly
    await _migrate_weekly_availability_add_period(raw_conn)
```

- [ ] **Step 4: Run the migration tests + import check**

Run: `cd app/backend ; python -m pytest tests/test_weekly_availability.py -q`
Expected: 3 passed.
Run: `cd app/backend ; python -c "import main ; from app.models.user_weekly_availability import PERIODS ; print(PERIODS)"`
Expected: prints `('morning', 'afternoon', 'evening')`.

- [ ] **Step 5: Commit**

```bash
git add app/backend/app/models/user_weekly_availability.py app/backend/main.py app/backend/tests/test_weekly_availability.py
git commit -m "feat(availability): period column on weekly availability + expand-existing migration"
```

---

## Task 2: Schemas

**Files:**
- Modify: `app/backend/app/schemas/user.py`

- [ ] **Step 1: Add `Period` and change the weekly schemas**

In `app/backend/app/schemas/user.py`, after the `Weekday` alias (line ~9) add:

```python
Period = Literal["morning", "afternoon", "evening"]
```

Replace the two weekly classes:

```python
class UserWeeklyAvailabilityUpdate(BaseModel):
    weekdays: list[Weekday] = Field(default_factory=list)


class UserWeeklyAvailabilityOut(BaseModel):
    weekdays: list[Weekday] = Field(default_factory=list)
```

with:

```python
class UserWeeklyAvailabilityUpdate(BaseModel):
    blocks: dict[Weekday, list[Period]] = Field(default_factory=dict)


class UserWeeklyAvailabilityOut(BaseModel):
    blocks: dict[Weekday, list[Period]] = Field(default_factory=dict)
```

(Leave `UserListItem.unavailable_weekdays: list[Weekday]` unchanged — the admin rollup keeps that shape.)

- [ ] **Step 2: Verify it imports**

Run: `cd app/backend ; python -c "from app.schemas.user import UserWeeklyAvailabilityOut, UserWeeklyAvailabilityUpdate, Period ; print('OK')"`
Expected: prints `OK`.

- [ ] **Step 3: Commit**

```bash
git add app/backend/app/schemas/user.py
git commit -m "feat(availability): blocks-map weekly schemas + Period literal"
```

---

## Task 3: Endpoints + admin rollup

**Files:**
- Modify: `app/backend/app/routers/users.py`
- Modify: `app/backend/tests/test_weekly_availability.py` (append endpoint/rollup tests)

- [ ] **Step 1: Append the failing endpoint tests**

Append to `app/backend/tests/test_weekly_availability.py`:

```python
# ── endpoint + admin rollup (use the shared client/db_session fixtures) ──

async def test_put_and_get_blocks_roundtrip(client):
    r = await client.put("/users/me/weekly-availability", json={
        "blocks": {"monday": ["morning"], "sunday": ["morning", "afternoon", "evening"]},
    })
    assert r.status_code == 200, r.text
    body = r.json()["blocks"]
    assert body["monday"] == ["morning"]
    assert body["sunday"] == ["morning", "afternoon", "evening"]

    got = (await client.get("/users/me/weekly-availability")).json()["blocks"]
    assert got["monday"] == ["morning"]
    assert sorted(got["sunday"]) == ["afternoon", "evening", "morning"]


async def test_put_replaces_previous(client):
    await client.put("/users/me/weekly-availability", json={"blocks": {"monday": ["morning", "evening"]}})
    await client.put("/users/me/weekly-availability", json={"blocks": {"monday": ["afternoon"]}})
    got = (await client.get("/users/me/weekly-availability")).json()["blocks"]
    assert got == {"monday": ["afternoon"]}


async def test_put_empty_clears(client):
    await client.put("/users/me/weekly-availability", json={"blocks": {"monday": ["morning"]}})
    await client.put("/users/me/weekly-availability", json={"blocks": {}})
    assert (await client.get("/users/me/weekly-availability")).json()["blocks"] == {}


async def test_put_rejects_bad_weekday_or_period(client):
    r1 = await client.put("/users/me/weekly-availability", json={"blocks": {"funday": ["morning"]}})
    assert r1.status_code == 422
    r2 = await client.put("/users/me/weekly-availability", json={"blocks": {"monday": ["midnight"]}})
    assert r2.status_code == 422


async def test_admin_rollup_full_day_only(client, db_session):
    # Seed a real crew user (the conftest mock-admin is NOT a DB row, so it won't appear
    # in GET /users) with all-3 Monday periods blocked + a partial Tuesday block.
    import uuid
    from datetime import datetime, timezone
    from app.models.user import User
    from app.models.user_weekly_availability import UserWeeklyAvailability

    uid = str(uuid.uuid4())
    db_session.add(User(
        id=uid, username="rollup-crew", credential_hash="x", role="crew",
        city_id="st-louis", is_active=True, created_at=datetime.now(timezone.utc),
    ))
    for period in ("morning", "afternoon", "evening"):
        db_session.add(UserWeeklyAvailability(user_id=uid, weekday="monday", period=period))
    db_session.add(UserWeeklyAvailability(user_id=uid, weekday="tuesday", period="morning"))
    await db_session.commit()

    users = (await client.get("/users")).json()
    me = next(u for u in users if u["username"] == "rollup-crew")
    assert "monday" in me["unavailable_weekdays"]      # all 3 periods -> full-day unavailable
    assert "tuesday" not in me["unavailable_weekdays"]  # only morning -> not full-day
```

> **Implementer note:** if `GET /users` is city-scoped or filtered (check `users.py` + existing `test_users.py`), seed the crew user in whatever city the conftest admin lists, and mirror how `test_users.py` seeds users so the new user actually appears in the response.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd app/backend ; python -m pytest tests/test_weekly_availability.py -q`
Expected: the 5 new endpoint tests FAIL (current endpoints still use the `weekdays` shape).

- [ ] **Step 3: Rewrite the endpoints in `users.py`**

Add `delete` to the SQLAlchemy import: change `from sqlalchemy import select` to `from sqlalchemy import delete, select`.

Add a period-order constant near `_WEEKDAY_ORDER`:

```python
_PERIOD_ORDER = ["morning", "afternoon", "evening"]
```

Add a small helper (near the weekly endpoints):

```python
def _blocks_from_rows(rows) -> dict[str, list[str]]:
    grouped: dict[str, set[str]] = {}
    for row in rows:
        grouped.setdefault(row.weekday, set()).add(row.period)
    return {
        day: [p for p in _PERIOD_ORDER if p in grouped[day]]
        for day in _WEEKDAY_ORDER if day in grouped
    }
```

Replace `get_my_weekly_availability` and `replace_my_weekly_availability` with:

```python
@router.get("/me/weekly-availability", response_model=UserWeeklyAvailabilityOut)
async def get_my_weekly_availability(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_auth),
):
    rows = (await db.execute(
        select(UserWeeklyAvailability).where(UserWeeklyAvailability.user_id == current_user.id)
    )).scalars().all()
    return UserWeeklyAvailabilityOut(blocks=_blocks_from_rows(rows))


@router.put("/me/weekly-availability", response_model=UserWeeklyAvailabilityOut)
async def replace_my_weekly_availability(
    data: UserWeeklyAvailabilityUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_auth),
):
    await db.execute(
        delete(UserWeeklyAvailability).where(UserWeeklyAvailability.user_id == current_user.id)
    )
    for weekday, periods in data.blocks.items():
        for period in dict.fromkeys(periods):  # dedup, preserve order
            db.add(UserWeeklyAvailability(user_id=current_user.id, weekday=weekday, period=period))
    await db.commit()

    rows = (await db.execute(
        select(UserWeeklyAvailability).where(UserWeeklyAvailability.user_id == current_user.id)
    )).scalars().all()
    return UserWeeklyAvailabilityOut(blocks=_blocks_from_rows(rows))
```

- [ ] **Step 4: Update the admin rollup in the user-list endpoint**

In the user-list endpoint, the weekly block currently builds `weekly_map: dict[str, set[str]]` (user → weekdays) and computes `unavailable_weekdays`. Replace that block:

```python
    weekly_result = await db.execute(
        select(UserWeeklyAvailability)
        .where(UserWeeklyAvailability.user_id.in_(user_ids))
    )
    weekly_map: dict[str, set[str]] = {user_id: set() for user_id in user_ids}
    for row in weekly_result.scalars().all():
        weekly_map.setdefault(row.user_id, set()).add(row.weekday)
```

with one that tracks periods per weekday and rolls up to full-day only:

```python
    weekly_result = await db.execute(
        select(UserWeeklyAvailability)
        .where(UserWeeklyAvailability.user_id.in_(user_ids))
    )
    # user_id -> weekday -> set(periods)
    weekly_periods: dict[str, dict[str, set[str]]] = {user_id: {} for user_id in user_ids}
    for row in weekly_result.scalars().all():
        weekly_periods.setdefault(row.user_id, {}).setdefault(row.weekday, set()).add(row.period)
```

and change the `unavailable_weekdays=...` line (a weekday qualifies only when all 3 periods are blocked):

```python
            unavailable_weekdays=[
                day for day in _WEEKDAY_ORDER
                if len(weekly_periods.get(user.id, {}).get(day, set())) == 3
            ],
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd app/backend ; python -m pytest tests/test_weekly_availability.py -q`
Expected: all passed (3 migration + 5 endpoint/rollup).

- [ ] **Step 6: Commit**

```bash
git add app/backend/app/routers/users.py app/backend/tests/test_weekly_availability.py
git commit -m "feat(availability): blocks-map GET/PUT + full-day-only admin rollup"
```

---

## Task 4: Frontend — the days×periods grid

**Files:**
- Modify: `app/frontend/src/services/api.ts`
- Modify: `app/frontend/src/hooks/useAvailability.ts`
- Modify: `app/frontend/src/screens/SettingsScreen.tsx`

- [ ] **Step 1: Update the API client types (`services/api.ts`)**

Replace the `WeeklyAvailability` type and `saveMyAvailability`:

```ts
export type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'
export type Period = 'morning' | 'afternoon' | 'evening'

export type WeeklyAvailability = {
  blocks: Partial<Record<Weekday, Period[]>>
}

export async function fetchMyAvailability(): Promise<WeeklyAvailability> {
  const r = await apiFetch('/users/me/weekly-availability')
  if (!r.ok) throw new Error('Failed to fetch availability')
  return r.json()
}

export async function saveMyAvailability(blocks: WeeklyAvailability['blocks']): Promise<WeeklyAvailability> {
  const r = await apiFetch('/users/me/weekly-availability', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blocks }),
  })
  if (!r.ok) throw new Error('Failed to save availability')
  return r.json()
}
```

(`useAvailability.ts` re-exports `WeeklyAvailability` and calls `saveMyAvailability` via the mutation — no change needed beyond the type flowing through; verify it still type-checks.)

- [ ] **Step 2: Rewrite the Settings availability grid (`SettingsScreen.tsx`)**

READ the current Availability `<section>` (around lines 238-294) and the related state/helpers (`weeklyAvailability` state ~line 82, the load effect ~line 134, `toggleWeekday` ~line 141, `handleSaveWeeklyAvailability` ~line 159, `formatWeekdayLabel`, `WEEKDAY_ORDER`).

Make these changes:

(a) Add a periods constant near `WEEKDAY_ORDER`:

```tsx
const PERIOD_ORDER = [
  { key: 'morning', label: 'Morning' },
  { key: 'afternoon', label: 'Afternoon' },
  { key: 'evening', label: 'Evening' },
] as const
type PeriodKey = typeof PERIOD_ORDER[number]['key']
```

(b) Change the state from `WeekdayKey[]` to a Set of `"weekday:period"` cell keys:

```tsx
const [blocked, setBlocked] = useState<Set<string>>(new Set())
```

(c) Replace the load effect:

```tsx
useEffect(() => {
  const next = new Set<string>()
  const blocks = availability?.blocks ?? {}
  for (const day of WEEKDAY_ORDER) {
    for (const period of blocks[day.key] ?? []) next.add(`${day.key}:${period}`)
  }
  setBlocked(next)
}, [availability])
```

(d) Replace `toggleWeekday` with a cell toggle:

```tsx
const toggleCell = (day: WeekdayKey, period: PeriodKey) => {
  const cell = `${day}:${period}`
  setBlocked(prev => {
    const next = new Set(prev)
    if (next.has(cell)) next.delete(cell)
    else next.add(cell)
    return next
  })
}

const blocksFromSet = (cells: Set<string>): Record<string, string[]> => {
  const out: Record<string, string[]> = {}
  for (const day of WEEKDAY_ORDER) {
    const periods = PERIOD_ORDER.filter(p => cells.has(`${day.key}:${p.key}`)).map(p => p.key)
    if (periods.length) out[day.key] = periods
  }
  return out
}
```

(e) Replace `handleSaveWeeklyAvailability`:

```tsx
const handleSaveWeeklyAvailability = () => {
  saveAvailability.mutate(blocksFromSet(blocked), {
    onSuccess: () => {
      setAvailabilitySaved(true)
      window.setTimeout(() => setAvailabilitySaved(false), 2000)
    },
  })
}
```

(f) Replace the grid markup (the `<div className="flex flex-wrap gap-2">…</div>` of day buttons) with a days×periods grid — each cell a ≥44px tap target:

```tsx
<div className="space-y-2">
  <div className="grid grid-cols-[3rem_repeat(3,1fr)] gap-1.5 text-center">
    <span />
    {PERIOD_ORDER.map(p => (
      <span key={p.key} className="text-[11px] font-medium text-gray-400">{p.label}</span>
    ))}
    {WEEKDAY_ORDER.map(day => (
      <FragmentRow key={day.key} day={day} blocked={blocked} onToggle={toggleCell} />
    ))}
  </div>
</div>
```

where `FragmentRow` is a small local component (define it above `SettingsScreen` or inline with `<>...</>`):

```tsx
function FragmentRow({
  day, blocked, onToggle,
}: {
  day: { key: WeekdayKey; label: string }
  blocked: Set<string>
  onToggle: (day: WeekdayKey, period: PeriodKey) => void
}) {
  return (
    <>
      <span className="flex items-center text-xs font-medium text-gray-600 dark:text-gray-300">{day.label}</span>
      {PERIOD_ORDER.map(p => {
        const on = blocked.has(`${day.key}:${p.key}`)
        return (
          <button
            key={p.key}
            type="button"
            aria-pressed={on}
            aria-label={`${day.label} ${p.label}`}
            onClick={() => onToggle(day.key, p.key)}
            className={`min-h-11 rounded-lg border text-xs font-medium transition-colors ${
              on
                ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200'
                : 'border-gray-200 bg-white text-gray-400 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600'
            }`}
          >
            {on ? 'Blocked' : '—'}
          </button>
        )
      })}
    </>
  )
}
```

(g) Update the "Clear all" button to `onClick={() => setBlocked(new Set())}` and `disabled={saveAvailability.isPending || blocked.size === 0}`.

(h) Replace the "Currently blocked" summary:

```tsx
{blocked.size > 0 && (
  <p className="text-xs text-gray-500 dark:text-gray-400">
    Currently blocked: {WEEKDAY_ORDER
      .map(day => {
        const periods = PERIOD_ORDER.filter(p => blocked.has(`${day.key}:${p.key}`))
        if (!periods.length) return null
        const label = periods.length === 3 ? 'all day' : periods.map(p => p.label.toLowerCase()).join(', ')
        return `${day.label} (${label})`
      })
      .filter(Boolean)
      .join('; ')}
  </p>
)}
```

(i) Remove the now-unused `weeklyAvailability` state, `toggleWeekday`, and `formatWeekdayLabel` if nothing else references them (verify with a search before deleting).

- [ ] **Step 3: Build**

Run: `cd app/frontend ; npm run build`
Expected: build succeeds, no TS errors.

- [ ] **Step 4: Commit**

```bash
git add app/frontend/src/services/api.ts app/frontend/src/hooks/useAvailability.ts app/frontend/src/screens/SettingsScreen.tsx
git commit -m "feat(availability): days x periods grid in Settings"
```

---

## Task 5: Docs + full suite green

**Files:**
- Modify: `CAPABILITIES.md`

- [ ] **Step 1: Run the full backend suite**

Run: `cd app/backend ; python -m pytest -q`
Expected: all passed (prior 322 + the 8 new weekly-availability tests). Diagnose any unrelated break.

- [ ] **Step 2: Update `CAPABILITIES.md`**

Note that weekly availability now supports per-period blocks (morning/afternoon/evening per weekday): `UserWeeklyAvailability` gained a `period` column (migration expands existing all-day blocks), `GET/PUT /users/me/weekly-availability` exchange a `{blocks: {weekday: [periods]}}` map, the admin rollup reports a weekday unavailable only when all three periods are blocked, and Settings shows a days×periods grid. Update the test count.

- [ ] **Step 3: Commit**

```bash
git add CAPABILITIES.md
git commit -m "docs(availability): capabilities + suite green"
```

---

## Self-Review Notes (addressed)

- **Spec coverage:** model+migration (T1), schemas (T2), GET/PUT + admin rollup (T3), frontend grid (T4), docs/suite (T5). Every spec section maps to a task.
- **Migration:** idempotent (guarded on the `period` column), expands existing rows via CROSS JOIN, recreates the index; tested standalone (T1) since the conftest DB is built fresh with the new shape.
- **Validation:** `dict[Weekday, list[Period]]` makes Pydantic reject unknown weekday/period with 422 — covered by `test_put_rejects_bad_weekday_or_period`.
- **Admin rollup:** `len(periods) == 3` full-day-only — covered by `test_admin_rollup_full_day_only`.
- **Type consistency:** `blocks: {weekday: [period]}` identical across schema, endpoints, tests, and the frontend `WeeklyAvailability` type; periods ordered via `_PERIOD_ORDER` / `PERIOD_ORDER`.
- **No non-ASCII in Python**; the frontend em-dash `—` is JSX text (browser UTF-8), not a Python string — fine.
