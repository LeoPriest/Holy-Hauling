"""Workday design, stage 5: crew jobs (agenda, active card, job detail with
the stepper, items to bring, before/after photos) and the office Jobs list,
at phone width.

Run from app/frontend:  python -m pytest -q tests
"""
import json
from datetime import date, timedelta

import pytest

from workday import PHONE, TABLET, iso, lead, open_app, too_small

TODAY = date.today()


def _job(**over):
    base = {
        "id": "j1", "city_id": "c1", "city_name": "St. Louis", "city_slug": "stl",
        "customer_name": "Ruiz Family", "service_type": "hauling", "job_location": "Lindenwood Park",
        "job_address": "4417 Ivanhoe Ave, St. Louis, MO", "job_date_requested": TODAY.isoformat(),
        "appointment_time_slot": "10:00", "estimated_job_duration_minutes": 120,
        "scope_notes": "Gate code 4411. Dog in the yard.", "crew": ["marisol"],
        "customer_phone": None, "quote_context": None, "quoted_price_total": None, "quote_modifiers": None,
        "has_google_calendar_event": False, "job_phase": None, "dispatched_at": None, "en_route_at": None,
        "arrived_at": None, "started_at": None, "realized_revenue_cents": None, "completed_at": None,
    }
    base.update(over)
    return base


ACTIVE = _job(job_phase="en_route", dispatched_at=iso(40), en_route_at=iso(20))
JOBS = [
    ACTIVE,
    _job(id="j2", customer_name="Priya S.", appointment_time_slot="13:00", job_address="7700 Forsyth Blvd, Clayton, MO", scope_notes=None),
    _job(id="j3", customer_name="Linda K.", job_date_requested=(TODAY + timedelta(days=1)).isoformat(), appointment_time_slot="09:00", scope_notes=None),
]
DONE = [_job(id="j9", customer_name="Old Job", job_phase=None, realized_revenue_cents=42000, completed_at=iso(3000))]
CHECKLIST = [
    {"id": "c1", "lead_id": "j1", "label": "Dolly", "is_checked": False, "source": "standard", "sort_order": 1, "created_at": iso(9), "updated_at": iso(9)},
    {"id": "c2", "lead_id": "j1", "label": "Paint can bags", "is_checked": True, "source": "scope", "sort_order": 2, "created_at": iso(9), "updated_at": iso(9)},
]


def _open(browser, server, role="crew", jobs=None, viewport=PHONE, theme="light", status_ok=True):
    data = JOBS if jobs is None else jobs

    def answer(method, url, query):
        if method == "GET":
            if url == "/jobs":
                return 200, (DONE if "status=completed" in query else data)
            job_id = url.split("/")[2] if url.startswith("/leads/") else None
            if job_id and url == f"/leads/{job_id}":
                return 200, lead(id=job_id, customer_name="Ruiz Family", screenshots=[], events=[])
            if job_id and url.endswith("/checklist"):
                return 200, CHECKLIST if job_id == "j1" else []
            return {"/users": (200, []), "/leads": (200, [])}.get(url)
        if method == "PATCH" and url.startswith("/jobs/") and url.endswith("/status"):
            return (200, ACTIVE) if status_ok else (500, {"detail": "no"})
        if method == "PATCH" and "/checklist/" in url:
            return 200, dict(CHECKLIST[0], is_checked=True)
        return None

    page = open_app(browser, server, answer, role=role, path="/jobs", viewport=viewport, theme=theme)
    page.get_by_role("heading", name="Jobs").wait_for()
    return page


def _office_open(page, name="Ruiz Family"):
    """Office roles land on Scheduled; an active job sits under In progress."""
    page.get_by_role("group", name="Show").get_by_role("button", name="In progress").tap()
    page.get_by_role("button", name=name).first.tap()


def _sent(page, method, url):
    return [json.loads(b) for m, u, b in page.bodies if m == method and u == url and b]


def test_crew_header_and_segments(server, browser):
    page = _open(browser, server)
    hdr = page.locator("header.wd-hdr")
    assert "marisol" in hdr.inner_text().lower()
    seg = page.get_by_role("group", name="Show")
    assert seg.get_by_role("button", name="Upcoming").get_attribute("aria-pressed") == "true"
    seg.get_by_role("button", name="Completed").tap()
    page.get_by_text("Old Job").wait_for()
    assert "$420" in page.locator("main").inner_text()


def test_crew_active_card_and_agenda_rows(server, browser):
    page = _open(browser, server)
    card = page.locator(".wd-act")
    assert "ruiz family" in card.inner_text().lower()
    assert "en route" in card.inner_text().lower()
    row = page.locator(".wd-ag", has_text="Priya S.")
    assert "1:00 PM" in row.inner_text()
    go = row.get_by_role("link", name="Go")
    assert "Forsyth" in (go.get_attribute("href") or "").replace("%20", " ")
    assert page.get_by_text("Tomorrow", exact=True).count() == 1
    page.wait_for_timeout(400)
    assert too_small(page) == []


def test_job_detail_stepper_checklist_photos(server, browser):
    page = _open(browser, server)
    page.get_by_role("button", name="Continue job").tap()
    detail = page.get_by_role("dialog", name="Ruiz Family")
    detail.wait_for()
    steps = detail.get_by_role("list", name="Job progress")
    labels = [li.inner_text().strip().lower() for li in steps.get_by_role("listitem").all()]
    assert [l.split("\n")[-1] for l in labels] == ["dispatched", "en route", "on site", "working", "done"]
    assert "en route" in steps.locator("[aria-current=step]").inner_text().lower()
    # Crew can't move a job along (the server only lets supervisors and admins).
    assert detail.get_by_role("button", name="I've arrived").count() == 0
    assert "gate code 4411" in detail.locator(".wd-heads").inner_text().lower()
    assert "1/2" in detail.inner_text()
    detail.get_by_role("button", name="Check Dolly").tap()
    page.wait_for_timeout(300)
    assert _sent(page, "PATCH", "/leads/j1/checklist/c1") == [{"is_checked": True}]
    assert detail.get_by_text("Before", exact=True).count() == 1
    assert detail.get_by_text("After", exact=True).count() == 1
    page.wait_for_timeout(500)
    assert too_small(page) == []
    detail.get_by_role("button", name="Back to jobs").tap()
    page.wait_for_timeout(600)
    assert page.get_by_role("dialog", name="Ruiz Family").count() == 0


def test_supervisor_next_action_moves_the_job(server, browser):
    page = _open(browser, server, role="supervisor")
    _office_open(page)
    detail = page.get_by_role("dialog", name="Ruiz Family")
    detail.get_by_role("button", name="I've arrived").tap()
    page.wait_for_timeout(300)
    assert _sent(page, "PATCH", "/jobs/j1/status") == [{"status": "arrived"}]


def test_finish_job_asks_first(server, browser):
    working = _job(job_phase="started", dispatched_at=iso(200), en_route_at=iso(180), arrived_at=iso(150), started_at=iso(140))
    page = _open(browser, server, role="supervisor", jobs=[working])
    _office_open(page)
    detail = page.get_by_role("dialog", name="Ruiz Family")
    detail.get_by_role("button", name="Finish job").tap()
    detail.get_by_text("Mark job complete?").wait_for()
    assert _sent(page, "PATCH", "/jobs/j1/status") == []
    detail.get_by_role("button", name="Yes, it's done").tap()
    page.wait_for_timeout(300)
    assert _sent(page, "PATCH", "/jobs/j1/status") == [{"status": "completed"}]


def test_status_failure_says_so(server, browser):
    page = _open(browser, server, role="supervisor", status_ok=False)
    _office_open(page)
    detail = page.get_by_role("dialog", name="Ruiz Family")
    detail.get_by_role("button", name="I've arrived").tap()
    detail.get_by_text("Couldn't update the job. Try again.").wait_for()


def test_office_list_tabs_and_cards(server, browser):
    page = _open(browser, server, role="admin")
    seg = page.get_by_role("group", name="Show")
    for name in ("Scheduled", "In progress", "Completed"):
        assert seg.get_by_role("button", name=name).count() == 1, name
    assert page.locator(".wd-card", has_text="Priya S.").count() == 1
    seg.get_by_role("button", name="In progress").tap()
    page.locator(".wd-card", has_text="Ruiz Family").wait_for()
    page.wait_for_timeout(400)
    assert too_small(page) == []


@pytest.mark.parametrize("role", ["crew", "admin"])
def test_jobs_have_no_old_colors_or_hover_titles(server, browser, role):
    page = _open(browser, server, role=role)
    if role == "crew":
        page.get_by_role("button", name="Continue job").tap()
    else:
        _office_open(page)
    page.get_by_role("dialog", name="Ruiz Family").wait_for()
    page.wait_for_timeout(500)
    old = page.evaluate("""() => [...document.querySelectorAll('body *')]
        .map(e => e.getAttribute('class') || '')
        .filter(c => /(gray|indigo|violet|orange|blue|emerald|green|amber|red)-\\d/.test(c))""")
    assert old == []
    assert page.locator("[title]").count() == 0


@pytest.mark.parametrize("viewport", [PHONE, TABLET])
def test_no_sideways_scroll(server, browser, viewport):
    page = _open(browser, server, viewport=viewport)
    page.wait_for_timeout(400)
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")


def test_dark_mode(server, browser):
    page = _open(browser, server, theme="dark")
    assert page.evaluate("getComputedStyle(document.body).backgroundColor") == "rgb(19, 26, 23)"
