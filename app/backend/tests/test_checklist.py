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
    from sqlalchemy import select
    factory = app.state.test_session_factory
    lead_id = await _make_booked_lead(factory, service_type=ServiceType.moving, unload_stairs=1)

    async with factory() as s:
        lead = (await s.execute(select(Lead).where(Lead.id == lead_id))).scalar_one()
        await checklist_service.seed_checklist(s, lead)
    first = await _count_items(factory, lead_id)
    assert first > 0

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
    await checklist_service.set_standard_kit(db_session, ["Mattress bags", "Hand truck"], "st-louis")
    lead_id = await _make_booked_lead(factory, service_type=ServiceType.moving)
    async with factory() as s:
        lead = (await s.execute(select(Lead).where(Lead.id == lead_id))).scalar_one()
        await checklist_service.seed_checklist(s, lead)
    async with factory() as s:
        labels = [i.label for i in (await s.execute(
            select(LeadChecklistItem).where(LeadChecklistItem.lead_id == lead_id))).scalars().all()]
    assert labels.count("Mattress bags") == 1


# --- Endpoint tests ----------------------------------------------------------

async def _create_booked_lead_via_api(client, **patch) -> str:
    r = await client.post("/leads", json={
        "source_type": "manual",
        "customer_name": "Checklist Test",
        "service_type": patch.get("service_type", "moving"),
    })
    assert r.status_code == 201
    lead_id = r.json()["id"]
    field_body = {}
    for k in ("load_stairs", "unload_stairs", "move_size_label", "move_type"):
        if k in patch:
            field_body[k] = patch[k]
    if field_body:
        rf = await client.patch(f"/leads/{lead_id}", json=field_body)
        assert rf.status_code == 200
    r2 = await client.patch(f"/leads/{lead_id}/status", json={"status": "booked"})
    assert r2.status_code == 200
    return lead_id


async def test_get_checklist_seeds_on_first_call_for_booked(client):
    lead_id = await _create_booked_lead_via_api(client, service_type="moving", unload_stairs=1)
    r = await client.get(f"/leads/{lead_id}/checklist")
    assert r.status_code == 200
    items = r.json()
    labels = [i["label"] for i in items]
    assert "Moving blankets" in labels
    assert "Stair-climbing hand truck" in labels
    assert [i["sort_order"] for i in items] == sorted(i["sort_order"] for i in items)
    r2 = await client.get(f"/leads/{lead_id}/checklist")
    assert len(r2.json()) == len(items)


async def test_get_checklist_does_not_seed_non_booked(client):
    r = await client.post("/leads", json={
        "source_type": "manual", "customer_name": "New Lead", "service_type": "moving",
    })
    lead_id = r.json()["id"]
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
