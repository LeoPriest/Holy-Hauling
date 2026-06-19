# Per-Job Checklist (Items to Bring) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give crew a per-booked-job "items to bring" checklist — seeded once from a configurable standard kit plus code-driven scope extras, then fully crew-editable — inside the job working modal, with an office-managed standard-kit editor in Settings.

**Architecture:** New `lead_checklist_item` child table + a `checklist_seeded_at` marker on `leads`. A `checklist_service` reads the standard kit (an `AppSetting`), computes scope extras, and seeds once. A `checklist` router exposes per-lead item CRUD + a settings kit GET/PUT. Frontend adds a `JobChecklist` (in the working modal, optimistic) and a `StandardKitEditor` (Settings, admin/facilitator).

**Tech Stack:** FastAPI + SQLAlchemy async (aiosqlite), Pydantic v2, pytest-asyncio (`asyncio_mode=auto`); React 18 + TS + Vite + Tailwind + TanStack Query. Frontend verification: `tsc && vite build` (no JS test runner).

**Reference spec:** `docs/superpowers/specs/2026-06-19-job-checklist-items-design.md`

---

## File Structure

**Backend**
- Create: `app/backend/app/models/lead_checklist_item.py` — the item table.
- Modify: `app/backend/app/models/lead.py` — `checklist_seeded_at` column + `checklist_items` relationship.
- Modify: `app/backend/main.py` — import the new model, add `_migrate_leads_add_checklist_seeded_at`, register it + include the router.
- Create: `app/backend/app/schemas/checklist.py` — request/response schemas.
- Create: `app/backend/app/services/checklist_service.py` — standard kit, scope rules, seeder.
- Create: `app/backend/app/routers/checklist.py` — per-lead item CRUD + settings kit endpoints.
- Create: `app/backend/tests/test_checklist.py` — service + endpoint tests.

**Frontend**
- Modify: `app/frontend/src/services/api.ts` — `ChecklistItem` / `StandardKit` types + fetchers.
- Create: `app/frontend/src/hooks/useChecklist.ts` — query + optimistic mutations.
- Create: `app/frontend/src/hooks/useStandardKit.ts` — kit query + save mutation.
- Create: `app/frontend/src/components/JobChecklist.tsx` — the in-modal checklist.
- Create: `app/frontend/src/components/StandardKitEditor.tsx` — the Settings editor.
- Modify: `app/frontend/src/screens/JobsScreen.tsx` — mount `<JobChecklist>` in `JobModal`.
- Modify: `app/frontend/src/screens/SettingsScreen.tsx` — mount `<StandardKitEditor>` for admin/facilitator.

---

## Task 1: Backend model + migration

**Files:**
- Create: `app/backend/app/models/lead_checklist_item.py`
- Modify: `app/backend/app/models/lead.py`
- Modify: `app/backend/main.py`

- [ ] **Step 1: Create the model**

Create `app/backend/app/models/lead_checklist_item.py`:

```python
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base


class LeadChecklistItem(Base):
    __tablename__ = "lead_checklist_items"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    lead_id = Column(String, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False)
    label = Column(String, nullable=False)
    is_checked = Column(Boolean, nullable=False, default=False)
    source = Column(String, nullable=False, default="custom")  # standard | scope | custom
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))

    lead = relationship("Lead", back_populates="checklist_items")
```

- [ ] **Step 2: Add the column + relationship to `Lead`**

In `app/backend/app/models/lead.py`, add the marker column near the other timestamp columns (after `updated_at` around line 98):

```python
    checklist_seeded_at = Column(DateTime, nullable=True)
```

And add the relationship right after the `pay_records` relationship (line 121):

```python
    checklist_items = relationship(
        "LeadChecklistItem",
        back_populates="lead",
        order_by="LeadChecklistItem.sort_order",
        lazy="select",
        cascade="all, delete-orphan",
    )
```

- [ ] **Step 3: Register the model in `main.py`**

In `app/backend/main.py`, add this import alongside the other model imports (after `import app.models.quote_suggestion_log  # noqa: F401` at line 44):

```python
import app.models.lead_checklist_item  # noqa: F401
```

- [ ] **Step 4: Add the migration function**

In `app/backend/main.py`, add a migration near the other `_migrate_leads_*` functions (e.g. after `_migrate_users_add_hourly_rate_cents`):

```python
async def _migrate_leads_add_checklist_seeded_at(conn) -> None:
    """Add the checklist_seeded_at marker column to leads. Idempotent."""
    result = await conn.execute(text("PRAGMA table_info(leads)"))
    rows = result.fetchall()
    if not rows:
        return
    if "checklist_seeded_at" in _existing_columns(rows):
        return
    await conn.execute(text("ALTER TABLE leads ADD COLUMN checklist_seeded_at DATETIME"))
    print("[startup] leads: added checklist_seeded_at column")
```

- [ ] **Step 5: Register the migration in the lifespan**

In `app/backend/main.py`, the lifespan runs migrations inside `async with engine.begin() as conn:` then calls `create_all`. Add the call just before `await conn.run_sync(Base.metadata.create_all)` (line 595), after `await _migrate_weekly_availability_add_period(conn)`:

```python
        await _migrate_leads_add_checklist_seeded_at(conn)
```

The new `lead_checklist_items` table itself is created by `create_all` (model now imported) — no DDL needed for it.

- [ ] **Step 6: Verify import + app boot**

Run: `cd app/backend && python -c "import main; print('ok')"`
Expected: prints `ok` (model + migration import cleanly; no SQLAlchemy mapper errors).

- [ ] **Step 7: Commit**

```bash
git add app/backend/app/models/lead_checklist_item.py app/backend/app/models/lead.py app/backend/main.py
git commit -m "feat(checklist): lead_checklist_item model + checklist_seeded_at migration"
```

---

## Task 2: Backend schemas

**Files:**
- Create: `app/backend/app/schemas/checklist.py`

- [ ] **Step 1: Create the schemas**

Create `app/backend/app/schemas/checklist.py`:

```python
from __future__ import annotations

from pydantic import BaseModel


class ChecklistItemOut(BaseModel):
    id: str
    lead_id: str
    label: str
    is_checked: bool
    source: str
    sort_order: int
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}


class ChecklistItemCreate(BaseModel):
    label: str


class ChecklistItemUpdate(BaseModel):
    is_checked: bool | None = None
    label: str | None = None


class StandardKitOut(BaseModel):
    items: list[str]


class StandardKitUpdate(BaseModel):
    items: list[str]
```

- [ ] **Step 2: Import check**

Run: `cd app/backend && python -c "from app.schemas.checklist import ChecklistItemOut, ChecklistItemCreate, ChecklistItemUpdate, StandardKitOut, StandardKitUpdate; print('ok')"`
Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add app/backend/app/schemas/checklist.py
git commit -m "feat(checklist): request/response schemas"
```

---

## Task 3: Backend service — standard kit, scope rules, seeder

**Files:**
- Create: `app/backend/app/services/checklist_service.py`
- Test: `app/backend/tests/test_checklist.py` (created here; extended in Task 4)

- [ ] **Step 1: Write the failing unit tests for the pure scope logic + seeding**

Create `app/backend/tests/test_checklist.py` with the service-level tests. `scope_items` is pure (in-memory `Lead`, no DB). Seeding tests use the `client`/`db_session` fixtures from `conftest.py`.

```python
from __future__ import annotations

from datetime import datetime, timezone

from app.models.lead import Lead, LeadSourceType, LeadStatus, ServiceType
from app.models.lead_checklist_item import LeadChecklistItem
from app.services import checklist_service


def _lead(**kw) -> Lead:
    base = dict(
        id="lead-x",
        source_type=LeadSourceType.manual,
        status=LeadStatus.booked,
        service_type=ServiceType.unknown,
        urgency_flag=False,
        city_id="st-louis",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    base.update(kw)
    return Lead(**base)


def test_scope_items_moving_adds_mattress_and_wardrobe():
    items = checklist_service.scope_items(_lead(service_type=ServiceType.moving))
    assert "Mattress bags" in items
    assert "Wardrobe boxes" in items
    assert "Contractor/disposal bags" not in items


def test_scope_items_hauling_adds_disposal_and_bins():
    items = checklist_service.scope_items(_lead(service_type=ServiceType.hauling))
    assert "Contractor/disposal bags" in items
    assert "Junk bins" in items
    assert "Mattress bags" not in items


def test_scope_items_both_adds_both_families():
    items = checklist_service.scope_items(_lead(service_type=ServiceType.both))
    assert "Mattress bags" in items
    assert "Junk bins" in items


def test_scope_items_stairs_adds_stair_dolly():
    items = checklist_service.scope_items(_lead(load_stairs=0, unload_stairs=2))
    assert "Stair-climbing hand truck" in items
    assert "Extra straps" in items
    no_stairs = checklist_service.scope_items(_lead(load_stairs=0, unload_stairs=0))
    assert "Stair-climbing hand truck" not in no_stairs


def test_scope_items_large_move_adds_blankets():
    assert "Extra blankets (large move)" in checklist_service.scope_items(_lead(move_size_label="4 bedroom house"))
    assert "Extra blankets (large move)" in checklist_service.scope_items(_lead(move_size_label="Whole house"))
    assert "Extra blankets (large move)" not in checklist_service.scope_items(_lead(move_size_label="Studio"))


def test_scope_items_truck_unless_labor_or_customer():
    assert "Company truck — fuel & equipment check" in checklist_service.scope_items(_lead(move_type="our_truck"))
    assert "Company truck — fuel & equipment check" in checklist_service.scope_items(_lead(move_type=None))
    assert "Company truck — fuel & equipment check" not in checklist_service.scope_items(_lead(move_type="labor_only"))
    assert "Company truck — fuel & equipment check" not in checklist_service.scope_items(_lead(move_type="customer_truck"))


async def test_get_standard_kit_defaults_when_unset(db_session):
    kit = await checklist_service.get_standard_kit(db_session, "st-louis")
    assert kit == checklist_service.DEFAULT_STANDARD_KIT


async def test_set_then_get_standard_kit_roundtrips(db_session):
    saved = await checklist_service.set_standard_kit(db_session, ["Dolly", "Straps", "  ", "Dolly"], "st-louis")
    assert saved == ["Dolly", "Straps"]  # blanks + dups removed
    assert await checklist_service.get_standard_kit(db_session, "st-louis") == ["Dolly", "Straps"]


async def _make_booked_lead(factory, **kw) -> str:
    from app.models.lead import Lead
    async with factory() as s:
        lead = Lead(
            source_type=LeadSourceType.manual,
            status=LeadStatus.booked,
            service_type=kw.get("service_type", ServiceType.moving),
            urgency_flag=False,
            customer_name="Seed Test",
            city_id="st-louis",
            load_stairs=kw.get("load_stairs"),
            unload_stairs=kw.get("unload_stairs"),
            move_size_label=kw.get("move_size_label"),
            move_type=kw.get("move_type"),
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        s.add(lead)
        await s.commit()
        await s.refresh(lead)
        return lead.id


async def _count_items(factory, lead_id) -> int:
    from sqlalchemy import select
    async with factory() as s:
        r = await s.execute(select(LeadChecklistItem).where(LeadChecklistItem.lead_id == lead_id))
        return len(r.scalars().all())


async def test_seed_checklist_is_idempotent(client, db_session):
    from main import app
    factory = app.state.test_session_factory
    lead_id = await _make_booked_lead(factory, service_type=ServiceType.moving, unload_stairs=1)

    from sqlalchemy import select
    async with factory() as s:
        lead = (await s.execute(select(Lead).where(Lead.id == lead_id))).scalar_one()
        await checklist_service.seed_checklist(s, lead)
    first = await _count_items(factory, lead_id)
    assert first > 0

    # second seed is a no-op even after deleting an item
    async with factory() as s:
        items = (await s.execute(select(LeadChecklistItem).where(LeadChecklistItem.lead_id == lead_id))).scalars().all()
        await s.delete(items[0])
        await s.commit()
    async with factory() as s:
        lead = (await s.execute(select(Lead).where(Lead.id == lead_id))).scalar_one()
        await checklist_service.seed_checklist(s, lead)
    assert await _count_items(factory, lead_id) == first - 1  # not re-seeded


async def test_seed_dedupes_standard_and_scope(client, db_session):
    from main import app
    from sqlalchemy import select
    factory = app.state.test_session_factory
    # Put a scope label into the standard kit so it would collide
    await checklist_service.set_standard_kit(db_session, ["Mattress bags", "Hand truck"], "st-louis")
    lead_id = await _make_booked_lead(factory, service_type=ServiceType.moving)
    async with factory() as s:
        lead = (await s.execute(select(Lead).where(Lead.id == lead_id))).scalar_one()
        await checklist_service.seed_checklist(s, lead)
    async with factory() as s:
        labels = [i.label for i in (await s.execute(
            select(LeadChecklistItem).where(LeadChecklistItem.lead_id == lead_id))).scalars().all()]
    assert labels.count("Mattress bags") == 1
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app/backend && python -m pytest tests/test_checklist.py -v`
Expected: FAIL — `AttributeError`/`ModuleNotFoundError` (`checklist_service` doesn't exist yet).

- [ ] **Step 3: Implement the service**

Create `app/backend/app/services/checklist_service.py`:

```python
from __future__ import annotations

import json
import re
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_setting import AppSetting
from app.models.city import DEFAULT_CITY_ID
from app.models.lead import Lead, ServiceType
from app.models.lead_checklist_item import LeadChecklistItem

_KIT_KEY = "checklist_standard_kit"

DEFAULT_STANDARD_KIT = [
    "Moving blankets",
    "Furniture dolly",
    "Hand truck",
    "Ratchet straps",
    "Shrink wrap",
    "Packing tape",
    "Basic tool kit",
    "Floor runners",
    "Work gloves",
]

_LARGE_MOVE_RE = re.compile(r"(\d+)\s*\+?\s*bed")


def _dedupe_preserve_order(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for raw in items:
        label = str(raw).strip()
        key = label.lower()
        if not label or key in seen:
            continue
        seen.add(key)
        out.append(label)
    return out


async def get_standard_kit(db: AsyncSession, city_id: str = DEFAULT_CITY_ID) -> list[str]:
    result = await db.execute(
        select(AppSetting).where(AppSetting.key == _KIT_KEY, AppSetting.city_id == city_id)
    )
    row = result.scalar_one_or_none()
    if row is None or not row.value:
        return list(DEFAULT_STANDARD_KIT)
    try:
        items = json.loads(row.value)
    except (ValueError, TypeError):
        return list(DEFAULT_STANDARD_KIT)
    if not isinstance(items, list):
        return list(DEFAULT_STANDARD_KIT)
    cleaned = _dedupe_preserve_order(items)
    return cleaned or list(DEFAULT_STANDARD_KIT)


async def set_standard_kit(db: AsyncSession, items: list[str], city_id: str = DEFAULT_CITY_ID) -> list[str]:
    cleaned = _dedupe_preserve_order(items)
    value = json.dumps(cleaned)
    result = await db.execute(
        select(AppSetting).where(AppSetting.key == _KIT_KEY, AppSetting.city_id == city_id)
    )
    row = result.scalar_one_or_none()
    if row:
        row.value = value
    else:
        db.add(AppSetting(key=_KIT_KEY, city_id=city_id, value=value))
    await db.commit()
    return cleaned


def _has_stairs(lead: Lead) -> bool:
    return (lead.load_stairs or 0) > 0 or (lead.unload_stairs or 0) > 0


def _is_large_move(lead: Lead) -> bool:
    label = (lead.move_size_label or "").lower()
    if "house" in label:
        return True
    m = _LARGE_MOVE_RE.search(label)
    return bool(m and int(m.group(1)) >= 3)


def _brings_truck(lead: Lead) -> bool:
    move_type = (lead.move_type or "").lower()
    if "labor" in move_type or "customer" in move_type:
        return False
    return True


def scope_items(lead: Lead) -> list[str]:
    items: list[str] = []
    service_type = lead.service_type
    if service_type in (ServiceType.moving, ServiceType.both):
        items += ["Mattress bags", "Wardrobe boxes"]
    if service_type in (ServiceType.hauling, ServiceType.both):
        items += ["Contractor/disposal bags", "Junk bins"]
    if _has_stairs(lead):
        items += ["Stair-climbing hand truck", "Extra straps"]
    if _is_large_move(lead):
        items.append("Extra blankets (large move)")
    if _brings_truck(lead):
        items.append("Company truck — fuel & equipment check")
    return items


async def seed_checklist(db: AsyncSession, lead: Lead) -> None:
    if lead.checklist_seeded_at is not None:
        return
    kit = await get_standard_kit(db, lead.city_id or DEFAULT_CITY_ID)
    seen: set[str] = set()
    ordered: list[tuple[str, str]] = []  # (label, source)
    for label in kit:
        key = label.strip().lower()
        if not label.strip() or key in seen:
            continue
        seen.add(key)
        ordered.append((label.strip(), "standard"))
    for label in scope_items(lead):
        key = label.strip().lower()
        if key in seen:
            continue
        seen.add(key)
        ordered.append((label.strip(), "scope"))
    for index, (label, source) in enumerate(ordered):
        db.add(LeadChecklistItem(lead_id=lead.id, label=label, source=source, sort_order=index))
    lead.checklist_seeded_at = datetime.now(timezone.utc)
    await db.commit()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app/backend && python -m pytest tests/test_checklist.py -v`
Expected: all service tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/backend/app/services/checklist_service.py app/backend/tests/test_checklist.py
git commit -m "feat(checklist): standard-kit config, scope rules, idempotent seeder"
```

---

## Task 4: Backend router — item CRUD + kit settings

**Files:**
- Create: `app/backend/app/routers/checklist.py`
- Modify: `app/backend/main.py` (import + include_router)
- Test: `app/backend/tests/test_checklist.py` (append endpoint tests)

- [ ] **Step 1: Append the failing endpoint tests**

Append to `app/backend/tests/test_checklist.py`:

```python
# --- Endpoint tests ----------------------------------------------------------

async def _create_booked_lead_via_api(client, **patch) -> str:
    r = await client.post("/leads", json={
        "source_type": "manual",
        "customer_name": "Checklist Test",
        "service_type": patch.get("service_type", "moving"),
    })
    assert r.status_code == 201
    lead_id = r.json()["id"]
    body = {"status": "booked"}
    for k in ("load_stairs", "unload_stairs", "move_size_label", "move_type"):
        if k in patch:
            body[k] = patch[k]
    r2 = await client.patch(f"/leads/{lead_id}", json=body)
    assert r2.status_code == 200
    return lead_id


async def test_get_checklist_seeds_on_first_call_for_booked(client):
    lead_id = await _create_booked_lead_via_api(client, service_type="moving", unload_stairs=1)
    r = await client.get(f"/leads/{lead_id}/checklist")
    assert r.status_code == 200
    items = r.json()
    labels = [i["label"] for i in items]
    assert "Moving blankets" in labels          # standard
    assert "Stair-climbing hand truck" in labels  # scope (stairs)
    # ordered by sort_order
    assert [i["sort_order"] for i in items] == sorted(i["sort_order"] for i in items)
    # idempotent: second GET returns the same count
    r2 = await client.get(f"/leads/{lead_id}/checklist")
    assert len(r2.json()) == len(items)


async def test_get_checklist_does_not_seed_non_booked(client):
    r = await client.post("/leads", json={
        "source_type": "manual", "customer_name": "New Lead", "service_type": "moving",
    })
    lead_id = r.json()["id"]  # status defaults to "new", not booked
    r2 = await client.get(f"/leads/{lead_id}/checklist")
    assert r2.status_code == 200
    assert r2.json() == []


async def test_add_checklist_item_appends_custom(client):
    lead_id = await _create_booked_lead_via_api(client)
    before = await client.get(f"/leads/{lead_id}/checklist")
    r = await client.post(f"/leads/{lead_id}/checklist", json={"label": "Cash box"})
    assert r.status_code == 200
    item = r.json()
    assert item["label"] == "Cash box"
    assert item["source"] == "custom"
    assert item["sort_order"] == max(i["sort_order"] for i in before.json()) + 1


async def test_add_blank_label_rejected(client):
    lead_id = await _create_booked_lead_via_api(client)
    r = await client.post(f"/leads/{lead_id}/checklist", json={"label": "   "})
    assert r.status_code == 422


async def test_patch_toggles_checked(client):
    lead_id = await _create_booked_lead_via_api(client)
    items = (await client.get(f"/leads/{lead_id}/checklist")).json()
    item_id = items[0]["id"]
    r = await client.patch(f"/leads/{lead_id}/checklist/{item_id}", json={"is_checked": True})
    assert r.status_code == 200
    assert r.json()["is_checked"] is True


async def test_patch_missing_item_404(client):
    lead_id = await _create_booked_lead_via_api(client)
    r = await client.patch(f"/leads/{lead_id}/checklist/nope", json={"is_checked": True})
    assert r.status_code == 404


async def test_delete_item(client):
    lead_id = await _create_booked_lead_via_api(client)
    items = (await client.get(f"/leads/{lead_id}/checklist")).json()
    item_id = items[0]["id"]
    r = await client.delete(f"/leads/{lead_id}/checklist/{item_id}")
    assert r.status_code == 200
    assert r.json() == {"deleted": True}
    after = (await client.get(f"/leads/{lead_id}/checklist")).json()
    assert item_id not in [i["id"] for i in after]


async def test_get_kit_returns_default(client):
    r = await client.get("/settings/checklist-kit")
    assert r.status_code == 200
    assert r.json()["items"] == checklist_service.DEFAULT_STANDARD_KIT


async def test_put_kit_persists_as_admin(client):
    r = await client.put("/settings/checklist-kit", json={"items": ["Dolly", "Straps"]})
    assert r.status_code == 200
    assert r.json()["items"] == ["Dolly", "Straps"]
    assert (await client.get("/settings/checklist-kit")).json()["items"] == ["Dolly", "Straps"]
```

Append a crew-forbidden test using a crew-auth override (mirrors the `crew_client` pattern; put this fixture + test at the end of the file):

```python
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.database import Base, get_db
from app.dependencies import require_auth
from app.models.user import User

_TEST_DB = "sqlite+aiosqlite:///:memory:"


def _mock_crew() -> User:
    return User(
        id="mock-crew", username="mock-crew", credential_hash="x",
        role="crew", city_id="st-louis", is_active=True,
        created_at=datetime.now(timezone.utc),
    )


@pytest_asyncio.fixture
async def crew_client():
    from main import app
    engine = create_async_engine(_TEST_DB)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async def override_get_db():
        async with Factory() as s:
            yield s

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[require_auth] = _mock_crew
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


async def test_put_kit_forbidden_for_crew(crew_client):
    r = await crew_client.put("/settings/checklist-kit", json={"items": ["X"]})
    assert r.status_code == 403
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `cd app/backend && python -m pytest tests/test_checklist.py -k "checklist_item or kit or seeds or toggle or delete" -v`
Expected: FAIL — routes return 404 (router not mounted yet).

- [ ] **Step 3: Implement the router**

Create `app/backend/app/routers/checklist.py`:

```python
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import city_for_create, require_auth, require_role
from app.models.lead import Lead, LeadStatus
from app.models.lead_checklist_item import LeadChecklistItem
from app.models.user import User
from app.schemas.checklist import (
    ChecklistItemCreate,
    ChecklistItemOut,
    ChecklistItemUpdate,
    StandardKitOut,
    StandardKitUpdate,
)
from app.services import checklist_service

router = APIRouter(tags=["checklist"])
lead_router = APIRouter(prefix="/leads/{lead_id}/checklist")
kit_router = APIRouter(prefix="/settings")


def _item_out(item: LeadChecklistItem) -> ChecklistItemOut:
    return ChecklistItemOut.model_validate({
        "id": item.id,
        "lead_id": item.lead_id,
        "label": item.label,
        "is_checked": item.is_checked,
        "source": item.source,
        "sort_order": item.sort_order,
        "created_at": item.created_at.isoformat(),
        "updated_at": item.updated_at.isoformat(),
    })


async def _load_lead(db: AsyncSession, lead_id: str) -> Lead:
    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead


@lead_router.get("", response_model=list[ChecklistItemOut])
async def get_checklist(
    lead_id: str,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_auth),
):
    lead = await _load_lead(db, lead_id)
    if lead.checklist_seeded_at is None and lead.status == LeadStatus.booked:
        await checklist_service.seed_checklist(db, lead)
    result = await db.execute(
        select(LeadChecklistItem)
        .where(LeadChecklistItem.lead_id == lead_id)
        .order_by(LeadChecklistItem.sort_order, LeadChecklistItem.created_at)
    )
    return [_item_out(i) for i in result.scalars().all()]


@lead_router.post("", response_model=ChecklistItemOut)
async def add_checklist_item(
    lead_id: str,
    data: ChecklistItemCreate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_auth),
):
    label = data.label.strip()
    if not label:
        raise HTTPException(status_code=422, detail="label must not be blank")
    await _load_lead(db, lead_id)
    result = await db.execute(
        select(LeadChecklistItem).where(LeadChecklistItem.lead_id == lead_id)
    )
    existing = result.scalars().all()
    next_order = max((i.sort_order for i in existing), default=-1) + 1
    item = LeadChecklistItem(lead_id=lead_id, label=label, source="custom", sort_order=next_order)
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return _item_out(item)


@lead_router.patch("/{item_id}", response_model=ChecklistItemOut)
async def update_checklist_item(
    lead_id: str,
    item_id: str,
    data: ChecklistItemUpdate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_auth),
):
    result = await db.execute(
        select(LeadChecklistItem).where(
            LeadChecklistItem.id == item_id,
            LeadChecklistItem.lead_id == lead_id,
        )
    )
    item = result.scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="Checklist item not found")
    if data.is_checked is not None:
        item.is_checked = data.is_checked
    if data.label is not None:
        new_label = data.label.strip()
        if not new_label:
            raise HTTPException(status_code=422, detail="label must not be blank")
        item.label = new_label
    item.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(item)
    return _item_out(item)


@lead_router.delete("/{item_id}", status_code=200)
async def delete_checklist_item(
    lead_id: str,
    item_id: str,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_auth),
):
    result = await db.execute(
        select(LeadChecklistItem).where(
            LeadChecklistItem.id == item_id,
            LeadChecklistItem.lead_id == lead_id,
        )
    )
    item = result.scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="Checklist item not found")
    await db.delete(item)
    await db.commit()
    return {"deleted": True}


@kit_router.get("/checklist-kit", response_model=StandardKitOut)
async def get_checklist_kit(
    city_id: str | None = None,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    resolved = city_for_create(current_user, city_id)
    items = await checklist_service.get_standard_kit(db, resolved)
    return StandardKitOut(items=items)


@kit_router.put("/checklist-kit", response_model=StandardKitOut)
async def put_checklist_kit(
    data: StandardKitUpdate,
    city_id: str | None = None,
    current_user: User = Depends(require_role("admin", "facilitator")),
    db: AsyncSession = Depends(get_db),
):
    resolved = city_for_create(current_user, city_id)
    items = await checklist_service.set_standard_kit(db, data.items, resolved)
    return StandardKitOut(items=items)


router.include_router(lead_router)
router.include_router(kit_router)
```

- [ ] **Step 4: Register the router in `main.py`**

Add `checklist` to the routers import line (line 47, the `from app.routers import ...` list) and include it with the other `app.include_router(...)` calls (e.g. after `app.include_router(payroll.router)`):

```python
app.include_router(checklist.router)
```

- [ ] **Step 5: Run the checklist tests, then the full suite**

Run: `cd app/backend && python -m pytest tests/test_checklist.py -v`
Expected: all checklist tests PASS.

Run: `cd app/backend && python -m pytest -q`
Expected: full suite green (baseline 341 + new checklist tests), 0 failures. Report exact counts.

- [ ] **Step 6: Commit**

```bash
git add app/backend/app/routers/checklist.py app/backend/main.py app/backend/tests/test_checklist.py
git commit -m "feat(checklist): per-lead item CRUD + standard-kit settings endpoints"
```

---

## Task 5: Frontend — API types, fetchers, and hooks

**Files:**
- Modify: `app/frontend/src/services/api.ts`
- Create: `app/frontend/src/hooks/useChecklist.ts`
- Create: `app/frontend/src/hooks/useStandardKit.ts`

- [ ] **Step 1: Add types + fetchers to `api.ts`**

Append to `app/frontend/src/services/api.ts` (match the file's no-semicolon, single-quote style):

```ts
export interface ChecklistItem {
  id: string
  lead_id: string
  label: string
  is_checked: boolean
  source: 'standard' | 'scope' | 'custom'
  sort_order: number
  created_at: string
  updated_at: string
}

export interface StandardKit {
  items: string[]
}

export async function getStandardKit(): Promise<StandardKit> {
  const r = await apiFetch('/settings/checklist-kit')
  if (!r.ok) throw new Error('Failed to load standard kit')
  return r.json()
}

export async function putStandardKit(items: string[]): Promise<StandardKit> {
  const r = await apiFetch('/settings/checklist-kit', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  })
  if (!r.ok) throw new Error('Failed to save standard kit')
  return r.json()
}
```

- [ ] **Step 2: Create `useChecklist.ts`**

Create `app/frontend/src/hooks/useChecklist.ts`. Toggle and delete are optimistic with rollback; add invalidates on success (the input's pending/disabled state and an error message provide the in-progress/failure signals).

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../services/api'
import type { ChecklistItem } from '../services/api'

const keyFor = (leadId: string) => ['checklist', leadId]

export function useChecklist(leadId: string | null) {
  return useQuery<ChecklistItem[]>({
    queryKey: ['checklist', leadId],
    enabled: !!leadId,
    queryFn: async () => {
      const r = await apiFetch(`/leads/${leadId}/checklist`)
      if (!r.ok) throw new Error('Failed to load checklist')
      return r.json()
    },
  })
}

export function useToggleChecklistItem(leadId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ itemId, isChecked }: { itemId: string; isChecked: boolean }) => {
      const r = await apiFetch(`/leads/${leadId}/checklist/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_checked: isChecked }),
      })
      if (!r.ok) throw new Error('Failed to update item')
      return r.json() as Promise<ChecklistItem>
    },
    onMutate: async ({ itemId, isChecked }) => {
      await qc.cancelQueries({ queryKey: keyFor(leadId) })
      const prev = qc.getQueryData<ChecklistItem[]>(keyFor(leadId))
      qc.setQueryData<ChecklistItem[]>(keyFor(leadId), old =>
        (old ?? []).map(i => (i.id === itemId ? { ...i, is_checked: isChecked } : i)))
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(keyFor(leadId), ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keyFor(leadId) }),
  })
}

export function useAddChecklistItem(leadId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (label: string) => {
      const r = await apiFetch(`/leads/${leadId}/checklist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      })
      if (!r.ok) throw new Error('Failed to add item')
      return r.json() as Promise<ChecklistItem>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keyFor(leadId) }),
  })
}

export function useDeleteChecklistItem(leadId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (itemId: string) => {
      const r = await apiFetch(`/leads/${leadId}/checklist/${itemId}`, { method: 'DELETE' })
      if (!r.ok) throw new Error('Failed to delete item')
      return r.json()
    },
    onMutate: async (itemId: string) => {
      await qc.cancelQueries({ queryKey: keyFor(leadId) })
      const prev = qc.getQueryData<ChecklistItem[]>(keyFor(leadId))
      qc.setQueryData<ChecklistItem[]>(keyFor(leadId), old => (old ?? []).filter(i => i.id !== itemId))
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(keyFor(leadId), ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keyFor(leadId) }),
  })
}
```

- [ ] **Step 3: Create `useStandardKit.ts`**

Create `app/frontend/src/hooks/useStandardKit.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getStandardKit, putStandardKit, type StandardKit } from '../services/api'

export function useStandardKit() {
  return useQuery<StandardKit>({
    queryKey: ['standard-kit'],
    queryFn: getStandardKit,
  })
}

export function useSaveStandardKit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (items: string[]) => putStandardKit(items),
    onSuccess: data => qc.setQueryData(['standard-kit'], data),
  })
}
```

- [ ] **Step 4: Type-check**

Run: `cd app/frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/frontend/src/services/api.ts app/frontend/src/hooks/useChecklist.ts app/frontend/src/hooks/useStandardKit.ts
git commit -m "feat(checklist): frontend types, fetchers, checklist + kit hooks"
```

---

## Task 6: Frontend — `JobChecklist` in the working modal

**Files:**
- Create: `app/frontend/src/components/JobChecklist.tsx`
- Modify: `app/frontend/src/screens/JobsScreen.tsx`

- [ ] **Step 1: Create the component**

Create `app/frontend/src/components/JobChecklist.tsx`:

```tsx
import { useState } from 'react'
import {
  useChecklist,
  useToggleChecklistItem,
  useAddChecklistItem,
  useDeleteChecklistItem,
} from '../hooks/useChecklist'
import type { ChecklistItem } from '../services/api'

function Tag({ source }: { source: ChecklistItem['source'] }) {
  if (source === 'standard') return null
  const label = source === 'scope' ? 'scope' : 'added'
  const cls = source === 'scope'
    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200'
    : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300'
  return (
    <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {label}
    </span>
  )
}

function Row({
  item, onToggle, onDelete,
}: {
  item: ChecklistItem
  onToggle: (item: ChecklistItem) => void
  onDelete: (item: ChecklistItem) => void
}) {
  return (
    <div className="flex min-h-11 items-center gap-3 border-t border-gray-100 py-1.5 first:border-t-0 dark:border-gray-700">
      <button
        type="button"
        aria-pressed={item.is_checked}
        aria-label={`${item.is_checked ? 'Uncheck' : 'Check'} ${item.label}`}
        onClick={() => onToggle(item)}
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 text-sm transition-colors ${
          item.is_checked
            ? 'border-emerald-500 bg-emerald-500 text-white'
            : 'border-gray-300 text-transparent dark:border-gray-600'
        }`}
      >
        ✓
      </button>
      <span className={`min-w-0 flex-1 truncate ${item.is_checked ? 'text-gray-400 line-through dark:text-gray-500' : 'text-gray-900 dark:text-white'}`}>
        {item.label}
        <Tag source={item.source} />
      </span>
      <button
        type="button"
        aria-label={`Delete ${item.label}`}
        onClick={() => onDelete(item)}
        className="shrink-0 px-2 text-gray-400 hover:text-red-500"
      >
        ✕
      </button>
    </div>
  )
}

export function JobChecklist({ leadId }: { leadId: string }) {
  const { data, isLoading, isError } = useChecklist(leadId)
  const toggle = useToggleChecklistItem(leadId)
  const add = useAddChecklistItem(leadId)
  const remove = useDeleteChecklistItem(leadId)
  const [newLabel, setNewLabel] = useState('')

  const items = data ?? []
  const checked = items.filter(i => i.is_checked).length
  const total = items.length
  const pct = total > 0 ? Math.round((checked / total) * 100) : 0

  const submitAdd = () => {
    const label = newLabel.trim()
    if (!label) return
    add.mutate(label, { onSuccess: () => setNewLabel('') })
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Items to bring</p>
        {total > 0 && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">{checked}</span>/{total} packed
          </span>
        )}
      </div>

      {total > 0 && (
        <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}

      {isLoading && <p className="py-2 text-sm text-gray-500 dark:text-gray-400">Loading…</p>}
      {isError && <p className="py-2 text-sm text-amber-600 dark:text-amber-400">Couldn't load the checklist.</p>}

      {!isLoading && !isError && total === 0 && (
        <p className="py-2 text-sm text-gray-500 dark:text-gray-400">No items — add what you need below.</p>
      )}

      {items.map(item => (
        <Row
          key={item.id}
          item={item}
          onToggle={i => toggle.mutate({ itemId: i.id, isChecked: !i.is_checked })}
          onDelete={i => remove.mutate(i.id)}
        />
      ))}

      <div className="flex items-center gap-2 pt-1">
        <input
          value={newLabel}
          onChange={e => setNewLabel(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submitAdd() }}
          placeholder="Add an item…"
          className="min-h-11 flex-1 rounded-lg border border-gray-200 bg-white px-3 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        />
        <button
          type="button"
          onClick={submitAdd}
          disabled={!newLabel.trim() || add.isPending}
          className="min-h-11 rounded-lg bg-emerald-500 px-4 text-sm font-semibold text-white disabled:opacity-40"
        >
          {add.isPending ? 'Adding…' : 'Add'}
        </button>
      </div>
      {add.isError && <p className="text-xs text-red-500">Couldn't add the item. Try again.</p>}
    </div>
  )
}
```

- [ ] **Step 2: Mount it in `JobModal`**

In `app/frontend/src/screens/JobsScreen.tsx`, add the import near the other component imports:

```tsx
import { JobChecklist } from '../components/JobChecklist'
```

Then render it inside `JobModal`, immediately after the closing `</div>` of the "Job Photos" section (the `<div className="space-y-3">…</div>` block that ends around line 714, just before the `{job.crew.length > 0 && !canAssign && (` Crew block):

```tsx
          <div className="space-y-3">
            <JobChecklist leadId={job.id} />
          </div>
```

Place it so it reads as its own section between Job Photos and Crew. Do not alter the existing sections.

- [ ] **Step 3: Type-check + build**

Run: `cd app/frontend && npx tsc --noEmit`
Expected: no errors.

Run: `cd app/frontend && npm run build`
Expected: `tsc` + `vite build` succeed (the pre-existing >500 kB chunk warning is not an error).

- [ ] **Step 4: Commit**

```bash
git add app/frontend/src/components/JobChecklist.tsx app/frontend/src/screens/JobsScreen.tsx
git commit -m "feat(checklist): JobChecklist in the working modal (optimistic check/add/delete)"
```

---

## Task 7: Frontend — `StandardKitEditor` in Settings

**Files:**
- Create: `app/frontend/src/components/StandardKitEditor.tsx`
- Modify: `app/frontend/src/screens/SettingsScreen.tsx`

- [ ] **Step 1: Create the editor**

Create `app/frontend/src/components/StandardKitEditor.tsx`. Local editable copy seeded from the query; Save persists via the mutation (in-progress on the button, success + failure messages).

```tsx
import { useEffect, useState } from 'react'
import { useStandardKit, useSaveStandardKit } from '../hooks/useStandardKit'

export function StandardKitEditor() {
  const { data, isLoading, isError } = useStandardKit()
  const save = useSaveStandardKit()
  const [items, setItems] = useState<string[]>([])
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (data) setItems(data.items)
  }, [data])

  if (isLoading) return <p className="py-2 text-sm text-gray-500 dark:text-gray-400">Loading…</p>
  if (isError) return <p className="py-2 text-sm text-amber-600 dark:text-amber-400">Couldn't load the standard kit.</p>

  const addDraft = () => {
    const label = draft.trim()
    if (!label) return
    setItems(prev => (prev.some(i => i.toLowerCase() === label.toLowerCase()) ? prev : [...prev, label]))
    setDraft('')
  }
  const removeAt = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx))

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-600">
        {items.length === 0 && (
          <p className="px-3 py-3 text-sm text-gray-500 dark:text-gray-400">No standard items yet.</p>
        )}
        {items.map((item, idx) => (
          <div key={`${item}-${idx}`} className="flex min-h-11 items-center gap-2 border-t border-gray-100 px-3 first:border-t-0 dark:border-gray-700">
            <span className="flex-1 text-sm text-gray-900 dark:text-white">{item}</span>
            <button type="button" aria-label={`Remove ${item}`} onClick={() => removeAt(idx)} className="px-2 text-gray-400 hover:text-red-500">✕</button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addDraft() }}
          placeholder="Add a standard item…"
          className="min-h-11 flex-1 rounded-lg border border-gray-200 bg-white px-3 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        />
        <button type="button" onClick={addDraft} disabled={!draft.trim()} className="min-h-11 rounded-lg bg-gray-200 px-4 text-sm font-semibold text-gray-700 disabled:opacity-40 dark:bg-gray-600 dark:text-white">Add</button>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={() => save.mutate(items)}
          disabled={save.isPending}
          className="min-h-11 rounded-lg bg-emerald-500 px-4 text-sm font-semibold text-white disabled:opacity-40"
        >
          {save.isPending ? 'Saving…' : 'Save kit'}
        </button>
        {save.isSuccess && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>}
        {save.isError && <span className="text-xs text-red-500">Couldn't save. Try again.</span>}
      </div>
      <p className="text-xs text-gray-400">The always-bring base list. Smart extras (stairs, large move, hauling, truck) are added automatically per job.</p>
    </div>
  )
}
```

- [ ] **Step 2: Mount it in Settings for admin/facilitator**

In `app/frontend/src/screens/SettingsScreen.tsx`:

Add the import near the other component imports:

```tsx
import { StandardKitEditor } from '../components/StandardKitEditor'
```

The screen already reads the current user via `useAuth()` (used elsewhere in the file as `user`). Add a new section, rendered only for admin/facilitator, using the SAME section wrapper the other Settings sections use (`<section className="space-y-3 rounded-xl border bg-white p-4 dark:bg-gray-800 dark:border-gray-700">` with an `<h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">` heading — match exactly what the sibling sections use):

```tsx
{(user?.role === 'admin' || user?.role === 'facilitator') && (
  <section className="space-y-3 rounded-xl border bg-white p-4 dark:bg-gray-800 dark:border-gray-700">
    <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Standard kit · items to bring</h2>
    <StandardKitEditor />
  </section>
)}
```

Confirm the exact wrapper/heading classes against a sibling section before editing and match them; place it near the Availability section. Do not modify other sections.

- [ ] **Step 3: Type-check + build**

Run: `cd app/frontend && npx tsc --noEmit`
Expected: no errors.

Run: `cd app/frontend && npm run build`
Expected: `tsc` + `vite build` succeed.

- [ ] **Step 4: Commit**

```bash
git add app/frontend/src/components/StandardKitEditor.tsx app/frontend/src/screens/SettingsScreen.tsx
git commit -m "feat(checklist): Standard kit editor in Settings (admin/facilitator)"
```

---

## Self-Review

**Spec coverage:**
- New `lead_checklist_item` table + `checklist_seeded_at` marker + migration → Task 1.
- Schemas → Task 2.
- Configurable standard kit (AppSetting, default fallback) + conditional scope rules + idempotent once-only seeder → Task 3 (with unit tests for every rule + idempotency + de-dup).
- Per-lead GET (lazy seed, booked-only)/POST/PATCH/DELETE + kit GET/PUT (admin/facilitator-gated) → Task 4 (with endpoint tests incl. non-booked no-seed and crew-403).
- Crew working-modal checklist with optimistic check/add/delete + progress + scope/added tags + empty/loading/error states → Task 6.
- Settings standard-kit editor for admin/facilitator with save in-progress/success/failure → Task 7.
- Action states (in-progress/success/failure) present for every write: toggle/delete optimistic + rollback; add pending button + error; kit Save button states.

**Placeholder scan:** The only "match the sibling section" instructions (Task 6 mount point, Task 7 section chrome) are existing-codebase integration points with the surrounding pattern quoted; all component/service/router/test code is complete. No TODO/TBD.

**Type/name consistency:** `LeadChecklistItem` fields, `ChecklistItemOut`/`ChecklistItemCreate`/`ChecklistItemUpdate`/`StandardKitOut`/`StandardKitUpdate` schema names, the `ChecklistItem`/`StandardKit` TS types, `source` union (`standard|scope|custom`), the `['checklist', leadId]` / `['standard-kit']` query keys, and the routes (`/leads/{id}/checklist`, `/settings/checklist-kit`) are consistent across backend, hooks, and components. Seeder reads the kit under `lead.city_id`; kit endpoints resolve the same city via `city_for_create`, so seeding and the editor share one city-scoped setting.

**Note for implementer:** `scope_items` uses keyword/threshold matching on free-text fields (`move_type`, `move_size_label`) — intentionally fuzzy. The seeder commits once and stamps `checklist_seeded_at`; the GET endpoint is the only caller and gates on `booked`, so non-booked leads never seed.
