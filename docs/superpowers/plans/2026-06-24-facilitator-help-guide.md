# Facilitator Help Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A passive, facilitator-scoped help guide — lifecycle walkthrough + glossary — as collapsible accordion sections, reached from a "Help" entry in Settings, authored in one typed content file (no markdown dependency, no backend).

**Architecture:** Entirely static frontend. A `helpContent.ts` data file (sections discriminated by `kind`), an `AccordionSection` component, a `HelpGuideScreen`, a `/help` route (admin+facilitator), and a Settings entry. No fetch, no state beyond which sections are open.

**Tech Stack:** React 18 + TS + Vite + Tailwind + react-router. Verification: `tsc && vite build`. No backend, no pytest.

**Reference spec:** `docs/superpowers/specs/2026-06-24-facilitator-help-guide-design.md`

---

## File Structure

- Create: `app/frontend/src/content/helpContent.ts` — the typed guide content.
- Create: `app/frontend/src/components/AccordionSection.tsx` — collapsible section renderer.
- Create: `app/frontend/src/screens/HelpGuideScreen.tsx` — the screen.
- Modify: `app/frontend/src/App.tsx` — `/help` route (admin+facilitator).
- Modify: `app/frontend/src/screens/SettingsScreen.tsx` — "Help" section/entry.

---

## Task 1: Build the help guide (content, accordion, screen, route, entry)

**Files:** all of the above.

- [ ] **Step 1: Content file**

Create `app/frontend/src/content/helpContent.ts`:

```ts
export type HelpSection =
  | { id: string; icon: string; title: string; subtitle?: string; kind: 'steps'; steps: { title: string; detail: string }[] }
  | { id: string; icon: string; title: string; subtitle?: string; kind: 'terms'; terms: { word: string; def: string }[] }
  | { id: string; icon: string; title: string; subtitle?: string; kind: 'text'; paragraphs: string[] }

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'flow',
    icon: '🧭',
    title: 'How a lead flows',
    subtitle: 'What you do, in order',
    kind: 'steps',
    steps: [
      { title: 'A lead comes in', detail: 'From Thumbtack it lands in your queue. Open it and skim the customer’s request, address, and move details.' },
      { title: 'Get the customer’s number', detail: 'Thumbtack hides the number until you reply — the lead shows a prompt. Reply on Thumbtack, then add the number that appears to the lead.' },
      { title: 'Draft the quote', detail: 'Tap “✨ Suggest with AI”. Review “What this quote is based on” (the comparable past jobs it used) and the AI pricing guidance, then adjust the price and line items.' },
      { title: 'Lock & book', detail: 'When the customer’s ready, lock the quote and book the job. It moves to the Jobs tab for the crew.' },
    ],
  },
  {
    id: 'reading-quote',
    icon: '💬',
    title: 'Reading an AI quote',
    subtitle: 'Grounded vs SOP-only, the basis',
    kind: 'text',
    paragraphs: [
      'Every AI draft is either “grounded” — anchored on similar past local jobs — or “SOP-only” when no comparables exist yet. The “What this quote is based on” section shows which, and lists the comparable jobs it leaned on (their price and whether they were won or lost).',
      'The AI rationale explains its reasoning, but treat it as a starting point to review — not a fixed formula. You always have the final say on the number.',
      'The orange “AI Pricing Guidance” cards are internal pricing notes (band, position, guidance) that also feed the draft.',
    ],
  },
  {
    id: 'thumbtack',
    icon: '📞',
    title: 'Thumbtack specifics',
    subtitle: 'Proxy phone · lead cost · refunds',
    kind: 'text',
    paragraphs: [
      'Phone numbers: Thumbtack gives you a “Thumbtack line” — a proxy number that reaches the customer but isn’t their real number and can stop working after the job. When the customer shares their real number, add it in the “Real #” field so you don’t lose them.',
      'Lead cost: the fee Thumbtack charged for the lead is at the bottom of the lead (Direct lead / Bonus / Total). Snap that part as a photo and the AI fills it in, or type it. It feeds your profit and ROI.',
      'Refunds: if a customer never responds within 72 hours, the lead shows up as “refund-eligible”. It’s a candidate to review — mark “Customer responded” if they did, or “Mark refunded” if Thumbtack refunded it (that zeroes the lead’s cost).',
    ],
  },
  {
    id: 'terms',
    icon: '📖',
    title: 'Key terms',
    subtitle: 'The words that trip people up',
    kind: 'terms',
    terms: [
      { word: 'Grounded', def: 'The AI quote anchored on similar past jobs — a stronger pricing signal.' },
      { word: 'SOP-only / Cold start', def: 'No comparable jobs were available yet, so the quote leaned on the standard pricing (SOP). Normal early on.' },
      { word: 'Thumbtack line', def: 'A proxy number that reaches the customer through Thumbtack — not their real number, and it can stop working after the job.' },
      { word: 'Refund-eligible', def: 'A Thumbtack lead the customer never responded to within 72 hours. A candidate to mark refunded — the app never assumes it for you.' },
      { word: 'Escalation', def: 'A lead flagged as needing attention (aging, or manually raised). Resolve it or hand it off; it doesn’t change the lead’s pipeline stage.' },
      { word: 'Follow-up', def: 'A scheduled reminder to circle back on a lead.' },
    ],
  },
]
```

- [ ] **Step 2: `AccordionSection` component**

Create `app/frontend/src/components/AccordionSection.tsx`:

```tsx
import type { HelpSection } from '../content/helpContent'

export function AccordionSection({ section, isOpen, onToggle }: {
  section: HelpSection
  isOpen: boolean
  onToggle: () => void
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-sm dark:bg-gray-700">{section.icon}</span>
        <span className="flex-1">
          <span className="block text-sm font-bold text-gray-900 dark:text-white">{section.title}</span>
          {section.subtitle && <span className="block text-[11px] text-gray-500 dark:text-gray-400">{section.subtitle}</span>}
        </span>
        <span className={`text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} aria-hidden="true">›</span>
      </button>

      {isOpen && (
        <div className="border-t border-gray-100 px-4 py-3 dark:border-gray-700">
          {section.kind === 'steps' && (
            <ol className="space-y-3">
              {section.steps.map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[11px] font-bold text-emerald-600 dark:bg-gray-700 dark:text-emerald-400">{i + 1}</span>
                  <span className="text-[13px] leading-relaxed text-gray-700 dark:text-gray-200">
                    <b className="text-gray-900 dark:text-white">{s.title}.</b> <span className="text-gray-500 dark:text-gray-400">{s.detail}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
          {section.kind === 'terms' && (
            <dl className="space-y-3">
              {section.terms.map((t, i) => (
                <div key={i}>
                  <dt className="text-[13px] font-bold text-gray-900 dark:text-white">{t.word}</dt>
                  <dd className="mt-0.5 text-[12.5px] leading-relaxed text-gray-500 dark:text-gray-400">{t.def}</dd>
                </div>
              ))}
            </dl>
          )}
          {section.kind === 'text' && (
            <div className="space-y-2.5">
              {section.paragraphs.map((p, i) => (
                <p key={i} className="text-[13px] leading-relaxed text-gray-600 dark:text-gray-300">{p}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: `HelpGuideScreen`**

Create `app/frontend/src/screens/HelpGuideScreen.tsx`:

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BottomNav } from '../components/BottomNav'
import { AccordionSection } from '../components/AccordionSection'
import { HELP_SECTIONS } from '../content/helpContent'

export function HelpGuideScreen() {
  const navigate = useNavigate()
  const [open, setOpen] = useState<Set<string>>(new Set(HELP_SECTIONS.length ? [HELP_SECTIONS[0].id] : []))

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
        <h1 className="text-lg font-bold text-gray-900 dark:text-white">Help &amp; guide</h1>
      </header>

      <div className="space-y-2.5 p-4">
        <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          Your day-to-day with leads, start to finish — plus what the less-obvious words mean. Tap a section to open it.
        </p>

        {HELP_SECTIONS.map(section => (
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

- [ ] **Step 4: Route**

In `app/frontend/src/App.tsx`, add `import { HelpGuideScreen } from './screens/HelpGuideScreen'` and a route right after the `/settings` route:

```tsx
      <Route path="/help" element={<AuthGuard><RoleGuard roles={['admin', 'facilitator']}><HelpGuideScreen /></RoleGuard></AuthGuard>} />
```

- [ ] **Step 5: Settings entry**

In `app/frontend/src/screens/SettingsScreen.tsx`, add a "Help" section gated to admin/facilitator. The screen already has `navigate` (from `useNavigate()`) and `canViewOpsSettings = user?.role === 'admin' || user?.role === 'facilitator'`. Add this section among the other `<section>` blocks (a sensible spot is near the bottom, e.g., before the Browser Push section or after the ops sections), matching the sibling section chrome:

```tsx
{canViewOpsSettings && (
  <section className="space-y-3 rounded-xl border bg-white p-4 dark:bg-gray-800 dark:border-gray-700">
    <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Help</h2>
    <button
      type="button"
      onClick={() => navigate('/help')}
      className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-gray-200 px-3 text-left dark:border-gray-700"
    >
      <span className="text-lg">📘</span>
      <span className="flex-1">
        <span className="block text-sm font-medium text-gray-900 dark:text-white">Facilitator guide</span>
        <span className="block text-xs text-gray-500 dark:text-gray-400">How leads flow + key terms</span>
      </span>
      <span className="text-gray-400">›</span>
    </button>
  </section>
)}
```

Confirm `canViewOpsSettings` is in scope (it is, defined ~line 112); if the variable name differs, use `(user?.role === 'admin' || user?.role === 'facilitator')`. Do not alter other sections.

- [ ] **Step 6: Type-check + build**

Run: `cd app/frontend && npx tsc --noEmit` → no errors.
Run: `cd app/frontend && npm run build` → succeeds (pre-existing >500 kB chunk warning is not an error).

- [ ] **Step 7: Commit**

```bash
git add app/frontend/src/content/helpContent.ts app/frontend/src/components/AccordionSection.tsx app/frontend/src/screens/HelpGuideScreen.tsx app/frontend/src/App.tsx app/frontend/src/screens/SettingsScreen.tsx
git commit -m "feat(help): facilitator help guide — lifecycle + glossary accordion, Settings entry"
```

---

## Self-Review

**Spec coverage:**
- Workflow-first facilitator content (lifecycle steps + concepts + glossary) → `helpContent.ts` (Step 1).
- Structured content data, no markdown dep → typed `HelpSection` union; renderer switches on `kind`.
- Accordion (collapsible, touch-first ≥44px headers) → `AccordionSection` + `HelpGuideScreen` open-state.
- Settings "Help" entry + `/help` route, admin+facilitator → Steps 4-5.
- Static, no backend/fetch → no service/hook/endpoint anywhere.
- Out of scope (crew/admin content, guided tour, search, CMS, markdown pipeline, per-screen manual) → not present.

**Placeholder scan:** All content copy is final (real facilitator wording), all components complete. The only "confirm in scope" note is the `canViewOpsSettings` variable name in SettingsScreen, with a fallback inline expression given. No TODO/TBD.

**Type/name consistency:** `HelpSection` (discriminated by `kind: 'steps'|'terms'|'text'`) is consumed by `AccordionSection` with exhaustive branches; `HELP_SECTIONS` imported by the screen. The `/help` route's `roles={['admin','facilitator']}` matches the Settings entry's `canViewOpsSettings` gate. No backend types involved.

**Note for implementer:** entirely static — there is no data fetch, no loading/error state, and no test runner; verification is `tsc` + `vite build`. The guide content lives only in `helpContent.ts` (the single edit point when the app changes).
