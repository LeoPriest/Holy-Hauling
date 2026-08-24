import json

import pytest


@pytest.mark.asyncio
async def test_connection_table_exists_with_defaults(client, db_session):
    from app.models.thumbtack import ThumbtackConnection

    conn = ThumbtackConnection(
        label="Holy Hauling — St. Louis",
        city_id="st-louis",
        business="holy_hauling",
        url_token="tok_test_1",
    )
    db_session.add(conn)
    await db_session.commit()
    await db_session.refresh(conn)

    assert conn.id is not None
    assert conn.is_active is True
    assert conn.created_at is not None
    assert conn.last_event_at is None


@pytest.mark.asyncio
async def test_event_table_stores_raw_body_verbatim(client, db_session):
    from app.models.thumbtack import ThumbtackConnection, ThumbtackWebhookEvent

    conn = ThumbtackConnection(
        label="Holy Handy — Chicago",
        city_id="chicago",
        business="holy_handy",
        url_token="tok_test_2",
    )
    db_session.add(conn)
    await db_session.commit()

    body = '{"leadID":"abc","request":{"category":"Junk Removal"}}'
    event = ThumbtackWebhookEvent(
        connection_id=conn.id,
        kind="lead",
        external_id="abc",
        raw_body=body,
        status="received",
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)

    assert event.raw_body == body
    assert json.loads(event.raw_body)["leadID"] == "abc"
    assert event.status == "received"
    assert event.processed_at is None


@pytest.mark.asyncio
async def test_create_connection_returns_plaintext_secret_once(client, db_session):
    from app.services import thumbtack_service

    conn, secret = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_hauling"
    )

    assert secret
    assert len(secret) >= 20
    # The plaintext is never persisted.
    assert conn.auth_secret_hash != secret
    assert conn.url_token
    assert conn.auth_username


@pytest.mark.asyncio
async def test_generated_tokens_are_unique(client, db_session):
    from app.services import thumbtack_service

    a, _ = await thumbtack_service.create_connection(
        db_session, label="A", city_id="st-louis", business="holy_hauling"
    )
    b, _ = await thumbtack_service.create_connection(
        db_session, label="B", city_id="chicago", business="holy_handy"
    )

    assert a.url_token != b.url_token
    assert a.auth_username != b.auth_username


@pytest.mark.asyncio
async def test_get_by_url_token_finds_the_connection(client, db_session):
    from app.services import thumbtack_service

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_hauling"
    )

    found = await thumbtack_service.get_by_url_token(db_session, conn.url_token)
    assert found is not None
    assert found.id == conn.id

    assert await thumbtack_service.get_by_url_token(db_session, "nope") is None


@pytest.mark.asyncio
async def test_verify_basic_header(client, db_session):
    import base64

    from app.services import thumbtack_service

    conn, secret = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_hauling"
    )

    def header(user: str, password: str) -> str:
        raw = base64.b64encode(f"{user}:{password}".encode()).decode()
        return f"Basic {raw}"

    assert thumbtack_service.verify_basic_header(header(conn.auth_username, secret), conn) is True
    assert thumbtack_service.verify_basic_header(header(conn.auth_username, "wrong"), conn) is False
    assert thumbtack_service.verify_basic_header(header("wrong", secret), conn) is False
    assert thumbtack_service.verify_basic_header("Bearer abc", conn) is False
    assert thumbtack_service.verify_basic_header("Basic !!!not-base64!!!", conn) is False
    # No header at all is not a *failed* verification — the caller decides. See the route.
    assert thumbtack_service.verify_basic_header(None, conn) is False


@pytest.mark.asyncio
async def test_set_active_and_delete(client, db_session):
    from app.services import thumbtack_service

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_hauling"
    )

    disabled = await thumbtack_service.set_active(db_session, conn.id, False)
    assert disabled is not None and disabled.is_active is False

    assert await thumbtack_service.delete_connection(db_session, conn.id) is True
    assert await thumbtack_service.get_by_url_token(db_session, conn.url_token) is None
    assert await thumbtack_service.delete_connection(db_session, "missing") is False


LEAD_BODY = {
    "leadID": "lead-123",
    "createTimestamp": "1756000000",
    "leadPrice": "31.50",
    "chargeState": "CHARGED",
    "request": {
        "requestID": "req-1",
        "category": "Junk Removal",
        "title": "Garage cleanout",
        "description": "Old couch and boxes",
        "location": {"city": "St. Louis", "state": "MO", "zipCode": "63101"},
        "details": [{"question": "How many items?", "answer": "About 10"}],
    },
    "customer": {"customerID": "cust-1", "name": "Jane D", "phone": "3145551212"},
    "business": {"businessID": "biz-1", "name": "Holy Hauling"},
}

MESSAGE_BODY = {
    "leadID": "lead-123",
    "customerID": "cust-1",
    "businessID": "biz-1",
    "message": {
        "messageID": "msg-9",
        "createTimestamp": "1756000100",
        "text": "Can you come Saturday?",
    },
}

REVIEW_BODY = {
    "review": {
        "reviewID": "rev-5",
        "businessID": "biz-1",
        "leadID": "lead-123",
        "rating": "5",
        "verified": True,
    },
    "reviewEventType": "REVIEW_ADDED",
}


def test_classify_lead():
    from app.services import thumbtack_service

    assert thumbtack_service.classify(LEAD_BODY) == ("lead", "lead-123")


def test_classify_message():
    from app.services import thumbtack_service

    assert thumbtack_service.classify(MESSAGE_BODY) == ("message", "msg-9")


def test_classify_review():
    from app.services import thumbtack_service

    assert thumbtack_service.classify(REVIEW_BODY) == ("review", "rev-5")


def test_classify_unknown_shapes():
    from app.services import thumbtack_service

    assert thumbtack_service.classify({"hello": "world"}) == ("unknown", None)
    assert thumbtack_service.classify([]) == ("unknown", None)
    assert thumbtack_service.classify("a string") == ("unknown", None)
    # A leadID without a request object is not a lead payload we recognise.
    assert thumbtack_service.classify({"leadID": "x"}) == ("unknown", None)


@pytest.mark.asyncio
async def test_record_event_stores_lead_and_marks_received(client, db_session):
    from app.services import thumbtack_service

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_hauling"
    )
    raw = json.dumps(LEAD_BODY).encode()

    event = await thumbtack_service.record_event(db_session, conn, raw)

    assert event.kind == "lead"
    assert event.external_id == "lead-123"
    assert event.status == "received"
    assert event.error is None
    assert json.loads(event.raw_body) == LEAD_BODY

    await db_session.refresh(conn)
    assert conn.last_event_at is not None


@pytest.mark.asyncio
async def test_record_event_marks_reviews_ignored(client, db_session):
    from app.services import thumbtack_service

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_hauling"
    )

    event = await thumbtack_service.record_event(
        db_session, conn, json.dumps(REVIEW_BODY).encode()
    )

    assert event.kind == "review"
    assert event.status == "ignored"


@pytest.mark.asyncio
async def test_record_event_keeps_unparseable_body_and_flags_it(client, db_session):
    from app.services import thumbtack_service

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_hauling"
    )

    event = await thumbtack_service.record_event(db_session, conn, b"{not json at all")

    assert event.status == "failed"
    assert event.kind == "unknown"
    assert event.error
    # The body survives verbatim — this is the whole point of capture-first.
    assert event.raw_body == "{not json at all"

    await db_session.refresh(conn)
    assert conn.last_error_at is not None


@pytest.mark.asyncio
async def test_record_event_handles_undecodable_bytes(client, db_session):
    from app.services import thumbtack_service

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_hauling"
    )

    event = await thumbtack_service.record_event(db_session, conn, b"\xff\xfe\x00binary")

    assert event.status == "failed"
    assert event.raw_body  # stored lossily rather than crashing


@pytest.mark.asyncio
async def test_list_events_newest_first_and_respects_limit(client, db_session):
    from app.services import thumbtack_service

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_hauling"
    )
    for i in range(3):
        body = {**LEAD_BODY, "leadID": f"lead-{i}"}
        await thumbtack_service.record_event(db_session, conn, json.dumps(body).encode())

    events = await thumbtack_service.list_events(db_session, connection_id=conn.id, limit=2)

    assert len(events) == 2
    assert events[0].external_id == "lead-2"


@pytest.mark.asyncio
async def test_prune_events_removes_only_old_rows(client, db_session):
    from datetime import timedelta

    from app.services import thumbtack_service

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_hauling"
    )
    fresh = await thumbtack_service.record_event(
        db_session, conn, json.dumps(LEAD_BODY).encode()
    )
    stale = await thumbtack_service.record_event(
        db_session, conn, json.dumps({**LEAD_BODY, "leadID": "old"}).encode()
    )
    stale.received_at = thumbtack_service._now() - timedelta(days=120)
    await db_session.commit()

    removed = await thumbtack_service.prune_events(db_session, older_than_days=90)

    assert removed == 1
    remaining = await thumbtack_service.list_events(db_session, connection_id=conn.id)
    assert [e.id for e in remaining] == [fresh.id]


async def _make_connection(db_session, city_id="st-louis", business="holy_hauling"):
    from app.services import thumbtack_service

    return await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id=city_id, business=business
    )


def _basic(user: str, password: str) -> dict:
    import base64

    raw = base64.b64encode(f"{user}:{password}".encode()).decode()
    return {"Authorization": f"Basic {raw}"}


@pytest.mark.asyncio
async def test_webhook_accepts_valid_token_without_auth_header(client, db_session):
    from app.services import thumbtack_service

    conn, _ = await _make_connection(db_session)

    r = await client.post(f"/ingest/webhook/thumbtack/{conn.url_token}", json=LEAD_BODY)

    assert r.status_code == 200
    events = await thumbtack_service.list_events(db_session, connection_id=conn.id)
    assert len(events) == 1
    assert events[0].kind == "lead"


@pytest.mark.asyncio
async def test_webhook_accepts_correct_basic_credentials(client, db_session):
    conn, secret = await _make_connection(db_session)

    r = await client.post(
        f"/ingest/webhook/thumbtack/{conn.url_token}",
        json=LEAD_BODY,
        headers=_basic(conn.auth_username, secret),
    )

    assert r.status_code == 200


@pytest.mark.asyncio
async def test_webhook_rejects_wrong_password_and_stores_nothing(client, db_session):
    from app.services import thumbtack_service

    conn, _ = await _make_connection(db_session)

    r = await client.post(
        f"/ingest/webhook/thumbtack/{conn.url_token}",
        json=LEAD_BODY,
        headers=_basic(conn.auth_username, "wrong-secret"),
    )

    assert r.status_code == 401
    assert await thumbtack_service.list_events(db_session, connection_id=conn.id) == []


@pytest.mark.asyncio
async def test_webhook_rejects_unknown_token(client, db_session):
    from sqlalchemy import func, select as sa_select

    from app.models.thumbtack import ThumbtackWebhookEvent

    r = await client.post("/ingest/webhook/thumbtack/not-a-real-token", json=LEAD_BODY)
    assert r.status_code == 401

    count = await db_session.execute(
        sa_select(func.count()).select_from(ThumbtackWebhookEvent)
    )
    assert count.scalar() == 0


@pytest.mark.asyncio
async def test_webhook_rejects_disabled_connection(client, db_session):
    from app.services import thumbtack_service

    conn, _ = await _make_connection(db_session)
    await thumbtack_service.set_active(db_session, conn.id, False)

    r = await client.post(f"/ingest/webhook/thumbtack/{conn.url_token}", json=LEAD_BODY)

    assert r.status_code == 401
    assert await thumbtack_service.list_events(db_session, connection_id=conn.id) == []


@pytest.mark.asyncio
async def test_webhook_returns_200_for_unparseable_body(client, db_session):
    from app.services import thumbtack_service

    conn, _ = await _make_connection(db_session)

    r = await client.post(
        f"/ingest/webhook/thumbtack/{conn.url_token}",
        content=b"{not json",
        headers={"Content-Type": "application/json"},
    )

    # Thumbtack must never see a failure for a body we could not parse.
    assert r.status_code == 200
    events = await thumbtack_service.list_events(db_session, connection_id=conn.id)
    assert len(events) == 1
    assert events[0].status == "failed"
    assert events[0].raw_body == "{not json"


@pytest.mark.asyncio
async def test_webhook_returns_200_for_unrecognised_shape(client, db_session):
    from app.services import thumbtack_service

    conn, _ = await _make_connection(db_session)

    r = await client.post(
        f"/ingest/webhook/thumbtack/{conn.url_token}", json={"something": "new"}
    )

    assert r.status_code == 200
    events = await thumbtack_service.list_events(db_session, connection_id=conn.id)
    assert events[0].kind == "unknown"


@pytest.mark.asyncio
async def test_webhook_records_message_and_review_at_the_same_url(client, db_session):
    from app.services import thumbtack_service

    conn, _ = await _make_connection(db_session)
    url = f"/ingest/webhook/thumbtack/{conn.url_token}"

    assert (await client.post(url, json=MESSAGE_BODY)).status_code == 200
    assert (await client.post(url, json=REVIEW_BODY)).status_code == 200

    events = await thumbtack_service.list_events(db_session, connection_id=conn.id)
    kinds = {e.kind for e in events}
    assert kinds == {"message", "review"}


@pytest.mark.asyncio
async def test_webhook_rejects_oversized_body(client, db_session):
    from app.services import thumbtack_service

    conn, _ = await _make_connection(db_session)
    huge = b'{"a":"' + b"x" * (thumbtack_service.MAX_BODY_BYTES + 10) + b'"}'

    r = await client.post(
        f"/ingest/webhook/thumbtack/{conn.url_token}",
        content=huge,
        headers={"Content-Type": "application/json"},
    )

    assert r.status_code == 413
    # Rejected, but not silently: the operator must be able to see it happened.
    events = await thumbtack_service.list_events(db_session, connection_id=conn.id)
    assert len(events) == 1
    assert events[0].status == "failed"


@pytest.mark.asyncio
async def test_webhook_oversized_body_leaves_a_visible_failed_event(client, db_session):
    from app.services import thumbtack_service

    conn, _ = await _make_connection(db_session)
    huge = b'{"leadID":"big","padding":"' + b"x" * (thumbtack_service.MAX_BODY_BYTES + 10) + b'"}'

    r = await client.post(
        f"/ingest/webhook/thumbtack/{conn.url_token}",
        content=huge,
        headers={"Content-Type": "application/json"},
    )

    assert r.status_code == 413

    events = await thumbtack_service.list_events(db_session, connection_id=conn.id)
    assert len(events) == 1
    event = events[0]
    assert event.status == "failed"
    assert "exceeds" in (event.error or "")
    # A prefix is kept so the operator can recognise what arrived.
    assert event.raw_body.startswith('{"leadID":"big"')
    assert len(event.raw_body) <= thumbtack_service.OVERSIZE_PREFIX_BYTES

    await db_session.refresh(conn)
    assert conn.last_error_at is not None


@pytest.mark.asyncio
async def test_webhook_caps_streaming_body_with_no_content_length(client, db_session):
    """A chunked POST declares no length; the read must still be bounded."""
    from app.services import thumbtack_service

    conn, _ = await _make_connection(db_session)
    chunk = b"x" * 100_000

    async def _stream():
        yield b'{"leadID":"big","padding":"'
        for _ in range(12):  # ~1.2 MB, over MAX_BODY_BYTES
            yield chunk
        yield b'"}'

    r = await client.post(
        f"/ingest/webhook/thumbtack/{conn.url_token}",
        content=_stream(),
        headers={"Content-Type": "application/json"},
    )

    assert r.status_code == 413
    events = await thumbtack_service.list_events(db_session, connection_id=conn.id)
    assert len(events) == 1
    assert events[0].status == "failed"
    await db_session.refresh(conn)
    assert conn.last_error_at is not None


@pytest.mark.asyncio
async def test_webhook_unknown_token_stores_nothing_even_when_oversized(client, db_session):
    from sqlalchemy import func, select as sa_select

    from app.models.thumbtack import ThumbtackWebhookEvent
    from app.services import thumbtack_service

    huge = b'{"a":"' + b"x" * (thumbtack_service.MAX_BODY_BYTES + 10) + b'"}'

    r = await client.post(
        "/ingest/webhook/thumbtack/not-a-real-token",
        content=huge,
        headers={"Content-Type": "application/json"},
    )

    assert r.status_code == 401
    count = await db_session.execute(sa_select(func.count()).select_from(ThumbtackWebhookEvent))
    assert count.scalar() == 0


@pytest.mark.asyncio
async def test_webhook_creates_no_leads(client, db_session):
    from sqlalchemy import func, select as sa_select

    from app.models.lead import Lead

    conn, _ = await _make_connection(db_session)
    await client.post(f"/ingest/webhook/thumbtack/{conn.url_token}", json=LEAD_BODY)

    count = await db_session.execute(sa_select(func.count()).select_from(Lead))
    # Phase 1 captures only. Mapping arrives in Phase 2.
    assert count.scalar() == 0


@pytest.mark.asyncio
async def test_webhook_returns_503_when_record_event_fails(client, db_session, monkeypatch):
    from app.services import thumbtack_service

    conn, _ = await _make_connection(db_session)

    async def _boom(*args, **kwargs):
        raise RuntimeError("db is unavailable")

    monkeypatch.setattr(thumbtack_service, "record_event", _boom)

    r = await client.post(f"/ingest/webhook/thumbtack/{conn.url_token}", json=LEAD_BODY)

    # Thumbtack must retry rather than believe a lost write succeeded.
    assert r.status_code == 503


@pytest.mark.asyncio
async def test_admin_create_connection_returns_url_and_credentials(client):
    r = await client.post(
        "/admin/thumbtack/connections",
        json={"label": "Holy Hauling — St. Louis", "city_id": "st-louis", "business": "holy_hauling"},
    )

    assert r.status_code == 201
    data = r.json()
    assert data["label"] == "Holy Hauling — St. Louis"
    assert data["city_id"] == "st-louis"
    assert data["business"] == "holy_hauling"
    assert data["webhook_url"].endswith(f"/ingest/webhook/thumbtack/{data['url_token']}")
    # The URL is the bearer secret for the endpoint, so it is never handed out as http.
    assert data["webhook_url"].startswith("https://")
    assert data["auth_username"]
    assert data["auth_secret"]


@pytest.mark.asyncio
async def test_admin_list_never_exposes_the_secret(client):
    create = await client.post(
        "/admin/thumbtack/connections",
        json={"label": "HH STL", "city_id": "st-louis", "business": "holy_hauling"},
    )
    secret = create.json()["auth_secret"]

    r = await client.get("/admin/thumbtack/connections")

    assert r.status_code == 200
    body = r.text
    assert secret not in body
    assert "auth_secret_hash" not in body
    row = r.json()[0]
    assert "auth_secret" not in row
    assert row["is_active"] is True
    assert row["last_event_at"] is None


@pytest.mark.asyncio
async def test_admin_rejects_unknown_business_and_city(client):
    bad_business = await client.post(
        "/admin/thumbtack/connections",
        json={"label": "X", "city_id": "st-louis", "business": "not_a_business"},
    )
    assert bad_business.status_code == 422

    bad_city = await client.post(
        "/admin/thumbtack/connections",
        json={"label": "X", "city_id": "atlantis", "business": "holy_hauling"},
    )
    assert bad_city.status_code == 422


@pytest.mark.asyncio
async def test_admin_disable_and_delete_connection(client):
    created = (await client.post(
        "/admin/thumbtack/connections",
        json={"label": "HH STL", "city_id": "st-louis", "business": "holy_hauling"},
    )).json()

    patched = await client.patch(
        f"/admin/thumbtack/connections/{created['id']}", json={"is_active": False}
    )
    assert patched.status_code == 200
    assert patched.json()["is_active"] is False

    deleted = await client.delete(f"/admin/thumbtack/connections/{created['id']}")
    assert deleted.status_code == 204

    assert (await client.get("/admin/thumbtack/connections")).json() == []

    assert (await client.delete(f"/admin/thumbtack/connections/{created['id']}")).status_code == 404


@pytest.mark.asyncio
async def test_admin_events_endpoint_shows_captured_bodies(client):
    created = (await client.post(
        "/admin/thumbtack/connections",
        json={"label": "HH STL", "city_id": "st-louis", "business": "holy_hauling"},
    )).json()

    await client.post(f"/ingest/webhook/thumbtack/{created['url_token']}", json=LEAD_BODY)

    r = await client.get(f"/admin/thumbtack/events?connection_id={created['id']}")

    assert r.status_code == 200
    events = r.json()
    assert len(events) == 1
    assert events[0]["kind"] == "lead"
    assert events[0]["status"] == "received"
    assert json.loads(events[0]["raw_body"])["leadID"] == "lead-123"


@pytest.mark.asyncio
async def test_admin_deleting_a_connection_removes_its_events(client):
    created = (await client.post(
        "/admin/thumbtack/connections",
        json={"label": "HH STL", "city_id": "st-louis", "business": "holy_hauling"},
    )).json()
    await client.post(f"/ingest/webhook/thumbtack/{created['url_token']}", json=LEAD_BODY)

    await client.delete(f"/admin/thumbtack/connections/{created['id']}")

    r = await client.get("/admin/thumbtack/events")
    assert r.json() == []


@pytest.mark.asyncio
async def test_admin_events_limit_rejects_negative_value(client):
    created = (await client.post(
        "/admin/thumbtack/connections",
        json={"label": "HH STL", "city_id": "st-louis", "business": "holy_hauling"},
    )).json()
    for _ in range(3):
        await client.post(f"/ingest/webhook/thumbtack/{created['url_token']}", json=LEAD_BODY)

    r = await client.get("/admin/thumbtack/events?limit=-1")

    # A negative SQLite LIMIT means "no limit" -- this must never reach the
    # service layer. Rejected at validation, not silently clamped.
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_admin_events_limit_rejects_zero(client):
    created = (await client.post(
        "/admin/thumbtack/connections",
        json={"label": "HH STL", "city_id": "st-louis", "business": "holy_hauling"},
    )).json()
    await client.post(f"/ingest/webhook/thumbtack/{created['url_token']}", json=LEAD_BODY)

    r = await client.get("/admin/thumbtack/events?limit=0")

    assert r.status_code == 422


@pytest.mark.asyncio
async def test_admin_events_limit_rejects_value_over_200(client):
    created = (await client.post(
        "/admin/thumbtack/connections",
        json={"label": "HH STL", "city_id": "st-louis", "business": "holy_hauling"},
    )).json()
    await client.post(f"/ingest/webhook/thumbtack/{created['url_token']}", json=LEAD_BODY)

    r = await client.get("/admin/thumbtack/events?limit=500")

    assert r.status_code == 422


@pytest.mark.asyncio
async def test_admin_events_limit_returns_requested_count(client):
    created = (await client.post(
        "/admin/thumbtack/connections",
        json={"label": "HH STL", "city_id": "st-louis", "business": "holy_hauling"},
    )).json()
    for _ in range(4):
        await client.post(f"/ingest/webhook/thumbtack/{created['url_token']}", json=LEAD_BODY)

    r = await client.get(f"/admin/thumbtack/events?connection_id={created['id']}&limit=2")

    assert r.status_code == 200
    assert len(r.json()) == 2


@pytest.mark.asyncio
async def test_webhook_url_is_https_for_a_non_local_host(client, monkeypatch):
    """Behind a TLS terminator the app can see scheme http; the pasted URL must not."""
    monkeypatch.delenv("PUBLIC_BASE_URL", raising=False)

    r = await client.post(
        "/admin/thumbtack/connections",
        json={"label": "HH STL", "city_id": "st-louis", "business": "holy_hauling"},
        headers={"Host": "api.holyhauling.com"},
    )

    assert r.status_code == 201
    url = r.json()["webhook_url"]
    assert url.startswith("https://api.holyhauling.com/"), url


@pytest.mark.asyncio
async def test_public_base_url_override_wins(client, monkeypatch):
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://leads.example.com/")

    r = await client.post(
        "/admin/thumbtack/connections",
        json={"label": "HH STL 2", "city_id": "st-louis", "business": "holy_hauling"},
    )

    assert r.status_code == 201
    data = r.json()
    assert data["webhook_url"] == (
        f"https://leads.example.com/ingest/webhook/thumbtack/{data['url_token']}"
    )
