# Thumbtack Webhooks — Phase 2 (Leads and Alerts) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a stored Thumbtack delivery into a lead in the facilitator queue and a push notification on the owner's phone.

**Architecture:** A pure mapper converts the captured payload into Lead field values. A persister creates the lead, wires the cost into the existing finance sync, and notifies. Both run from `record_event` **after** the raw body is committed, so a mapping failure marks the event `failed` and leaves the body intact for retry — a delivery is never lost because mapping broke.

**Tech Stack:** Python 3, FastAPI, SQLAlchemy async + aiosqlite, pytest + pytest-asyncio + httpx `AsyncClient`; React 18 + TypeScript (one small admin addition).

**Spec:** `docs/superpowers/specs/2026-09-01-thumbtack-phase-2-design.md`

**Branch:** create `feat/thumbtack-phase-2` off `main`

## Global Constraints

- **Test baseline is 480 collected tests** (`python -m pytest --collect-only -q`, verified on merged `main` 2026-09-01). Do not regress it. `CLAUDE.md` claims 108; it is stale — ignore it.
- **No database migration.** Every column this writes already exists on `Lead`.
- **The raw body is committed before mapping runs.** Mapping is best-effort and can never turn a delivered event into a lost one.
- **The customer's phone is a Thumbtack proxy line, never their real number.** `customer_phone_is_proxy` must be set `True`.
- **Money is whole cents as `int`,** parsed by the existing `ocr_service.parse_cents`. Never float, never a new parser.
- **Zero is a real lead cost.** `parse_cents("$0.00")` returns `0` and Thumbtack issues free leads. Do **not** import the `0 < value` guard from `ai_review_service._validate_money` — that governs quote targets, where zero is impossible. Here it is not.
- **A cost that will not parse is left unset,** never guessed.
- **Out-of-area leads are flagged, never suppressed.** He paid for the lead; hiding it loses both the job and the refund case.
- **Raw bodies carry customer PII.** Never log them at `info` level.
- Backend business logic lives in services; routers own only HTTP.

## Decisions made while planning

1. **The mapper is a pure function, separate from persistence.** `map_lead_payload(data, connection) -> MappedLead` takes a dict and returns values; a second function writes them. The mapping is where every one of the seven payload corrections lives and is the part most likely to need changing when a new category or field appears — it must be testable against a fixture without a database.
2. **The real captured body is checked into the test suite as a fixture.** Tests written against a hand-typed approximation would re-introduce exactly the guesswork Phase 1 existed to eliminate. The fixture is the observed body with name, phone, and street redacted.
3. **`_LOCATION_MISMATCH` detection lives in the mapper**, not the persister, so it is testable without a DB and so the flag travels with the mapped values.
4. **The flag is stored in `quote_context`, not a new column.** The spec adds no migration, and `quote_context` is already free-text carried into the AI review — which is the one place a "this address may be elsewhere" warning is most useful. A dedicated column would be cleaner but is a schema change the spec forbids.
5. **AI review is NOT auto-run in this plan.** The Phase 1 spec assumed it and flagged it unconfirmed; it is still unconfirmed. Adding a paid model call per inbound lead without explicit approval is not mine to decide. The lead lands with all its data and Ron taps "Run AI review" as he does today. Flagged in the handoff.

## File Structure

**Backend — create**

| File | Responsibility |
|---|---|
| `app/backend/app/services/thumbtack_mapper.py` | Pure payload → Lead-field mapping, category mapping, mismatch detection. No DB, no I/O. |
| `app/backend/tests/fixtures/thumbtack_lead_v4.json` | The real captured body, redacted. The authority the mapper is tested against. |
| `app/backend/tests/fixtures/thumbtack_test_ping.json` | The real captured test ping, redacted. |
| `app/backend/tests/test_thumbtack_mapper.py` | Mapper tests — no database needed. |

**Backend — modify**

| File | Change |
|---|---|
| `app/backend/app/services/thumbtack_service.py` | `_persist_lead()`; call it from `record_event` after the commit; add `retry_event()` |
| `app/backend/app/routers/thumbtack.py` | `POST /admin/thumbtack/events/{id}/retry` |
| `app/backend/app/schemas/thumbtack.py` | `EventOut` gains nothing; add `RetryResult` |
| `app/backend/tests/test_thumbtack_webhook.py` | Persistence, idempotency, notification, retry |

**Frontend — modify**

| File | Change |
|---|---|
| `app/frontend/src/types/thumbtack.ts` | `RetryResult` type |
| `app/frontend/src/hooks/useThumbtack.ts` | `useRetryThumbtackEvent()` |
| `app/frontend/src/screens/AdminThumbtackScreen.tsx` | Retry button on `failed` / `unknown` rows |

---

### Task 1: Capture the real payloads as fixtures

**Files:**
- Create: `app/backend/tests/fixtures/thumbtack_lead_v4.json`
- Create: `app/backend/tests/fixtures/thumbtack_test_ping.json`

**Interfaces:**
- Produces: two JSON fixtures every later task loads

**Why this is its own task.** Every mapping test asserts against these. A hand-typed approximation would smuggle back the guesswork Phase 1 was built to kill, and the seven corrections in the spec exist precisely because the guesses were wrong.

- [ ] **Step 1: Create the lead fixture**

Create `app/backend/tests/fixtures/thumbtack_lead_v4.json` with exactly this content. It is the real delivery received 2026-09-01, with the customer name, phone, and street address replaced — the field names, nesting, and value *shapes* are untouched:

```json
{
  "event": {
    "eventType": "NegotiationCreatedV4",
    "description": "",
    "webhookID": "588474365069058060",
    "triggeredAt": "2026-09-01T15:05:50Z"
  },
  "data": {
    "negotiationID": "589129524549820420",
    "createdAt": "2026-09-01T15:05:24Z",
    "customer": {
      "customerID": "540228627464085518",
      "firstName": "Handyman",
      "lastName": "Amenify",
      "phone": "3145550142"
    },
    "business": {
      "businessID": "561924958510514187",
      "name": "Holy Handy",
      "imageURL": "https://production-next-images-cdn.thumbtack.com/i/561925159748116492/desktop/standard/fullscreen",
      "accessCode": "9363089"
    },
    "request": {
      "requestID": "589129468107235335",
      "customerID": "540228627464085518",
      "contactedBusinesses": [],
      "description": "Date: September 19\n Pickup/source: POD in the parking lot next to the apartment building\n Destination: Apartment at the same property\n Access: 1st floor, no stairs\nFurniture:\n\nQueen bed + mattress\nHeadboard\nFoot trunk\nTall dresser\n2 end tables\nDresser with mirror\nChair-and-a-half\n3-seat couch\nCoffee table\nDining table + 4 chairs\nServer\n2 large lamps\nAdditional boxes \nAddress- 9 Redacted Road, Newtown, CT, USA, 06470",
      "category": {
        "categoryID": "234041504938762645",
        "name": "Furniture Moving and Heavy Lifting"
      },
      "proposedTimes": [
        { "start": "2026-09-01T05:00:00Z", "end": "2026-09-02T04:59:00Z" },
        { "start": "2026-09-02T05:00:00Z", "end": "2026-09-03T04:59:00Z" },
        { "start": "2026-09-03T05:00:00Z", "end": "2026-09-04T04:59:00Z" }
      ],
      "location": {
        "address1": "",
        "address2": "",
        "city": "Saint Louis",
        "state": "MO",
        "zipCode": "63144"
      },
      "travelPreferences": ["ProviderTravelToCustomer"],
      "details": [
        { "question": "Move distance", "answer": "Less than 5 miles" },
        { "question": "Type of furniture", "answer": "Other furniture items" },
        { "question": "Loading method", "answer": "No change in floors to load items" },
        { "question": "Category", "answer": "Furniture Moving and Heavy Lifting" },
        { "question": "Scheduling", "answer": "Dates: Sep 1-3" },
        { "question": "Large items to move (longer than 4 feet)", "answer": "11-20 items" },
        { "question": "Travel Preferences", "answer": "The furniture mover travels to me" },
        { "question": "Unloading method", "answer": "No change in floors to unload items" },
        { "question": "Zip code", "answer": "63144" }
      ],
      "attachments": []
    },
    "estimate": {
      "type": "PerUnit",
      "pricePerUnit": "120.00",
      "unitQuantity": 0,
      "unitName": "Hour",
      "total": "$120/hour"
    },
    "status": "Open",
    "leadPrice": "$15.88",
    "leadPriceBreakdown": { "subtotal": "$15.88", "salesTax": "$0.00" },
    "chargeState": "Charged",
    "refundRequestLink": "https://www.thumbtack.com/generic-survey/REQUEST_A_REFUND?negotiation-pk=589129524549820420"
  }
}
```

- [ ] **Step 2: Create the test-ping fixture**

Create `app/backend/tests/fixtures/thumbtack_test_ping.json`. Only the tail of the real ping was captured; this reconstructs it with the observed markers, which is all any test asserts on:

```json
{
  "event": {
    "eventType": "NegotiationCreatedV4",
    "description": "",
    "webhookID": "588474365069058060",
    "triggeredAt": "2026-08-25T12:00:00Z"
  },
  "data": {
    "request": {
      "description": "Test request",
      "details": [
        { "question": "Frequency", "answer": "One time only" },
        { "question": "Zip code", "answer": "95010, 78901" },
        { "question": "Travel Preferences", "answer": "The lawn professional travels to me" }
      ],
      "attachments": [
        {
          "fileName": "test_request_attachment.jpg",
          "fileSize": 20,
          "mimeType": "image/jpeg",
          "url": "https://www.thumbtack.com/attachment/b180b7d3bf981dd2896732f979f44fbf45fc4224/test_request_attachment.jpg",
          "description": "test request attachment"
        }
      ]
    },
    "estimate": {
      "type": "Fixed",
      "pricePerUnit": "150.00",
      "unitQuantity": 1,
      "unitName": "service",
      "total": "$150.00"
    },
    "status": "Open",
    "leadPrice": "$25.00",
    "leadPriceBreakdown": { "subtotal": "$23.15", "salesTax": "$1.85" },
    "chargeState": "Created"
  }
}
```

Note it has **no `negotiationID`** — that is why the live one classified as `unknown`, and why the test ping is excluded by construction.

- [ ] **Step 3: Verify both parse**

Run: `cd app/backend && python -c "import json; [print(p, 'ok') for p in ['tests/fixtures/thumbtack_lead_v4.json','tests/fixtures/thumbtack_test_ping.json'] if json.load(open(p))]"`
Expected: both print `ok`.

- [ ] **Step 4: Commit**

```bash
git add app/backend/tests/fixtures/
git commit -m "test(thumbtack): check in the real captured payloads as fixtures"
```

---

### Task 2: The mapper

**Files:**
- Create: `app/backend/app/services/thumbtack_mapper.py`
- Create: `app/backend/tests/test_thumbtack_mapper.py`

**Interfaces:**
- Consumes: the fixtures from Task 1; `ocr_service.parse_cents`
- Produces:
  - `MappedLead` dataclass — fields: `source_reference_id: str`, `customer_name: str | None`, `customer_phone: str | None`, `scope_notes: str | None`, `service_type: ServiceType`, `job_location: str | None`, `quote_context: str | None`, `move_date_options: list[str]`, `lead_cost_cents: int | None`, `lead_cost_gross_cents: int | None`, `is_refunded: bool`, `thumbtack_business_id: str | None`, `location_mismatch: str | None`
  - `map_lead_payload(body: dict) -> MappedLead | None` — `None` when the body carries no `negotiationID`
  - `CATEGORY_TO_SERVICE: dict[str, ServiceType]`

- [ ] **Step 1: Write the failing tests**

Create `app/backend/tests/test_thumbtack_mapper.py`:

```python
"""Mapper tests — pure functions, no database.

Everything asserts against the REAL captured payload. A hand-typed
approximation would smuggle back the guesswork Phase 1 existed to remove:
the spec lists seven fields the documentation got wrong.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app/backend && python -m pytest tests/test_thumbtack_mapper.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.thumbtack_mapper'`

- [ ] **Step 3: Write the mapper**

Create `app/backend/app/services/thumbtack_mapper.py`:

```python
"""Pure mapping from a Thumbtack V4 webhook payload to Lead field values.

No database, no I/O. Every assumption here is checked against the real
captured body in tests/fixtures/thumbtack_lead_v4.json — the published
documentation was wrong about seven fields, so the fixture is the authority.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime

from app.models.lead import ServiceType
from app.services.ocr_service import parse_cents

# Thumbtack category names seen or expected on this account. Anything not
# listed maps to `unknown` — a wrong service type is worse than an absent one,
# because it silently steers the pricing SOP down the wrong branch.
CATEGORY_TO_SERVICE: dict[str, ServiceType] = {
    "furniture moving and heavy lifting": ServiceType.moving,
    "local moving (under 50 miles)": ServiceType.moving,
    "long distance moving": ServiceType.moving,
    "packing and unpacking": ServiceType.moving,
    "junk removal": ServiceType.hauling,
    "trash removal": ServiceType.hauling,
    "hauling": ServiceType.hauling,
    "furniture removal": ServiceType.hauling,
}

_ZIP = re.compile(r"\b(\d{5})\b")
_STATE = re.compile(r"\b([A-Z]{2})\b")

# Two-letter tokens that appear in ordinary prose and are not state codes.
_NOT_STATES = {"AM", "PM", "OK", "TV", "AC", "ID", "IT", "NO", "SO", "US", "USA"}


@dataclass
class MappedLead:
    """Lead field values derived from one Thumbtack payload."""
    source_reference_id: str
    customer_name: str | None = None
    customer_phone: str | None = None
    scope_notes: str | None = None
    service_type: ServiceType = ServiceType.unknown
    job_location: str | None = None
    quote_context: str | None = None
    move_date_options: list[str] = field(default_factory=list)
    lead_cost_cents: int | None = None
    lead_cost_gross_cents: int | None = None
    is_refunded: bool = False
    thumbtack_business_id: str | None = None
    location_mismatch: str | None = None


def _service_type(category_name: str | None) -> ServiceType:
    if not category_name:
        return ServiceType.unknown
    return CATEGORY_TO_SERVICE.get(category_name.strip().lower(), ServiceType.unknown)


def _job_location(location: dict) -> str | None:
    """City-level only.

    `address1` and `address2` are empty strings on every observed lead — the
    street address, when it exists at all, is buried in the description prose.
    Extracting it from free text is a separate project; the facilitator reads
    the description.
    """
    city = (location.get("city") or "").strip()
    state = (location.get("state") or "").strip()
    zipcode = (location.get("zipCode") or "").strip()
    head = ", ".join(p for p in (city, state) if p)
    return " ".join(p for p in (head, zipcode) if p) or None


def _date_options(proposed_times: list) -> list[str]:
    """ISO start/end ranges -> distinct YYYY-MM-DD start dates, in order."""
    out: list[str] = []
    for slot in proposed_times or []:
        start = slot.get("start") if isinstance(slot, dict) else None
        if not start:
            continue
        try:
            day = datetime.fromisoformat(start.replace("Z", "+00:00")).date().isoformat()
        except (ValueError, AttributeError):
            continue
        if day not in out:
            out.append(day)
    return out


def _quote_context(details: list) -> str | None:
    lines = [
        f"{d.get('question')}: {d.get('answer')}"
        for d in details or []
        if isinstance(d, dict) and d.get("question") and d.get("answer")
    ]
    return "\n".join(lines) or None


def _location_mismatch(description: str | None, location: dict) -> str | None:
    """Warn when the description points somewhere other than the search area.

    A heuristic over free text, and deliberately narrow: it only ever ADDS a
    warning, so a false negative costs nothing and a false positive costs a
    glance. A zip differing only in its later digits is the same metro and must
    not fire — 63144 and 63105 are both St. Louis.
    """
    if not description:
        return None

    found: list[str] = []
    home_zip = (location.get("zipCode") or "").strip()
    home_state = (location.get("state") or "").strip().upper()

    if home_zip:
        for zipcode in _ZIP.findall(description):
            if zipcode != home_zip and zipcode[0] != home_zip[0]:
                found.append(zipcode)
                break

    if home_state:
        for state in _STATE.findall(description):
            if state in _NOT_STATES or state == home_state:
                continue
            found.append(state)
            break

    if not found:
        return None
    return (
        f"Description mentions {' / '.join(found)}, but this lead's service area is "
        f"{home_state} {home_zip}".strip()
    )


def map_lead_payload(body: dict) -> MappedLead | None:
    """Map a NegotiationCreatedV4 body to Lead values, or None if it is not a lead.

    The test ping Thumbtack sends on webhook creation carries no
    `negotiationID`; returning None keeps it out of the queue.
    """
    if not isinstance(body, dict):
        return None
    data = body.get("data")
    if not isinstance(data, dict):
        return None

    negotiation_id = data.get("negotiationID")
    if not negotiation_id:
        return None

    customer = data.get("customer") or {}
    business = data.get("business") or {}
    request = data.get("request") or {}
    location = request.get("location") or {}
    breakdown = data.get("leadPriceBreakdown") or {}

    name = " ".join(
        p for p in (customer.get("firstName"), customer.get("lastName")) if p
    ).strip() or None

    return MappedLead(
        source_reference_id=str(negotiation_id),
        customer_name=name,
        customer_phone=(customer.get("phone") or None),
        scope_notes=(request.get("description") or None),
        service_type=_service_type((request.get("category") or {}).get("name")),
        job_location=_job_location(location),
        quote_context=_quote_context(request.get("details")),
        move_date_options=_date_options(request.get("proposedTimes")),
        lead_cost_cents=parse_cents(data.get("leadPrice")),
        lead_cost_gross_cents=parse_cents(breakdown.get("subtotal")),
        is_refunded=str(data.get("chargeState", "")).strip().lower() == "refunded",
        thumbtack_business_id=(business.get("businessID") or None),
        location_mismatch=_location_mismatch(request.get("description"), location),
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app/backend && python -m pytest tests/test_thumbtack_mapper.py -q`
Expected: 15 passed

- [ ] **Step 5: Run the full suite**

Run: `cd app/backend && python -m pytest -q 2>&1 | tail -3`
Expected: 495 passed (480 + 15). If a pre-existing test fails, STOP and report.

- [ ] **Step 6: Commit**

```bash
git add app/backend/app/services/thumbtack_mapper.py app/backend/tests/test_thumbtack_mapper.py
git commit -m "feat(thumbtack): map the V4 payload to Lead values"
```

---

### Task 3: Persist the lead

**Files:**
- Modify: `app/backend/app/services/thumbtack_service.py`
- Test: `app/backend/tests/test_thumbtack_webhook.py` (append)

**Interfaces:**
- Consumes: `map_lead_payload`, `MappedLead` from Task 2
- Produces: `async _persist_lead(db, conn, event, body) -> str | None` — returns the lead id, or `None` when the body maps to nothing

- [ ] **Step 1: Write the failing tests**

Append to `app/backend/tests/test_thumbtack_webhook.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app/backend && python -m pytest tests/test_thumbtack_webhook.py -q -k "creates_a_lead or proxy or redelivery or test_ping_creates or mismatch_reaches or mapping_failure"`
Expected: FAIL — no lead is created, because nothing maps yet.

- [ ] **Step 3: Write the persister**

In `app/backend/app/services/thumbtack_service.py`, add these imports to the existing import block:

```python
from app.models.lead import Lead, LeadSourceType, LeadStatus
from app.services import lead_cost_service, lead_service, push_service
from app.services.thumbtack_mapper import map_lead_payload
```

`LeadSourceType` is required — `_persist_lead` sets `source_type=LeadSourceType.thumbtack_api`.

Then add `_persist_lead` above `record_event`:

```python
async def _persist_lead(
    db: AsyncSession,
    conn: ThumbtackConnection,
    event: ThumbtackWebhookEvent,
    body: dict,
) -> Optional[str]:
    """Create a Lead from a captured delivery. Returns the lead id, or None.

    Runs AFTER the raw body is committed, so a failure here marks the event and
    leaves the body intact for retry. A delivery is never lost because mapping
    broke.
    """
    mapped = map_lead_payload(body)
    if mapped is None:
        return None   # test ping, or a body carrying no negotiationID

    existing = await db.execute(
        select(Lead).where(Lead.source_reference_id == mapped.source_reference_id).limit(1)
    )
    already = existing.scalar_one_or_none()
    if already is not None:
        return already.id   # Thumbtack retries; one delivery, one lead

    quote_context = mapped.quote_context
    if mapped.location_mismatch:
        # Stored here rather than a new column: the spec forbids a migration,
        # and quote_context is carried into the AI review, which is where a
        # "this may be elsewhere" warning is most useful.
        quote_context = "\n\n".join(
            p for p in (quote_context, f"[WARNING] {mapped.location_mismatch}") if p
        )

    lead = Lead(
        id=lead_service._id(),
        city_id=conn.city_id,
        source_type=LeadSourceType.thumbtack_api,
        source_reference_id=mapped.source_reference_id,
        source_business=conn.business,
        thumbtack_business_id=mapped.thumbtack_business_id,
        customer_name=mapped.customer_name,
        customer_phone=mapped.customer_phone,
        # A Thumbtack number routes to the customer and is not theirs.
        customer_phone_is_proxy=bool(mapped.customer_phone),
        service_type=mapped.service_type,
        job_location=mapped.job_location,
        scope_notes=mapped.scope_notes,
        quote_context=quote_context,
        move_date_options=json.dumps(mapped.move_date_options) if mapped.move_date_options else None,
        lead_cost_cents=mapped.lead_cost_cents,
        lead_cost_gross_cents=mapped.lead_cost_gross_cents,
        raw_payload=event.raw_body,
        status=LeadStatus.new,
        urgency_flag=False,
        ingested_by="thumbtack_webhook",
        created_at=lead_service._now(),
        updated_at=lead_service._now(),
    )
    db.add(lead)
    await db.commit()
    await db.refresh(lead)

    if mapped.is_refunded:
        # Signature is mark_refunded(db, lead_id, on, actor=..., city_id=...) —
        # `on` is a required positional, not a keyword with a default.
        await lead_service.mark_refunded(
            db, lead.id, True, actor="thumbtack_webhook", city_id=conn.city_id
        )

    # Mirrors a manually entered cost into finance. Idempotent via
    # lead_cost_finance_transaction_id, so a redelivery adds no second expense.
    if mapped.lead_cost_cents is not None:
        try:
            await lead_cost_service.sync_lead_cost_expense(db, lead)
            await db.commit()
        except Exception:
            logger.exception("thumbtack lead cost sync failed lead=%s", lead.id)

    event.lead_id = lead.id
    event.status = "processed"
    event.processed_at = _now()
    await db.commit()

    return lead.id
```

**Do not** call `mark_refunded` before the lead is committed — it writes an audit event against the lead id.

- [ ] **Step 4: Call it from record_event**

In `record_event`, find the block that ends:

```python
    await db.commit()
    await db.refresh(event)
    # Deliberately not logging the body: it carries customer name, phone, and address.
    logger.info(
        "thumbtack webhook recorded connection=%s kind=%s status=%s",
        conn.id, kind, status,
    )
    return event
```

Insert the mapping call **between** `db.refresh(event)` and the `logger.info` line:

```python
    await db.commit()
    await db.refresh(event)

    # Everything past this point is best-effort. The body is already committed,
    # so a mapping failure marks the event and can never lose the delivery.
    if kind == "lead" and status == "received":
        try:
            await _persist_lead(db, conn, event, parsed)
        except Exception as exc:
            await db.rollback()
            event.status = "failed"
            event.error = f"Mapping failed: {exc}"
            await db.commit()
            logger.exception("thumbtack lead mapping failed event=%s", event.id)

    # Deliberately not logging the body: it carries customer name, phone, and address.
```

`parsed` is in scope from the `try` block above; it is only bound when JSON parsing succeeded, which is exactly when `status == "received"`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd app/backend && python -m pytest tests/test_thumbtack_webhook.py -q`
Expected: all pass, 6 new

- [ ] **Step 6: Run the full suite**

Run: `cd app/backend && python -m pytest -q 2>&1 | tail -3`
Expected: 501 passed (495 + 6)

- [ ] **Step 7: Commit**

```bash
git add app/backend/app/services/thumbtack_service.py app/backend/tests/test_thumbtack_webhook.py
git commit -m "feat(thumbtack): a delivery classified as a lead becomes a Lead"
```

---

### Task 4: Notify the phone

**Files:**
- Modify: `app/backend/app/services/thumbtack_service.py` — `_persist_lead`
- Test: `app/backend/tests/test_thumbtack_webhook.py` (append)

**Interfaces:**
- Consumes: `_persist_lead` from Task 3; `push_service.send_push_to_roles(db, roles, message, city_id)`

**This is the feature Ron actually asked for.** Everything before it is plumbing he cannot see.

- [ ] **Step 1: Write the failing tests**

Append to `app/backend/tests/test_thumbtack_webhook.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app/backend && python -m pytest tests/test_thumbtack_webhook.py -q -k "pushes_to_the_facilitator or out_of_area_lead_says or push_failure"`
Expected: FAIL — nothing calls `send_push_to_roles` yet.

- [ ] **Step 3: Add the notification**

In `_persist_lead`, insert this immediately before the final `event.lead_id = lead.id` block:

```python
    # The notification is why any of this matters — he works leads from a truck
    # between other jobs and will not be watching the app.
    first_name = (mapped.customer_name or "New lead").split(" ")[0]
    category = mapped.service_type.value if mapped.service_type else "lead"
    where = mapped.job_location or conn.city_id
    message = f"New Thumbtack lead — {first_name} · {category} · {where}"
    if mapped.location_mismatch:
        message += " · WARNING address may be out of area"

    try:
        await push_service.send_push_to_roles(
            db, ["facilitator", "admin"], message, city_id=conn.city_id
        )
    except Exception:
        # A lead that landed with no ping still beats no lead.
        logger.exception("thumbtack lead push failed lead=%s", lead.id)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app/backend && python -m pytest tests/test_thumbtack_webhook.py -q`
Expected: all pass, 3 new

- [ ] **Step 5: Run the full suite**

Run: `cd app/backend && python -m pytest -q 2>&1 | tail -3`
Expected: 504 passed (501 + 3)

- [ ] **Step 6: Commit**

```bash
git add app/backend/app/services/thumbtack_service.py app/backend/tests/test_thumbtack_webhook.py
git commit -m "feat(thumbtack): push the facilitator when a lead lands"
```

---

### Task 5: Retry a failed delivery

**Files:**
- Modify: `app/backend/app/services/thumbtack_service.py`
- Modify: `app/backend/app/routers/thumbtack.py`
- Modify: `app/backend/app/schemas/thumbtack.py`
- Test: `app/backend/tests/test_thumbtack_webhook.py` (append)

**Interfaces:**
- Consumes: `_persist_lead` from Task 3
- Produces: `async retry_event(db, event_id) -> ThumbtackWebhookEvent | None`; `RetryResult` schema; `POST /admin/thumbtack/events/{event_id}/retry`

**Phase 1 deferred this deliberately** — there was no parser to re-run. There is now, and a stored body that failed to map is exactly what retry is for.

- [ ] **Step 1: Write the failing tests**

Append to `app/backend/tests/test_thumbtack_webhook.py`:

```python
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
    assert r.json()["created"] is True
    lead = (await db_session.execute(
        sa_select(Lead).where(Lead.source_reference_id == "589129524549820420")
    )).scalar_one_or_none()
    assert lead is not None


@pytest.mark.asyncio
async def test_retrying_an_already_processed_delivery_creates_no_duplicate(client, db_session):
    from sqlalchemy import func, select as sa_select

    from app.models.lead import Lead
    from app.services import thumbtack_service

    conn, _ = await thumbtack_service.create_connection(
        db_session, label="HH STL", city_id="st-louis", business="holy_handy"
    )
    await client.post(f"/ingest/webhook/thumbtack/{conn.url_token}", json=_real_lead_body())
    events = await thumbtack_service.list_events(db_session, connection_id=conn.id)

    await client.post(f"/admin/thumbtack/events/{events[0].id}/retry")

    count = (await db_session.execute(
        sa_select(func.count()).select_from(Lead)
        .where(Lead.source_reference_id == "589129524549820420")
    )).scalar()
    assert count == 1


@pytest.mark.asyncio
async def test_retrying_an_unknown_event_id_is_a_404(client):
    r = await client.post("/admin/thumbtack/events/no-such-event/retry")
    assert r.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app/backend && python -m pytest tests/test_thumbtack_webhook.py -q -k "retry"`
Expected: FAIL with 404s — the route does not exist.

- [ ] **Step 3: Add the service function**

In `app/backend/app/services/thumbtack_service.py`, add below `_persist_lead`:

```python
async def retry_event(db: AsyncSession, event_id: str) -> Optional[ThumbtackWebhookEvent]:
    """Re-run mapping over a stored delivery. None when the event does not exist.

    Idempotent by way of _persist_lead's own lookup on source_reference_id —
    retrying a delivery that already produced a lead returns that lead rather
    than making a second one.
    """
    result = await db.execute(
        select(ThumbtackWebhookEvent).where(ThumbtackWebhookEvent.id == event_id).limit(1)
    )
    event = result.scalar_one_or_none()
    if event is None:
        return None

    conn = await get_by_id(db, event.connection_id)
    if conn is None:
        event.status = "failed"
        event.error = "Connection no longer exists"
        await db.commit()
        return event

    try:
        parsed = json.loads(event.raw_body)
    except (json.JSONDecodeError, ValueError) as exc:
        event.status = "failed"
        event.error = f"Body is not valid JSON: {exc}"
        await db.commit()
        return event

    try:
        await _persist_lead(db, conn, event, parsed)
    except Exception as exc:
        await db.rollback()
        event.status = "failed"
        event.error = f"Mapping failed: {exc}"
        await db.commit()
        logger.exception("thumbtack retry failed event=%s", event.id)

    await db.refresh(event)
    return event
```

- [ ] **Step 4: Add the schema**

In `app/backend/app/schemas/thumbtack.py`, append:

```python
class RetryResult(BaseModel):
    """Response for POST /admin/thumbtack/events/{id}/retry."""
    event: EventOut
    created: bool          # True when this retry produced or found a lead
    lead_id: Optional[str] = None
```

- [ ] **Step 5: Add the route**

In `app/backend/app/routers/thumbtack.py`, add `RetryResult` to the schema import, then append below the events listing route:

```python
@router.post("/admin/thumbtack/events/{event_id}/retry", response_model=RetryResult)
async def retry_event(
    event_id: str,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    event = await thumbtack_service.retry_event(db, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    return RetryResult(
        event=EventOut.model_validate(event),
        created=event.lead_id is not None,
        lead_id=event.lead_id,
    )
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd app/backend && python -m pytest tests/test_thumbtack_webhook.py -q`
Expected: all pass, 3 new

- [ ] **Step 7: Run the full suite**

Run: `cd app/backend && python -m pytest -q 2>&1 | tail -3`
Expected: 507 passed (504 + 3)

- [ ] **Step 8: Commit**

```bash
git add app/backend/app/services/thumbtack_service.py app/backend/app/routers/thumbtack.py app/backend/app/schemas/thumbtack.py app/backend/tests/test_thumbtack_webhook.py
git commit -m "feat(thumbtack): retry a delivery whose mapping failed"
```

---

### Task 6: The retry button

**Files:**
- Modify: `app/frontend/src/types/thumbtack.ts`
- Modify: `app/frontend/src/hooks/useThumbtack.ts`
- Modify: `app/frontend/src/screens/AdminThumbtackScreen.tsx`

**Interfaces:**
- Consumes: `POST /admin/thumbtack/events/{id}/retry` from Task 5
- Produces: `useRetryThumbtackEvent()`

- [ ] **Step 1: Add the type**

In `app/frontend/src/types/thumbtack.ts`, append:

```ts
export interface RetryResult {
  event: ThumbtackEvent
  /** True when the retry produced or found a lead. */
  created: boolean
  lead_id: string | null
}
```

- [ ] **Step 2: Add the hook**

In `app/frontend/src/hooks/useThumbtack.ts`, add `RetryResult` to the type import from `../types/thumbtack`, then append:

```ts
export function useRetryThumbtackEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (eventId: string) => {
      const r = await apiFetch(`/admin/thumbtack/events/${eventId}/retry`, { method: 'POST' })
      if (!r.ok) throw new Error(await detail(r, 'Could not retry this delivery'))
      return r.json() as Promise<RetryResult>
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['thumbtack-events'] })
      void qc.invalidateQueries({ queryKey: ['leads'] })
    },
  })
}
```

- [ ] **Step 3: Add the button**

In `app/frontend/src/screens/AdminThumbtackScreen.tsx`, add `useRetryThumbtackEvent` to the existing import from `../hooks/useThumbtack`.

Inside `EventsFeed`, add above the `return`:

```tsx
  const retry = useRetryThumbtackEvent()
  const [retryError, setRetryError] = useState('')
```

Then, inside the `events.map` block, directly after the `{event.error && (...)}` line, add:

```tsx
            {(event.status === 'failed' || event.kind === 'unknown') && (
              <div className="mt-2">
                <button
                  onClick={() => {
                    setRetryError('')
                    retry.mutate(event.id, {
                      onError: err =>
                        setRetryError(err instanceof Error ? err.message : 'Retry failed'),
                    })
                  }}
                  disabled={retry.isPending}
                  className={`${TOUCH} rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white disabled:opacity-40`}
                >
                  {retry.isPending ? 'Retrying…' : 'Retry'}
                </button>
                {retryError && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">{retryError}</p>
                )}
              </div>
            )}
```

The success state is the row re-rendering with `status: processed` after the query invalidates — that is the confirmation. In-progress is the disabled button and changed label; failure is the red line. All three ship here.

- [ ] **Step 4: Verify it type-checks and builds**

Run: `cd app/frontend && npx tsc --noEmit && npm run build`
Expected: clean type-check, successful build.

- [ ] **Step 5: Commit**

```bash
git add app/frontend/src/types/thumbtack.ts app/frontend/src/hooks/useThumbtack.ts app/frontend/src/screens/AdminThumbtackScreen.tsx
git commit -m "feat(thumbtack): retry button on failed and unknown deliveries"
```

---

### Task 7: Documentation and close-out

**Files:**
- Modify: `CAPABILITIES.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Run both suites**

Run: `cd app/backend && python -m pytest -q 2>&1 | tail -3`
Run: `cd app/frontend && npx tsc --noEmit && npm run build`

Record the actual backend number. Do not assert a count you have not seen.

- [ ] **Step 2: Update `CAPABILITIES.md`**

Add under the built-and-working section:

```markdown
### Thumbtack webhooks — Phase 2 (leads and alerts)

- A delivery classified `lead` now becomes a Lead in the facilitator queue: city pinned
  from its connection, business tagged, `leadPrice` parsed into `lead_cost_cents` and
  synced to finance, and the customer's phone recorded as a **Thumbtack proxy line**
  rather than their real number.
- The facilitator's phone is pushed the moment a lead lands. Out-of-area leads say so
  in the notification text.
- **Location mismatch flag.** `location` carries the search area; the street address,
  when present, is only in the description prose. When the description names a zip in a
  different region or a different state, the lead is flagged — never suppressed, since
  the lead was paid for.
- Re-delivery of the same `negotiationID` creates no second lead and no second finance
  expense.
- Thumbtack's synthetic test ping (sent on webhook creation) carries no `negotiationID`
  and creates no lead.
- Failed deliveries can be retried from `/admin/thumbtack`; the stored raw body is
  re-mapped without asking Thumbtack to resend.

**Payload note.** The published Thumbtack documentation is wrong about seven fields —
`customer.name` is actually `firstName`/`lastName`, `category` is an object,
`request.title` does not exist, `schedule` is `proposedTimes[]`, `leadPrice` is the
string `"$15.88"`, `chargeState` is `"Charged"`, and `location.address1` is empty. The
real captured body is checked in at `app/backend/tests/fixtures/thumbtack_lead_v4.json`
and is the authority.

**Not in Phase 2:** photos (`request.attachments[]`), inbound messages, and the AI review
does not auto-run on webhook leads — the facilitator taps Run AI review as with any lead.
Deliveries captured before Phase 2 shipped are not backfilled.
```

- [ ] **Step 3: Update `CHANGELOG.md`**

Add an entry at the top matching the file's existing format. Name the spec (`docs/superpowers/specs/2026-09-01-thumbtack-phase-2-design.md`) and this plan.

- [ ] **Step 4: Commit**

```bash
git add CAPABILITIES.md CHANGELOG.md
git commit -m "docs(thumbtack): record Phase 2 in capabilities and changelog"
```

- [ ] **Step 5: Hand back to Ron**

Report:

1. Deploy — Railway auto-deploys on push to `main`.
2. **Wait for the next real Thumbtack lead.** It should arrive in the queue by itself, and his phone should buzz.
3. Check on the lead: city correct, business tagged, cost showing `$15.88`-style figures, phone marked as a **Thumbtack line** rather than the customer's own, and the requested dates populated from `proposedTimes`.
4. **Two things need his decision, neither blocking:**
   - **Backfill.** Every delivery captured before this shipped is still only a raw row. A script over `thumbtack_webhook_events` can map them, but it was deliberately not written first — proving the mapping on one live lead beats debugging it against a batch.
   - **Should the AI review auto-run on webhook leads?** It does not today. Running it automatically means a paid model call per inbound lead; leaving it manual means one extra tap before the decision card has a number.
5. **Confirm push notifications are actually permitted** on his phone for the app. The lead lands either way, but the alert is the point.

---

## Phase 2 exit criteria

- [ ] Full backend suite passes with no regression from 480
- [ ] Frontend type-checks and builds
- [ ] A real Thumbtack lead appears in the queue by itself
- [ ] His phone is notified
- [ ] The phone number on that lead is marked as a Thumbtack line
- [ ] Lead cost matches what Thumbtack charged
- [ ] An out-of-area lead is flagged rather than hidden

## Not in this plan

Photos (Phase 3), inbound messages (Phase 4), replying to Thumbtack (needs the Partner API),
backfilling captured deliveries, auto-running the AI review, and extracting the street address from
description prose. The Amenify/out-of-area **business** question — whether a meaningful share of
Thumbtack spend is going to broker leads outside the service area — is a commercial investigation,
not a code change, and is deliberately left to Ron.
