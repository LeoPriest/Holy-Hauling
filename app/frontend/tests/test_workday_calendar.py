"""Workday design, stage 6: the calendar (week rows, month grid, needs a
date) at phone width.

Run from app/frontend:  python -m pytest -q tests
"""
from datetime import date, timedelta

import pytest

from workday import PHONE, TABLET, open_app, too_small
from test_workday_jobs import _job

TODAY = date.today()
OTHER = TODAY + timedelta(days=1) if TODAY.weekday() != 5 else TODAY - timedelta(days=1)  # same week


def _jobs():
    return [
        _job(id="j1", customer_name="Ruiz Family", has_google_calendar_event=True, quoted_price_total=520),
        _job(id="j2", customer_name="Priya S.", appointment_time_slot="13:00", quoted_price_total=95),
        _job(id="j3", customer_name="Linda K.", job_date_requested=OTHER.isoformat(), quoted_price_total=640),
        _job(id="j4", customer_name="No Date Dan", job_date_requested=None, quoted_price_total=300),
    ]


def _open(browser, server, role="admin", sync_ok=True, viewport=PHONE, theme="light"):
    jobs = _jobs()

    def answer(method, url, query):
        if method == "GET":
            if url == "/jobs":
                return 200, ([] if "status=completed" in query else jobs)
            return {"/admin/recurring-expenses": (200, []), "/leads": (200, []), "/users": (200, [])}.get(url)
        if method == "POST" and url == "/jobs/j2/sync-google":
            if not sync_ok:
                return 502, {"detail": "Google said no"}
            jobs[1]["has_google_calendar_event"] = True
            return 200, jobs[1]
        return None

    page = open_app(browser, server, answer, role=role, path="/calendar", viewport=viewport, theme=theme)
    page.get_by_role("heading", name="Calendar").wait_for()
    return page


def _today_row(page):
    return page.locator(".wd-day.today")


def test_header_and_view_switch(server, browser):
    page = _open(browser, server)
    assert "confirmed jobs by day" in page.locator("header.wd-hdr").inner_text().lower()
    seg = page.get_by_role("group", name="View")
    assert seg.get_by_role("button", name="Week").get_attribute("aria-pressed") == "true"
    seg.get_by_role("button", name="Month").tap()
    assert seg.get_by_role("button", name="Month").get_attribute("aria-pressed") == "true"


def test_week_rows_today_open_with_job_cards(server, browser):
    page = _open(browser, server)
    assert page.locator(".wd-day").count() == 7
    today = _today_row(page)
    assert "today" in today.inner_text().lower()
    assert "2 jobs" in today.inner_text()
    assert "$615" in today.inner_text()
    head = today.get_by_role("button").first
    assert head.get_attribute("aria-expanded") == "true"
    ruiz = page.locator(".wd-cal-job", has_text="Ruiz Family")
    assert "google synced" in ruiz.inner_text().lower()
    priya = page.locator(".wd-cal-job", has_text="Priya S.")
    assert "local only" in priya.inner_text().lower()
    assert priya.get_by_role("button", name="Open lead").count() == 1
    page.wait_for_timeout(500)
    assert too_small(page) == []


def test_tapping_another_day_opens_it(server, browser):
    page = _open(browser, server)
    other = page.locator(".wd-day", has_text="Linda K.")
    btn = other.get_by_role("button").first
    assert btn.get_attribute("aria-expanded") == "false"
    btn.tap()
    assert btn.get_attribute("aria-expanded") == "true"
    page.wait_for_timeout(500)
    assert other.locator(".wd-cal-job", has_text="Linda K.").is_visible()


def test_sync_to_google(server, browser):
    page = _open(browser, server)
    priya = page.locator(".wd-cal-job", has_text="Priya S.")
    priya.get_by_role("button", name="Sync to Google").tap()
    priya.get_by_text("Google synced").wait_for()
    assert ("POST", "/jobs/j2/sync-google") in page.calls


def test_sync_failure_says_so(server, browser):
    page = _open(browser, server, sync_ok=False)
    priya = page.locator(".wd-cal-job", has_text="Priya S.")
    priya.get_by_role("button", name="Sync to Google").tap()
    priya.get_by_text("Google said no").wait_for()


def test_prev_next_today(server, browser):
    page = _open(browser, server)
    label = page.locator(".wd-cal-label")
    start = label.inner_text()
    page.get_by_role("button", name="Next week").tap()
    assert label.inner_text() != start
    page.get_by_role("button", name="Today", exact=True).tap()
    assert label.inner_text() == start
    page.get_by_role("button", name="Previous week").tap()
    assert label.inner_text() != start


def test_month_grid_dots_and_selected_day(server, browser):
    page = _open(browser, server)
    page.get_by_role("group", name="View").get_by_role("button", name="Month").tap()
    grid = page.get_by_role("grid", name="Month")
    assert grid.locator(".wd-mday").count() == 42
    today = grid.locator(".wd-mday.today")
    assert today.locator(".wd-dot").count() == 2
    other = grid.locator(f"[data-day='{OTHER.isoformat()}']")
    other.tap()
    assert other.get_attribute("aria-pressed") == "true"
    page.locator(".wd-cal-job", has_text="Linda K.").wait_for()
    page.wait_for_timeout(400)
    assert too_small(page) == []


def test_needs_a_date_card(server, browser):
    page = _open(browser, server)
    card = page.locator(".wd-needs")
    card.wait_for()
    assert card.locator(".haz").count() == 1
    toggle = card.get_by_role("button", name="1 job needs a date")
    toggle.tap()
    card.get_by_role("button", name="Set date").tap()
    page.wait_for_url("**/leads/j4")


def test_no_old_colors(server, browser):
    page = _open(browser, server)
    page.wait_for_timeout(400)
    old = page.evaluate("""() => [...document.querySelectorAll('body *')]
        .map(e => e.getAttribute('class') || '')
        .filter(c => /(gray|indigo|violet|purple|orange|blue|emerald|green|amber|red)-\\d/.test(c))""")
    assert old == []


@pytest.mark.parametrize("viewport", [PHONE, TABLET])
def test_no_sideways_scroll(server, browser, viewport):
    page = _open(browser, server, viewport=viewport)
    page.get_by_role("group", name="View").get_by_role("button", name="Month").tap()
    page.wait_for_timeout(400)
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")


def test_crew_sees_open_jobs_not_quotes(server, browser):
    page = _open(browser, server, role="crew")
    assert "$615" not in _today_row(page).inner_text()
    assert page.locator(".wd-cal-job", has_text="Priya S.").get_by_role("button", name="Open jobs").count() == 1
