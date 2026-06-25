# Supervisor Help Guide (Role-Aware /help) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the existing `/help` guide to be role-aware and add a supervisor (on-site-lead) guide — jobs-centric content (phases, crew, photos/notes, calendar, glossary). One screen renders the viewer's guide; admin/facilitator keep the facilitator guide.

**Architecture:** Refactor `helpContent.ts` from a single `HELP_SECTIONS` array into role-keyed `HELP_GUIDES` + `guideForRole`. The `HelpSection` union and `AccordionSection` are unchanged. The screen, Settings entry, and route become role-aware / widen to include supervisor. Entirely static frontend.

**Tech Stack:** React 18 + TS + Vite + Tailwind + react-router. Verification: `tsc && vite build`. No backend, no tests beyond build.

**Reference spec:** `docs/superpowers/specs/2026-06-25-supervisor-help-guide-design.md`

---

## File Structure

- Modify: `app/frontend/src/content/helpContent.ts` — `HelpGuide` + supervisor sections + `HELP_GUIDES` + `guideForRole` (keep `HELP_SECTIONS` as the facilitator sections).
- Modify: `app/frontend/src/screens/HelpGuideScreen.tsx` — role-aware (pick guide by `useAuth().user.role`).
- Modify: `app/frontend/src/screens/SettingsScreen.tsx` — widen the Help entry gate to include supervisor; role-adaptive label.
- Modify: `app/frontend/src/App.tsx` — widen the `/help` route to include supervisor.

`app/frontend/src/components/AccordionSection.tsx` is **unchanged**.

---

## Task 1: Role-aware guide + supervisor content

**Files:** all of the above.

- [ ] **Step 1: Refactor `helpContent.ts` (keep facilitator content, add the map + supervisor guide)**

Leave the existing `export type HelpSection` and `export const HELP_SECTIONS: HelpSection[] = [ … ]` (the facilitator sections) exactly as they are. **Append** to the file:

```ts
const SUPERVISOR_SECTIONS: HelpSection[] = [
  {
    id: 'phases',
    icon: '🚚',
    title: 'Track the job through its phases',
    subtitle: 'Keep the office in sync',
    kind: 'steps',
    steps: [
      { title: 'Dispatched', detail: 'The job’s assigned and set to go. Tap it when you’re about to head out.' },
      { title: 'En route', detail: 'You and the crew are driving to the customer. Tap it when you leave.' },
      { title: 'Arrived', detail: 'You’re on site getting set up. Tap it when you pull in.' },
      { title: 'Started', detail: 'The move is underway. Tap it when you begin loading.' },
      { title: 'Completed', detail: 'The job’s done. Tap it to wrap up — it moves to the Completed tab.' },
    ],
  },
  {
    id: 'crew',
    icon: '👷',
    title: 'Your crew',
    subtitle: 'Who’s on the job',
    kind: 'text',
    paragraphs: [
      'Each job shows who’s assigned. As the on-site lead you can add or swap crew if something changes. Crew marked unavailable that day are flagged so you don’t assign them by mistake.',
    ],
  },
  {
    id: 'photos',
    icon: '📸',
    title: 'Photos & notes',
    subtitle: 'Keep a record',
    kind: 'text',
    paragraphs: [
      'Log before and after photos on the job, and add notes for anything worth recording — existing damage, tricky access, special customer requests. It keeps a record of the move and protects everyone if a question comes up later.',
    ],
  },
  {
    id: 'calendar',
    icon: '🗓️',
    title: 'The calendar',
    subtitle: 'What’s coming',
    kind: 'text',
    paragraphs: [
      'The Calendar tab shows your upcoming jobs by week or month — handy for seeing what’s ahead and planning your days.',
    ],
  },
  {
    id: 'terms',
    icon: '📖',
    title: 'Key terms',
    subtitle: 'The job phases',
    kind: 'terms',
    terms: [
      { word: 'Dispatched', def: 'The job is assigned and set to go; you haven’t left yet.' },
      { word: 'En route', def: 'You and the crew are driving to the customer.' },
      { word: 'Arrived', def: 'You’re on site, before the work starts.' },
      { word: 'Started', def: 'The move is actively underway.' },
      { word: 'Completed', def: 'The job’s finished and moved to the Completed tab.' },
    ],
  },
]

export interface HelpGuide {
  title: string
  tagline: string   // short subtitle for the Settings entry
  intro: string     // one-line intro under the screen header
  sections: HelpSection[]
}

export const HELP_GUIDES: Record<'facilitator' | 'supervisor', HelpGuide> = {
  facilitator: {
    title: 'Facilitator guide',
    tagline: 'How leads flow + key terms',
    intro: 'Your day-to-day with leads, start to finish — plus what the less-obvious words mean. Tap a section to open it.',
    sections: HELP_SECTIONS,
  },
  supervisor: {
    title: 'Supervisor guide',
    tagline: 'How jobs work + key terms',
    intro: 'You’re the lead on site — you run the move and the crew. Here’s how a job works and what the words mean. Tap a section to open it.',
    sections: SUPERVISOR_SECTIONS,
  },
}

export function guideForRole(role: string | undefined): HelpGuide {
  return role === 'supervisor' ? HELP_GUIDES.supervisor : HELP_GUIDES.facilitator
}
```

- [ ] **Step 2: Make `HelpGuideScreen` role-aware**

Replace `app/frontend/src/screens/HelpGuideScreen.tsx` with:

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BottomNav } from '../components/BottomNav'
import { AccordionSection } from '../components/AccordionSection'
import { guideForRole } from '../content/helpContent'
import { useAuth } from '../context/AuthContext'

export function HelpGuideScreen() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const guide = guideForRole(user?.role)
  const [open, setOpen] = useState<Set<string>>(new Set(guide.sections.length ? [guide.sections[0].id] : []))

  const toggle = (id: string) =>
    setOpen(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  return (
    <div className="min-h-screen bg-gray-50 pb-20 dark:bg-gray-900">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
        <button type="button" onClick={() => navigate('/settings')} aria-label="Back" className="text-gray-400">‹</button>
        <h1 className="text-lg font-bold text-gray-900 dark:text-white">{guide.title}</h1>
      </header>

      <div className="space-y-2.5 p-4">
        <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">{guide.intro}</p>

        {guide.sections.map(section => (
          <AccordionSection key={section.id} section={section} isOpen={open.has(section.id)} onToggle={() => toggle(section.id)} />
        ))}

        <div className="flex items-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-3 text-xs text-gray-500 dark:border-gray-600 dark:text-gray-400">
          🛟 Something off or missing in this guide? Tell Ron.
        </div>
      </div>
      <BottomNav />
    </div>
  )
}
```

(Confirm `useAuth` is exported from `../context/AuthContext` — it is, used across screens; `user?.role` is the role string.)

- [ ] **Step 3: Widen + adapt the Settings "Help" entry**

In `app/frontend/src/screens/SettingsScreen.tsx`, the Help entry is currently gated by `canViewOpsSettings` (admin/facilitator) with a hardcoded "Facilitator guide" label. Change it to include supervisor and use the role's guide for the label:

(a) Add `import { guideForRole } from '../content/helpContent'` near the other imports.
(b) Replace the Help `<section>` block (the one with `<h2>…Help…</h2>` and the "Facilitator guide" button) with a role-aware version. Use a role check that includes supervisor:

```tsx
{(user?.role === 'admin' || user?.role === 'facilitator' || user?.role === 'supervisor') && (
  <section className="space-y-3 rounded-xl border bg-white p-4 dark:bg-gray-800 dark:border-gray-700">
    <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Help</h2>
    <button
      type="button"
      onClick={() => navigate('/help')}
      className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-gray-200 px-3 text-left dark:border-gray-700"
    >
      <span className="text-lg">📘</span>
      <span className="flex-1">
        <span className="block text-sm font-medium text-gray-900 dark:text-white">{guideForRole(user?.role).title}</span>
        <span className="block text-xs text-gray-500 dark:text-gray-400">{guideForRole(user?.role).tagline}</span>
      </span>
      <span className="text-gray-400">›</span>
    </button>
  </section>
)}
```

(Do not alter other sections. `user` is already in scope from `useAuth()`.)

- [ ] **Step 4: Widen the `/help` route**

In `app/frontend/src/App.tsx`, change the `/help` route's guard from `roles={['admin', 'facilitator']}` to:

```tsx
      <Route path="/help" element={<AuthGuard><RoleGuard roles={['admin', 'facilitator', 'supervisor']}><HelpGuideScreen /></RoleGuard></AuthGuard>} />
```

- [ ] **Step 5: Type-check + build**

Run: `cd app/frontend && npx tsc --noEmit` → no errors.
Run: `cd app/frontend && npm run build` → succeeds (pre-existing >500 kB chunk warning is not an error).

- [ ] **Step 6: Commit**

```bash
git add app/frontend/src/content/helpContent.ts app/frontend/src/screens/HelpGuideScreen.tsx app/frontend/src/screens/SettingsScreen.tsx app/frontend/src/App.tsx
git commit -m "feat(help): role-aware /help guide + supervisor (on-site-lead) guide"
```

---

## Self-Review

**Spec coverage:**
- Role-aware single `/help` (content by role) → `HELP_GUIDES` + `guideForRole`; screen reads `user.role` (Steps 1-2).
- Supervisor jobs-centric content (phases, crew, photos/notes, calendar, glossary; no escalations) → `SUPERVISOR_SECTIONS` (Step 1).
- Admin → facilitator guide → `guideForRole` returns facilitator for any non-supervisor role.
- Access widened to admin+facilitator+supervisor; role-adaptive label → Steps 3-4.
- Reuse `AccordionSection` + screen shell → untouched.
- Out of scope (escalation-push cleanup, crew guide, admin-specific guide, markdown/CMS) → not present.

**Placeholder scan:** All supervisor copy is final; the facilitator content is reused as-is (not re-pasted). No TODO/TBD. The "confirm useAuth export" note is a verify-only check with the established import.

**Type/name consistency:** `HelpSection` unchanged; `HelpGuide` adds `title`/`tagline`/`intro`/`sections`. `HELP_GUIDES` is keyed `'facilitator' | 'supervisor'`; `guideForRole` returns the supervisor guide only for `'supervisor'`, else facilitator (covers `admin`, `facilitator`, undefined). The route's `roles={['admin','facilitator','supervisor']}` matches the Settings entry gate. `HELP_SECTIONS` is still exported (now also referenced by `HELP_GUIDES.facilitator.sections`).

**Note for implementer:** entirely static; the only role input is `user.role` from `useAuth`. The facilitator guide is preserved by reference (`sections: HELP_SECTIONS`) — do not duplicate that content. Verification is `tsc` + `vite build`.
