"""
run.py — starts the Holy Hauling backend and frontend together.

Usage:
    python run.py            # starts both backend and frontend
    python run.py --backend  # starts backend only
    python run.py --frontend # starts frontend only
"""

import argparse
import os
import signal
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(ROOT, "app", "backend")
FRONTEND_DIR = os.path.join(ROOT, "app", "frontend")


def start_backend():
    print("[backend] starting on http://localhost:8000")
    return subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app", "--reload", "--port", "8000"],
        cwd=BACKEND_DIR,
    )


def start_frontend():
    npm = "npm.cmd" if sys.platform == "win32" else "npm"
    node_modules = os.path.join(FRONTEND_DIR, "node_modules")
    if not os.path.isdir(node_modules):
        print("[frontend] node_modules not found — running npm install first...")
        subprocess.run([npm, "install"], cwd=FRONTEND_DIR, check=True)
    print("[frontend] starting on http://localhost:5173")
    return subprocess.Popen(
        [npm, "run", "dev"],
        cwd=FRONTEND_DIR,
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", action="store_true")
    parser.add_argument("--frontend", action="store_true")
    args = parser.parse_args()

    run_backend = args.backend or not args.frontend
    run_frontend = args.frontend or not args.backend

    procs = []

    if run_backend:
        procs.append(start_backend())
        if run_frontend:
            time.sleep(1)  # give backend a moment before frontend starts

    if run_frontend:
        procs.append(start_frontend())

    print("\nPress Ctrl+C to stop.\n")

    def shutdown(sig=None, frame=None):
        print("\nstopping...")
        for p in procs:
            p.terminate()
        for p in procs:
            p.wait()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    for p in procs:
        p.wait()


if __name__ == "__main__":
    main()
