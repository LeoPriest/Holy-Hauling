from __future__ import annotations

from app.services import lead_service


async def _create_lead(client, source_type="manual") -> str:
    r = await client.post("/leads", json={
        "source_type": source_type,
        "customer_name": "Phone Test",
        "service_type": "moving",
    })
    assert r.status_code == 201
    return r.json()["id"]


class _L:
    def __init__(self, real=None, phone=None):
        self.customer_real_phone = real
        self.customer_phone = phone


def test_contact_phone_prefers_real():
    assert lead_service.contact_phone(_L(real="(314) 555-7788", phone="(314) 555-0142")) == "(314) 555-7788"


def test_contact_phone_falls_back_to_phone():
    assert lead_service.contact_phone(_L(real=None, phone="(314) 555-0142")) == "(314) 555-0142"


def test_contact_phone_ignores_masked_real():
    assert lead_service.contact_phone(_L(real="314-xxx-xxxx", phone="(314) 555-0142")) == "(314) 555-0142"


def test_contact_phone_none_when_neither_valid():
    assert lead_service.contact_phone(_L(real=None, phone=None)) is None


async def test_proxy_autotagged_on_thumbtack_lead(client):
    lead_id = await _create_lead(client, source_type="thumbtack_screenshot")
    r = await client.patch(f"/leads/{lead_id}", json={"customer_phone": "(314) 555-0142"})
    assert r.status_code == 200
    body = r.json()
    assert body["customer_phone_is_proxy"] is True
    assert body["contact_phone"] == "(314) 555-0142"


async def test_proxy_not_tagged_on_manual_lead(client):
    lead_id = await _create_lead(client, source_type="manual")
    r = await client.patch(f"/leads/{lead_id}", json={"customer_phone": "(314) 555-0142"})
    assert r.status_code == 200
    assert r.json()["customer_phone_is_proxy"] is False


async def test_manual_proxy_override_persists(client):
    lead_id = await _create_lead(client, source_type="thumbtack_screenshot")
    await client.patch(f"/leads/{lead_id}", json={"customer_phone": "(314) 555-0142"})
    r = await client.patch(f"/leads/{lead_id}", json={"customer_phone_is_proxy": False})
    assert r.status_code == 200
    assert r.json()["customer_phone_is_proxy"] is False


async def test_real_phone_persists_and_becomes_contact(client):
    lead_id = await _create_lead(client, source_type="thumbtack_screenshot")
    await client.patch(f"/leads/{lead_id}", json={"customer_phone": "(314) 555-0142"})
    r = await client.patch(f"/leads/{lead_id}", json={"customer_real_phone": "(314) 555-7788"})
    assert r.status_code == 200
    body = r.json()
    assert body["customer_real_phone"] == "(314) 555-7788"
    assert body["contact_phone"] == "(314) 555-7788"


async def test_masked_real_phone_is_noop(client):
    lead_id = await _create_lead(client, source_type="thumbtack_screenshot")
    r = await client.patch(f"/leads/{lead_id}", json={"customer_real_phone": "314-xxx-xxxx"})
    assert r.status_code == 200
    assert r.json()["customer_real_phone"] is None
