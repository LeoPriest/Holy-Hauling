"""Workday design, stage 8: the animated logo (burnout in, burnout out, the
working pulse) wherever the design puts it.

Run from app/frontend:  python -m pytest -q tests
"""
import pytest

from workday import FRONTEND, open_app, too_small
import test_workday_newlead as nl
import test_workday_quote as q
import test_workday_settings as st

STILL = """el => [...el.querySelectorAll('*')].flatMap(e => e.getAnimations()).length"""


def _logo(scope):
    return scope.locator(".wd-logo")


# ── Login ─────────────────────────────────────────────────────────────────

def test_login_logo_burns_in(server, browser):
    page = st._login(browser, server)
    logo = page.locator(".wd-hero .wd-logo")
    assert "arrive" in logo.get_attribute("class")
    assert logo.get_attribute("role") == "img"
    assert logo.get_attribute("aria-label") == "Holy Hauling"
    assert logo.locator(".wd-lg-ray").count() == 9
    assert logo.locator(".wd-lg-word").count() == 1


def test_sign_in_burns_out_then_in(server, browser):
    page = st._login(browser, server)
    page.get_by_role("textbox", name="Username").fill("marisol")
    st._tap_pin(page, "1234")
    page.get_by_role("button", name="Sign in").tap()
    page.locator(".wd-hero .wd-logo.leave").wait_for()
    page.locator(".wd-ovl .wd-logo.arrive").wait_for()
    page.get_by_role("heading", name="Lead queue").wait_for()


def test_reduced_motion_shows_the_whole_logo_still(server, browser):
    page = open_app(browser, server, lambda m, u: None, role=None, path="/login", reduced_motion="reduce")
    logo = page.locator(".wd-hero .wd-logo")
    logo.wait_for()
    page.wait_for_timeout(300)
    assert logo.evaluate(STILL) == 0
    ray = logo.locator(".wd-lg-ray").first
    assert ray.evaluate("e => getComputedStyle(e).opacity") == "1"
    assert logo.locator(".wd-lg-word").evaluate("e => getComputedStyle(e).clipPath") in ("none", "")


# ── Booked and In the queue ───────────────────────────────────────────────

def test_booked_logo_burns_in(server, browser):
    page = q._open(browser, server)
    q._quote_tab(page)
    q._fill_valid(page)
    page.locator(".wd-qbar").get_by_role("button", name="Lock & book").tap()
    booked = page.get_by_role("dialog", name="Booked")
    booked.wait_for()
    assert "arrive" in _logo(booked).get_attribute("class")


def test_in_the_queue_burns_out_before_leaving(server, browser):
    page = nl._open(browser, server)
    nl._start(page)
    nl._pick(page, 1)
    page.get_by_role("button", name="Read 1 screenshot").tap()
    page.get_by_role("button", name="Add to queue").tap()
    done = page.get_by_role("dialog", name="In the queue")
    done.wait_for()
    assert "arrive" in _logo(done).get_attribute("class")
    done.get_by_role("button", name="Back to queue").tap()
    page.locator(".wd-ovl .wd-logo.leave").wait_for()
    assert page.get_by_role("dialog", name="In the queue").count() == 1
    page.get_by_role("dialog", name="In the queue").wait_for(state="detached", timeout=4000)


# ── Working pulse ─────────────────────────────────────────────────────────

def _reading(browser, server, ingest):
    def answer(method, url):
        if method == "GET" and url == "/leads":
            return 200, []
        if method == "POST" and url == "/ingest/screenshot":
            return ingest
        return None

    page = open_app(browser, server, answer)
    page.get_by_role("navigation", name="Main").wait_for()
    nl._start(page)
    nl._pick(page, 1)
    page.get_by_role("button", name="Read 1 screenshot").tap()
    return page


def test_reading_panel_pulses_the_black_logo(server, browser):
    page = _reading(browser, server, "hang")
    logo = page.locator(".wd-rd .wd-logo")
    logo.wait_for()
    assert "load" in logo.get_attribute("class")


def test_upload_failure_dims_the_logo(server, browser):
    page = _reading(browser, server, (500, {"detail": "down"}))
    page.get_by_role("heading", name="Upload failed").wait_for()
    logo = page.locator(".wd-rd.err .wd-logo")
    assert "load" not in logo.get_attribute("class")


LOADING = [
    ("/", "facilitator", "/leads"),
    ("/jobs", "admin", "/jobs"),
    ("/calendar", "admin", "/jobs"),
    ("/settings", "admin", "/settings"),
    ("/leads/l1", "facilitator", "/leads/l1"),
    ("/admin/payroll", "admin", "/admin/payroll"),
]


@pytest.mark.parametrize("path,role,slow", LOADING)
def test_loading_uses_the_working_pulse(server, browser, path, role, slow):
    page = open_app(browser, server, lambda m, u: "hang" if u == slow else None, role=role, path=path)
    status = page.get_by_role("status").filter(has=page.locator(".wd-logo.load"))
    status.first.wait_for()
    assert "loading" in status.first.inner_text().lower()
    page.wait_for_timeout(300)
    assert too_small(page) == []


def test_no_spinners_left():
    src = FRONTEND / "src"
    hits = [str(p.relative_to(src)) for p in src.rglob("*.tsx") if "animate-spin" in p.read_text(encoding="utf-8")]
    assert hits == []


def test_app_start_uses_the_working_pulse(server, browser):
    def answer(method, url):
        return "hang" if url == "/auth/me" else None

    ctx_page = open_app(browser, server, answer, role=None, path="/")
    # Signed out: the app shows the login. Signed in with a slow /auth/me: the pulse.
    ctx_page.get_by_role("heading", name="Welcome back").wait_for()
    page = ctx_page.context.new_page()
    page.add_init_script("localStorage.setItem('hh_token','t')")
    page.goto(server + "/jobs")
    page.get_by_role("status").filter(has=page.locator(".wd-logo.load")).first.wait_for()


def test_wheels_are_clipped_round(server, browser):
    # iPhone Safari ignores overflow + border-radius while the pattern spins;
    # an ellipse clip-path keeps the wheels round there.
    page = st._login(browser, server)
    clips = page.locator(".wd-hero .wd-lg-whl").evaluate_all("els => els.map(e => getComputedStyle(e).clipPath)")
    assert len(clips) == 3 and all(c.startswith("ellipse") for c in clips)
