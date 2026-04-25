---
project: "holy-hauling-app"
date: "2026-04-23"
session: "Google Calendar integration — OAuth, crew invites, Settings UI"
---

# brain-sync — holy-hauling-app — 2026-04-23

## What changed this session
<!-- last 20 commits -->
- bd1b61b fix: address code review findings from Google Calendar integration
- 9916a39 feat: add Google Calendar connect button and status to settings
- d496206 feat: add Google email field to user create/edit forms
- d101952 feat: sync Google Calendar event when job date/address/notes change
- 81c6593 feat: trigger calendar sync on crew assignment changes
- 3c4e0de feat: add /admin/google OAuth connect/callback/status endpoints
- c907145 fix: delete_event returns bool; sync_job_calendar only clears event ID on confirmed deletion
- 43397a3 feat: add calendar_service with create/update/delete/sync_job_calendar
- a8b18d1 fix: allow email to be cleared via PATCH using model_fields_set
- 46344aa feat: add optional email field to users for Google Calendar invites
- f1c43c4 feat: add google packages, user.email, leads.google_calendar_event_id
- da8cc95 Add Google Calendar integration implementation plan
- e01617d Add Google Calendar integration design spec
- 05b0b6e feat: move dark mode toggle to Settings, default to dark
- 4c80315 feat: global dark mode via ThemeContext
- c49b58f feat: inline field editing on Brief panel
- e717b33 feat: job tabs (Scheduled/In Progress), clickable address â†’ Maps, street view preview
- f3f625c fix: rename closed status labels to Completed / Released
- f4f6af1 feat: add 'lost' terminal status to differentiate won vs not-won leads
- ae2813c feat: split lead queue into Active / Released tabs

## What was tried and failed
<!-- "Tried X, result was Y" — prevents re-attempting dead ends in future sessions -->
<!-- Example: "Tried masked phone storage, caused state model confusion — removed" -->
<!-- Leave blank only if nothing failed or was abandoned -->

## Current state
**Built and working:** Lead CRUD with audit trail, screenshot-first OCR intake, Claude-powered extraction (16 fields), A–O AI review grounded in pricing SOP, facilitator queue + detail UI, field provenance tracking, Thumbtack webhook normalization, 108 passing pytest tests.
**Active wave — automatic intake/review:** Replace contact-lock with auto-review semantics; make OCR + AI review trigger automatically on screenshot upload; treat masked Thumbtack phones as unavailable.
**Not started:** Quote builder UI, crew/field worker views, payments, alert ladder, E2E tests, Docker, CI/CD.

## Decisions made
<!-- Decision + rationale. Not just the outcome. -->
<!-- Example: "Removed contact-lock: didn't match real workflow, replaced with auto-review semantics" -->

## Blockers
- Contact-lock workflow is implemented but wrong — replace with auto-review semantics in `lead_service.py` and `ingest_service.py`.
- OCR + AI review are still manually triggered — add auto-trigger to the ingest path.
- No correspondence screenshot support — intake path handles initial lead screenshots only.
- No `quote_context` field — AI cannot receive supplemental context for re-runs.

## Open questions
<!-- Unresolved items that need future work or a decision -->

## Next action
Contact-lock workflow is implemented but wrong — replace with auto-review semantics in `lead_service.py` and `ingest_service.py`.
