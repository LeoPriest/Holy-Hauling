import http.server
import os
import subprocess
import threading

import pytest
from playwright.sync_api import sync_playwright

from workday import BASE, FRONTEND, PORT, SpaHandler

NPM = "npm.cmd" if os.name == "nt" else "npm"


@pytest.fixture(scope="session")
def server():
    # A static server, not `vite preview`: preview forwards /jobs, /settings
    # etc. to the dev backend on 8000, and a test copy must never reach it.
    subprocess.run([NPM, "run", "build"], cwd=FRONTEND, check=True, capture_output=True)
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), SpaHandler)
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
