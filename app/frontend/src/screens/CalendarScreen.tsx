import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { BottomNav } from '../components/BottomNav'
import { CitySwitcher } from '../components/CitySwitcher'
import { Segmented } from '../components/Segmented'
import { useCity } from '../context/CityContext'
import { useJobs, useSyncJobCalendar, type Job } from '../hooks/useJobs'
import { apiFetch } from '../services/api'
import { fmtDurationMinutes, fmtTimeSlot } from '../utils/time'
import { useRecurringExpenses } from '../hooks/useRecurringExpenses'
import { centsToDisplay } from '../types/recurringExpense'
import type { RecurringExpense } from '../types/recurringExpense'
import { Working } from '../components/Logo'

type ViewMode = 'week' | 'month'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const BACK = 'M15 6l-6 6 6 6'
const CHEV = 'M9 6l6 6-6 6'
const WARN = 'M12 3.5 21.5 20h-19L12 3.5zM12 10v4.5M12 17.5v.01'

type CalendarStatus = {
  configured: boolean
  connected: boolean
  missing: string[]
  detail: string | null
}

function Icon({ d }: { d: string }) {
  return <svg className="wd-ic" viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>
}

function Chevron() {
  return <span className="wd-chv" aria-hidden="true"><Icon d={CHEV} /></span>
}

// Collapsed accordion content stays in the DOM for the grid-rows animation,
// so it is made inert to keep it out of the tab order.
function Accordion({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div className={`wd-acc${open ? ' open' : ''}`}>
      <div {...(open ? {} : { inert: '' })}>{children}</div>
    </div>
  )
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function addMonths(date: Date, delta: number) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1)
}

function startOfWeek(date: Date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  d.setDate(d.getDate() - d.getDay())
  return d
}

function addDays(date: Date, delta: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + delta)
  return d
}

function buildWeekDays(weekStart: Date) {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
}

function weekRangeLabel(weekStart: Date) {
  const end = addDays(weekStart, 6)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  const startStr = weekStart.toLocaleDateString([], opts)
  const endStr =
    end.getMonth() === weekStart.getMonth()
      ? `${end.getDate()}`
      : end.toLocaleDateString([], opts)
  return `${startStr} – ${endStr}`
}

function dateKey(date: Date) {
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function buildMonthGrid(month: Date) {
  const first = startOfMonth(month)
  const gridStart = new Date(first)
  gridStart.setDate(first.getDate() - first.getDay())
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(gridStart)
    day.setDate(gridStart.getDate() + index)
    return day
  })
}

function sameMonth(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth()
}

function monthLabel(date: Date) {
  return date.toLocaleDateString([], { month: 'long', year: 'numeric' })
}

function weekdayShort(key: string) {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString([], { weekday: 'short' })
}

function dayNumber(key: string) {
  return Number(key.split('-')[2])
}

function selectedLabel(key: string) {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

function phaseLabel(job: Job) {
  if (!job.job_phase) return 'Scheduled'
  const text = job.job_phase.replace('_', ' ')
  return text[0].toUpperCase() + text.slice(1)
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function compareJobsBySchedule(left: Job, right: Job) {
  const leftSlot = left.appointment_time_slot ?? '99:99'
  const rightSlot = right.appointment_time_slot ?? '99:99'
  if (leftSlot !== rightSlot) return leftSlot.localeCompare(rightSlot)
  return (left.customer_name ?? '').localeCompare(right.customer_name ?? '')
}

export function CalendarScreen() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const today = new Date()
  const todayKey = dateKey(today)
  const [viewMode, setViewMode] = useState<ViewMode>('week')
  const [monthCursor, setMonthCursor] = useState(startOfMonth(today))
  const [weekCursor, setWeekCursor] = useState(startOfWeek(today))
  const [selectedDay, setSelectedDay] = useState(todayKey)
  const [expandedDay, setExpandedDay] = useState(todayKey)
  const [showUnscheduled, setShowUnscheduled] = useState(false)
  const [syncErrorByJob, setSyncErrorByJob] = useState<Record<string, string>>({})
  const [justSynced, setJustSynced] = useState<string | null>(null)
  const { requiredCityId, isAllCities } = useCity()

  const { data: jobs = [], isLoading } = useJobs()
  const syncJobCalendar = useSyncJobCalendar()
  const { data: calendarStatus } = useQuery<CalendarStatus>({
    queryKey: ['google-calendar-status', requiredCityId],
    queryFn: async () => {
      const r = await apiFetch(`/admin/google/status?city_id=${encodeURIComponent(requiredCityId)}`)
      if (!r.ok) return { configured: false, connected: false, missing: [], detail: null }
      return r.json()
    },
    enabled: user?.role === 'admin' && Boolean(requiredCityId),
  })

  const { data: recurringExpenses = [] } = useRecurringExpenses()

  const recurringByDay = user?.role === 'admin'
    ? recurringExpenses.reduce<Record<string, RecurringExpense[]>>((acc, exp) => {
        if (!exp.next_due_date) return acc
        acc[exp.next_due_date] = [...(acc[exp.next_due_date] ?? []), exp]
        return acc
      }, {})
    : {}

  const jobsByDay = jobs.reduce<Record<string, Job[]>>((acc, job) => {
    if (!job.job_date_requested) return acc
    acc[job.job_date_requested] = [...(acc[job.job_date_requested] ?? []), job]
    return acc
  }, {})

  const monthDays = buildMonthGrid(monthCursor)
  const weekDays = buildWeekDays(weekCursor)
  const unscheduledJobs = jobs.filter(job => !job.job_date_requested)
  const showQuote = user?.role === 'admin' || user?.role === 'facilitator'

  function dayJobs(key: string) {
    return [...(jobsByDay[key] ?? [])].sort(compareJobsBySchedule)
  }

  function dayTotal(key: string) {
    return (jobsByDay[key] ?? []).reduce((sum, job) => sum + (job.quoted_price_total ?? 0), 0)
  }

  useEffect(() => {
    const requestedDate = searchParams.get('date')
    if (!requestedDate || !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) return
    const [year, month, day] = requestedDate.split('-').map(Number)
    const nextDate = new Date(year, month - 1, day, 12)
    if (Number.isNaN(nextDate.getTime())) return
    setMonthCursor(startOfMonth(nextDate))
    setWeekCursor(startOfWeek(nextDate))
    setSelectedDay(requestedDate)
    setExpandedDay(requestedDate)
  }, [searchParams])

  function changeMonth(delta: number) {
    const nextMonth = addMonths(monthCursor, delta)
    setMonthCursor(nextMonth)
    setSelectedDay(dateKey(nextMonth))
  }

  function changeWeek(delta: number) {
    setWeekCursor(prev => startOfWeek(addDays(prev, delta * 7)))
  }

  function jumpToToday() {
    setMonthCursor(startOfMonth(today))
    setWeekCursor(startOfWeek(today))
    setSelectedDay(todayKey)
    setExpandedDay(todayKey)
  }

  function openJob(job: Job) {
    if (showQuote) {
      navigate(`/leads/${job.id}`)
      return
    }
    navigate('/jobs')
  }

  function handleSyncJob(jobId: string) {
    setSyncErrorByJob(prev => ({ ...prev, [jobId]: '' }))
    syncJobCalendar.mutate(jobId, {
      onError: error => {
        setSyncErrorByJob(prev => ({
          ...prev,
          [jobId]: (error as Error)?.message ?? 'Google Calendar sync failed.',
        }))
      },
      onSuccess: () => {
        setSyncErrorByJob(prev => ({ ...prev, [jobId]: '' }))
        setJustSynced(jobId)
      },
    })
  }

  function recurringCard(exp: RecurringExpense) {
    return (
      <div key={exp.id} className="wd-cal-exp">
        <span className="wd-disp text-lg text-mu" aria-hidden="true">$</span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{exp.name}</p>
          <p className="text-xs text-mu">Expense due · {exp.category} · {centsToDisplay(exp.amount_cents)}</p>
        </div>
      </div>
    )
  }

  function jobCard(job: Job) {
    const syncing = syncJobCalendar.isPending && syncJobCalendar.variables === job.id
    const synced = job.has_google_calendar_event
    return (
      <div key={job.id} className="wd-cal-job">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold">{job.customer_name ?? 'Unnamed customer'}</p>
            <p className="text-xs capitalize text-mu">
              {job.service_type}
              {isAllCities && job.city_name ? ` · ${job.city_name}` : ''}
            </p>
          </div>
          <span
            className={`wd-sync${synced ? ' on' : ''}${synced && justSynced === job.id ? ' wd-bump' : ''}`}
            aria-live="polite"
          >
            {synced ? 'Google synced' : 'Local only'}
          </span>
        </div>

        <dl className="wd-kv">
          <dt>Time</dt>
          <dd>{job.appointment_time_slot ? fmtTimeSlot(job.appointment_time_slot) : 'Not set'}</dd>
          <dt>Duration</dt>
          <dd>{job.estimated_job_duration_minutes != null ? fmtDurationMinutes(job.estimated_job_duration_minutes) : 'Not set'}</dd>
          <dt>Status</dt>
          <dd>{phaseLabel(job)}</dd>
          <dt>Crew</dt>
          <dd>{job.crew.length > 0 ? job.crew.join(', ') : 'Unassigned'}</dd>
          <dt>Address</dt>
          <dd>{job.job_address || job.job_location || 'Not set'}</dd>
          {showQuote && job.quoted_price_total != null && (
            <>
              <dt>Quoted</dt>
              <dd>{formatCurrency(job.quoted_price_total)}</dd>
            </>
          )}
          {job.scope_notes && (
            <>
              <dt>Scope</dt>
              <dd>{job.scope_notes}</dd>
            </>
          )}
        </dl>

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <button type="button" onClick={() => openJob(job)} className="wd-btn-sm">
            {showQuote ? 'Open lead' : 'Open jobs'}
          </button>
          {showQuote && !synced && job.job_date_requested && (
            <button type="button" onClick={() => handleSyncJob(job.id)} disabled={syncing} className="wd-btn-sm wd-btn-ghost">
              {syncing ? 'Syncing…' : 'Sync to Google'}
            </button>
          )}
        </div>
        {syncErrorByJob[job.id] && (
          <p className="mt-2 text-xs font-medium text-danger" role="alert">{syncErrorByJob[job.id]}</p>
        )}
      </div>
    )
  }

  function dayBody(key: string) {
    const jobsOn = dayJobs(key)
    const recurringOn = recurringByDay[key] ?? []
    if (jobsOn.length === 0 && recurringOn.length === 0) {
      return <p className="text-sm text-mu">No confirmed jobs on this date.</p>
    }
    return (
      <>
        {recurringOn.map(recurringCard)}
        {jobsOn.map(jobCard)}
      </>
    )
  }

  const selectedJobs = dayJobs(selectedDay)
  const weeks = Array.from({ length: 6 }, (_, w) => monthDays.slice(w * 7, w * 7 + 7))

  return (
    <div className="min-h-screen bg-bg pb-[calc(var(--dock-h)+16px)] text-ink">
      <header className="wd-hdr flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="wd-disp text-[26px] leading-none">Calendar</h1>
          <p className="wd-h-s truncate">Confirmed jobs by day</p>
        </div>
        {user?.role === 'admin' && <CitySwitcher variant="pill" />}
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-3 px-3.5 pt-4">
        <Segmented
          label="View"
          options={[
            { key: 'week', label: 'Week' },
            { key: 'month', label: 'Month' },
          ]}
          value={viewMode}
          onChange={setViewMode}
        />

        <div className="wd-cal-nav">
          <button
            type="button"
            aria-label={viewMode === 'week' ? 'Previous week' : 'Previous month'}
            onClick={() => (viewMode === 'week' ? changeWeek(-1) : changeMonth(-1))}
            className="wd-btn-sm wd-btn-ghost"
          >
            <Icon d={BACK} />
          </button>
          <span className="wd-cal-label" aria-live="polite">
            {viewMode === 'week' ? weekRangeLabel(weekCursor) : monthLabel(monthCursor)}
          </span>
          <button type="button" onClick={jumpToToday} className="wd-btn-sm wd-btn-amber">
            Today
          </button>
          <button
            type="button"
            aria-label={viewMode === 'week' ? 'Next week' : 'Next month'}
            onClick={() => (viewMode === 'week' ? changeWeek(1) : changeMonth(1))}
            className="wd-btn-sm wd-btn-ghost"
          >
            <Icon d={CHEV} />
          </button>
        </div>

        {isLoading && <Working label="Loading calendar…" />}

        {viewMode === 'week' && (
          <section key="week" className="wd-pane flex flex-col gap-2" aria-label="Week">
            {weekDays.map(day => {
              const key = dateKey(day)
              const count = (jobsByDay[key] ?? []).length
              const hasRecurring = (recurringByDay[key] ?? []).length > 0
              const total = dayTotal(key)
              const isOpen = key === expandedDay
              const isToday = key === todayKey

              return (
                <div key={key} className={`wd-day${isToday ? ' today' : ''}${isOpen ? ' open' : ''}`}>
                  <button
                    type="button"
                    onClick={() => setExpandedDay(isOpen ? '' : key)}
                    className="wd-day-h"
                    aria-expanded={isOpen}
                  >
                    <span className="wd-day-n">
                      {weekdayShort(key)} {dayNumber(key)}
                      {isToday && <em>Today</em>}
                    </span>
                    <span className="wd-day-c">
                      {count > 0 ? plural(count, 'job') : 'No jobs'}
                      {hasRecurring && ' · expense due'}
                    </span>
                    {showQuote && total > 0 && <span className="wd-day-t">{formatCurrency(total)}</span>}
                    <Chevron />
                  </button>
                  <Accordion open={isOpen}>
                    <div className="wd-day-b">{dayBody(key)}</div>
                  </Accordion>
                </div>
              )
            })}
          </section>
        )}

        {viewMode === 'month' && (
          <section key="month" className="wd-pane flex flex-col gap-3">
            <div className="wd-mg">
              <div role="grid" aria-label="Month" className="wd-mgr">
                <div role="row" className="wd-mh">
                  {WEEKDAYS.map(label => (
                    <span key={label} role="columnheader" aria-label={label}>{label[0]}</span>
                  ))}
                </div>
                {weeks.map(week => (
                  <div role="row" key={dateKey(week[0])}>
                    {week.map(day => {
                      const key = dateKey(day)
                      const count = (jobsByDay[key] ?? []).length
                      const isToday = key === todayKey
                      return (
                        <div role="gridcell" key={key}>
                          <button
                            type="button"
                            data-day={key}
                            aria-pressed={key === selectedDay}
                            aria-label={`${selectedLabel(key)}${isToday ? ', today' : ''}, ${count > 0 ? plural(count, 'job') : 'no jobs'}`}
                            onClick={() => setSelectedDay(key)}
                            className={`wd-mday${sameMonth(day, monthCursor) ? '' : ' out'}${isToday ? ' today' : ''}`}
                          >
                            <span>{day.getDate()}</span>
                            <i>{Array.from({ length: Math.min(count, 4) }, (_, n) => <b key={n} className="wd-dot" />)}</i>
                          </button>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>

            {user?.role === 'admin' && calendarStatus && !calendarStatus.connected && (
              <p className="px-1 text-xs text-mu">Google Calendar isn't connected for this city yet. Jobs stay local.</p>
            )}

            <h2 className="wd-label px-0.5 pt-1">
              {selectedLabel(selectedDay)} · {plural(selectedJobs.length, 'job')}
            </h2>
            <div className="flex flex-col gap-2">{dayBody(selectedDay)}</div>
          </section>
        )}

        {unscheduledJobs.length > 0 && (
          <section className="wd-needs">
            <div className="haz h-2" aria-hidden="true" />
            <button
              type="button"
              onClick={() => setShowUnscheduled(prev => !prev)}
              className="wd-needs-h"
              aria-expanded={showUnscheduled}
            >
              <Icon d={WARN} />
              <span>{plural(unscheduledJobs.length, 'job')} {unscheduledJobs.length === 1 ? 'needs' : 'need'} a date</span>
              <Chevron />
            </button>
            <Accordion open={showUnscheduled}>
              <div className="grid gap-2 px-3 pb-3">
                {unscheduledJobs.map(job => (
                  <div key={job.id} className="wd-needs-i">
                    <div className="min-w-0">
                      <p className="font-semibold">{job.customer_name ?? 'Unnamed customer'}</p>
                      <p className="truncate text-xs text-mu">
                        <span className="capitalize">{job.service_type}</span>
                        {` · ${job.job_address || job.job_location || 'Address not set'}`}
                        {isAllCities && job.city_name ? ` · ${job.city_name}` : ''}
                      </p>
                      {showQuote && job.quoted_price_total != null && (
                        <p className="wd-cal-v">{formatCurrency(job.quoted_price_total)}</p>
                      )}
                    </div>
                    <button type="button" onClick={() => openJob(job)} className="wd-btn-sm shrink-0">
                      {showQuote ? 'Set date' : 'Open jobs'}
                    </button>
                  </div>
                ))}
              </div>
            </Accordion>
          </section>
        )}
      </main>
      <BottomNav />
    </div>
  )
}
