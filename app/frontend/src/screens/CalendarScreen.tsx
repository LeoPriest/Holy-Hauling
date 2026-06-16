import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { BottomNav } from '../components/BottomNav'
import { CitySwitcher } from '../components/CitySwitcher'
import { useCity } from '../context/CityContext'
import { useJobs, useSyncJobCalendar, type Job } from '../hooks/useJobs'
import { apiFetch } from '../services/api'
import { fmtDurationMinutes, fmtTimeSlot } from '../utils/time'
import { useRecurringExpenses } from '../hooks/useRecurringExpenses'
import { centsToDisplay } from '../types/recurringExpense'
import type { RecurringExpense } from '../types/recurringExpense'

type ViewMode = 'week' | 'month'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type CalendarStatus = {
  configured: boolean
  connected: boolean
  missing: string[]
  detail: string | null
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

function dayLabel(key: string) {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
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
  return job.job_phase.replace('_', ' ')
}

function openTargetLabel(role: string | undefined) {
  return role === 'admin' || role === 'facilitator' ? 'Open Lead' : 'Open Jobs'
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
  const monthPrefix = dateKey(monthCursor).slice(0, 7)
  const monthJobs = jobs.filter(job => job.job_date_requested?.startsWith(monthPrefix))
  const unscheduledJobs = jobs.filter(job => !job.job_date_requested)
  const syncedJobs = jobs.filter(job => job.has_google_calendar_event).length
  const backTarget = user?.role === 'admin' || user?.role === 'facilitator' ? '/' : '/jobs'
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
    if (user?.role === 'admin' || user?.role === 'facilitator') {
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
      },
    })
  }

  function recurringCard(exp: RecurringExpense) {
    return (
      <div key={exp.id} className="rounded-xl border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 p-3">
        <div className="flex items-center gap-2">
          <span className="text-purple-600 dark:text-purple-300 text-sm" aria-hidden="true">$</span>
          <div>
            <p className="text-sm font-medium text-purple-900 dark:text-purple-100">{exp.name}</p>
            <p className="text-xs text-purple-600 dark:text-purple-300">{exp.category} · {centsToDisplay(exp.amount_cents)}</p>
          </div>
        </div>
      </div>
    )
  }

  function jobCard(job: Job) {
    return (
      <div key={job.id} className="rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-gray-900 dark:text-white">{job.customer_name ?? 'Unnamed customer'}</h3>
              {isAllCities && job.city_name && (
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-200">
                  {job.city_name}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 capitalize">{job.service_type}</p>
          </div>
          <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
            job.has_google_calendar_event
              ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
              : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200'
          }`}>
            {job.has_google_calendar_event ? 'Google synced' : 'Local only'}
          </span>
        </div>

        <div className="mt-3 space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
          <p><span className="font-medium text-gray-800 dark:text-gray-200">Time:</span> {job.appointment_time_slot ? fmtTimeSlot(job.appointment_time_slot) : 'Not set'}</p>
          <p><span className="font-medium text-gray-800 dark:text-gray-200">Est. Duration:</span> {job.estimated_job_duration_minutes != null ? fmtDurationMinutes(job.estimated_job_duration_minutes) : 'Not set'}</p>
          <p><span className="font-medium text-gray-800 dark:text-gray-200">Status:</span> {phaseLabel(job)}</p>
          {showQuote && job.quoted_price_total != null && (
            <p><span className="font-medium text-gray-800 dark:text-gray-200">Quoted Price:</span> {formatCurrency(job.quoted_price_total)}</p>
          )}
          <p><span className="font-medium text-gray-800 dark:text-gray-200">Crew:</span> {job.crew.length > 0 ? job.crew.join(', ') : 'Unassigned'}</p>
          <p><span className="font-medium text-gray-800 dark:text-gray-200">Address:</span> {job.job_address || job.job_location || 'Not set'}</p>
          {job.scope_notes && (
            <p><span className="font-medium text-gray-800 dark:text-gray-200">Scope:</span> {job.scope_notes}</p>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <button
            onClick={() => openJob(job)}
            className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
          >
            {openTargetLabel(user?.role)}
          </button>
          {showQuote && !job.has_google_calendar_event && job.job_date_requested && (
            <button
              onClick={() => handleSyncJob(job.id)}
              disabled={syncJobCalendar.isPending && syncJobCalendar.variables === job.id}
              className="px-3 py-2 rounded-lg border border-emerald-300 text-emerald-700 text-sm font-medium hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-900/20"
            >
              {syncJobCalendar.isPending && syncJobCalendar.variables === job.id ? 'Syncing...' : 'Sync to Google'}
            </button>
          )}
        </div>
        {syncErrorByJob[job.id] && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{syncErrorByJob[job.id]}</p>
        )}
      </div>
    )
  }

  const selectedJobs = dayJobs(selectedDay)
  const selectedRecurring = recurringByDay[selectedDay] ?? []

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-16">
      <header className="bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(backTarget)}
            className="text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 text-lg"
          >
            <span aria-hidden="true">←</span>
          </button>
          <div>
            <h1 className="font-bold text-gray-900 dark:text-white text-lg">Calendar</h1>
            <p className="text-xs text-gray-400 dark:text-gray-500">Confirmed jobs by day</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {user?.role === 'admin' && <CitySwitcher />}
          <span className="text-xs text-gray-500 dark:text-gray-400">{user?.username}</span>
        </div>
      </header>

      <main className="p-4 space-y-4 pb-10">
        {/* View toggle + period nav */}
        <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-800 p-1 self-start">
            {(['week', 'month'] as ViewMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`min-h-11 px-4 rounded-md text-sm font-medium capitalize transition-colors ${
                  viewMode === mode
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => (viewMode === 'week' ? changeWeek(-1) : changeMonth(-1))}
              className="min-h-11 px-3 rounded-lg border dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Prev
            </button>
            <span className="min-w-28 text-center text-sm font-semibold text-gray-900 dark:text-white">
              {viewMode === 'week' ? weekRangeLabel(weekCursor) : monthLabel(monthCursor)}
            </span>
            <button
              onClick={jumpToToday}
              className="min-h-11 px-3 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
            >
              Today
            </button>
            <button
              onClick={() => (viewMode === 'week' ? changeWeek(1) : changeMonth(1))}
              className="min-h-11 px-3 rounded-lg border dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Next
            </button>
          </div>
        </section>

        {viewMode === 'week' && (
          <section className="space-y-2">
            {weekDays.map(day => {
              const key = dateKey(day)
              const jobsToday = dayJobs(key)
              const recurringToday = recurringByDay[key] ?? []
              const total = dayTotal(key)
              const isExpanded = key === expandedDay
              const isToday = key === todayKey
              const count = jobsToday.length

              return (
                <div
                  key={key}
                  className={`bg-white dark:bg-gray-800 rounded-2xl border shadow-sm overflow-hidden ${
                    isToday ? 'border-indigo-400 dark:border-indigo-500' : 'dark:border-gray-700'
                  }`}
                >
                  <button
                    onClick={() => setExpandedDay(isExpanded ? '' : key)}
                    className="w-full min-h-14 px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50"
                    aria-expanded={isExpanded}
                  >
                    <div className="flex items-baseline gap-3 min-w-0">
                      <span className={`text-sm font-semibold w-20 shrink-0 ${
                        isToday ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-900 dark:text-white'
                      }`}>
                        {weekdayShort(key)} {dayNumber(key)}
                        {isToday && <span className="ml-1 text-[10px] uppercase tracking-wide">Today</span>}
                      </span>
                      <span className="text-sm text-gray-500 dark:text-gray-400 truncate">
                        {count > 0 ? `${count} job${count === 1 ? '' : 's'}` : 'No jobs'}
                        {recurringToday.length > 0 && (
                          <span className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-purple-400 align-middle" aria-label="recurring expense due" />
                        )}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {showQuote && total > 0 && (
                        <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">{formatCurrency(total)}</span>
                      )}
                      <span className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} aria-hidden="true">›</span>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 pt-1 space-y-3 border-t dark:border-gray-700">
                      {count === 0 && recurringToday.length === 0 ? (
                        <p className="text-sm text-gray-400 dark:text-gray-500 pt-3">No confirmed jobs on this date.</p>
                      ) : (
                        <div className="pt-3 space-y-3">
                          {recurringToday.map(recurringCard)}
                          {jobsToday.map(jobCard)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </section>
        )}

        {viewMode === 'month' && (
          <>
            <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">This Month</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white mt-2">{monthJobs.length}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Booked jobs on the {monthLabel(monthCursor)} board.</p>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Google Sync</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white mt-2">{syncedJobs}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  {user?.role === 'admin'
                    ? (calendarStatus?.connected ? 'Google Calendar is connected.' : 'Google Calendar is not connected yet.')
                    : 'Jobs with an active Google Calendar event.'}
                </p>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Needs Date</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white mt-2">{unscheduledJobs.length}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Booked jobs missing a confirmed calendar date.</p>
              </div>
            </section>

            <section className="bg-white dark:bg-gray-800 rounded-2xl border dark:border-gray-700 shadow-sm overflow-hidden">
              <div className="grid grid-cols-7 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                {WEEKDAYS.map(label => (
                  <div key={label} className="px-2 py-2 text-center text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                    {label}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7">
                {monthDays.map(day => {
                  const key = dateKey(day)
                  const dJobs = jobsByDay[key] ?? []
                  const inMonth = sameMonth(day, monthCursor)
                  const isSelected = key === selectedDay
                  const isToday = key === todayKey

                  return (
                    <button
                      key={key}
                      onClick={() => setSelectedDay(key)}
                      className={`min-h-24 border-b border-r dark:border-gray-700 p-2 text-left align-top transition-colors ${
                        inMonth ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-900/40'
                      } ${
                        isSelected ? 'ring-2 ring-inset ring-indigo-500 z-[1]' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-sm font-semibold ${
                          inMonth ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-600'
                        }`}>
                          {day.getDate()}
                        </span>
                        {isToday && (
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
                            Today
                          </span>
                        )}
                      </div>
                      <div className="space-y-1">
                        {[...dJobs].sort(compareJobsBySchedule).slice(0, 3).map(job => (
                          <div
                            key={job.id}
                            className={`rounded-lg px-2 py-1 text-[11px] leading-tight ${
                              job.has_google_calendar_event
                                ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-200'
                                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200'
                            }`}
                          >
                            <p className="truncate font-medium">
                              {job.appointment_time_slot ? `${fmtTimeSlot(job.appointment_time_slot)} - ` : ''}
                              {job.customer_name ?? 'Unnamed customer'}
                            </p>
                            <p className="truncate opacity-80">{job.service_type}</p>
                          </div>
                        ))}
                        {dJobs.length > 3 && (
                          <p className="text-[11px] font-medium text-gray-400 dark:text-gray-500">
                            +{dJobs.length - 3} more
                          </p>
                        )}
                        {(recurringByDay[key] ?? []).length > 0 && (
                          <span className="inline-block h-1 w-1 rounded-full bg-purple-400" aria-hidden="true" />
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </section>

            <section className="bg-white dark:bg-gray-800 rounded-2xl border dark:border-gray-700 shadow-sm p-4">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{dayLabel(selectedDay)}</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{selectedJobs.length} confirmed job{selectedJobs.length === 1 ? '' : 's'}</p>
                </div>
                {selectedJobs.length > 0 && (
                  <button
                    onClick={() => navigate('/jobs')}
                    className="text-xs text-indigo-600 dark:text-indigo-400 font-medium hover:underline"
                  >
                    Open Jobs Board
                  </button>
                )}
              </div>

              {selectedJobs.length === 0 && selectedRecurring.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500">No confirmed jobs on this date.</p>
              ) : (
                <div className="space-y-3">
                  {selectedRecurring.map(recurringCard)}
                  {selectedJobs.map(jobCard)}
                </div>
              )}
            </section>
          </>
        )}

        {/* Needs-a-date banner — shown in both views only when there is work to do */}
        {unscheduledJobs.length > 0 && (
          <section className="bg-white dark:bg-gray-800 rounded-2xl border border-amber-200 dark:border-amber-800 shadow-sm overflow-hidden">
            <button
              onClick={() => setShowUnscheduled(prev => !prev)}
              className="w-full min-h-14 px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-amber-50 dark:hover:bg-amber-900/10"
              aria-expanded={showUnscheduled}
            >
              <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                ⚠ {unscheduledJobs.length} job{unscheduledJobs.length === 1 ? '' : 's'} need a date
              </span>
              <span className={`text-amber-500 transition-transform ${showUnscheduled ? 'rotate-90' : ''}`} aria-hidden="true">›</span>
            </button>
            {showUnscheduled && (
              <div className="px-4 pb-4 pt-1 space-y-3 border-t border-amber-200 dark:border-amber-800">
                {unscheduledJobs.map(job => (
                  <div key={job.id} className="rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-3 mt-3 first:mt-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-gray-900 dark:text-white">{job.customer_name ?? 'Unnamed customer'}</p>
                          {isAllCities && job.city_name && (
                            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-200">
                              {job.city_name}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-500 dark:text-gray-400 capitalize">{job.service_type}</p>
                        {showQuote && job.quoted_price_total != null && (
                          <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                            {formatCurrency(job.quoted_price_total)}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => openJob(job)}
                        className="text-xs text-indigo-600 dark:text-indigo-400 font-medium hover:underline"
                      >
                        {openTargetLabel(user?.role)}
                      </button>
                    </div>
                    <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{job.job_address || job.job_location || 'Address not set'}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {isLoading && (
          <div className="text-sm text-gray-400 dark:text-gray-500">Loading calendar...</div>
        )}
      </main>
      <BottomNav />
    </div>
  )
}
