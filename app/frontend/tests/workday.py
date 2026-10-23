"""Shared helpers for the Workday design tests.

The app is built once, served from dist/ on the test-copy port, and driven in
headless Chromium. Every API call is answered from fixtures in the tests, so
no backend, database or outside service is touched.
"""
import http.server
import inspect
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

FRONTEND = Path(__file__).resolve().parents[1]
PORT = 5192
BASE = f"http://127.0.0.1:{PORT}"
PHONE = {"width": 390, "height": 844}
TABLET = {"width": 1024, "height": 768}


def iso(minutes_ago: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).strftime("%Y-%m-%dT%H:%M:%S")


def lead(**over):
    base = {
        "id": "l1", "city_id": "c1", "city_name": "St. Louis", "city_slug": "stl",
        "source_type": "thumbtack_api", "source_reference_id": None, "status": "new",
        "urgency_flag": False, "customer_name": "Dana R.", "customer_phone": "3145550101",
        "service_type": "hauling", "job_location": None, "job_origin": None,
        "job_destination": None, "job_date_requested": None, "job_date_end": None,
        "appointment_time_slot": None, "estimated_job_duration_minutes": None,
        "scope_notes": None, "field_sources": None, "notes": None, "ingested_by": None,
        "assigned_to": None, "created_at": iso(4), "acknowledged_at": None,
        "updated_at": iso(4), "dispatched_at": None, "started_at": None,
        "move_distance_miles": None, "load_stairs": None, "unload_stairs": None,
        "move_size_label": None, "move_type": None, "move_date_options": None,
        "accept_and_pay": False, "quote_context": None, "quote_cents": None,
        "quoted_price_total": None, "quote_modifiers": None, "job_address": None,
        "source_category_label": "Thumbtack API", "active_followup": None,
    }
    base.update(over)
    return base


def user(role):
    return {"id": "u1", "username": "marisol", "role": role, "city_id": "c1",
            "city_name": "St. Louis", "is_active": True, "available_cities": []}


class SpaHandler(http.server.SimpleHTTPRequestHandler):
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


def open_app(browser, server, answer, role="facilitator", path="/", viewport=PHONE,
             reduced_motion="no-preference", theme="light"):
    """Open the app signed in as `role`. `answer(method, url)` returns
    (status, body) for an API call, or None for "not found". An answer that
    takes a third argument also gets the query string ("status=completed")."""
    wants_query = len(inspect.signature(answer).parameters) >= 3
    ctx = browser.new_context(viewport=viewport, has_touch=True, reduced_motion=reduced_motion)
    ctx.add_init_script(f"localStorage.setItem('hh_token','t'); localStorage.setItem('hh_theme','{theme}');")
    calls = []
    bodies = []

    def handle(route):
        req = route.request
        if req.resource_type not in ("fetch", "xhr"):
            return route.continue_()
        url = req.url.split("?")[0].replace(server, "")
        calls.append((req.method, url))
        try:
            body = req.post_data
        except Exception:  # binary uploads (screenshots) aren't text
            body = None
        bodies.append((req.method, url, body))
        got = {"/auth/me": (200, user(role))}.get(url) if req.method == "GET" else None
        query = req.url.split("?", 1)[1] if "?" in req.url else ""
        got = got or (answer(req.method, url, query) if wants_query else answer(req.method, url))
        if got is None:
            # Anything else answers "not found", as a fresh backend would.
            return route.fulfill(status=404, content_type="application/json", body='{"detail":"not mocked"}')
        status, body = got
        route.fulfill(status=status, content_type="application/json", body=json.dumps(body))

    ctx.route("**/*", handle)
    ctx.set_default_timeout(10000)
    page = ctx.new_page()
    page.calls = calls
    page.bodies = bodies
    page.goto(server + path)
    return page


def too_small(page):
    """Visible tap targets under 44x44 CSS px, as 'label WxH' strings."""
    return page.evaluate("""() => {
      const out = [];
      for (const el of document.querySelectorAll('button, a[href], select, input, textarea, [role=button]')) {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none') continue;
        if (el.type === 'file' || el.closest('[aria-hidden=true]')) continue;
        if (r.height < 44 || r.width < 44)
          out.push((el.getAttribute('aria-label') || el.textContent.trim().slice(0, 30) || el.placeholder || el.type) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
      }
      return out;
    }""")
