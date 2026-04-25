"""
Generate a brain-sync doc from the template and deliver it to docs/sync/.

Usage:
    python scripts/brain-sync.py
    python scripts/brain-sync.py --session "Google Calendar integration complete"

Fills in:
    - date, project slug
    - What changed: git log since last sync (or last 20 commits)
    - Current state: pulled from CLAUDE.md "Current State" section
    - Blockers: pulled from CLAUDE.md "Active Blockers" section
    - Next action: first item from Active Blockers
    - Other sections: left as prompts for manual completion
"""

import argparse
import os
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).parent.parent
TEMPLATE = ROOT / "_templates" / "brain-sync.md"
SYNC_DIR = ROOT / "docs" / "sync"
CLAUDE_MD = ROOT / "CLAUDE.md"

PROJECT_SLUG = "holy-hauling-app"


def git(*args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=ROOT, capture_output=True, text=True
    )
    return result.stdout.strip()


def last_sync_date() -> str | None:
    """Return the date of the most recent brain-sync file, or None."""
    if not SYNC_DIR.exists():
        return None
    files = sorted(SYNC_DIR.glob("*brain-sync.md"), reverse=True)
    if not files:
        return None
    # Filename format: YYYY-MM-DD-brain-sync.md
    match = re.match(r"(\d{4}-\d{2}-\d{2})", files[0].name)
    return match.group(1) if match else None


def git_log_since(since_date: str | None) -> str:
    """Return a formatted git log since the given date, or last 20 commits."""
    if since_date:
        log = git("log", f"--since={since_date}", "--oneline", "--no-merges")
    else:
        log = git("log", "--oneline", "--no-merges", "-20")
    if not log:
        return "No commits found."
    lines = log.splitlines()
    return "\n".join(f"- {line}" for line in lines)


def extract_section(text: str, keyword: str) -> str:
    """Extract lines under a ## heading that contains keyword until the next ## or end."""
    lines = text.splitlines()
    in_section = False
    collected = []
    for line in lines:
        if line.startswith("## ") and keyword.lower() in line.lower():
            in_section = True
            continue
        if in_section:
            if line.startswith("## "):
                break
            collected.append(line)
    return "\n".join(collected).strip()


def parse_blockers(blockers_text: str) -> list[str]:
    """Extract numbered blocker items as plain strings."""
    items = []
    for line in blockers_text.splitlines():
        match = re.match(r"^\d+\.\s+(.+)", line)
        if match:
            items.append(match.group(1).strip())
    return items


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate brain-sync doc")
    parser.add_argument(
        "--session", "-s",
        default=None,
        help="One-line session description (default: derived from latest commit)",
    )
    args = parser.parse_args()

    if not TEMPLATE.exists():
        print(f"ERROR: template not found at {TEMPLATE}", file=sys.stderr)
        sys.exit(1)

    today = date.today().isoformat()
    SYNC_DIR.mkdir(parents=True, exist_ok=True)

    # Session description: arg > latest commit subject > placeholder
    session_desc = args.session
    if not session_desc:
        latest = git("log", "-1", "--format=%s")
        session_desc = latest if latest else "describe this session"

    # Git log since last sync
    since = last_sync_date()
    changed_log = git_log_since(since)
    since_label = f"since last sync ({since})" if since else "last 20 commits"

    # Pull sections from CLAUDE.md
    claude_text = CLAUDE_MD.read_text(encoding="utf-8") if CLAUDE_MD.exists() else ""
    current_state_raw = extract_section(claude_text, "Current State")
    active_blockers_raw = extract_section(claude_text, "Active Blockers")

    blockers = parse_blockers(active_blockers_raw)
    blockers_md = "\n".join(f"- {b}" for b in blockers) if blockers else "none"
    next_action = blockers[0] if blockers else "<!-- specify next action -->"

    # Build current state summary: all non-empty, non-separator lines
    current_state_lines = [
        l for l in current_state_raw.splitlines()
        if l.strip() and l.strip() != "---"
    ]
    current_state = "\n".join(current_state_lines) if current_state_lines else "<!-- describe current state -->"

    template = TEMPLATE.read_text(encoding="utf-8")

    filled = template
    filled = filled.replace("{{project-slug}}", PROJECT_SLUG)
    filled = filled.replace("{{YYYY-MM-DD}}", today)
    filled = filled.replace("{{one-line session description}}", session_desc)

    # Replace section bodies (strip HTML comments, insert content)
    def replace_section(doc: str, heading: str, content: str) -> str:
        pattern = rf"(## {re.escape(heading)}\n)((?:<!--.*?-->\n)*)"
        replacement = rf"\g<1>{content}\n"
        return re.sub(pattern, replacement, doc, flags=re.MULTILINE)

    filled = replace_section(filled, "What changed this session",
        f"<!-- {since_label} -->\n{changed_log}")
    filled = replace_section(filled, "Current state", current_state)
    filled = replace_section(filled, "Blockers", blockers_md)
    filled = replace_section(filled, "Next action", next_action)

    out_path = SYNC_DIR / f"{today}-brain-sync.md"
    if out_path.exists():
        # Avoid clobbering — append a counter
        i = 2
        while out_path.exists():
            out_path = SYNC_DIR / f"{today}-brain-sync-{i}.md"
            i += 1

    out_path.write_text(filled, encoding="utf-8")
    print(f"brain-sync written to: {out_path}")
    print(f"Open and complete: What was tried and failed, Decisions made, Open questions")


if __name__ == "__main__":
    main()
