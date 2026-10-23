"""Workday design, stage 2: the lead screen (header, gates, decision card,
Brief and Log tabs, quote bar, tab dock, more menu) at phone width.

Run from app/frontend:  python -m pytest -q tests
"""
import pytest

from workday import PHONE, TABLET, iso, lead, open_app, too_small

REVIEW = {
    "id": "r1", "lead_id": "l1", "model_used": "x", "prompt_version": "x", "grounding_source": None,
    "input_snapshot": {}, "created_at": iso(3), "actor": None,
    "sections": {
        "a_next_message": "Hi Dana, thanks for reaching out.", "b_call_plan": "", "c_behavior_class": "",
        "d_transport_path": "", "e_escalation_note": "", "f_pricing_band": "", "g_band_position": "",
        "h_friction_points": "", "i_sayability_check": "", "j_quote_style": "", "k_quote_source_label": "",
        "l_pricing_guidance": "", "m_quick_read": "Garage cleanout, ground floor.", "n_pattern_anchor": "",
        "o_branch_replies": "",
        "sayability": "ready", "target_low": 325, "target_high": 425, "floor": 275, "band_position": "mid",
        "band_reason": "Single-car garage, mostly bagged items.",
        "range_levers": [{"factor": "Appliances", "low_answer": "No fridge", "low_price": 325,
                          "high_answer": "Fridge + chest freezer", "high_price": 425}],
        "floor_defense": "Price includes dump fees and a two-person crew.",
    },
}

EVENTS = [
    {"id": "e1", "lead_id": "l1", "event_type": "created", "from_status": None, "to_status": None,
     "actor": "system", "note": None, "created_at": iso(4)},
    {"id": "e2", "lead_id": "l1", "event_type": "note_added", "from_status": None, "to_status": None,
     "actor": "marisol", "note": "Left a voicemail", "created_at": iso(2)},
]


def _lead(**over):
    base = dict(customer_name="Dana R.", urgency_flag=True, job_address="12 Elm St, Kirkwood, MO 63122",
                job_location="Kirkwood, MO 63122", scope_notes="Old couch, boxes, a broken fridge.",
                contact_phone="3145550101", screenshots=[], events=EVENTS)
    base.update(over)
    return lead(**base)


def _open(browser, server, the_lead=None, review=REVIEW, tab_path="", viewport=PHONE, theme="light",
          reduced_motion="no-preference", status_ok=True):
    data = the_lead or _lead()

    def answer(method, url):
        if method == "GET":
            return {
                "/leads": (200, [data]),
                "/leads/l1": (200, data),
                "/leads/l1/ai-review": (200, review) if review else None,
                "/leads/l1/escalation": (200, None),
                "/leads/l1/pay-records": (200, []),
                "/users": (200, []),
                "/settings": (200, {"t1_minutes": 100000, "t2_minutes": 200000}),
            }.get(url)
        if method == "PATCH" and url == "/leads/l1/status":
            return (200, data) if status_ok else (500, {"detail": "boom"})
        if method == "POST" and url in ("/leads/l1/notes", "/leads/l1/acknowledge"):
            return 200, data
        return None

    page = open_app(browser, server, answer, path="/leads/l1" + tab_path, viewport=viewport,
                    theme=theme, reduced_motion=reduced_motion)
    page.get_by_role("heading", name="Dana R.").wait_for()
    return page


def test_header_is_dark_with_name_tags_and_primary_action(server, browser):
    page = _open(browser, server)
    hdr = page.locator("header.wd-hdr")
    assert "dana r." in hdr.inner_text().lower()
    assert hdr.locator(".wd-st").inner_text().lower() == "new"
    assert "urgent" in hdr.inner_text().lower()
    hdr.get_by_role("button", name="Mark replied").tap()
    page.get_by_role("status").filter(has_text="Marked replied").wait_for()
    assert ("PATCH", "/leads/l1/status") in page.calls


def test_mark_replied_failure_says_so(server, browser):
    page = _open(browser, server, status_ok=False)
    page.locator("header.wd-hdr").get_by_role("button", name="Mark replied").tap()
    page.get_by_role("status").filter(has_text="Couldn't mark replied").wait_for()


def test_gates_show_five_steps_with_current_striped(server, browser):
    page = _open(browser, server, the_lead=_lead(status="ready_for_quote"))
    gates = page.get_by_role("list", name="Gates")
    labels = [li.inner_text().strip().lower() for li in gates.get_by_role("listitem").all()]
    assert [l.replace("✓", "").strip() for l in labels] == ["gate 0", "gate 1", "gate 2a", "gate 2b", "booked"]
    cur = gates.locator("[aria-current=step]")
    assert "2a" in cur.inner_text().lower()
    assert cur.locator(".haz").count() == 1


def test_decision_card_shows_range_floor_lever_and_call(server, browser):
    page = _open(browser, server)
    card = page.locator(".wd-dc")
    card.wait_for()
    text = card.inner_text()
    assert "Ready to quote".lower() in text.lower()
    assert "$325–$425" in text
    assert "$275" in text
    assert "No fridge" in text and "$425" in text
    assert "if they push back" in text.lower()
    assert card.get_by_role("link", name="Call Dana").get_attribute("href") == "tel:3145550101"
    assert card.get_by_role("link", name="Text").get_attribute("href") == "sms:3145550101"


def test_no_review_offers_run_ai_review(server, browser):
    page = _open(browser, server, review=None)
    page.get_by_role("button", name="Run AI review").wait_for()


def test_tab_dock_switches_brief_quote_log(server, browser):
    page = _open(browser, server)
    dock = page.get_by_role("navigation", name="Lead")
    names = [b.get_attribute("aria-label") for b in dock.get_by_role("button").all()]
    assert names == ["Brief", "Quote", "Log"]
    assert dock.get_by_role("button", name="Brief").get_attribute("aria-current") == "page"
    dock.get_by_role("button", name="Log").tap()
    page.get_by_placeholder("Add a note").wait_for()
    assert dock.get_by_role("button", name="Log").get_attribute("aria-current") == "page"
    # The app's own Queue / Jobs dock is not on this screen.
    assert page.get_by_role("navigation", name="Main").count() == 0


def test_quote_bar_opens_quote_tab(server, browser):
    page = _open(browser, server)
    bar = page.locator(".wd-qbar")
    assert "not set" in bar.inner_text().lower()
    bar.get_by_role("button", name="Open quote").tap()
    page.wait_for_timeout(200)
    assert page.get_by_role("navigation", name="Lead").get_by_role("button", name="Quote").get_attribute("aria-current") == "page"
    assert bar.get_by_role("button", name="Lock & book").count() == 1


def test_more_menu_is_a_bottom_sheet(server, browser):
    page = _open(browser, server)
    page.get_by_role("button", name="More actions").tap()
    sheet = page.get_by_role("dialog", name="More actions")
    sheet.wait_for()
    for name in ("Schedule date", "Set follow-up", "View in calendar", "Mark released"):
        assert sheet.get_by_role("button", name=name).count() == 1, name
    page.wait_for_timeout(500)
    assert too_small(page) == []
    page.locator(".wd-scrim").tap(position={"x": 20, "y": 20})
    page.wait_for_timeout(500)
    assert not sheet.is_visible()


def test_log_tab_timeline_and_note(server, browser):
    page = _open(browser, server)
    page.get_by_role("navigation", name="Lead").get_by_role("button", name="Log").tap()
    tl = page.get_by_role("list", name="Activity")
    tl.wait_for()
    assert "Left a voicemail" in tl.inner_text()
    page.get_by_placeholder("Add a note").fill("Called back")
    page.get_by_role("button", name="Add", exact=True).tap()
    page.wait_for_timeout(300)
    assert ("POST", "/leads/l1/notes") in page.calls


def test_delete_asks_on_screen_not_with_a_browser_popup(server, browser):
    page = _open(browser, server)
    dialogs = []
    page.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
    page.get_by_role("navigation", name="Lead").get_by_role("button", name="Log").tap()
    page.get_by_role("button", name="Delete lead").tap()
    page.get_by_role("button", name="Yes, delete for good").wait_for()
    page.get_by_role("button", name="Keep it").tap()
    assert dialogs == []
    assert ("DELETE", "/leads/l1") not in page.calls


@pytest.mark.parametrize("tab", ["Brief", "Log"])
def test_tap_targets_at_phone_width(server, browser, tab):
    page = _open(browser, server)
    page.get_by_role("navigation", name="Lead").get_by_role("button", name=tab).tap()
    page.wait_for_timeout(600)
    assert too_small(page) == []


def test_no_hover_titles_and_no_broken_characters(server, browser):
    page = _open(browser, server)
    page.wait_for_timeout(400)
    assert page.locator("[title]").count() == 0
    body = page.locator("body").inner_text()
    assert "â€" not in body  # UTF-8 read as cp1252 ("â€")


def test_reduced_motion_stops_gate_stripe(server, browser):
    page = _open(browser, server, reduced_motion="reduce")
    name = page.locator("[aria-current=step] .haz").evaluate("e => getComputedStyle(e).animationName")
    assert name == "none"


@pytest.mark.parametrize("viewport", [PHONE, TABLET])
def test_no_sideways_scroll(server, browser, viewport):
    page = _open(browser, server, viewport=viewport)
    page.wait_for_timeout(400)
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")


def test_dark_mode_uses_night_background(server, browser):
    page = _open(browser, server, theme="dark")
    bg = page.evaluate("getComputedStyle(document.body).backgroundColor")
    assert bg == "rgb(19, 26, 23)"
    card_bg = page.locator(".wd-dc").evaluate("e => getComputedStyle(e).backgroundColor")
    assert card_bg == "rgb(28, 38, 34)"


@pytest.mark.parametrize("opener", ["Schedule date", "Set follow-up"])
def test_more_menu_popups_have_finger_sized_buttons(server, browser, opener):
    page = _open(browser, server)
    page.get_by_role("button", name="More actions").tap()
    page.get_by_role("dialog", name="More actions").get_by_role("button", name=opener).tap()
    page.wait_for_timeout(600)
    assert too_small(page) == []


def test_escalate_sheet_has_finger_sized_buttons(server, browser):
    page = _open(browser, server)
    page.get_by_role("navigation", name="Lead").get_by_role("button", name="Log").tap()
    page.get_by_role("button", name="Escalate to owner").tap()
    page.wait_for_timeout(600)
    assert too_small(page) == []


@pytest.mark.parametrize("section", ["Truck rental", "Payroll"])
def test_brief_fold_outs_have_finger_sized_buttons(server, browser, section):
    page = _open(browser, server, the_lead=_lead(status="booked", quote_cents=37500))
    page.get_by_role("button", name=section).first.tap()
    page.wait_for_timeout(600)
    assert too_small(page) == []
