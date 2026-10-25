"""Workday design, stage 1: lead queue, lead cards and the dock at phone width.

Builds the frontend, serves dist/ on the test-copy port and
drives it in headless Chromium (helpers in workday.py, fixtures in conftest.py). Every API call is answered from fixtures in
this file, so no backend, database or outside service is touched.

Run from app/frontend:  python -m pytest -q tests
"""
import pytest

from workday import PHONE, TABLET, iso, lead, open_app, too_small


LEADS = [
    lead(id="l1", customer_name="Dana R.", job_address="12 Elm St, Kirkwood, MO 63122"),
    lead(id="l2", customer_name="Marcus T.", status="in_review", source_type="yelp_screenshot",
         service_type="moving", move_size_label="2 bedroom", job_origin="1900 Park Ave, St. Louis, MO",
         created_at=iso(22), updated_at=iso(22), acknowledged_at=iso(20)),
    lead(id="l3", customer_name="Linda K.", status="ready_for_quote", job_location="Florissant, MO",
         created_at=iso(60), updated_at=iso(60), acknowledged_at=iso(50), urgency_flag=True),
    lead(id="l4", customer_name="Old Lead", status="lost", created_at=iso(3000),
         updated_at=iso(3000), acknowledged_at=iso(2990)),
]

SETTINGS = {"t1_minutes": 100000, "t2_minutes": 200000}


def _open(browser, server, role="facilitator", path="/", viewport=PHONE, reduced_motion="no-preference", leads=None, theme="light"):
    data = LEADS if leads is None else leads

    def answer(method, url):
        if method == "GET" and url == "/leads":
            return 200, data
        if method == "GET" and url == "/settings":
            return 200, SETTINGS
        return None

    return open_app(browser, server, answer, role=role, path=path, viewport=viewport,
                    reduced_motion=reduced_motion, theme=theme)


_too_small = too_small


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


# ── Leads that land while the queue is open ──────────────────────────────

def _live_queue(browser, server, leads):
    """Queue whose /leads answer is the `leads` list as it stands, filtered by
    source_type like the backend does. Mutate the list, then `_refetch`."""
    def answer(method, url, query):
        if method == "GET" and url == "/leads":
            want = next((p.split("=", 1)[1] for p in query.split("&") if p.startswith("source_type=")), None)
            return 200, [l for l in leads if not want or l["source_type"] == want]
        if method == "GET" and url == "/settings":
            return 200, SETTINGS
        return None

    return open_app(browser, server, answer)


def _refetch(page):
    # Coming back to the tab refetches the queue, as the 30s poll would.
    page.evaluate("window.dispatchEvent(new Event('visibilitychange'))")


def _card_box(card):
    return card.evaluate("""e => { const s = getComputedStyle(e);
        return [s.textAlign, s.paddingTop, s.paddingLeft, s.outlineStyle] }""")


# Records every class the arriving card and its row ever carry, including the
# ones a later render replaced, so a one-frame wrong state still shows up.
_WATCH_ARRIVAL = """name => {
    window.__cardClasses = []; window.__slotClasses = []
    const note = (el, cls) => {
        if (!el.textContent.includes(name)) return
        if (el.matches('.wd-card')) window.__cardClasses.push(cls)
        if (el.matches('.wd-slot')) window.__slotClasses.push(cls)
    }
    new MutationObserver(records => {
        for (const r of records) {
            if (r.type === 'attributes') { note(r.target, r.oldValue || ''); note(r.target, r.target.className) }
            for (const n of r.addedNodes) {
                if (!(n instanceof Element)) continue
                for (const el of [n, ...n.querySelectorAll('.wd-card, .wd-slot')]) note(el, el.className)
            }
        }
    }).observe(document.body, { subtree: true, childList: true, attributes: true,
                                attributeFilter: ['class'], attributeOldValue: true })
}"""


def test_arriving_lead_keeps_the_card_layout(server, browser):
    leads = [dict(l) for l in LEADS]
    page = _live_queue(browser, server, leads)
    dana = page.get_by_role("button", name="Dana R.")
    dana.wait_for()
    page.wait_for_timeout(800)
    settled = _card_box(dana)
    page.evaluate(_WATCH_ARRIVAL, "Nina P.")

    leads.append(lead(id="l9", customer_name="Nina P.", created_at=iso(0), updated_at=iso(0),
                      job_address="5 Oak Dr, Kirkwood, MO 63122"))
    _refetch(page)
    page.locator(".wd-toast.show").wait_for()
    nina = page.get_by_role("button", name="Nina P.")
    nina.wait_for()
    # Mid drop-in, the new card already has the same layout as every other card.
    assert _card_box(nina) == settled
    # Once the drop has played it is an ordinary card again.
    page.wait_for_timeout(1500)
    assert "drop" not in (nina.get_attribute("class") or "")
    assert _card_box(nina) == settled
    # It dropped in from its very first frame and never played the load-time rise.
    cards = page.evaluate("window.__cardClasses")
    assert cards and "wd-card-drop" in cards[0].split()
    assert not [c for c in cards if "wd-rise" in c.split()]
    # Its row opened from nothing, pushing the cards below it down.
    slots = page.evaluate("window.__slotClasses")
    assert slots and "enter" in slots[0].split()
    assert "enter" not in page.locator(".wd-slot", has=nina).get_attribute("class").split()


def test_two_quick_arrivals_each_clear_on_their_own(server, browser):
    leads = [dict(l) for l in LEADS]
    page = _live_queue(browser, server, leads)
    page.get_by_role("button", name="Dana R.").wait_for()
    page.wait_for_timeout(800)
    leads.append(lead(id="l9", customer_name="Nina P.", created_at=iso(0), updated_at=iso(0)))
    _refetch(page)
    nina = page.get_by_role("button", name="Nina P.")
    nina.wait_for()
    page.wait_for_timeout(400)
    leads.append(lead(id="l10", customer_name="Omar S.", created_at=iso(0), updated_at=iso(0)))
    _refetch(page)
    omar = page.get_by_role("button", name="Omar S.")
    omar.wait_for()
    # The second arrival doesn't cut the first one's drop short...
    assert "drop" in (nina.get_attribute("class") or "")
    # ...and the first one's drop ends on its own clock, not when the second's does.
    page.wait_for_timeout(700)
    assert "drop" not in (nina.get_attribute("class") or "")
    assert "drop" in (omar.get_attribute("class") or "")


def test_filter_flip_raises_no_new_lead_alert(server, browser):
    leads = [dict(l) for l in LEADS]
    page = _live_queue(browser, server, leads)
    page.get_by_role("button", name="Dana R.").wait_for()
    page.wait_for_timeout(800)
    source = page.get_by_role("combobox", name="Source")
    source.select_option("yelp_screenshot")
    page.get_by_role("button", name="Marcus T.").wait_for()
    page.wait_for_timeout(400)
    source.select_option("")
    page.get_by_role("button", name="Dana R.").wait_for()
    page.wait_for_timeout(800)
    assert page.locator(".wd-toast.show").count() == 0
    assert page.locator(".wd-card[class*=drop]").count() == 0
