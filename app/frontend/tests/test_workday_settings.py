"""Workday design, stage 7: login, Settings, the Admin hub and the admin
screens behind it, at phone width.

Run from app/frontend:  python -m pytest -q tests
"""
import json

import pytest

from workday import PHONE, TABLET, open_app, too_small, user

OLD_COLORS = """() => [...document.querySelectorAll('body *')]
    .map(e => e.getAttribute('class') || '')
    .filter(c => /(gray|indigo|violet|purple|orange|blue|emerald|green|amber|red|yellow|sky|slate|rose|teal)-\\d/.test(c))"""

SETTINGS = {
    "t1_minutes": 10, "t2_minutes": 30, "quiet_hours_start": "22:00", "quiet_hours_end": "07:00",
    "quiet_hours_enabled": True, "primary_sms": "+13145550100", "primary_email": "m@example.com",
    "backup_name": "Jordan", "backup_sms": "", "backup_email": "", "t1_push": True, "t1_sms": False,
    "t1_email": False, "t2_push": True, "t2_sms": True, "t2_email": False,
}
CONFIGURED = {"configured": True, "missing": [], "detail": None}
NOTIFY = {"sms": CONFIGURED, "email": CONFIGURED, "web_push": CONFIGURED}


def _no_old_colors(page):
    page.wait_for_timeout(400)
    assert page.evaluate(OLD_COLORS) == []


def _no_sideways(page):
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")


# ── Login ─────────────────────────────────────────────────────────────────

def _login(browser, server, status=200, viewport=PHONE):
    signed_in = []

    def answer(method, url):
        if method == "POST" and url == "/auth/login":
            if status != 200:
                return status, {"detail": "Invalid credentials"}
            signed_in.append(True)
            return 200, {"token": "t2", "user": user("facilitator")}
        if method == "GET" and url == "/auth/me" and signed_in:
            return 200, user("facilitator")
        if method == "GET" and url == "/leads":
            return 200, []
        return None

    page = open_app(browser, server, answer, role=None, path="/login", viewport=viewport)
    page.get_by_role("heading", name="Welcome back").wait_for()
    return page


def _tap_pin(page, digits):
    pad = page.get_by_role("group", name="Keypad")
    for d in digits:
        pad.get_by_role("button", name=d, exact=True).tap()


def test_login_hero_and_form(server, browser):
    page = _login(browser, server)
    hero = page.locator(".wd-hero")
    assert hero.get_by_role("img", name="Holy Hauling").count() == 1
    assert "good to see you" in page.locator("main").inner_text().lower()
    assert page.get_by_role("textbox", name="Username").count() == 1
    assert page.locator(".wd-pin i").count() == 4
    assert page.get_by_role("button", name="Sign in").is_disabled()


def test_login_keypad_fills_and_deletes(server, browser):
    page = _login(browser, server)
    page.get_by_role("textbox", name="Username").fill("marisol")
    _tap_pin(page, "123")
    assert page.locator(".wd-pin i.on").count() == 3
    page.get_by_role("button", name="Delete digit").tap()
    assert page.locator(".wd-pin i.on").count() == 2
    _tap_pin(page, "34")
    assert page.locator(".wd-pin i.on").count() == 4
    assert page.get_by_role("button", name="Sign in").is_enabled()


def test_login_keyboard_digits(server, browser):
    page = _login(browser, server)
    page.get_by_role("textbox", name="Username").fill("marisol")
    page.get_by_role("textbox", name="Username").press("Enter")
    page.keyboard.type("12")
    assert page.locator(".wd-pin i.on").count() == 2
    page.keyboard.press("Backspace")
    assert page.locator(".wd-pin i.on").count() == 1


def test_login_success_says_youre_in(server, browser):
    page = _login(browser, server)
    page.get_by_role("textbox", name="Username").fill("marisol")
    _tap_pin(page, "1234")
    page.get_by_role("button", name="Sign in").tap()
    page.get_by_text("You're in").wait_for()
    page.get_by_role("heading", name="Lead queue").wait_for()
    sent = [b for m, u, b in page.bodies if m == "POST" and u == "/auth/login"]
    assert json.loads(sent[0]) == {"username": "marisol", "pin": "1234"}


def test_login_failure_clears_pin(server, browser):
    page = _login(browser, server, status=401)
    page.get_by_role("textbox", name="Username").fill("marisol")
    _tap_pin(page, "9999")
    page.get_by_role("button", name="Sign in").tap()
    page.get_by_role("alert").get_by_text("Invalid username or PIN").wait_for()
    assert page.locator(".wd-pin i.on").count() == 0
    assert page.get_by_role("button", name="Sign in").is_disabled()


@pytest.mark.parametrize("viewport", [PHONE, TABLET])
def test_login_targets_colors_scroll(server, browser, viewport):
    page = _login(browser, server, viewport=viewport)
    page.wait_for_timeout(500)
    assert too_small(page) == []
    _no_old_colors(page)
    _no_sideways(page)


# ── Settings ──────────────────────────────────────────────────────────────

def _settings(browser, server, role="admin", notify=NOTIFY, save_ok=True, theme="light", viewport=PHONE):
    def answer(method, url):
        if method == "GET":
            return {
                "/settings": (200, SETTINGS),
                "/settings/notification-status": (200, notify),
                "/users/me/weekly-availability": (200, {"blocks": {}}),
                "/admin/google/status": (200, {"configured": True, "connected": False, "missing": [], "detail": None}),
                "/admin/recurring-expenses/due": (200, []),
            }.get(url)
        if method == "PATCH" and url == "/settings":
            return (200, SETTINGS) if save_ok else (500, {"detail": "boom"})
        if method == "PUT" and url == "/users/me/weekly-availability":
            return 200, {"blocks": {"monday": ["morning"]}}
        return None

    page = open_app(browser, server, answer, role=role, path="/settings", viewport=viewport, theme=theme)
    page.get_by_role("heading", name="Settings").wait_for()
    return page


def test_settings_header_and_admin_row(server, browser):
    page = _settings(browser, server)
    assert "marisol" in page.locator("header.wd-hdr").inner_text().lower()
    page.get_by_role("button", name="Open admin").tap()
    page.wait_for_url("**/admin")


def test_settings_survives_empty_notification_status(server, browser):
    page = _settings(browser, server, notify=[])
    page.get_by_role("button", name="Sign out").wait_for()
    assert page.get_by_role("heading", name="Settings").is_visible()


def test_dark_mode_switch(server, browser):
    page = _settings(browser, server)
    sw = page.get_by_role("switch", name="Dark mode")
    assert sw.get_attribute("aria-checked") == "false"
    sw.tap()
    assert sw.get_attribute("aria-checked") == "true"
    assert "dark" in (page.locator("html").get_attribute("class") or "")


def test_save_settings_success(server, browser):
    page = _settings(browser, server)
    page.get_by_role("switch", name="T1 warning by SMS").tap()
    page.get_by_role("button", name="Save settings").tap()
    page.get_by_role("button", name="Saved").wait_for()
    sent = [b for m, u, b in page.bodies if m == "PATCH" and u == "/settings"]
    assert json.loads(sent[0])["t1_sms"] is True


def test_save_settings_failure_says_so(server, browser):
    page = _settings(browser, server, save_ok=False)
    page.get_by_role("button", name="Save settings").tap()
    page.get_by_role("alert").get_by_text("Couldn't save settings").wait_for()


def test_availability_toggle_and_save(server, browser):
    page = _settings(browser, server)
    cell = page.get_by_role("button", name="Mon Morning")
    cell.tap()
    assert cell.get_attribute("aria-pressed") == "true"
    page.get_by_role("button", name="Save weekly availability").tap()
    page.get_by_role("button", name="Saved").wait_for()
    assert ("PUT", "/users/me/weekly-availability") in page.calls


def test_sign_out_goes_to_login(server, browser):
    page = _settings(browser, server)
    page.get_by_role("button", name="Sign out").tap()
    page.get_by_role("heading", name="Welcome back").wait_for()


def test_crew_settings_are_short(server, browser):
    page = _settings(browser, server, role="crew")
    page.get_by_role("button", name="Sign out").wait_for()
    assert page.get_by_role("button", name="Open admin").count() == 0
    assert page.get_by_text("Alert thresholds").count() == 0


@pytest.mark.parametrize("theme", ["light", "dark"])
def test_settings_targets_and_colors(server, browser, theme):
    page = _settings(browser, server, theme=theme)
    page.wait_for_timeout(500)
    assert too_small(page) == []
    _no_old_colors(page)
    _no_sideways(page)


# ── Admin ─────────────────────────────────────────────────────────────────

ROWS = ["Metrics", "Quote grounding", "Finances", "Rentals", "Payroll", "Recurring", "Team", "Cities", "Thumbtack"]


def _admin(browser, server, path="/admin", viewport=PHONE):
    def answer(method, url):
        if method == "GET" and url == "/admin/recurring-expenses/due":
            return 200, [{"id": "e1"}, {"id": "e2"}]
        return None

    return open_app(browser, server, answer, role="admin", path=path, viewport=viewport)


def test_admin_hub(server, browser):
    page = _admin(browser, server)
    page.get_by_role("heading", name="Admin").wait_for()
    assert "settings · marisol" in page.locator("header.wd-hdr").inner_text().lower()
    rows = page.locator(".wd-ad")
    assert rows.count() == len(ROWS)
    for i, name in enumerate(ROWS):
        assert name.lower() in rows.nth(i).inner_text().lower()
    page.locator(".wd-ad", has_text="Recurring").locator(".wd-ad-b").get_by_text("2").wait_for()
    page.wait_for_timeout(500)
    assert too_small(page) == []
    _no_old_colors(page)
    page.get_by_role("button", name="Back to settings").tap()
    page.wait_for_url("**/settings")


def test_admin_row_opens_screen(server, browser):
    page = _admin(browser, server)
    page.locator(".wd-ad", has_text="Team").tap()
    page.wait_for_url("**/admin/users")


SUBSCREENS = [
    ("/admin/metrics", "Metrics"),
    ("/admin/quote-grounding", "Quote grounding"),
    ("/admin/finances", "Finances"),
    ("/admin/rentals", "Truck rentals"),
    ("/admin/payroll", "Payroll"),
    ("/admin/recurring-expenses", "Recurring expenses"),
    ("/admin/recurring-expenses/due", "Due expenses"),
    ("/admin/users", "Team"),
    ("/admin/cities", "Cities"),
    ("/admin/thumbtack", "Thumbtack"),
    ("/help", None),
]


@pytest.mark.parametrize("path,title", SUBSCREENS)
def test_admin_screens_use_the_workday_header(server, browser, path, title):
    page = _admin(browser, server, path=path)
    header = page.locator("header.wd-hdr")
    header.wait_for()
    if title:
        assert header.get_by_role("heading").inner_text().lower() == title.lower()
    assert header.get_by_role("button", name="Back").count() == 1
    _no_old_colors(page)
    assert too_small(page) == []
    _no_sideways(page)


# ── Dark mode: every field and button label can be read ──────────────────

UNREADABLE = """() => {
  const rgb = c => (c.match(/[\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]) => { const f = v => (v /= 255) <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
    return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
  const bgOf = el => { for (let e = el; e; e = e.parentElement) {
      const c = rgb(getComputedStyle(e).backgroundColor); if (c.length === 3 || c[3] > 0) return c; }
    return [255, 255, 255]; };
  const out = [];
  for (const el of document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]), select, textarea, button')) {
    const r = el.getBoundingClientRect();
    // The dock's labels are their own spans with their own colours.
    if (!r.width || !r.height || el.closest('[aria-hidden=true], .wd-dock')) continue;
    if (el.tagName === 'BUTTON' && !el.textContent.trim()) continue;
    const a = lum(rgb(getComputedStyle(el).color)), b = lum(bgOf(el));
    const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    if (ratio < 3) out.push((el.getAttribute('aria-label') || el.placeholder || el.textContent.trim().slice(0, 24) || el.tagName) + ' ' + ratio.toFixed(2));
  }
  return out;
}"""

CITY = {"id": "c1", "name": "St. Louis", "slug": "stl", "timezone": "America/Chicago",
        "is_active": True, "created_at": "2026-01-01T00:00:00", "updated_at": "2026-01-01T00:00:00"}
MEMBER = {"id": "u2", "username": "jordan", "role": "crew", "city_id": "c1", "city_name": "St. Louis",
          "is_active": True, "email": None, "hourly_rate_cents": None}


def _dark_admin(browser, server, path):
    def answer(method, url):
        if method == "GET" and url == "/admin/cities":
            return 200, [CITY]
        if method == "GET" and url == "/admin/users":
            return 200, [MEMBER]
        if method == "GET" and url in ("/admin/thumbtack/connections", "/admin/rentals"):
            return 200, []
        return None

    return open_app(browser, server, answer, role="admin", path=path, theme="dark")


def test_dark_team_forms_are_readable(server, browser):
    page = _dark_admin(browser, server, "/admin/users")
    page.get_by_role("button", name="Add user").tap()
    page.get_by_placeholder("Username").fill("newcrew")
    assert page.evaluate(UNREADABLE) == []
    page.get_by_role("button", name="Cancel").tap()
    page.get_by_role("button", name="Edit").tap()
    page.get_by_placeholder("New PIN").wait_for()
    assert page.evaluate(UNREADABLE) == []


@pytest.mark.parametrize("path,ready", [
    ("/admin/thumbtack", "Add connection"),
    ("/admin/cities", "Save"),
    ("/admin/rentals", "All"),
])
def test_dark_admin_screens_are_readable(server, browser, path, ready):
    page = _dark_admin(browser, server, path)
    page.get_by_text(ready, exact=True).first.wait_for()
    page.wait_for_timeout(400)
    assert page.evaluate(UNREADABLE) == []
