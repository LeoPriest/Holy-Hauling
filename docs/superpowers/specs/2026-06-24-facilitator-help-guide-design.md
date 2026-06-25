# Facilitator Help Guide (Passive Reference) — Design Spec

**Date:** 2026-06-24
**Status:** Approved direction, pre-implementation
**Author:** Ron + Claude

## Problem

The app has grown feature-rich with non-obvious behavior (grounded vs SOP-only quoting, refund-eligible candidates, Thumbtack proxy phones, cold-start, escalations, the 72h window). A new or occasional **facilitator** can't infer those from the UI alone. Ron needs a way to onboard a new facilitator and give the current one something to consult — without it becoming a stale manual.

A facilitator's first need isn't "what does this button do," it's **"what's my job, and in what order."** So the guide is **workflow-first**, with a glossary for the terms that trip people up — a **passive reference** they open when they want, not a forced walkthrough.

## Goals

1. Orient a new facilitator on the **lead lifecycle** (intake → review → quote → book), end to end.
2. Explain the **stable concepts** they'll trip on (grounded, cold-start, Thumbtack line, refund-eligible, escalation) in plain language.
3. Be **low-rot**: workflow + concepts, authored in one editable place, with **no button-by-button manual** (the rot magnet).
4. Reachable in one tap, scoped to the people who quote.

Out of scope: crew/admin content (this is facilitator-only), a guided first-run walkthrough (passive reference only), search, screen-by-screen manuals, any backend/data — the guide is entirely static.

## Decisions locked during brainstorming

- **Passive reference**, not a guided tour.
- **Workflow-first + glossary**, facilitator-scoped; no exhaustive per-screen how-tos.
- **Structured content data, not a markdown library** — the app has 4 lean deps; a typed content file renders zero-dependency and stays just as editable. (Avoids `react-markdown` + bundle for one guide.)
- **Accordion (collapsible) sections** — touch-first, scan-then-expand.
- **Lives as a Help entry in Settings** → a `/help` screen, guarded **admin + facilitator** (crew/supervisor don't see the entry).

## Architecture

### Content model (single editable source)

`app/frontend/src/content/helpContent.ts` — a typed array of sections. Each section is a discriminated union by `kind` so the renderer is simple and the content is fully typed:

```ts
type HelpSection =
  | { id: string; icon: string; title: string; subtitle?: string; kind: 'steps'; steps: { title: string; detail: string }[] }
  | { id: string; icon: string; title: string; subtitle?: string; kind: 'terms'; terms: { word: string; def: string }[] }
  | { id: string; icon: string; title: string; subtitle?: string; kind: 'text';  paragraphs: string[] }
```

This is the **one place to edit** when the app changes — no copy buried in components. Plain TS, no new dependency.

### Sections (content)

1. **How a lead flows** (`kind: 'steps'`) — the lifecycle as numbered steps: a lead comes in → get the number (reply on Thumbtack to reveal it) → draft the quote with "✨ Suggest with AI" and read "What this quote is based on" → lock & book (it moves to Jobs). *The 80% for a new hire.*
2. **Reading an AI quote** (`kind: 'text'`) — grounded vs SOP-only, what the comparables/basis mean, the internal AI pricing guidance, and that the rationale is the model's reasoning to *review*, not gospel.
3. **Thumbtack specifics** (`kind: 'text'`) — the proxy "Thumbtack line" (reaches the customer, not their real number, may expire), capturing the real number, entering the lead cost from the bottom of the lead, and refund-eligible candidates.
4. **Key terms** (`kind: 'terms'`) — glossary: grounded, cold start, Thumbtack line, refund-eligible, escalation, follow-up (the stable, won't-rot definitions).

A closing **"Something off or missing? Tell Ron"** support line (static; a `mailto:` or just text — see error/empty states).

### Screen + rendering

- `app/frontend/src/screens/HelpGuideScreen.tsx` — a sticky header ("Help & guide") + a short intro line + the accordion + the support line + `BottomNav`. Renders `helpContent` by mapping sections to an `AccordionSection`.
- `app/frontend/src/components/AccordionSection.tsx` (or inline in the screen) — a collapsible section: a ≥44px header (icon, title, subtitle, chevron) toggling an open/closed body; the body switches on `kind` to render numbered **steps**, a **terms** glossary, or **text** paragraphs. First section may default open.
- Local `useState` for which sections are open (independent toggles; no persistence needed).

### Entry point + route

- `app/frontend/src/screens/SettingsScreen.tsx` — a **"Help"** section with one row ("Facilitator guide — How leads flow + key terms") that navigates to `/help`. Shown only when `user?.role` is `admin` or `facilitator` (the screen already reads `useAuth()`).
- `app/frontend/src/App.tsx` — `/help` route wrapped in `AuthGuard` + `RoleGuard roles={['admin', 'facilitator']}` (consistent with the entry's visibility; crew/supervisor are blocked even by direct URL).

## Data flow

```
Settings (admin/facilitator) -> "Facilitator guide" row -> navigate('/help')
  HelpGuideScreen -> render helpContent[] -> AccordionSection per section
    tap a header -> toggle open -> body renders steps | terms | text
  (entirely static — no fetch, no backend)
```

## Error / empty states

- No data fetch, so no loading/error states. The content is a static import — if a section array is empty it simply renders nothing (defensive, but the file always ships populated).
- The **"Tell Ron"** support affordance is static text (optionally a `mailto:` to Ron's address); it is not a ticketing system — just a pointer so a stuck facilitator knows where to go.
- Crew/supervisor reaching `/help` directly → blocked by `RoleGuard` (redirected like other guarded routes).

## Testing

### Frontend

- `tsc && vite build` green with the content file, `AccordionSection`, `HelpGuideScreen`, the Settings entry, and the route.
- (Structural) the Settings "Help" row renders for admin/facilitator and is absent for crew/supervisor; `/help` renders the accordion; each `kind` (`steps`/`terms`/`text`) renders its body shape; expand/collapse toggles independently; ≥44px headers. No JS test runner — verification is type-check + build; visual confirmation manual.

### Backend

None — the feature is entirely static frontend content; no endpoint, no model, no pytest.

## Out of scope

- **Crew / admin guides** — facilitator-only now; a crew guide could be a later, separate section reusing `AccordionSection`.
- **Guided first-run walkthrough / product tour** — passive reference only.
- **Search, deep-linking to a section, "what's new"/changelog** — possible later; not now.
- **Editable-in-app content (CMS)** — content is a code file edited via PR, not a runtime-editable admin surface.
- **A markdown rendering pipeline** — deliberately avoided; structured data instead.
- **Per-screen "how-to" manuals** — the rot magnet; excluded by design.
