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
