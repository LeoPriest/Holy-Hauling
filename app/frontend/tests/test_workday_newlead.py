"""Workday design, stage 4: the new-lead flow (choose, reading, review, shots
disagree, in the queue, manual entry, upload failed) at phone width.

Run from app/frontend:  python -m pytest -q tests
"""
import json

import pytest

from workday import PHONE, TABLET, iso, lead, open_app, too_small
from test_workday_lead import REVIEW

PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082"
)
NEW = lead(id="l9", customer_name="Dana R.", service_type="hauling", job_location="Kirkwood, MO 63122",
           source_type="thumbtack_screenshot")


def _fields(*pairs):
    return json.dumps([{"field": f, "value": v, "confidence": "high"} for f, v in pairs])


def _ingest(conflicts=()):
    shot2_cost = "21.00" if conflicts else "18.50"
    return {
        "lead": NEW,
        "extractions": [
            {"id": "o1", "screenshot_id": "s1", "raw_text": None, "model_used": None, "created_at": iso(1),
             "extracted_fields": _fields(("customer_name", "Dana R."), ("lead_cost_total", "18.50"))},
            {"id": "o2", "screenshot_id": "s2", "raw_text": None, "model_used": None, "created_at": iso(1),
             "extracted_fields": _fields(("job_location", "Kirkwood, MO 63122"), ("lead_cost_total", shot2_cost))},
        ],
        "auto_applied_fields": ["customer_name", "job_location", "service_type"],
        "conflicts": list(conflicts),
    }


def _open(browser, server, ingest="ok", review_ok=True, conflicts=(), viewport=PHONE, theme="light"):
    state = {"ingest": ingest}

    def answer(method, url):
        if method == "GET":
            return {
                "/leads": (200, []),
                "/leads/l9": (200, dict(NEW, screenshots=[], events=[])),
                "/leads/l9/ai-review": (200, REVIEW),
                "/leads/l9/escalation": (200, None),
                "/leads/l9/pay-records": (200, []),
                "/users": (200, []),
                "/settings": (200, {"t1_minutes": 100000, "t2_minutes": 200000}),
            }.get(url)
        if method == "POST" and url == "/ingest/screenshot":
            if state["ingest"] == "fail":
                state["ingest"] = "ok"  # the retry goes through
                return 500, {"detail": "down"}
            return 200, _ingest(conflicts)
        if method == "POST" and url == "/leads/l9/ai-review":
            return (200, REVIEW) if review_ok else (500, {"detail": "model down"})
        if method == "PATCH" and url == "/leads/l9":
            return 200, NEW
        if method == "POST" and url == "/leads":
            return 200, dict(NEW, id="l9", source_type="manual")
        return None

    page = open_app(browser, server, answer, viewport=viewport, theme=theme)
    page.get_by_role("navigation", name="Main").wait_for()
    return page


def _start(page, kind="Screenshot"):
    page.get_by_role("button", name="New lead", exact=True).tap()
    page.get_by_role("dialog", name="New lead").get_by_role("button", name=kind if kind == "Screenshot" else "Type it in").tap()
    page.get_by_role("dialog", name="Add a lead").wait_for()


def _pick(page, n=2):
    files = [{"name": f"shot{i + 1}.png", "mimeType": "image/png", "buffer": PNG} for i in range(n)]
    page.locator("input[type=file]").set_input_files(files)


def _sent(page, method, url):
    return [json.loads(b) for m, u, b in page.bodies if m == method and u == url and b]


def test_choose_screen_sources_and_shots(server, browser):
    page = _open(browser, server)
    _start(page)
    flow = page.get_by_role("dialog", name="Add a lead")
    assert flow.get_by_role("button", name="Thumbtack").get_attribute("aria-pressed") == "true"
    read = flow.get_by_role("button", name="Choose a screenshot first")
    assert read.is_disabled()
    _pick(page, 2)
    assert flow.locator(".wd-shot img").count() == 2
    assert flow.get_by_role("button", name="Read 2 screenshots").is_enabled()
    flow.get_by_role("button", name="Remove shot 2").tap()
    assert flow.get_by_role("button", name="Read 1 screenshot").is_enabled()
    page.wait_for_timeout(400)
    assert too_small(page) == []


def test_read_review_add_to_queue_then_open(server, browser):
    page = _open(browser, server)
    _start(page)
    _pick(page, 2)
    page.get_by_role("button", name="Read 2 screenshots").tap()
    flow = page.get_by_role("dialog", name="Add a lead")
    flow.get_by_text("AI review ready").wait_for()
    assert "$325–$425" in flow.inner_text()
    assert "filled in from the screenshot" in flow.inner_text().lower()
    assert flow.get_by_label("Customer name").input_value() == "Dana R."
    assert flow.locator(".wd-rtag").count() >= 2
    assert flow.get_by_role("button", name="Hauling").get_attribute("aria-pressed") == "true"
    page.wait_for_timeout(400)
    assert too_small(page) == []
    flow.get_by_role("switch", name="Mark as urgent").tap()
    flow.get_by_role("button", name="Add to queue").tap()
    done = page.get_by_role("dialog", name="In the queue")
    done.wait_for()
    assert "Dana R. · Hauling · Kirkwood" in done.inner_text()
    body = _sent(page, "PATCH", "/leads/l9")[-1]
    assert body["customer_name"] == "Dana R." and body["urgency_flag"] is True
    assert ("POST", "/leads/l9/ai-review") in page.calls
    page.wait_for_timeout(600)
    assert too_small(page) == []
    done.get_by_role("button", name="Open lead").tap()
    page.wait_for_url("**/leads/l9")


def test_shots_disagree_blocks_until_picked(server, browser):
    page = _open(browser, server, conflicts=["lead_cost_total"])
    _start(page)
    _pick(page, 2)
    page.get_by_role("button", name="Read 2 screenshots").tap()
    flow = page.get_by_role("dialog", name="Add a lead")
    flow.get_by_text("Shots disagree on lead cost").wait_for()
    flow.get_by_role("button", name="Add to queue").tap()
    flow.get_by_text("Set the lead cost. The screenshots disagreed on it.").wait_for()
    assert _sent(page, "PATCH", "/leads/l9") == []
    flow.get_by_role("button", name="$21.00 from shot 2").tap()
    assert flow.get_by_label("Lead cost").input_value() == "21.00"
    flow.get_by_role("button", name="Add to queue").tap()
    page.get_by_role("dialog", name="In the queue").wait_for()
    assert _sent(page, "PATCH", "/leads/l9")[-1]["lead_cost_cents"] == 2100


def test_name_is_required(server, browser):
    page = _open(browser, server)
    _start(page)
    _pick(page, 1)
    page.get_by_role("button", name="Read 1 screenshot").tap()
    flow = page.get_by_role("dialog", name="Add a lead")
    flow.get_by_label("Customer name").fill("")
    flow.get_by_role("button", name="Add to queue").tap()
    flow.get_by_text("Customer name is required before adding to the queue.").wait_for()
    assert _sent(page, "PATCH", "/leads/l9") == []


def test_upload_failure_keeps_shots_and_retries(server, browser):
    page = _open(browser, server, ingest="fail")
    _start(page)
    _pick(page, 2)
    page.get_by_role("button", name="Read 2 screenshots").tap()
    flow = page.get_by_role("dialog", name="Add a lead")
    flow.get_by_role("heading", name="Upload failed").wait_for()
    page.wait_for_timeout(400)
    assert too_small(page) == []
    flow.get_by_role("button", name="Try again").tap()
    flow.get_by_text("AI review ready").wait_for()


def test_review_failure_still_reaches_review(server, browser):
    page = _open(browser, server, review_ok=False)
    _start(page)
    _pick(page, 1)
    page.get_by_role("button", name="Read 1 screenshot").tap()
    flow = page.get_by_role("dialog", name="Add a lead")
    flow.get_by_text("The AI review didn't run").wait_for()
    assert flow.get_by_label("Customer name").input_value() == "Dana R."


def test_manual_entry_creates_lead(server, browser):
    page = _open(browser, server)
    _start(page, kind="manual")
    flow = page.get_by_role("dialog", name="Add a lead")
    assert flow.get_by_role("button", name="Manual").get_attribute("aria-pressed") == "true"
    flow.get_by_role("button", name="Create lead").tap()
    flow.get_by_text("Customer name is required.").wait_for()
    flow.get_by_label("Customer name").fill("Pat Q.")
    flow.get_by_role("button", name="Moving").tap()
    page.wait_for_timeout(400)
    assert too_small(page) == []
    flow.get_by_role("button", name="Create lead").tap()
    page.get_by_role("dialog", name="In the queue").wait_for()
    body = _sent(page, "POST", "/leads")[-1]
    assert body["customer_name"] == "Pat Q." and body["source_type"] == "manual" and body["service_type"] == "moving"


def test_manual_link_from_choose(server, browser):
    page = _open(browser, server)
    _start(page)
    page.get_by_role("button", name="Manual entry instead").tap()
    page.get_by_label("Customer name").wait_for()


def test_close_returns_to_queue(server, browser):
    page = _open(browser, server)
    _start(page)
    page.get_by_role("dialog", name="Add a lead").get_by_role("button", name="Close").first.tap()
    page.wait_for_timeout(300)
    assert page.get_by_role("dialog", name="Add a lead").count() == 0


def test_flow_has_no_old_colors(server, browser):
    page = _open(browser, server)
    _start(page)
    _pick(page, 1)
    page.get_by_role("button", name="Read 1 screenshot").tap()
    page.get_by_text("AI review ready").wait_for()
    old = page.evaluate("""() => [...document.querySelectorAll('[role=dialog] *')]
        .map(e => e.getAttribute('class') || '')
        .filter(c => /(gray|indigo|violet|orange|blue|emerald|green)-\\d/.test(c))""")
    assert old == []


@pytest.mark.parametrize("viewport", [PHONE, TABLET])
def test_no_sideways_scroll(server, browser, viewport):
    page = _open(browser, server, viewport=viewport)
    _start(page)
    _pick(page, 3)
    page.wait_for_timeout(400)
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
