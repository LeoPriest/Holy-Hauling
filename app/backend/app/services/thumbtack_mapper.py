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
