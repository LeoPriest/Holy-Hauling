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
