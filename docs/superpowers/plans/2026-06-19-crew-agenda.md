# Crew Agenda — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For crew, make the Jobs tab a single agenda — active job pinned, then upcoming jobs grouped Today / Tomorrow / This week / Later, with a small Upcoming/Completed toggle — and remove the Calendar tab from crew's nav. Office roles unchanged.

**Architecture:** Frontend-only. A pure `bucketJobsByDay` util groups the crew's jobs; a new `CrewAgenda` component renders the agenda and reuses the existing working modal (via an `onOpenJob` callback) and the existing data hooks. `JobsScreen` branches by role (`crew` → `CrewAgenda`, else the existing view). `BottomNav` drops `crew` from the Calendar item. No backend or endpoint changes.

**Tech Stack:** React 18 + TS + Tailwind + TanStack Query. (Frontend verification is `tsc && vite build` — the repo has no JS test runner; `bucketJobsByDay` is kept pure and simple.)

**Spec:** `docs/superpowers/specs/2026-06-19-crew-agenda-design.md`

---

## File Structure

**Create:**
- `app/frontend/src/utils/jobAgenda.ts` — `bucketJobsByDay`
- `app/frontend/src/components/CrewAgenda.tsx` — the crew agenda view

**Modify:**
- `app/frontend/src/screens/JobsScreen.tsx` — render `CrewAgenda` for crew
- `app/frontend/src/components/BottomNav.tsx` — drop `crew` from the Calendar nav item

---

## Task 1: `bucketJobsByDay` util

**Files:**
- Create: `app/frontend/src/utils/jobAgenda.ts`

- [ ] **Step 1: Write the util**

`app/frontend/src/utils/jobAgenda.ts`:

```ts
import type { Job } from '../hooks/useJobs'

export type AgendaBucketKey = 'today' | 'tomorrow' | 'this_week' | 'later' | 'unscheduled'

export interface AgendaBucket {
  key: AgendaBucketKey
  label: string
  jobs: Job[]
}

export interface Agenda {
  active: Job[]               // in-progress jobs (a phase has started), pinned at top
  buckets: AgendaBucket[]     // non-active jobs grouped by day, only non-empty buckets, in order
}

const BUCKET_LABELS: Record<AgendaBucketKey, string> = {
  today: 'Today',
  tomorrow: 'Tomorrow',
  this_week: 'This week',
  later: 'Later',
  unscheduled: 'Unscheduled',
}

// Parse a 'YYYY-MM-DD' string as a LOCAL date (midnight), avoiding UTC offset bugs.
function ymdToLocalDate(ymd: string): Date | null {
  const [y, m, d] = ymd.split('-').map(Number)
  if ([y, m, d].some(Number.isNaN)) return null
  return new Date(y, m - 1, d)
}

function dayDelta(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime()
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime()
  return Math.round((b - a) / 86_400_000)
}

// Timed jobs ascending by slot; all-day (no slot) jobs after timed ones.
function bySlot(a: Job, b: Job): number {
  const sa = a.appointment_time_slot
  const sb = b.appointment_time_slot
  if (sa && sb) return sa.localeCompare(sb)
  if (sa) return -1
  if (sb) return 1
  return 0
}

export function bucketJobsByDay(jobs: Job[], now: Date = new Date()): Agenda {
  const active = jobs.filter(j => j.job_phase != null).sort(bySlot)
  const rest = jobs.filter(j => j.job_phase == null)

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const daysToSaturday = 6 - today.getDay() // week is Sun..Sat (matches the Calendar)

  const map: Record<AgendaBucketKey, Job[]> = {
    today: [], tomorrow: [], this_week: [], later: [], unscheduled: [],
  }

  for (const job of rest) {
    const date = job.job_date_requested ? ymdToLocalDate(job.job_date_requested) : null
    if (!date) {
      map.unscheduled.push(job)
      continue
    }
    const delta = dayDelta(today, date)
    if (delta <= 0) map.today.push(job)            // today or overdue -> Today
    else if (delta === 1) map.tomorrow.push(job)
    else if (delta <= daysToSaturday) map.this_week.push(job)
    else map.later.push(job)
  }

  const order: AgendaBucketKey[] = ['today', 'tomorrow', 'this_week', 'later', 'unscheduled']
  const buckets = order
    .map(key => ({ key, label: BUCKET_LABELS[key], jobs: map[key].slice().sort(bySlot) }))
    .filter(b => b.jobs.length > 0)

  return { active, buckets }
}
```

- [ ] **Step 2: Type-check via build**

Run: `cd app/frontend ; npm run build`
Expected: build succeeds (the util isn't imported anywhere yet, but must type-check).

- [ ] **Step 3: Commit**

```bash
git add app/frontend/src/utils/jobAgenda.ts
git commit -m "feat(crew): bucketJobsByDay agenda helper (active + today/tomorrow/this-week/later)"
```

---

## Task 2: `CrewAgenda` component

**Files:**
- Create: `app/frontend/src/components/CrewAgenda.tsx`

- [ ] **Step 1: Write the component**

`app/frontend/src/components/CrewAgenda.tsx`:

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Job } from '../hooks/useJobs'
import { bucketJobsByDay } from '../utils/jobAgenda'
import { fmtTimeSlot } from '../utils/time'

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

function mapsHref(job: Job): string | null {
  const target = job.job_address || job.job_location
  return target ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(target)}` : null
}

function rowTime(job: Job): string {
  return job.appointment_time_slot ? fmtTimeSlot(job.appointment_time_slot) : 'All day'
}

function AgendaRow({ job, onOpen }: { job: Job; onOpen: (job: Job) => void }) {
  const href = mapsHref(job)
  const target = job.job_address || job.job_location
  return (
    <div className="flex items-start gap-3 rounded-xl border border-gray-100 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <button onClick={() => onOpen(job)} className="flex min-w-0 flex-1 items-start gap-3 text-left">
        <div className="w-14 shrink-0 text-right">
          <div className="text-sm font-bold text-gray-900 dark:text-white">{rowTime(job)}</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-gray-900 dark:text-white">
            {job.customer_name ?? <span className="font-normal italic text-gray-400">Unnamed</span>}
          </div>
          <div className="text-xs capitalize text-gray-500 dark:text-gray-400">{job.service_type}</div>
          {target && <div className="mt-1 truncate text-xs text-gray-400 dark:text-gray-500">{target}</div>}
        </div>
      </button>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            onClick={e => e.stopPropagation()}
            className="min-h-11 rounded-lg border border-blue-200 px-2.5 py-1 text-xs font-semibold text-blue-600 dark:border-blue-800 dark:text-blue-300"
          >
            Navigate
          </a>
        )}
      </div>
    </div>
  )
}

function ActiveCard({ job, onOpen }: { job: Job; onOpen: (job: Job) => void }) {
  const target = job.job_address || job.job_location
  const stateLabel =
    job.job_phase === 'started' ? 'Working'
    : job.job_phase === 'arrived' ? 'On site'
    : job.job_phase === 'en_route' ? 'En route'
    : 'Dispatched'
  return (
    <div className="rounded-2xl border-2 border-green-300 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/20">
      <div className="flex items-center justify-between gap-2">
        <div className="text-lg font-bold text-gray-900 dark:text-white">
          {job.customer_name ?? 'Unnamed'}
        </div>
        <span className="rounded-full bg-green-200 px-2 py-0.5 text-xs font-bold text-green-800 dark:bg-green-800 dark:text-green-100">
          {stateLabel}
        </span>
      </div>
      <div className="mt-0.5 text-sm capitalize text-gray-600 dark:text-gray-300">{job.service_type}</div>
      {target && <div className="mt-2 text-sm text-blue-700 dark:text-blue-300">{target}</div>}
      <button
        onClick={() => onOpen(job)}
        className="mt-3 min-h-11 w-full rounded-xl bg-green-600 py-3 text-center text-base font-bold text-white hover:bg-green-700"
      >
        Continue job →
      </button>
    </div>
  )
}

interface Props {
  jobs: Job[]
  completedJobs: Job[]
  isLoading: boolean
  onOpenJob: (job: Job) => void
}

export function CrewAgenda({ jobs, completedJobs, isLoading, onOpenJob }: Props) {
  const navigate = useNavigate()
  const [segment, setSegment] = useState<'upcoming' | 'completed'>('upcoming')
  const { active, buckets } = bucketJobsByDay(jobs)
  const empty = active.length === 0 && buckets.length === 0

  return (
    <div>
      <div className="flex gap-1.5 bg-gray-100 p-1 mx-4 mt-3 rounded-xl dark:bg-gray-700/50">
        {(['upcoming', 'completed'] as const).map(seg => (
          <button
            key={seg}
            onClick={() => setSegment(seg)}
            className={`min-h-11 flex-1 rounded-lg text-sm font-semibold capitalize transition-colors ${
              segment === seg
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-white'
                : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            {seg}
          </button>
        ))}
      </div>

      <main className="space-y-3 p-4 pb-10">
        {segment === 'upcoming' && (
          <>
            {isLoading && <p className="py-10 text-center text-sm text-gray-400 dark:text-gray-500">Loading...</p>}
            {!isLoading && empty && (
              <p className="py-10 text-center text-sm text-gray-400 dark:text-gray-500">No upcoming jobs scheduled.</p>
            )}
            {active.length > 0 && (
              <section className="space-y-2">
                <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-green-700 dark:text-green-400">▸ Active now</h2>
                {active.map(job => <ActiveCard key={job.id} job={job} onOpen={onOpenJob} />)}
              </section>
            )}
            {buckets.map(bucket => (
              <section key={bucket.key} className="space-y-2">
                <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">{bucket.label}</h2>
                {bucket.jobs.map(job => <AgendaRow key={job.id} job={job} onOpen={onOpenJob} />)}
              </section>
            ))}
          </>
        )}

        {segment === 'completed' && (
          <>
            <div className="px-1 py-1 text-sm text-gray-500 dark:text-gray-400">
              {completedJobs.length} completed · {fmtMoney(completedJobs.reduce((sum, j) => sum + (j.realized_revenue_cents ?? 0), 0) / 100)} realized
            </div>
            {completedJobs.length === 0 ? (
              <p className="py-10 text-center text-sm text-gray-400 dark:text-gray-500">No completed jobs yet.</p>
            ) : (
              completedJobs.map(job => (
                <button
                  key={job.id}
                  onClick={() => navigate(`/leads/${job.id}`)}
                  className="w-full rounded-xl border border-gray-100 bg-white p-4 text-left shadow-sm dark:border-gray-700 dark:bg-gray-800"
                >
                  <div className="font-semibold text-gray-900 dark:text-white">{job.customer_name ?? 'Unnamed'}</div>
                  <div className="text-xs capitalize text-gray-500 dark:text-gray-400">{job.service_type}</div>
                  {job.realized_revenue_cents != null && (
                    <div className="mt-1 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                      {fmtMoney(job.realized_revenue_cents / 100)} realized
                    </div>
                  )}
                </button>
              ))
            )}
          </>
        )}
      </main>
    </div>
  )
}
```

> **Implementer note:** confirm `fmtTimeSlot` is exported from `../utils/time` (it's used elsewhere in JobsScreen). If its signature differs, adapt `rowTime`. If `Job` lacks `realized_revenue_cents`/`completed_at`, they were added in the completed-jobs feature — they exist on `Job`.

- [ ] **Step 2: Build**

Run: `cd app/frontend ; npm run build`
Expected: build succeeds (component not yet wired in, but type-checks).

- [ ] **Step 3: Commit**

```bash
git add app/frontend/src/components/CrewAgenda.tsx
git commit -m "feat(crew): CrewAgenda component (active pinned + day buckets + completed)"
```

---

## Task 3: Wire into JobsScreen + trim crew nav

**Files:**
- Modify: `app/frontend/src/screens/JobsScreen.tsx`
- Modify: `app/frontend/src/components/BottomNav.tsx`

- [ ] **Step 1: Render `CrewAgenda` for crew in `JobsScreen.tsx`**

Add the import (with the other component imports):
```tsx
import { CrewAgenda } from '../components/CrewAgenda'
```

In the returned JSX of `JobsScreen`, the structure is: `<header>…</header>`, then a `lateJobs` banner, then the tab bar (`<div className="flex border-b …">`), then `<main>…</main>`, then `<JobModal …>`. Wrap the **lateJobs banner + tab bar + `<main>`** (everything between the header and `<JobModal>`) so it renders only for non-crew, and render `<CrewAgenda>` for crew. Concretely, replace from the `{lateJobs.length > 0 && (` banner through the closing `</main>` with:

```tsx
      {user?.role === 'crew' ? (
        <CrewAgenda
          jobs={jobs}
          completedJobs={completedJobs}
          isLoading={isLoading}
          onOpenJob={setSelectedJob}
        />
      ) : (
        <>
          {lateJobs.length > 0 && (
            <div className="flex items-center gap-2 bg-red-600 px-4 py-2.5 text-white">
              <p className="text-sm font-medium">
                {lateJobs.length === 1
                  ? `${lateJobs[0].customer_name ?? 'A job'} may need attention. Check In Progress.`
                  : `${lateJobs.length} jobs may need attention. Check In Progress.`}
              </p>
            </div>
          )}

          {/* ── existing tab bar (Scheduled / In Progress / Completed) ── */}
          {/* ...unchanged... */}

          {/* ── existing <main> ... </main> ── */}
          {/* ...unchanged... */}
        </>
      )}
```

Keep the existing tab-bar `<div>` and the existing `<main>…</main>` exactly as they are — just move them inside the `: (` non-crew branch. The shared `<JobModal …>` stays AFTER this block (unchanged) so the modal works for crew taps too.

After the edit, verify there are no now-unused vars for the non-crew path (there shouldn't be — `jobGroups`, `displayJobs`, `inProgressCount`, `lateJobs`, `liveSelectedJob` are all still used in the non-crew branch / the modal).

- [ ] **Step 2: Drop Calendar from crew nav in `BottomNav.tsx`**

In `NAV_ITEMS`, change the Calendar entry's roles to exclude `crew`:
```tsx
  { path: '/calendar', label: 'Calendar', roles: ['admin', 'facilitator', 'supervisor'], Icon: CalendarIcon, exact: false },
```
(Leave Jobs and Settings as-is — they already include `crew`.)

- [ ] **Step 3: Confirm crew land on Jobs**

Check the post-login redirect / default route (look in `App.tsx` / the router and `AuthContext`). Crew should land on `/jobs`. If the default redirect sends crew to `/` (the Queue, which is admin/facilitator-only) and that doesn't already fall through to `/jobs` for crew, add a redirect so crew land on `/jobs`. If crew already land on `/jobs`, no change — note it.

- [ ] **Step 4: Build**

Run: `cd app/frontend ; npm run build`
Expected: build succeeds, no TS errors.

- [ ] **Step 5: Commit**

```bash
git add app/frontend/src/screens/JobsScreen.tsx app/frontend/src/components/BottomNav.tsx
git commit -m "feat(crew): Jobs tab is the agenda for crew; drop Calendar from crew nav"
```

---

## Task 4: Docs + suite green

**Files:**
- Modify: `CAPABILITIES.md`

- [ ] **Step 1: Build the frontend + run the backend suite**

Run: `cd app/frontend ; npm run build` — expect success.
Run: `cd app/backend ; python -m pytest -q` — expect the existing total still passing (this feature is frontend-only; backend unchanged).

- [ ] **Step 2: Update `CAPABILITIES.md`**

Note: crew now see the Jobs tab as a single agenda — the active job pinned at top ("Active now"), upcoming jobs grouped Today / Tomorrow / This week / Later, with an Upcoming / Completed toggle; the Calendar tab is hidden for crew (office roles keep it). Office Jobs/Calendar unchanged. Frontend-only (`bucketJobsByDay` + `CrewAgenda`; reuses `GET /jobs`).

- [ ] **Step 3: Commit**

```bash
git add CAPABILITIES.md
git commit -m "docs(crew): capabilities — crew agenda"
```

---

## Self-Review Notes (addressed)

- **Spec coverage:** `bucketJobsByDay` (T1), `CrewAgenda` with active-pinned + buckets + Upcoming/Completed (T2), JobsScreen role-branch + BottomNav crew Calendar removal + crew-landing check (T3), docs (T4). Every spec section maps to a task.
- **Office path untouched:** the non-crew branch wraps the existing banner/tabs/main verbatim; the shared `JobModal` stays after the branch and serves both. `setSelectedJob` is reused by the agenda so the working modal opens for crew.
- **No backend change:** reuses `GET /jobs` (crew-scoped) + `GET /jobs?status=completed`; the backend suite is run only to confirm no regression.
- **Date safety:** `ymdToLocalDate` parses `YYYY-MM-DD` as a local date (no UTC drift), consistent with the existing `weekdayKeyFromDate` helper; overdue booked jobs fall into Today so they're not lost.
- **No JS test runner exists** (build-only repo convention): `bucketJobsByDay` is pure and simple; verification is `tsc && vite build`. Not adding a test framework (out of scope).
