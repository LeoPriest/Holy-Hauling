# Holy Hauling Recovery Prompt + Progress Tracking Files

## 1. Prompt for Claude — Fix functionality after recent freehand changes

```md
We need to recover functionality in the Holy Hauling app after recent freehand changes.

Current symptoms:
- leads are not loading in the app
- screenshot upload is still failing
- we need the current system made functional again before adding new features

Important constraints:
- do not redesign this as a generic CRM
- keep screenshot-first intake as the default path
- manual entry remains fallback-only
- keep Anthropic / Claude as the active provider for OCR/extraction and AI review right now
- keep the currently configured grounding file path active
- preserve the current unified queue, lead detail, extraction, and AI review architecture unless something is clearly broken
- focus on restoring working functionality first, not adding new features

Your job:
1. Diagnose what the last freehand changes likely broke
2. Restore proper functionality with the **smallest clean patch set**
3. Add project tracking files so progress is easier to manage going forward

## What must work after this fix
1. leads load correctly in the queue
2. screenshot-first upload works again
3. screenshot ingest reaches the backend successfully
4. extraction/OCR works with Claude
5. extracted fields still apply cleanly into the lead model
6. AI review still works with Claude
7. the configured grounding file is actually used
8. runtime/config errors are clear and not silent
9. existing working behavior is preserved where possible

## What to inspect first
Check these areas in order:
1. backend startup and env loading
2. frontend-to-backend route/proxy wiring
3. whether `/ingest/screenshot` is mounted and reachable
4. whether queue endpoints still return data correctly
5. whether any recent change broke filtering, serialization, or lead loading
6. whether screenshot upload request shape still matches backend expectations
7. whether grounding loading or provider setup is causing request failures to cascade
8. whether any recent change to `.env`, dotenv loading, or router mounting broke dev behavior

## Likely root-cause areas to verify
- `load_dotenv()` timing / env loading
- router inclusion in `main.py`
- Vite proxy config for `/api`, `/uploads`, and `/ingest`
- API base URL usage in frontend services
- screenshot ingest request path and multipart handling
- lead queue query / schema mismatch
- silent exception handling that hides broken config
- model/provider config mismatch
- grounding file path resolution

## Required output
At the top, give:
1. files changed
2. what was fixed
3. how to test
4. assumptions made

## Implementation rules
- return only changed files
- prefer minimal patches
- include tests for the fixes
- do not add unrelated new features
- do not refactor broadly unless required to restore functionality
- if something is unclear, inspect first and choose the most likely root cause instead of widening scope

## Additional requirement — progress tracking
Create and wire these files into the repo if they do not already exist:

### A. `CHANGELOG.md`
Purpose:
- track major development progress by date and slice
- track fixes, regressions, and recovery work
- make it easier to see what changed over time

Minimum structure:
- date
- slice / milestone
- added
- changed
- fixed
- notes / risks

### B. `CAPABILITIES.md`
Purpose:
- maintain a living list of what the app can currently do
- separate “working now” from “planned” and “broken/in progress”
- update this file whenever a meaningful capability changes

Minimum structure:
- Currently Working
- Partially Working / Needs Verification
- Broken / In Progress
- Planned / Not Yet Built
- Notes on provider/config assumptions

When you complete the fix, update both files to reflect the current state accurately.

Use low-token mode.
Do not restate project background.
Focus on recovery and accurate tracking.
```

---

## 2. Recommended `CHANGELOG.md` starter structure

```md
# CHANGELOG

All meaningful development changes for the Holy Hauling app should be logged here.

---

## [Unreleased]

### Added
- 

### Changed
- 

### Fixed
- 

### Notes
- 

---

## [2026-04-18] Slice 1 — App Skeleton + Lead Domain + Queue Foundation

### Added
- Initial backend foundation
- Lead CRUD
- Queue screen foundation
- Lead events/audit trail

### Changed
- 

### Fixed
- 

### Notes
- First operational skeleton established

---

## [2026-04-18] Slice 2 — Intake-to-Queue Foundation

### Added
- Screenshot attachments
- Lead field editing
- Operational notes
- Assigned-to queue filter

### Changed
- Intake notes vs operational notes clarified

### Fixed
- 

### Notes
- Set up screenshot attachment path for future extraction

---

## [2026-04-18] Slice 3 — Screenshot-to-Structured-Intake Foundation

### Added
- Screenshot extraction / OCR flow
- Parsed field review/apply
- OCR result storage
- OCR status tracking

### Changed
- Screenshot detail view enhanced

### Fixed
- 

### Notes
- Created bridge from screenshot to structured lead data

---

## [2026-04-18] Slice 4 — Grounded AI Review Engine

### Added
- A–H AI review generation
- AI review storage and auditability
- Lead detail AI review panel

### Changed
- Grounding/prompt version tracking introduced

### Fixed
- 

### Notes
- First AI review loop established

---

## [2026-04-18] Slice 5 — Screenshot-First Intake + Webhook Ingest API

### Added
- Screenshot-first ingest pipeline
- Thumbtack webhook normalization
- Deduping on external lead identifiers

### Changed
- Manual entry shifted to fallback role

### Fixed
- 

### Notes
- Intake architecture aligned more closely with real workflow

---

## [2026-04-18] Recovery / Functionality Restoration

### Added
- CHANGELOG.md
- CAPABILITIES.md

### Changed
- 

### Fixed
- Leads not loading
- Screenshot upload failures
- Any routing/env/proxy/config regressions discovered during recovery

### Notes
- Recovery pass focused on restoring end-to-end usability before new feature work
```

---

## 3. Recommended `CAPABILITIES.md` starter structure

```md
# CAPABILITIES

This file tracks what the Holy Hauling app can currently do, what needs verification, what is broken, and what is planned.

---

## Currently Working
- [ ] Lead queue loads correctly
- [ ] Manual lead creation works
- [ ] Screenshot-first intake works
- [ ] Screenshot upload reaches backend
- [ ] Screenshot extraction/OCR works
- [ ] Extracted fields can be applied to the lead
- [ ] AI review returns valid A–H output
- [ ] Grounding file is actively used in AI review
- [ ] Lead event history is visible
- [ ] Operational notes work
- [ ] Assigned handler editing works
- [ ] Queue filters work
- [ ] Webhook ingest normalizes into lead queue

---

## Partially Working / Needs Verification
- [ ] Screenshot ingest with real Thumbtack screenshots
- [ ] Real-world extraction quality
- [ ] AI review quality against current pricing-weighted SOP
- [ ] Duplicate webhook behavior under repeated delivery
- [ ] Grounding path behavior across different machines
- [ ] Provider/model metadata storage accuracy

---

## Broken / In Progress
- [ ] Example: leads not loading in queue
- [ ] Example: screenshot upload failing
- [ ] Example: AI review not using configured grounding path

---

## Planned / Not Yet Built
- [ ] Alert ladder for unprocessed leads
- [ ] Quiet hours / backup handler routing
- [ ] Review history UI expansion
- [ ] Quote builder / pricing control UI
- [ ] Owner-review automation rules
- [ ] Booking-to-job conversion refinement
- [ ] Crew workflow expansion
- [ ] Payments / closeout refinement
- [ ] OpenViking or richer multi-doc retrieval if needed later
- [ ] Provider/model switching UI

---

## Current Provider / Config Notes
- OCR provider:
- OCR model:
- AI review provider:
- AI review model:
- Grounding file:
- Screenshot-first intake is primary:
- Manual entry is fallback-only:

---

## Last Verified
- Date:
- Verified by:
- Notes:
```

---

## 4. Best instruction for Claude on tracking discipline

Add this follow-up after the recovery fix if needed:

```md
Going forward, every meaningful fix or feature change must update:
1. `CHANGELOG.md`
2. `CAPABILITIES.md`

Rules:
- `CHANGELOG.md` should record what changed
- `CAPABILITIES.md` should reflect what is actually working now
- do not mark capabilities as working unless they are implemented and verified
- keep both files concise and current
```
