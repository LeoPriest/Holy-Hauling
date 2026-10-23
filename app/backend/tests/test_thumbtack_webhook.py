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
async def test_record_event_flags_a_lead_shaped_body_the_mapper_cannot_map(client, db_session):
    """LEAD_BODY is the old pro-api shape (leadID + request, no `data` key).
    classify() still sniffs it as `kind="lead"` — Thumbtack's form sends every
    checked event type to one URL, and shape is all we have to go on — but
    Phase 2's stricter map_lead_payload requires data.negotiationID and
    declines it. Landing that as `status="received"` with `error=None` would
    be indistinguishable from a delivery nobody has looked at yet, with
    nothing anywhere acting on it — this is exactly the case a `failed`
    status with an explicit error exists to surface."""
    from app.services import thumbtack_service

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_hauling"
    )
    raw = json.dumps(LEAD_BODY).encode()

    event = await thumbtack_service.record_event(db_session, conn, raw)

    assert event.kind == "lead"
    assert event.external_id == "lead-123"
    assert event.status == "failed"
    assert event.error is not None
    assert "negotiationID" in event.error
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
    # LEAD_BODY is the old pro-api shape (no `data` key) — classify() still
    # sniffs "lead" from shape, but map_lead_payload can't map it, and a
    # mapper-declined lead-shaped body is flagged `failed` rather than left
    # `received` and unactionable.
    assert events[0]["status"] == "failed"
    assert events[0]["error"] is not None
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


# ── V4 event shapes (developers.thumbtack.com) ────────────────────────────────
# The self-serve webhook documents its events as NegotiationCreatedV4 /
# MessageCreatedV4 / ReviewCreatedV4, keyed on `negotiationID` rather than the
# `leadID` used by the older pro-api reference. classify() must recognise both,
# bare or wrapped in an envelope, and still fall back to 'unknown'.

def test_classify_v4_lead_bare():
    from app.services import thumbtack_service

    body = {
        "negotiationID": "neg-1",
        "request": {"category": "Junk Removal", "description": "garage"},
        "customer": {"name": "Jane"},
    }
    assert thumbtack_service.classify(body) == ("lead", "neg-1")


def test_classify_v4_lead_without_request_object():
    from app.services import thumbtack_service

    # A negotiationID alone is enough — unlike leadID, which needs a request
    # object to disambiguate it from message/review payloads.
    assert thumbtack_service.classify({"negotiationID": "neg-2"}) == ("lead", "neg-2")


def test_classify_v4_message_bare_beats_lead():
    from app.services import thumbtack_service

    # A message payload also carries negotiationID — it must NOT classify as a lead.
    body = {"negotiationID": "neg-1", "messageID": "msg-1", "text": "Saturday?"}
    assert thumbtack_service.classify(body) == ("message", "msg-1")


def test_classify_v4_review_bare_beats_lead():
    from app.services import thumbtack_service

    # A review payload also carries negotiationID — it must NOT classify as a lead.
    body = {"reviewID": "rev-1", "negotiationID": "neg-1", "rating": "5", "reviewText": "great"}
    assert thumbtack_service.classify(body) == ("review", "rev-1")


def test_classify_v4_envelope_lead():
    from app.services import thumbtack_service

    body = {"eventType": "NegotiationCreatedV4", "data": {"negotiationID": "neg-9"}}
    assert thumbtack_service.classify(body) == ("lead", "neg-9")


def test_classify_v4_envelope_message():
    from app.services import thumbtack_service

    body = {
        "eventType": "MessageCreatedV4",
        "data": {"messageID": "msg-9", "negotiationID": "neg-9", "text": "hi"},
    }
    assert thumbtack_service.classify(body) == ("message", "msg-9")


def test_classify_v4_envelope_review():
    from app.services import thumbtack_service

    body = {"eventType": "ReviewCreatedV4", "data": {"reviewID": "rev-9", "rating": "4"}}
    assert thumbtack_service.classify(body) == ("review", "rev-9")


def test_classify_declared_event_type_with_unrecognised_shape():
    from app.services import thumbtack_service

    # We know WHAT it is even when we cannot find an id — better than 'unknown'.
    assert thumbtack_service.classify({"eventType": "NegotiationCreatedV4"}) == ("lead", None)


def test_classify_still_returns_unknown_for_unrecognised_bodies():
    from app.services import thumbtack_service

    # The safety net must survive the change.
    assert thumbtack_service.classify({"hello": "world"}) == ("unknown", None)
    assert thumbtack_service.classify({"eventType": "SomethingElseV9"}) == ("unknown", None)
    assert thumbtack_service.classify({"data": {"nope": 1}}) == ("unknown", None)


# ── Phase 2: a delivery becomes a lead ───────────────────────────────────────

from pathlib import Path as _Path

_FIXTURE_DIR = _Path(__file__).parent / "fixtures"


def _real_lead_body() -> dict:
    return json.loads((_FIXTURE_DIR / "thumbtack_lead_v4.json").read_text(encoding="utf-8"))


def _real_ping_body() -> dict:
    return json.loads((_FIXTURE_DIR / "thumbtack_test_ping.json").read_text(encoding="utf-8"))


@pytest.mark.asyncio
async def test_a_real_delivery_creates_a_lead_in_the_queue(client, db_session):
    from sqlalchemy import select as sa_select

    from app.models.lead import Lead
    from app.services import thumbtack_service

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_handy"
    )

    r = await client.post(
        f"/ingest/webhook/thumbtack/{conn.url_token}", json=_real_lead_body()
    )
    assert r.status_code == 200

    lead = (await db_session.execute(
        sa_select(Lead).where(Lead.source_reference_id == "589129524549820420")
    )).scalar_one()

    assert lead.city_id == "st-louis"             # pinned by the connection
    assert lead.customer_name == "Handyman Amenify"
    assert lead.job_location == "Saint Louis, MO 63144"
    assert lead.lead_cost_cents == 1588


@pytest.mark.asyncio
async def test_the_phone_is_recorded_as_a_thumbtack_proxy(client, db_session):
    from sqlalchemy import select as sa_select

    from app.models.lead import Lead
    from app.services import thumbtack_service

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_handy"
    )
    await client.post(f"/ingest/webhook/thumbtack/{conn.url_token}", json=_real_lead_body())

    lead = (await db_session.execute(
        sa_select(Lead).where(Lead.source_reference_id == "589129524549820420")
    )).scalar_one()

    # A Thumbtack number routes to the customer; it is not theirs. Saving it as
    # their real number is the misrepresentation the Numbers work prevented.
    assert lead.customer_phone_is_proxy is True


@pytest.mark.asyncio
async def test_redelivery_creates_no_second_lead(client, db_session):
    from sqlalchemy import func, select as sa_select

    from app.models.lead import Lead
    from app.services import thumbtack_service

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_handy"
    )
    body = _real_lead_body()
    for _ in range(3):
        await client.post(f"/ingest/webhook/thumbtack/{conn.url_token}", json=body)

    count = (await db_session.execute(
        sa_select(func.count()).select_from(Lead)
        .where(Lead.source_reference_id == "589129524549820420")
    )).scalar()

    assert count == 1


@pytest.mark.asyncio
async def test_the_test_ping_creates_no_lead(client, db_session):
    from sqlalchemy import func, select as sa_select

    from app.models.lead import Lead
    from app.services import thumbtack_service

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_handy"
    )
    before = (await db_session.execute(sa_select(func.count()).select_from(Lead))).scalar()

    await client.post(f"/ingest/webhook/thumbtack/{conn.url_token}", json=_real_ping_body())

    after = (await db_session.execute(sa_select(func.count()).select_from(Lead))).scalar()
    assert after == before


@pytest.mark.asyncio
async def test_the_location_mismatch_reaches_the_lead(client, db_session):
    from sqlalchemy import select as sa_select

    from app.models.lead import Lead
    from app.services import thumbtack_service

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_handy"
    )
    await client.post(f"/ingest/webhook/thumbtack/{conn.url_token}", json=_real_lead_body())

    lead = (await db_session.execute(
        sa_select(Lead).where(Lead.source_reference_id == "589129524549820420")
    )).scalar_one()

    assert lead.quote_context is not None
    assert "service area" in lead.quote_context


@pytest.mark.asyncio
async def test_a_mapping_failure_marks_the_event_and_keeps_the_body(client, db_session, monkeypatch):
    from app.services import thumbtack_service

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_handy"
    )

    def _boom(_body):
        raise RuntimeError("mapper exploded")

    monkeypatch.setattr(thumbtack_service, "map_lead_payload", _boom)

    r = await client.post(
        f"/ingest/webhook/thumbtack/{conn.url_token}", json=_real_lead_body()
    )

    # Thumbtack still sees 200 — the body is safely stored and can be retried.
    assert r.status_code == 200
    events = await thumbtack_service.list_events(db_session, connection_id=conn.id)
    assert events[0].status == "failed"
    assert "589129524549820420" in events[0].raw_body


# ── Fix round 1: refund path + finance idempotency ───────────────────────────

import copy as _copy


@pytest.mark.asyncio
async def test_a_refunded_delivery_creates_a_lead_and_applies_the_refund(client, db_session):
    from sqlalchemy import select as sa_select

    from app.models.lead import Lead
    from app.services import thumbtack_service

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_handy"
    )

    body = _copy.deepcopy(_real_lead_body())
    body["data"]["chargeState"] = "Refunded"

    r = await client.post(f"/ingest/webhook/thumbtack/{conn.url_token}", json=body)
    assert r.status_code == 200

    lead = (await db_session.execute(
        sa_select(Lead).where(Lead.source_reference_id == "589129524549820420")
    )).scalar_one()

    # Reloaded from the DB rather than trusting the in-memory instance — this
    # is the assertion that would catch mark_refunded's required positional
    # `on` being dropped by a future refactor.
    await db_session.refresh(lead)
    assert lead.lead_refunded_at is not None


@pytest.mark.asyncio
async def test_redelivery_links_exactly_one_finance_transaction(client, db_session):
    from sqlalchemy import func, select as sa_select

    from app.models.finance import FinanceTransaction
    from app.models.lead import Lead
    from app.services import thumbtack_service

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_handy"
    )

    body = _real_lead_body()
    for _ in range(2):
        r = await client.post(f"/ingest/webhook/thumbtack/{conn.url_token}", json=body)
        assert r.status_code == 200

    lead = (await db_session.execute(
        sa_select(Lead).where(Lead.source_reference_id == "589129524549820420")
    )).scalar_one()

    assert lead.lead_cost_finance_transaction_id is not None

    count = (await db_session.execute(
        sa_select(func.count()).select_from(FinanceTransaction)
        .where(FinanceTransaction.lead_id == lead.id)
    )).scalar()

    assert count == 1


# ── Task 4: notify the phone ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_new_lead_pushes_to_the_facilitator(client, db_session, monkeypatch):
    from app.services import push_service, thumbtack_service

    sent: list[tuple[list[str], str, str | None]] = []

    async def _capture(db, roles, message, city_id=None):
        sent.append((roles, message, city_id))
        return 1

    monkeypatch.setattr(push_service, "send_push_to_roles", _capture)

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_handy"
    )
    await client.post(f"/ingest/webhook/thumbtack/{conn.url_token}", json=_real_lead_body())

    assert len(sent) == 1
    roles, message, city_id = sent[0]
    assert "facilitator" in roles
    assert city_id == "st-louis"
    assert "Handyman" in message


@pytest.mark.asyncio
async def test_an_out_of_area_lead_says_so_in_the_notification(client, db_session, monkeypatch):
    from app.services import push_service, thumbtack_service

    sent: list[str] = []

    async def _capture(db, roles, message, city_id=None):
        sent.append(message)
        return 1

    monkeypatch.setattr(push_service, "send_push_to_roles", _capture)

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_handy"
    )
    # The real body has a CT address under a St. Louis location.
    await client.post(f"/ingest/webhook/thumbtack/{conn.url_token}", json=_real_lead_body())

    # He must be able to triage from the notification without opening the app.
    assert "out of area" in sent[0].lower()


@pytest.mark.asyncio
async def test_a_push_failure_does_not_lose_the_lead(client, db_session, monkeypatch):
    from sqlalchemy import select as sa_select

    from app.models.lead import Lead
    from app.models.thumbtack import ThumbtackWebhookEvent
    from app.services import push_service, thumbtack_service

    async def _boom(db, roles, message, city_id=None):
        raise RuntimeError("push service down")

    monkeypatch.setattr(push_service, "send_push_to_roles", _boom)

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_handy"
    )
    r = await client.post(f"/ingest/webhook/thumbtack/{conn.url_token}", json=_real_lead_body())

    assert r.status_code == 200
    # The lead is the valuable artifact; the notification is a convenience.
    lead = (await db_session.execute(
        sa_select(Lead).where(Lead.source_reference_id == "589129524549820420")
    )).scalar_one_or_none()
    assert lead is not None
    # The other half of the governing rule: a push failure must not also mark
    # the event `failed` — that would invite a retry that can never actually
    # retry the (already-succeeded) push.
    event = (await db_session.execute(
        sa_select(ThumbtackWebhookEvent).where(ThumbtackWebhookEvent.connection_id == conn.id)
    )).scalar_one_or_none()
    assert event is not None
    assert event.status == "processed"


@pytest.mark.asyncio
async def test_retry_maps_a_delivery_that_failed_the_first_time(client, db_session, monkeypatch):
    from sqlalchemy import select as sa_select

    from app.models.lead import Lead
    from app.services import thumbtack_service

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_handy"
    )

    def _boom(_body):
        raise RuntimeError("transient")

    monkeypatch.setattr(thumbtack_service, "map_lead_payload", _boom)
    await client.post(f"/ingest/webhook/thumbtack/{conn.url_token}", json=_real_lead_body())
    monkeypatch.undo()

    events = await thumbtack_service.list_events(db_session, connection_id=conn.id)
    assert events[0].status == "failed"

    r = await client.post(f"/admin/thumbtack/events/{events[0].id}/retry")

    assert r.status_code == 200
    payload = r.json()
    assert payload["created"] is True
    # The feature's primary happy path: a delivery that failed mapping, then
    # succeeded on retry, must not keep the stale "Mapping failed: ..." error
    # forever — or the row (and its Retry button) never look done.
    assert payload["event"]["error"] is None
    lead = (await db_session.execute(
        sa_select(Lead).where(Lead.source_reference_id == "589129524549820420")
    )).scalar_one_or_none()
    assert lead is not None


@pytest.mark.asyncio
async def test_retrying_an_already_processed_delivery_creates_no_duplicate(client, db_session):
    from sqlalchemy import func, select as sa_select

    from app.models.finance import FinanceTransaction
    from app.models.lead import Lead
    from app.services import thumbtack_service

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_handy"
    )
    await client.post(f"/ingest/webhook/thumbtack/{conn.url_token}", json=_real_lead_body())
    events = await thumbtack_service.list_events(db_session, connection_id=conn.id)

    r = await client.post(f"/admin/thumbtack/events/{events[0].id}/retry")

    # The assertion that would have caught the "created means lead_id is not
    # None" bug: a retry that only found an existing lead via the
    # idempotency lookup must report created=False, even though it still
    # carries that lead's id.
    assert r.status_code == 200
    payload = r.json()
    assert payload["created"] is False
    assert payload["lead_id"] is not None

    count = (await db_session.execute(
        sa_select(func.count()).select_from(Lead)
        .where(Lead.source_reference_id == "589129524549820420")
    )).scalar()
    assert count == 1

    lead = (await db_session.execute(
        sa_select(Lead).where(Lead.source_reference_id == "589129524549820420")
    )).scalar_one()
    # The heal path is idempotent too: a lead whose expense already synced on
    # first ingest must not pick up a second FinanceTransaction on retry.
    tx_count = (await db_session.execute(
        sa_select(func.count()).select_from(FinanceTransaction)
        .where(FinanceTransaction.lead_id == lead.id)
    )).scalar()
    assert tx_count == 1


@pytest.mark.asyncio
async def test_retrying_an_unknown_event_id_is_a_404(client):
    r = await client.post("/admin/thumbtack/events/no-such-event/retry")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_retry_heals_a_lead_whose_cost_sync_failed(client, db_session, monkeypatch):
    from sqlalchemy import func, select as sa_select

    from app.models.finance import FinanceTransaction
    from app.models.lead import Lead
    from app.models.thumbtack import ThumbtackWebhookEvent
    from app.services import lead_cost_service, thumbtack_service

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_handy"
    )

    async def _boom(db, lead):
        raise RuntimeError("finance down")

    monkeypatch.setattr(lead_cost_service, "sync_lead_cost_expense", _boom)
    r = await client.post(f"/ingest/webhook/thumbtack/{conn.url_token}", json=_real_lead_body())
    monkeypatch.undo()

    assert r.status_code == 200

    lead = (await db_session.execute(
        sa_select(Lead).where(Lead.source_reference_id == "589129524549820420")
    )).scalar_one()
    assert lead.lead_cost_finance_transaction_id is None

    event = (await db_session.execute(
        sa_select(ThumbtackWebhookEvent).where(ThumbtackWebhookEvent.connection_id == conn.id)
    )).scalar_one()
    assert event.status == "processed"
    assert event.error is not None
    assert "lead cost sync failed" in event.error

    r = await client.post(f"/admin/thumbtack/events/{event.id}/retry")

    assert r.status_code == 200
    payload = r.json()
    assert payload["event"]["error"] is None
    # Healing an existing lead's expense is not creating a lead — this retry
    # must not report created=True.
    assert payload["created"] is False
    assert payload["lead_id"] is not None

    await db_session.refresh(lead)
    assert lead.lead_cost_finance_transaction_id is not None

    tx_count = (await db_session.execute(
        sa_select(func.count()).select_from(FinanceTransaction)
        .where(FinanceTransaction.lead_id == lead.id)
    )).scalar()
    assert tx_count == 1

    # `event` was already loaded into this session's identity map before the
    # retry ran on the app's own request-scoped session, so a plain re-select
    # would hand back the stale cached row rather than what retry committed —
    # refresh, the same house pattern used for `lead` above.
    await db_session.refresh(event)
    assert event.error is None
    assert event.status == "processed"


@pytest.mark.asyncio
async def test_retry_event_own_failure_leaves_the_body_and_creates_no_lead(
    client, db_session, monkeypatch
):
    from sqlalchemy import func, select as sa_select

    from app.models.lead import Lead
    from app.services import thumbtack_service

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_handy"
    )

    def _boom_map(_body):
        raise RuntimeError("transient")

    monkeypatch.setattr(thumbtack_service, "map_lead_payload", _boom_map)
    await client.post(f"/ingest/webhook/thumbtack/{conn.url_token}", json=_real_lead_body())
    monkeypatch.undo()

    events = await thumbtack_service.list_events(db_session, connection_id=conn.id)
    event_id = events[0].id
    assert events[0].status == "failed"

    async def _boom_persist(db, conn, event, body):
        raise RuntimeError("still transient")

    monkeypatch.setattr(thumbtack_service, "_persist_lead", _boom_persist)
    r = await client.post(f"/admin/thumbtack/events/{event_id}/retry")
    monkeypatch.undo()

    assert r.status_code == 200
    payload = r.json()
    assert payload["event"]["status"] == "failed"
    assert "still transient" in payload["event"]["error"]
    assert payload["created"] is False

    # `events[0]` was loaded into this session's identity map before retry ran
    # on the app's own request-scoped session — refresh rather than re-select,
    # same house pattern used elsewhere for `lead`.
    stored = events[0]
    await db_session.refresh(stored)
    assert stored.status == "failed"
    assert stored.error is not None
    assert "still transient" in stored.error
    # The raw body — the whole point of retry — survives an in-retry failure.
    assert "589129524549820420" in stored.raw_body

    lead_count = (await db_session.execute(
        sa_select(func.count()).select_from(Lead)
        .where(Lead.source_reference_id == "589129524549820420")
    )).scalar()
    assert lead_count == 0


# ── Final backend fixes: idempotency limbo, cost flags, refund heal, retry
# guards, message timeline ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_redelivery_marks_the_second_event_row_processed(client, db_session):
    """Two Thumbtack deliveries of the same negotiationID land as two event
    rows. The first creates the lead; the second, previously, stayed
    status=received/lead_id=NULL forever, indistinguishable from a delivery
    nobody had looked at, with nothing anywhere acting on it."""
    from sqlalchemy import select as sa_select

    from app.models.thumbtack import ThumbtackWebhookEvent
    from app.services import thumbtack_service

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_handy"
    )
    body = _real_lead_body()
    await client.post(f"/ingest/webhook/thumbtack/{conn.url_token}", json=body)
    await client.post(f"/ingest/webhook/thumbtack/{conn.url_token}", json=body)

    events = await thumbtack_service.list_events(db_session, connection_id=conn.id)
    assert len(events) == 2

    for e in events:
        row = (await db_session.execute(
            sa_select(ThumbtackWebhookEvent).where(ThumbtackWebhookEvent.id == e.id)
        )).scalar_one()
        assert row.status == "processed"
        assert row.lead_id is not None


@pytest.mark.asyncio
async def test_an_unparseable_lead_price_keeps_the_lead_and_flags_the_event(
    client, db_session
):
    """The spec is explicit: a malformed leadPrice leaves cost unset AND
    flags the event. Only the mapper half (cost stays None, never 0) shipped
    before this fix; nothing wrote to event.error, so a lead with a NULL
    cost looked perfectly healthy."""
    from sqlalchemy import select as sa_select

    from app.models.lead import Lead
    from app.models.thumbtack import ThumbtackWebhookEvent
    from app.services import thumbtack_service

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_handy"
    )

    body = _copy.deepcopy(_real_lead_body())
    body["data"]["leadPrice"] = "Free"

    r = await client.post(f"/ingest/webhook/thumbtack/{conn.url_token}", json=body)
    assert r.status_code == 200

    lead = (await db_session.execute(
        sa_select(Lead).where(Lead.source_reference_id == "589129524549820420")
    )).scalar_one()
    # Never substitute 0 for an unknown cost.
    assert lead.lead_cost_cents is None

    event = (await db_session.execute(
        sa_select(ThumbtackWebhookEvent).where(ThumbtackWebhookEvent.connection_id == conn.id)
    )).scalar_one()
    assert event.status == "processed"
    assert event.error is not None
    assert "could not be parsed" in event.error


@pytest.mark.asyncio
async def test_retry_does_not_book_an_expense_for_a_refund_the_db_never_recorded(
    client, db_session, monkeypatch
):
    """chargeState is Refunded, mark_refunded throws, rollback leaves
    lead_refunded_at NULL while lead_cost_cents was already committed. The
    heal must gate on the payload's own chargeState, not that column (which
    is NULL precisely because the refund failed), or a retry books a
    full-price expense for a lead Thumbtack refunded, clears the error, and
    reports success."""
    from sqlalchemy import func, select as sa_select

    from app.models.finance import FinanceTransaction
    from app.models.lead import Lead
    from app.models.thumbtack import ThumbtackWebhookEvent
    from app.services import lead_service, thumbtack_service

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_handy"
    )

    body = _copy.deepcopy(_real_lead_body())
    body["data"]["chargeState"] = "Refunded"

    async def _boom(*args, **kwargs):
        raise RuntimeError("refund sync down")

    monkeypatch.setattr(lead_service, "mark_refunded", _boom)
    r = await client.post(f"/ingest/webhook/thumbtack/{conn.url_token}", json=body)
    monkeypatch.undo()

    assert r.status_code == 200

    lead = (await db_session.execute(
        sa_select(Lead).where(Lead.source_reference_id == "589129524549820420")
    )).scalar_one()
    assert lead.lead_refunded_at is None                    # the failure this hinges on
    assert lead.lead_cost_finance_transaction_id is None
    assert lead.lead_cost_cents is not None                 # committed before the refund attempt

    event = (await db_session.execute(
        sa_select(ThumbtackWebhookEvent).where(ThumbtackWebhookEvent.connection_id == conn.id)
    )).scalar_one()
    assert event.status == "processed"
    assert event.error is not None

    r = await client.post(f"/admin/thumbtack/events/{event.id}/retry")
    assert r.status_code == 200

    await db_session.refresh(lead)
    # The heal must have refused: no expense booked for a refunded lead.
    assert lead.lead_cost_finance_transaction_id is None

    tx_count = (await db_session.execute(
        sa_select(func.count()).select_from(FinanceTransaction)
        .where(FinanceTransaction.lead_id == lead.id)
    )).scalar()
    assert tx_count == 0


@pytest.mark.asyncio
async def test_retrying_an_oversize_rejection_preserves_the_size_diagnostic(
    client, db_session
):
    """record_oversize stores a 2KB truncated prefix with a body-exceeds-limit
    error. That prefix is never valid JSON; retrying it must refuse, not
    overwrite the one thing the row can tell the operator with a generic
    Body-is-not-valid-JSON message."""
    from sqlalchemy import select as sa_select

    from app.models.thumbtack import ThumbtackWebhookEvent
    from app.services import thumbtack_service

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_handy"
    )
    huge = b'{"leadID":"big","padding":"' + b"x" * (thumbtack_service.MAX_BODY_BYTES + 10) + b'"}'
    r = await client.post(
        f"/ingest/webhook/thumbtack/{conn.url_token}",
        content=huge,
        headers={"content-type": "application/json"},
    )
    assert r.status_code == 413

    events = await thumbtack_service.list_events(db_session, connection_id=conn.id)
    assert len(events) == 1
    original_error = events[0].error
    assert original_error is not None
    assert original_error.startswith("Delivery rejected: body exceeds")

    retry_r = await client.post(f"/admin/thumbtack/events/{events[0].id}/retry")
    assert retry_r.status_code == 200
    assert retry_r.json()["event"]["error"] == original_error

    stored = (await db_session.execute(
        sa_select(ThumbtackWebhookEvent).where(ThumbtackWebhookEvent.id == events[0].id)
    )).scalar_one()
    assert stored.error == original_error
    assert "not valid JSON" not in stored.error


@pytest.mark.asyncio
async def test_retrying_a_message_event_does_not_create_a_hollow_lead(client, db_session):
    """MessageCreatedV4 bodies carry data.negotiationID too. record_event
    gates on kind=="lead" before calling _persist_lead; retry_event must
    too, or retrying a message maps it into a hollow Lead with no name,
    phone, or cost, which then wins the idempotency lookup and blocks the
    real lead from ever landing."""
    from sqlalchemy import func, select as sa_select

    from app.models.lead import Lead
    from app.services import thumbtack_service

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_handy"
    )

    message_body = {
        "data": {
            "negotiationID": "589129524549820420",
            "messageID": "msg-9",
            "text": "Can you come Saturday?",
        }
    }
    await client.post(f"/ingest/webhook/thumbtack/{conn.url_token}", json=message_body)

    events = await thumbtack_service.list_events(db_session, connection_id=conn.id)
    assert len(events) == 1
    assert events[0].kind == "message"

    r = await client.post(f"/admin/thumbtack/events/{events[0].id}/retry")
    assert r.status_code == 200
    assert r.json()["created"] is False

    count = (await db_session.execute(
        sa_select(func.count()).select_from(Lead)
        .where(Lead.source_reference_id == "589129524549820420")
    )).scalar()
    assert count == 0

    # The real lead can still land afterward; the message retry must not
    # have poisoned the idempotency lookup with a hollow row.
    await client.post(f"/ingest/webhook/thumbtack/{conn.url_token}", json=_real_lead_body())
    lead = (await db_session.execute(
        sa_select(Lead).where(Lead.source_reference_id == "589129524549820420")
    )).scalar_one()
    assert lead.customer_name is not None


@pytest.mark.asyncio
async def test_a_webhook_lead_opens_with_a_created_timeline_event(client, db_session):
    """_persist_lead constructs Lead(...) directly rather than via
    lead_service.create_lead, which is correct here, but it means
    create_lead's own created LeadEvent has to be replicated by hand, or a
    webhook lead opens with an empty timeline unlike every other lead."""
    from sqlalchemy import select as sa_select

    from app.models.lead import Lead
    from app.models.lead_event import LeadEvent
    from app.services import thumbtack_service

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_handy"
    )
    await client.post(f"/ingest/webhook/thumbtack/{conn.url_token}", json=_real_lead_body())

    lead = (await db_session.execute(
        sa_select(Lead).where(Lead.source_reference_id == "589129524549820420")
    )).scalar_one()

    events = (await db_session.execute(
        sa_select(LeadEvent).where(LeadEvent.lead_id == lead.id)
    )).scalars().all()
    assert any(e.event_type == "created" for e in events)


# ── Residuals round: R1-R4 ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_retry_via_idempotency_hit_clears_a_stale_error_on_a_healthy_lead(
    client, db_session, monkeypatch
):
    """Event A delivers cleanly and books the lead's expense. Event B, a
    redelivery of the same negotiationID, fails mapping transiently. Retrying
    B once mapping works again hits the idempotency lookup (the lead already
    exists via A) rather than the insert path, so the ordinary unconditional
    event.error clear at the bottom of the insert path never runs for B.
    Without a fix, B keeps its stale "Mapping failed" error and a Retry
    button forever, even though the lead it maps to is entirely healthy."""
    from sqlalchemy import select as sa_select

    from app.models.lead import Lead
    from app.services import thumbtack_service

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_handy"
    )
    body = _real_lead_body()

    r = await client.post(f"/ingest/webhook/thumbtack/{conn.url_token}", json=body)
    assert r.status_code == 200

    lead = (await db_session.execute(
        sa_select(Lead).where(Lead.source_reference_id == "589129524549820420")
    )).scalar_one()
    assert lead.lead_cost_finance_transaction_id is not None

    def _boom(_body):
        raise RuntimeError("transient")

    monkeypatch.setattr(thumbtack_service, "map_lead_payload", _boom)
    await client.post(f"/ingest/webhook/thumbtack/{conn.url_token}", json=body)
    monkeypatch.undo()

    events = await thumbtack_service.list_events(db_session, connection_id=conn.id)
    event_b = next(e for e in events if e.status == "failed")
    assert event_b.error is not None

    r = await client.post(f"/admin/thumbtack/events/{event_b.id}/retry")

    assert r.status_code == 200
    payload = r.json()
    assert payload["created"] is False
    assert payload["lead_id"] == lead.id
    assert payload["event"]["status"] == "processed"
    assert payload["event"]["error"] is None


@pytest.mark.asyncio
async def test_retry_fills_a_previously_unparseable_cost_once_it_parses(
    client, db_session, monkeypatch
):
    """Fix 3's flag is correct and stays: an unparseable leadPrice leaves
    lead_cost_cents unset and flags the event, never substituting 0. But
    retry could not previously heal that state at all -- the heal gate
    required a known cost. Retry re-reads the same stored raw body, so if
    the mapper is later fixed, re-mapping it can now yield a real price.
    This simulates that: the stored body never changes, only what the
    mapper does with it."""
    from sqlalchemy import func, select as sa_select

    from app.models.finance import FinanceTransaction
    from app.models.lead import Lead
    from app.models.thumbtack import ThumbtackWebhookEvent
    from app.services import thumbtack_service
    from app.services.thumbtack_mapper import map_lead_payload as real_map_lead_payload

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_handy"
    )

    body = _copy.deepcopy(_real_lead_body())
    body["data"]["leadPrice"] = "Free"

    r = await client.post(f"/ingest/webhook/thumbtack/{conn.url_token}", json=body)
    assert r.status_code == 200

    lead = (await db_session.execute(
        sa_select(Lead).where(Lead.source_reference_id == "589129524549820420")
    )).scalar_one()
    assert lead.lead_cost_cents is None
    assert lead.lead_cost_finance_transaction_id is None

    event = (await db_session.execute(
        sa_select(ThumbtackWebhookEvent).where(ThumbtackWebhookEvent.connection_id == conn.id)
    )).scalar_one()
    assert event.error is not None
    assert "could not be parsed" in event.error

    def _now_parses(raw_body):
        mapped = real_map_lead_payload(raw_body)
        mapped.lead_cost_cents = 1500
        mapped.lead_cost_gross_cents = 1500
        return mapped

    monkeypatch.setattr(thumbtack_service, "map_lead_payload", _now_parses)
    r = await client.post(f"/admin/thumbtack/events/{event.id}/retry")
    monkeypatch.undo()

    assert r.status_code == 200
    payload = r.json()
    assert payload["event"]["error"] is None

    await db_session.refresh(lead)
    # Filled from the (simulated-fixed) re-mapping, never a substituted 0.
    assert lead.lead_cost_cents == 1500
    assert lead.lead_cost_finance_transaction_id is not None

    tx_count = (await db_session.execute(
        sa_select(func.count()).select_from(FinanceTransaction)
        .where(FinanceTransaction.lead_id == lead.id)
    )).scalar()
    assert tx_count == 1


@pytest.mark.asyncio
async def test_retry_of_a_still_unparseable_price_leaves_the_error_in_place(
    client, db_session
):
    """The other half of R2: when the re-mapped body still will not parse,
    the flag must not be silently cleared just because a retry ran."""
    from sqlalchemy import select as sa_select

    from app.models.lead import Lead
    from app.models.thumbtack import ThumbtackWebhookEvent
    from app.services import thumbtack_service

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_handy"
    )

    body = _copy.deepcopy(_real_lead_body())
    body["data"]["leadPrice"] = "Free"

    r = await client.post(f"/ingest/webhook/thumbtack/{conn.url_token}", json=body)
    assert r.status_code == 200

    event = (await db_session.execute(
        sa_select(ThumbtackWebhookEvent).where(ThumbtackWebhookEvent.connection_id == conn.id)
    )).scalar_one()
    original_error = event.error
    assert original_error is not None

    r = await client.post(f"/admin/thumbtack/events/{event.id}/retry")

    assert r.status_code == 200
    payload = r.json()
    assert payload["event"]["error"] == original_error

    lead = (await db_session.execute(
        sa_select(Lead).where(Lead.source_reference_id == "589129524549820420")
    )).scalar_one()
    assert lead.lead_cost_cents is None
    assert lead.lead_cost_finance_transaction_id is None
