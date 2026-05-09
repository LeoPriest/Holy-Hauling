from __future__ import annotations


async def test_admin_can_create_list_and_summarize_finances(client):
    income = {
        "occurred_on": "2026-05-08",
        "transaction_type": "income",
        "category": "Job payment",
        "amount_cents": 45000,
        "payment_method": "Square",
        "vendor_customer": "Acme Customer",
        "description": "Local move",
    }
    expense = {
        "occurred_on": "2026-05-08",
        "transaction_type": "expense",
        "category": "Fuel",
        "amount_cents": 6200,
        "payment_method": "Debit",
        "vendor_customer": "Gas station",
        "description": "Truck refill",
    }

    r = await client.post("/admin/finances", json=income)
    assert r.status_code == 201
    created_income = r.json()
    assert created_income["amount_cents"] == 45000
    assert created_income["created_by"] == "test-admin-id"

    r = await client.post("/admin/finances", json=expense)
    assert r.status_code == 201

    r = await client.get("/admin/finances?start_date=2026-05-01&end_date=2026-05-31")
    assert r.status_code == 200
    transactions = r.json()
    assert len(transactions) == 2

    r = await client.get("/admin/finances/summary?start_date=2026-05-01&end_date=2026-05-31")
    assert r.status_code == 200
    summary = r.json()
    assert summary["income_cents"] == 45000
    assert summary["expense_cents"] == 6200
    assert summary["net_cents"] == 38800
    assert summary["transaction_count"] == 2
    assert {item["category"] for item in summary["categories"]} == {"Job payment", "Fuel"}


async def test_admin_can_update_and_delete_finance_transaction(client):
    r = await client.post("/admin/finances", json={
        "occurred_on": "2026-05-08",
        "transaction_type": "expense",
        "category": "Supplies",
        "amount_cents": 1500,
    })
    assert r.status_code == 201
    transaction_id = r.json()["id"]

    r = await client.patch(f"/admin/finances/{transaction_id}", json={
        "category": "Packing supplies",
        "amount_cents": 2100,
    })
    assert r.status_code == 200
    assert r.json()["category"] == "Packing supplies"
    assert r.json()["amount_cents"] == 2100

    r = await client.delete(f"/admin/finances/{transaction_id}")
    assert r.status_code == 200
    assert r.json()["deleted"] is True

    r = await client.get("/admin/finances")
    assert r.status_code == 200
    assert r.json() == []
