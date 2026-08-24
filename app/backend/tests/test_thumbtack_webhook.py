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
