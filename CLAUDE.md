# CLAUDE.md — Holy Hauling App

## Identity

You are helping build the **Holy Hauling App** — an internal operating system for Holy Hauling, a junk removal and moving company. The primary user is the **facilitator** (lead intake and quoting). The app handles the full lead lifecycle: screenshot intake → OCR extraction → AI review → facilitator action → quote → booking.

This is not a generic CRM. Every design decision must reflect the Holy Hauling facilitator workflow.

---

## Source of Truth Priority

When deciding what to do or what is currently implemented:

1. `CAPABILITIES.md` — canonical list of what works, what is broken, what is planned
2. `CHANGELOG.md` — slice history; what changed and why
3. `docs/` — SOPs, specs, and architecture docs
4. `CONTEXT.md` — project purpose and what good looks like
5. This `CLAUDE.md` — operating rules and routing
6. Brain project files at `06_Projects/holy-hauling-app/` in the Knowledge Operating System — higher-level context and session re-entry

---

## Current State (as of 2026-04-22 — Slice 8)

**Built and working:** Lead CRUD with audit trail, screenshot-first OCR intake, Claude-powered extraction (16 fields), A–O AI review grounded in pricing SOP, facilitator queue + detail UI, field provenance tracking, Thumbtack webhook normalization, 108 passing pytest tests.

**Active wave — automatic intake/review:** Replace contact-lock with auto-review semantics; make OCR + AI review trigger automatically on screenshot upload; treat masked Thumbtack phones as unavailable.

**Not started:** Quote builder UI, crew/field worker views, payments, alert ladder, E2E tests, Docker, CI/CD.

---

## Routing Table

| Task | Go to | Read first | Notes |
|------|-------|-----------|-------|
| Implement a backend feature | `app/backend/app/` | `CAPABILITIES.md`, relevant service file | Services own business logic; routes own only HTTP |
| Implement a frontend feature | `app/frontend/src/` | `CAPABILITIES.md`, relevant screen/component | State goes in React Query hooks, not local state |
| Fix a backend bug | `app/backend/app/` | `CAPABILITIES.md`, failing test if any | Read the service file before the route |
| Fix a frontend bug | `app/frontend/src/` | Affected screen or component | Check `useLeads.ts` before assuming it's a component issue |
| Add or change state transitions | `app/backend/app/services/lead_service.py` | `CAPABILITIES.md`, `docs/` specs | State logic lives here only — not in routes or schemas |
| Add or change AI review logic | `app/backend/app/services/ai_review_service.py` | `docs/sops/`, `CAPABILITIES.md` | A–O structure is locked; changes are additive |
| Add or change OCR extraction | `app/backend/app/services/ocr_service.py` | `CAPABILITIES.md` | Masked phone handling lives here |
| Write or update tests | `app/backend/tests/` | The service file being tested | 108 passing tests is the baseline — do not regress |
| Update the SOP grounding document | `docs/sops/` | Current SOP, `ai_review_service.py` | Path configurable via `GROUNDING_FILE_PATH` env var |
| Add or change a database model | `app/backend/app/models/` | Existing model, current schema version | Schema is at v8 — track all migrations |
| Add or change an API schema | `app/backend/app/schemas/` | Existing schema, relevant model | Never return raw SQLAlchemy objects |
| Review what is or isn't built | `CAPABILITIES.md` | — | Single source of truth for implementation status |
| Re-enter a session mid-wave | `CONTEXT.md`, then active service files | `CAPABILITIES.md` | Start with the blocker list in `CAPABILITIES.md` |

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS |
| Backend | Python FastAPI + SQLAlchemy (async) |
| Database | SQLite via aiosqlite — schema v8 |
| AI / ML | Claude API — OCR field extraction + A–O AI review |
| State management | TanStack Query (React Query) |
| Testing | pytest (backend, 108 tests); Playwright + Jest (frontend, configured, not yet used) |
| Run | `python run.py` — local only, no Docker required |

---

## Module Map

| Module | Responsibility |
|--------|----------------|
| `app/backend/app/models/` | SQLAlchemy ORM: Lead, Screenshot, OCRResult, AIReview, LeadEvent |
| `app/backend/app/routers/leads.py` | CRUD, status transitions, notes, acknowledgment |
| `app/backend/app/routers/ingest.py` | Screenshot intake, Thumbtack webhook |
| `app/backend/app/schemas/` | Pydantic request/response shapes |
| `app/backend/app/services/lead_service.py` | State transitions, audit trail — all state logic lives here |
| `app/backend/app/services/ingest_service.py` | Screenshot-first intake orchestration |
| `app/backend/app/services/ocr_service.py` | Claude OCR extraction, masked phone handling |
| `app/backend/app/services/ai_review_service.py` | A–O review generation grounded in pricing SOP |
| `app/backend/tests/` | 108 pytest tests across all services |
| `app/frontend/src/screens/` | LeadQueue, LeadDetail, LeadCreate |
| `app/frontend/src/components/` | LeadCard, StatusBadge, SourceBadge, AgeIndicator, FieldSourceBadge |
| `app/frontend/src/hooks/useLeads.ts` | React Query hooks for all lead operations |
| `docs/sops/` | Pricing-weighted SOP — AI review grounding source |

---

## Hard Rules

**Architecture:**
- State transitions belong in `lead_service.py` — never in routes, schemas, or frontend.
- Routes own HTTP only: validation, calling a service, returning a response.
- Never return raw SQLAlchemy objects — always go through Pydantic schemas.
- Schema migrations must be tracked — never allow model/migration drift.

**AI review:**
- The A–O format (15 sections) is locked. Do not restructure it. Changes are additive only.
- The SOP grounding path (`GROUNDING_FILE_PATH`) must remain configurable via env var.
- Grounding changes require operator review before deployment.

**Intake:**
- Screenshot-first intake is the primary design assumption — do not demote it to a secondary path.
- Field provenance must always be tracked (`field_sources`: `"ocr"` or `"edited"`).
- Lead event audit trail must record every state change and edit — never skip events for convenience.

**Scope (current wave):**
- Do not build booking, crew, payment, or alert ladder features during the automatic intake wave.
- Do not add provider switching UI until the intake path is stable.
- The contact-lock workflow is explicitly wrong and being replaced — do not patch it; replace the semantics entirely.

**Environment:**
- No hardcoded env vars — use `.env` and `.env.example` patterns.
- SQLite only for V1 — do not introduce Postgres without operator approval.
- The app must remain runnable locally via `run.py` without Docker.

**Tests:**
- 108 passing tests is the baseline — do not regress.
- Run `pytest` from `app/backend/` before declaring any slice complete.

---

## Business Rules (fixed — do not override with model instincts)

- **Moving** pricing follows time + care (move size, stairs, distance, crew size).
- **Hauling** pricing follows volume + disposal (load size, dump fees, labor).
- Pricing guidance must reflect Holy Hauling pricing logic — not generic AI estimates.
- Thumbtack masked phone values (e.g., `+1800XXXXXXX`) are not real — treat them as unavailable, do not store them in `customer_phone`.
- The facilitator is the decision-maker — AI supports, not replaces, judgment.

---

## Active Blockers (current wave)

1. Contact-lock workflow is implemented but wrong — replace with auto-review semantics in `lead_service.py` and `ingest_service.py`.
2. OCR + AI review are still manually triggered — add auto-trigger to the ingest path.
3. No correspondence screenshot support — intake path handles initial lead screenshots only.
4. No `quote_context` field — AI cannot receive supplemental context for re-runs.

---

## What to Avoid

- Patching the contact-lock workflow — it needs to be replaced.
- Encoding state logic outside `lead_service.py`.
- Restructuring the A–O review sections without operator approval.
- Building V2 features (crew views, payments, alert ladder) before the current wave is stable.
- Over-engineering intake for edge cases before the happy path is automated.
