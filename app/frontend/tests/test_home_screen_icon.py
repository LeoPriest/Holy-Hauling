"""Add to Home Screen shows the Holy Hauling logo, not a page screenshot.

Run from app/frontend:  python -m pytest -q tests/test_home_screen_icon.py
"""
import io
import json
import urllib.request

from PIL import Image


def _get(server, path):
    with urllib.request.urlopen(server + path) as r:
        return r.headers.get("Content-Type", ""), r.read()


def _head_link(page, rel):
    return page.locator(f'head link[rel="{rel}"]').get_attribute("href")


def _png(server, path):
    kind, body = _get(server, path)
    assert body[:8] == b"\x89PNG\r\n\x1a\n", f"{path} is not a PNG ({kind})"
    return Image.open(io.BytesIO(body))


def test_iphone_home_screen_icon_is_the_logo(server, browser):
    page = browser.new_page()
    page.goto(server + "/")
    href = _head_link(page, "apple-touch-icon")
    icon = _png(server, href)
    assert icon.size == (180, 180)
    # iOS paints transparent corners black, so the icon must be solid.
    assert icon.mode == "RGB"
    assert page.locator('head meta[name="apple-mobile-web-app-title"]').get_attribute("content") == "Holy Hauling"
    page.close()


def test_android_manifest_names_the_app_and_its_icons(server, browser):
    page = browser.new_page()
    page.goto(server + "/")
    _, body = _get(server, _head_link(page, "manifest"))
    manifest = json.loads(body)
    assert manifest["name"] == "Holy Hauling"
    assert manifest["display"] == "standalone"
    sizes = {}
    for entry in manifest["icons"]:
        img = _png(server, entry["src"])
        assert entry["sizes"] == f"{img.width}x{img.height}"
        sizes.setdefault(entry["sizes"], set()).add(entry.get("purpose", "any"))
    assert "any" in sizes["192x192"]
    assert "any" in sizes["512x512"]
    assert "maskable" in sizes["512x512"]
    page.close()


def test_browser_tab_shows_the_logo(server, browser):
    page = browser.new_page()
    page.goto(server + "/")
    assert _png(server, _head_link(page, "icon")).size == (32, 32)
    page.close()
