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
