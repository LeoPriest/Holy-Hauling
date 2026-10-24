"""Workday design, stage 3: the quote builder, the one-tap price buttons and
the "Booked" screen, at phone width.

Run from app/frontend:  python -m pytest -q tests
"""
import json

import pytest

from workday import PHONE, TABLET, in_reach, open_app, scroll_to_end, too_small
from test_workday_lead import REVIEW, _lead


def _open(browser, server, the_lead=None, book_ok=True, viewport=PHONE, theme="light", chat=None):
    data = the_lead or _lead(status="replied", acknowledged_at="2026-10-23T10:00:00")
    thread = list(chat or [])

    def answer(method, url):
        if method == "GET":
            return {
                "/leads": (200, [data]),
                "/leads/l1": (200, data),
                "/leads/l1/ai-review": (200, REVIEW),
                "/leads/l1/escalation": (200, None),
                "/leads/l1/pay-records": (200, []),
                "/leads/l1/chat": (200, thread),
                "/leads/l1/quote-suggestion/latest": (200, None),
                "/users": (200, []),
            }.get(url)
        if method == "PATCH" and url == "/leads/l1/status":
            return (200, dict(data, status="booked")) if book_ok else (500, {"detail": "Server said no"})
        if method == "PATCH" and url == "/leads/l1":
            return 200, data
        if method == "POST" and url == "/leads/l1/chat":
            thread.append(_msg("m%d" % len(thread), "user", "Is $300 too low?"))
            thread.append(_msg("m%d" % len(thread), "assistant", "It's under the floor."))
            return 200, {"reply": thread[-1], "quote_context_update": None}
        return None

    page = open_app(browser, server, answer, path="/leads/l1", viewport=viewport, theme=theme)
    page.get_by_role("heading", name="Dana R.").wait_for()
    return page


def _msg(mid, role, content):
    return {"id": mid, "lead_id": "l1", "role": role, "content": content, "created_at": "2026-10-23T10:00:00"}


def _quote_tab(page):
    page.get_by_role("navigation", name="Lead").get_by_role("button", name="Quote").tap()
    page.get_by_label("Quoted price").wait_for()


def _fill_valid(page):
    page.get_by_label("Quoted price").fill("375")
    page.get_by_role("button", name="2h", exact=True).tap()
    page.get_by_label("Line 1 amount").fill("325")
    page.get_by_role("button", name="Modifier").tap()
    page.get_by_label("Line 2 amount").fill("50")
    page.get_by_label("Line 2 note").fill("Fridge disposal")


def test_price_field_and_floor_hint(server, browser):
    page = _open(browser, server)
    _quote_tab(page)
    hint = page.locator(".wd-money-hint")
    assert "floor $275" in hint.inner_text().lower()
    page.get_by_label("Quoted price").fill("250")
    assert "$25 below the $275 floor" in hint.inner_text()
    assert "bad" in hint.get_attribute("class")


def test_duration_chips_save_on_tap(server, browser):
    page = _open(browser, server)
    _quote_tab(page)
    group = page.get_by_role("group", name="Estimated duration")
    labels = [b.inner_text() for b in group.get_by_role("button").all()]
    assert labels[:6] == ["1h", "1.5h", "2h", "2.5h", "3h", "4h"]
    group.get_by_role("button", name="2h", exact=True).tap()
    assert group.get_by_role("button", name="2h", exact=True).get_attribute("aria-pressed") == "true"
    page.wait_for_timeout(300)
    sent = [json.loads(b) for m, u, b in page.bodies if m == "PATCH" and u == "/leads/l1" and b]
    assert {"estimated_job_duration_minutes": 120} in sent


def test_breakdown_rows_sum_and_difference(server, browser):
    page = _open(browser, server)
    _quote_tab(page)
    _fill_valid(page)
    diff = page.locator(".wd-sum-diff")
    assert diff.inner_text() == "$0.00"
    assert "ok" in diff.get_attribute("class")
    page.get_by_role("button", name="Remove line 2").tap()
    assert diff.inner_text() == "$50.00"
    assert "off" in diff.get_attribute("class")


def test_lock_and_book_with_bad_quote_shakes_and_explains(server, browser):
    page = _open(browser, server)
    _quote_tab(page)
    page.locator(".wd-qbar").get_by_role("button", name="Lock & book").tap()
    page.get_by_text("Enter a valid quoted price greater than 0.").wait_for()
    assert "wd-shake" in page.locator(".wd-qbar button").get_attribute("class")
    assert ("PATCH", "/leads/l1/status") not in page.calls


def test_booking_shows_booked_screen_with_message(server, browser):
    page = _open(browser, server)
    _quote_tab(page)
    _fill_valid(page)
    page.locator(".wd-qbar").get_by_role("button", name="Lock & book").tap()
    booked = page.get_by_role("dialog", name="Booked")
    booked.wait_for()
    assert "$375.00" in booked.inner_text()
    msg = booked.get_by_label("Confirmation message")
    assert "Dana" in msg.input_value()
    page.wait_for_timeout(1600)
    assert too_small(page) == []
    booked.get_by_role("button", name="Done").tap()
    page.wait_for_timeout(500)
    assert page.get_by_role("dialog", name="Booked").count() == 0


def test_booking_failure_says_so_and_stays(server, browser):
    page = _open(browser, server, book_ok=False)
    _quote_tab(page)
    _fill_valid(page)
    page.locator(".wd-qbar").get_by_role("button", name="Lock & book").tap()
    page.get_by_text("Server said no").wait_for()
    assert page.get_by_role("dialog", name="Booked").count() == 0


def test_open_quote_lands_on_the_price(server, browser):
    # Proof: Open quote used to scroll down to the AI chat at the bottom.
    chat = [_msg("m%d" % i, "user" if i % 2 == 0 else "assistant", "Line %d" % i) for i in range(6)]
    page = _open(browser, server, chat=chat)
    page.locator(".wd-qbar").get_by_role("button", name="Open quote").tap()
    page.get_by_text("Line 5").wait_for()
    page.wait_for_timeout(800)  # past any smooth scroll
    assert in_reach(page.get_by_label("Quoted price"))


def test_new_chat_reply_still_scrolls_into_view(server, browser):
    page = _open(browser, server)
    _quote_tab(page)
    page.get_by_label("Message").fill("Is $300 too low?")
    page.get_by_role("button", name="Send").tap()
    page.get_by_text("It's under the floor.").wait_for()
    page.wait_for_timeout(800)
    assert in_reach(page.get_by_text("It's under the floor."))


@pytest.mark.parametrize("scrolled", [False, True])
def test_bad_quote_message_is_on_screen(server, browser, scrolled):
    page = _open(browser, server)
    _quote_tab(page)
    page.wait_for_timeout(800)
    if scrolled:
        scroll_to_end(page)
    page.locator(".wd-qbar").get_by_role("button", name="Lock & book").tap()
    msg = page.get_by_text("Enter a valid quoted price greater than 0.")
    msg.wait_for()
    page.wait_for_timeout(400)
    assert in_reach(msg)


def test_booking_failure_message_is_on_screen(server, browser):
    page = _open(browser, server, book_ok=False)
    _quote_tab(page)
    _fill_valid(page)
    scroll_to_end(page)
    page.locator(".wd-qbar").get_by_role("button", name="Lock & book").tap()
    msg = page.get_by_text("Server said no")
    msg.wait_for()
    page.wait_for_timeout(400)
    assert in_reach(msg)


def test_price_warning_clears_once_the_price_is_fixed(server, browser):
    page = _open(browser, server)
    _quote_tab(page)
    page.locator(".wd-qbar").get_by_role("button", name="Lock & book").tap()
    msg = page.get_by_text("Enter a valid quoted price greater than 0.")
    msg.wait_for()
    page.get_by_label("Quoted price").fill("375")
    msg.wait_for(state="detached")


def test_price_button_sets_the_quote(server, browser):
    page = _open(browser, server)
    page.get_by_role("button", name="No fridge $325").tap()
    page.get_by_role("status").filter(has_text="Quote set to $325").wait_for()
    assert "$325.00" in page.locator(".wd-qbar").inner_text()
    assert page.get_by_role("button", name="No fridge $325").get_attribute("aria-pressed") == "true"
    _quote_tab(page)
    assert page.get_by_label("Quoted price").input_value() == "325.00"
    assert page.get_by_label("Line 1 amount").input_value() == "325"


def test_quote_tab_tap_targets(server, browser):
    page = _open(browser, server)
    _quote_tab(page)
    _fill_valid(page)
    page.wait_for_timeout(500)
    assert too_small(page) == []


def test_quote_tab_has_no_old_colors(server, browser):
    page = _open(browser, server)
    _quote_tab(page)
    page.wait_for_timeout(400)
    old = page.evaluate("""() => [...document.querySelectorAll('main *')]
        .map(e => e.getAttribute('class') || '')
        .filter(c => /(gray|indigo|violet|orange|blue|emerald)-\\d/.test(c))""")
    assert old == []


@pytest.mark.parametrize("viewport", [PHONE, TABLET])
def test_quote_tab_no_sideways_scroll(server, browser, viewport):
    page = _open(browser, server, viewport=viewport)
    _quote_tab(page)
    page.wait_for_timeout(400)
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
