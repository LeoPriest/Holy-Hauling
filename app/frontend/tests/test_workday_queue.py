"""Workday design, stage 1: lead queue, lead cards and the dock at phone width.

Builds the frontend, serves dist/ on the test-copy port and
drives it in headless Chromium. Every API call is answered from fixtures in
this file, so no backend, database or outside service is touched.

Run from app/frontend:  python -m pytest -q tests
"""
import http.server
import json
import os
import subprocess
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

FRONTEND = Path(__file__).resolve().parents[1]
PORT = 5192
BASE = f"http://127.0.0.1:{PORT}"
PHONE = {"width": 390, "height": 844}
TABLET = {"width": 1024, "height": 768}
NPM = "npm.cmd" if os.name == "nt" else "npm"


def _iso(minutes_ago: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).strftime("%Y-%m-%dT%H:%M:%S")


def _lead(**over):
    base = {
        "id": "l1", "city_id": "c1", "city_name": "St. Louis", "city_slug": "stl",
        "source_type": "thumbtack_api", "source_reference_id": None, "status": "new",
        "urgency_flag": False, "customer_name": "Dana R.", "customer_phone": "3145550101",
        "service_type": "hauling", "job_location": None, "job_origin": None,
        "job_destination": None, "job_date_requested": None, "job_date_end": None,
        "appointment_time_slot": None, "estimated_job_duration_minutes": None,
        "scope_notes": None, "field_sources": None, "notes": None, "ingested_by": None,
        "assigned_to": None, "created_at": _iso(4), "acknowledged_at": None,
        "updated_at": _iso(4), "dispatched_at": None, "started_at": None,
        "move_distance_miles": None, "load_stairs": None, "unload_stairs": None,
        "move_size_label": None, "move_type": None, "move_date_options": None,
        "accept_and_pay": False, "quote_context": None, "quote_cents": None,
        "quoted_price_total": None, "quote_modifiers": None, "job_address": None,
        "source_category_label": "Thumbtack API", "active_followup": None,
    }
    base.update(over)
    return base


LEADS = [
    _lead(id="l1", customer_name="Dana R.", job_address="12 Elm St, Kirkwood, MO 63122"),
    _lead(id="l2", customer_name="Marcus T.", status="in_review", source_type="yelp_screenshot",
          service_type="moving", move_size_label="2 bedroom", job_origin="1900 Park Ave, St. Louis, MO",
          created_at=_iso(22), updated_at=_iso(22), acknowledged_at=_iso(20)),
    _lead(id="l3", customer_name="Linda K.", status="ready_for_quote", job_location="Florissant, MO",
          created_at=_iso(60), updated_at=_iso(60), acknowledged_at=_iso(50), urgency_flag=True),
    _lead(id="l4", customer_name="Old Lead", status="lost", created_at=_iso(3000),
          updated_at=_iso(3000), acknowledged_at=_iso(2990)),
]

SETTINGS = {"t1_minutes": 100000, "t2_minutes": 200000}


def _user(role):
    return {"id": "u1", "username": "marisol", "role": role, "city_id": "c1",
            "city_name": "St. Louis", "is_active": True, "available_cities": []}


class _SpaHandler(http.server.SimpleHTTPRequestHandler):
    """Serves the built app; any unknown path gets index.html, like the host does."""

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(FRONTEND / "dist"), **kw)

    def send_head(self):
        target = Path(self.translate_path(self.path.split("?")[0]))
        if not target.is_file():
            self.path = "/index.html"
        return super().send_head()

    def log_message(self, *a):
        pass


@pytest.fixture(scope="session")
def server():
    # A static server, not `vite preview`: preview forwards /jobs, /settings
    # etc. to the dev backend on 8000, and a test copy must never reach it.
    subprocess.run([NPM, "run", "build"], cwd=FRONTEND, check=True, capture_output=True)
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), _SpaHandler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield BASE
    finally:
        httpd.shutdown()
        httpd.server_close()


@pytest.fixture(scope="session")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


def _open(browser, server, role="facilitator", path="/", viewport=PHONE, reduced_motion="no-preference", leads=None, theme="light"):
    ctx = browser.new_context(viewport=viewport, has_touch=True, reduced_motion=reduced_motion)
    ctx.add_init_script(f"localStorage.setItem('hh_token','t'); localStorage.setItem('hh_theme','{theme}');")
    data = LEADS if leads is None else leads

    def handle(route):
        req = route.request
        if req.resource_type not in ("fetch", "xhr"):
            return route.continue_()
        url = req.url.split("?")[0].replace(server, "")
        if url == "/auth/me":
            body = _user(role)
        elif url == "/leads":
            body = data
        elif url == "/settings":
            body = SETTINGS
        else:
            # Anything else answers "not found", as a fresh backend would.
            return route.fulfill(status=404, content_type="application/json", body='{"detail":"not mocked"}')
        route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

    ctx.route("**/*", handle)
    ctx.set_default_timeout(10000)
    page = ctx.new_page()
    page.goto(server + path)
    return page


def _too_small(page):
    """Visible tap targets under 44x44 CSS px, as 'label WxH' strings."""
    return page.evaluate("""() => {
      const out = [];
      for (const el of document.querySelectorAll('button, a[href], select, input, [role=button]')) {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none') continue;
        if (r.height < 44 || r.width < 44)
          out.push((el.getAttribute('aria-label') || el.textContent.trim().slice(0, 30)) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
      }
      return out;
    }""")


def test_card_shows_title_town_source_and_new_band(server, browser):
    page = _open(browser, server)
    card = page.get_by_role("button", name="Marcus T.")
    card.wait_for()
    assert "2 bedroom move" in card.inner_text().lower()
    assert "St. Louis · Yelp" in card.inner_text()
    dana = page.get_by_role("button", name="Dana R.")
    assert "Kirkwood · Thumbtack" in dana.inner_text()
    assert "new lead" in dana.locator(".haz").inner_text().lower()
    # Phone number is off the card in the new design.
    assert "3145550101" not in dana.inner_text()
    # Non-new leads carry no hazard band.
    assert card.locator(".haz").count() == 0


def test_dock_tabs_badge_and_no_admin_tab(server, browser):
    page = _open(browser, server, role="admin")
    dock = page.get_by_role("navigation", name="Main")
    dock.wait_for()
    for name in ("Queue", "Jobs", "Calendar", "Settings", "New lead"):
        assert dock.get_by_role("button", name=name, exact=True).count() == 1, name
    assert dock.get_by_role("button", name="Admin").count() == 0
    assert dock.locator(".dbdg").inner_text() == "1"


def test_center_button_opens_new_lead_sheet(server, browser):
    page = _open(browser, server)
    page.get_by_role("button", name="New lead", exact=True).tap()
    sheet = page.get_by_role("dialog", name="New lead")
    sheet.get_by_role("button", name="Type it in").tap()
    page.get_by_text("Manual Entry", exact=False).first.wait_for()


def test_crew_dock_has_only_jobs_and_settings(server, browser):
    page = _open(browser, server, role="crew", path="/jobs")
    dock = page.get_by_role("navigation", name="Main")
    dock.wait_for()
    names = [b.get_attribute("aria-label") for b in dock.get_by_role("button").all()]
    assert names == ["Jobs", "Settings"]


def test_filter_chips_narrow_the_list(server, browser):
    page = _open(browser, server)
    page.get_by_role("button", name="Marcus T.").wait_for()
    page.get_by_role("tab", name="New").tap()
    page.wait_for_timeout(200)
    assert page.get_by_role("button", name="Marcus T.").count() == 0
    assert page.get_by_role("button", name="Dana R.").count() == 1
    page.get_by_role("tab", name="Closed").tap()
    page.get_by_role("button", name="Old Lead").wait_for()


def test_settings_holds_admin_entry_for_admin(server, browser):
    page = _open(browser, server, role="admin", path="/settings")
    page.get_by_role("button", name="Open admin").tap()
    page.wait_for_url("**/admin")


def test_tap_targets_at_phone_width(server, browser):
    page = _open(browser, server, role="admin")
    page.get_by_role("button", name="Marcus T.").wait_for()
    assert _too_small(page) == []
    page.get_by_role("button", name="New lead", exact=True).tap()
    page.wait_for_timeout(500)
    assert _too_small(page) == []


def test_flags_are_visible_text_not_hover(server, browser):
    page = _open(browser, server)
    linda = page.get_by_role("button", name="Linda K.")
    linda.wait_for()
    assert "urgent" in linda.inner_text().lower()
    assert page.locator("[title]").count() == 0


def test_reduced_motion_stops_stripes(server, browser):
    page = _open(browser, server, reduced_motion="reduce")
    page.get_by_role("button", name="Dana R.").wait_for()
    name = page.locator(".haz").first.evaluate("e => getComputedStyle(e).animationName")
    assert name == "none"


@pytest.mark.parametrize("viewport", [PHONE, TABLET])
def test_no_sideways_scroll(server, browser, viewport):
    page = _open(browser, server, viewport=viewport)
    page.get_by_role("button", name="Marcus T.").wait_for()
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
