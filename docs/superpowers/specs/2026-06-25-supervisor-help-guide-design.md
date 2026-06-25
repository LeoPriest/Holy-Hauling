# Supervisor Help Guide (Role-Aware /help) — Design Spec

**Date:** 2026-06-25
**Status:** Approved direction, pre-implementation
**Author:** Ron + Claude

## Problem

The facilitator help guide (shipped) is a passive, role-specific reference. The **supervisor** — the **on-site lead** who runs the move and drives the crew — needs the same kind of guide, but with *their* content: how a job flows through its phases, managing crew, photos/notes, the calendar. The facilitator's lead-intake/quoting content is irrelevant to them; escalations are explicitly out (supervisors don't act on them).

Rather than build a second parallel screen/route, this generalizes the existing `/help` into a **role-aware guide**: one screen that renders the content set for the viewer's role. This keeps it DRY and scales to a crew guide later.

## Goals

1. Give the supervisor a passive reference scoped to **running a job on site** (phase tracking, crew, photos/notes, calendar) + a glossary.
2. **Generalize `/help`** to pick content by role — facilitator and supervisor today; admin sees the facilitator guide (they quote).
3. Reuse the existing `AccordionSection` and screen shell — only content + role wiring change.

Out of scope: the facilitator's lead/quoting content for supervisors; escalations in the supervisor guide; a crew guide (later); the **escalation-push cleanup** (supervisors no longer needing escalation alerts) — that's a separate queued task.

## Decisions locked during brainstorming

- **Role-aware single `/help`** (not a second route) — content keyed by role.
- **Supervisor = on-site lead**; content is jobs-centric (phases, crew, photos/notes, calendar), **no escalations**.
- **Admin → facilitator guide** (admins do ops/quoting).
- Same accordion layout as the facilitator guide (already shipped/approved) — content-only difference.

## Architecture

### Content model — role-keyed guides

`app/frontend/src/content/helpContent.ts` is refactored from a single `HELP_SECTIONS` to role-keyed guides (the `HelpSection` discriminated union is unchanged):

```ts
export interface HelpGuide {
  title: string          // e.g. "Facilitator guide" / "Supervisor guide"
  intro: string          // the one-line intro under the header
  sections: HelpSection[]
}

export const HELP_GUIDES: Record<'facilitator' | 'supervisor', HelpGuide> = {
  facilitator: { title: 'Facilitator guide', intro: '…', sections: [ /* existing facilitator sections */ ] },
  supervisor:  { title: 'Supervisor guide',  intro: '…', sections: [ /* new supervisor sections */ ] },
}

export function guideForRole(role: string | undefined): HelpGuide {
  return role === 'supervisor' ? HELP_GUIDES.supervisor : HELP_GUIDES.facilitator
}
```

`guideForRole`: `supervisor` → supervisor guide; everyone else eligible (`facilitator`, `admin`) → facilitator guide. The existing facilitator sections move verbatim into `HELP_GUIDES.facilitator.sections`.

### Supervisor guide content

`HELP_GUIDES.supervisor` — `title: "Supervisor guide"`, `intro:` "You're the lead on site — you run the move and the crew. Here's how the job works and what the words mean." — sections:

1. **Track the job through its phases** (`kind: 'steps'`) — as the job goes, tap **Dispatched → En route → Arrived → Started → Completed**; that keeps the office in sync on live progress, and Completed jobs move to the Completed tab.
2. **Your crew** (`kind: 'text'`) — who's assigned to the job; you can add or swap crew if needed; blocked/unavailable crew are flagged.
3. **Photos & notes** (`kind: 'text'`) — log before/after photos and notes on the job so there's a record of the move.
4. **The calendar** (`kind: 'text'`) — your upcoming jobs at a glance (week/month).
5. **Key terms** (`kind: 'terms'`) — the job phases (Dispatched, En route, Arrived, Started, Completed) and what each means.

(Final copy is authored in the implementation plan; the section list + kinds are fixed here.)

### Screen + entry + route (role wiring)

- **`HelpGuideScreen`** — reads `useAuth().user?.role`, computes `const guide = guideForRole(role)`, and renders `guide.title` (header), `guide.intro`, and `guide.sections` via `AccordionSection`. The hardcoded title/intro are replaced by the guide's. Open-state logic and `AccordionSection` are unchanged.
- **`SettingsScreen`** — the "Help" entry's gate widens from facilitator/admin to **admin + facilitator + supervisor**; its label/subtitle reflect the role's guide (e.g., "Supervisor guide — how jobs work"). Reuse a role check that includes supervisor (define a small `canViewGuide = role is admin|facilitator|supervisor`, or inline).
- **`App.tsx`** — the `/help` route's `RoleGuard` widens to `['admin', 'facilitator', 'supervisor']` (was `['admin','facilitator']`), matching the entry gate.

`AccordionSection` and the screen's accordion/rendering are untouched — this is content + role selection only.

## Data flow

```
Settings (admin/facilitator/supervisor) -> "Help" entry -> navigate('/help')
  HelpGuideScreen -> guideForRole(user.role) -> { title, intro, sections }
    -> render title + intro + AccordionSection per section
  (entirely static; the only role input is user.role from useAuth)
```

## Error / empty states

- No fetch → no loading/error states (static content).
- A role with no guide mapping → `guideForRole` falls back to the facilitator guide (never blank). Crew is not granted the route/entry, so they don't reach it; if they somehow did, they'd get the fallback (harmless), but `RoleGuard` blocks them first.
- Crew reaching `/help` directly → blocked by `RoleGuard` (crew excluded).

## Testing

### Frontend

- `tsc && vite build` green with the refactored content map, the role-aware screen, the widened entry + route.
- (Structural) `guideForRole('supervisor')` returns the supervisor guide; `'facilitator'`/`'admin'`/undefined return the facilitator guide; the Settings "Help" entry renders for admin/facilitator/supervisor and not crew; `/help` renders the role's guide; the supervisor guide shows the jobs-centric sections and no escalation content. No JS test runner — verification is type-check + build; visual confirmation manual.

### Backend

None — entirely static frontend.

## Out of scope

- **Escalation-push cleanup** (remove supervisor from escalation/T2 push roles) — separate queued task.
- **Crew guide** — a later `HELP_GUIDES.crew` entry reusing the same plumbing.
- **Admin-specific guide** — admin sees the facilitator guide for now.
- **In-app-editable content / markdown / search / per-screen manuals** — same exclusions as the facilitator guide.
