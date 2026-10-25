"""Mapper tests — pure functions, no database.

Everything asserts against the REAL captured payload. A hand-typed
approximation would smuggle back the guesswork Phase 1 existed to remove:
the spec lists seven fields the documentation got wrong.
"""

from __future__ import annotations

import json
from pathlib import Path

_FIXTURES = Path(__file__).parent / "fixtures"


def _lead_body() -> dict:
    return json.loads((_FIXTURES / "thumbtack_lead_v4.json").read_text(encoding="utf-8"))


def _ping_body() -> dict:
    return json.loads((_FIXTURES / "thumbtack_test_ping.json").read_text(encoding="utf-8"))


def test_maps_the_identifier_and_business():
    from app.services.thumbtack_mapper import map_lead_payload

    m = map_lead_payload(_lead_body())

    assert m is not None
    assert m.source_reference_id == "589129524549820420"
    assert m.thumbtack_business_id == "561924958510514187"


def test_joins_the_split_customer_name():
    from app.services.thumbtack_mapper import map_lead_payload

    # The payload has firstName/lastName, NOT a single `name` field — one of
    # the seven documented-wrong assumptions.
    assert map_lead_payload(_lead_body()).customer_name == "Handyman Amenify"


def test_reads_the_category_object_not_a_string():
    from app.models.lead import ServiceType
    from app.services.thumbtack_mapper import map_lead_payload

    # `category` is {categoryID, name}; "Furniture Moving and Heavy Lifting" is moving.
    assert map_lead_payload(_lead_body()).service_type == ServiceType.moving


def test_unknown_category_falls_to_unknown_never_a_guess():
    from app.models.lead import ServiceType
    from app.services.thumbtack_mapper import map_lead_payload

    body = _lead_body()
    body["data"]["request"]["category"]["name"] = "Underwater Basket Weaving"

    assert map_lead_payload(body).service_type == ServiceType.unknown


def test_parses_the_dollar_string_lead_price():
    from app.services.thumbtack_mapper import map_lead_payload

    # leadPrice is the STRING "$15.88", not a number.
    m = map_lead_payload(_lead_body())

    assert m.lead_cost_cents == 1588
    assert m.lead_cost_gross_cents == 1588   # from leadPriceBreakdown.subtotal


def test_a_zero_lead_price_is_a_real_cost_not_a_rejection():
    from app.services.thumbtack_mapper import map_lead_payload

    # Thumbtack issues free leads. 0 must be written, not dropped — do not
    # import the `0 < value` guard that governs quote targets.
    body = _lead_body()
    body["data"]["leadPrice"] = "$0.00"
    body["data"]["leadPriceBreakdown"]["subtotal"] = "$0.00"

    assert map_lead_payload(body).lead_cost_cents == 0


def test_an_unparseable_lead_price_is_left_unset_never_guessed():
    from app.services.thumbtack_mapper import map_lead_payload

    body = _lead_body()
    body["data"]["leadPrice"] = "see dashboard"

    assert map_lead_payload(body).lead_cost_cents is None


def test_proposed_times_become_date_options():
    from app.services.thumbtack_mapper import map_lead_payload

    # `schedule` does not exist; proposedTimes is an array of ISO ranges.
    options = map_lead_payload(_lead_body()).move_date_options

    assert options == ["2026-09-01", "2026-09-02", "2026-09-03"]


def test_location_is_city_level_because_the_street_field_is_empty():
    from app.services.thumbtack_mapper import map_lead_payload

    # address1/address2 are empty strings on every observed lead.
    assert map_lead_payload(_lead_body()).job_location == "Saint Louis, MO 63144"


def test_details_reach_quote_context_as_question_and_answer():
    from app.services.thumbtack_mapper import map_lead_payload

    ctx = map_lead_payload(_lead_body()).quote_context

    assert ctx is not None
    assert "Move distance" in ctx
    assert "Less than 5 miles" in ctx
    assert "11-20 items" in ctx


def test_description_becomes_scope_notes():
    from app.services.thumbtack_mapper import map_lead_payload

    notes = map_lead_payload(_lead_body()).scope_notes

    assert notes is not None
    assert "Queen bed + mattress" in notes


def test_flags_an_address_in_another_state():
    from app.services.thumbtack_mapper import map_lead_payload

    # location says Saint Louis MO 63144; the description gives a CT address.
    # He was charged $15.88 for this lead.
    mismatch = map_lead_payload(_lead_body()).location_mismatch

    assert mismatch is not None
    assert "CT" in mismatch or "06470" in mismatch


def test_does_not_flag_a_same_metro_zip():
    from app.services.thumbtack_mapper import map_lead_payload

    body = _lead_body()
    # 63105 is Clayton — same metro as 63144. Must not fire.
    body["data"]["request"]["description"] = "Job at 123 Main St, 63105"

    assert map_lead_payload(body).location_mismatch is None


def test_does_not_flag_a_description_with_no_location_at_all():
    from app.services.thumbtack_mapper import map_lead_payload

    body = _lead_body()
    body["data"]["request"]["description"] = "Couch and a dresser, ground floor"

    assert map_lead_payload(body).location_mismatch is None


def test_flags_an_oklahoma_address_the_old_denylist_silently_missed():
    from app.services.thumbtack_mapper import map_lead_payload

    # OK is Oklahoma, a real USPS code — the old denylist excluded it as
    # "prose word" and would never fire on it. This is the case that costs
    # a lead fee and a wasted call when it goes unflagged.
    body = _lead_body()
    body["data"]["request"]["description"] = "Job at 123 Main St, Tulsa, OK 74103"

    assert map_lead_payload(body).location_mismatch is not None


def test_does_not_flag_a_po_box_in_the_description():
    from app.services.thumbtack_mapper import map_lead_payload

    # "PO Box" is ordinary address prose, not a state code, and must not fire
    # on the allow-list.
    body = _lead_body()
    body["data"]["request"]["description"] = "PO Box 4410, deliver to lobby"

    assert map_lead_payload(body).location_mismatch is None


def test_refunded_charge_state_is_detected():
    from app.services.thumbtack_mapper import map_lead_payload

    assert map_lead_payload(_lead_body()).is_refunded is False

    body = _lead_body()
    body["data"]["chargeState"] = "Refunded"
    assert map_lead_payload(body).is_refunded is True


def test_the_test_ping_maps_to_nothing():
    from app.services.thumbtack_mapper import map_lead_payload

    # No negotiationID — it is a handshake, not a lead. Returning a MappedLead
    # here would put a junk row in the queue every time a webhook is saved.
    assert map_lead_payload(_ping_body()) is None
