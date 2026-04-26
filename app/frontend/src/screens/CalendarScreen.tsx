import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useJobs, useSyncJobCalendar, type Job } from '../hooks/useJobs'
import { apiFetch } from '../services/api'
import { fmtDurationMinutes, fmtTimeSlot } from '../utils/time'

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
  const [monthCursor, setMonthCursor] = useState(startOfMonth(today))
  const [selectedDay, setSelectedDay] = useState(dateKey(today))

  const { data: jobs = [], isLoading } = useJobs()
  const syncJobCalendar = useSyncJobCalendar()
  const { data: calendarStatus } = useQuery<CalendarStatus>({
    queryKey: ['google-calendar-status'],
    queryFn: async () => {
      const r = await apiFetch('/admin/google/status')
      if (!r.ok) return { configured: false, connected: false, missing: [], detail: null }
      return r.json()
    },
    enabled: user?.role === 'admin',
  })

  const jobsByDay = jobs.reduce<Record<string, Job[]>>((acc, job) => {
    if (!job.job_date_requested) return acc
    acc[job.job_date_requested] = [...(acc[job.job_date_requested] ?? []), job]
    return acc
  }, {})
  const monthDays = buildMonthGrid(monthCursor)
  const monthPrefix = dateKey(monthCursor).slice(0, 7)
  const todayKey = dateKey(today)
  const selectedJobs = [...(jobsByDay[selectedDay] ?? [])].sort(compareJobsBySchedule)
  const monthJobs = jobs.filter(job => job.job_date_requested?.startsWith(monthPrefix))
  const unscheduledJobs = jobs.filter(job => !job.job_date_requested)
  const syncedJobs = jobs.filter(job => job.has_google_calendar_event).length
  const backTarget = user?.role === 'admin' || user?.role === 'facilitator' ? '/' : '/jobs'
  const showQuote = user?.role === 'admin' || user?.role === 'facilitator'
  const [syncErrorByJob, setSyncErrorByJob] = useState<Record<string, string>>({})

  useEffect(() => {
    const requestedDate = searchParams.get('date')
    if (!requestedDate || !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) return
    const [year, month, day] = requestedDate.split('-').map(Number)
    const nextDate = new Date(year, month - 1, day, 12)
    if (Number.isNaN(nextDate.getTime())) return
    setMonthCursor(startOfMonth(nextDate))
    setSelectedDay(requestedDate)
  }, [searchParams])

  function changeMonth(delta: number) {
    const nextMonth = addMonths(monthCursor, delta)
    setMonthCursor(nextMonth)
    setSelectedDay(dateKey(nextMonth))
  }

  function jumpToToday() {
    setMonthCursor(startOfMonth(today))
    setSelectedDay(todayKey)
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

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
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
          <button
            onClick={() => navigate('/jobs')}
            className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 font-medium"
          >
            Jobs
          </button>
          <span className="text-xs text-gray-500 dark:text-gray-400">{user?.username}</span>
        </div>
      </header>

      <main className="p-4 space-y-4 pb-10">
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
          <div className="px-4 py-4 border-b dark:border-gray-700 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{monthLabel(monthCursor)}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">Booked jobs land here as soon as the date is confirmed.</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => changeMonth(-1)}
                className="px-3 py-2 rounded-lg border dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Prev
              </button>
              <button
                onClick={jumpToToday}
                className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
              >
                Today
              </button>
              <button
                onClick={() => changeMonth(1)}
                className="px-3 py-2 rounded-lg border dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Next
              </button>
            </div>
          </div>

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
              const dayJobs = jobsByDay[key] ?? []
              const inMonth = sameMonth(day, monthCursor)
              const isSelected = key === selectedDay
              const isToday = key === todayKey

              return (
                <button
                  key={key}
                  onClick={() => setSelectedDay(key)}
                  className={`min-h-32 border-b border-r dark:border-gray-700 p-2 text-left align-top transition-colors ${
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
                    {[...dayJobs].sort(compareJobsBySchedule).slice(0, 3).map(job => (
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
                        {job.estimated_job_duration_minutes != null && (
                          <p className="truncate opacity-80">{fmtDurationMinutes(job.estimated_job_duration_minutes)}</p>
                        )}
                        {showQuote && job.quoted_price_total != null && (
                          <p className="truncate opacity-80">{formatCurrency(job.quoted_price_total)}</p>
                        )}
                      </div>
                    ))}
                    {dayJobs.length > 3 && (
                      <p className="text-[11px] font-medium text-gray-400 dark:text-gray-500">
                        +{dayJobs.length - 3} more
                      </p>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl border dark:border-gray-700 shadow-sm p-4">
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

            {selectedJobs.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500">No confirmed jobs on this date.</p>
            ) : (
              <div className="space-y-3">
                {selectedJobs.map(job => (
                  <div key={job.id} className="rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-gray-900 dark:text-white">{job.customer_name ?? 'Unnamed customer'}</h3>
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
                ))}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <section className="bg-white dark:bg-gray-800 rounded-2xl border dark:border-gray-700 shadow-sm p-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Sync Notes</h2>
              <div className="mt-3 space-y-2 text-sm text-gray-600 dark:text-gray-300">
                <p>Booked jobs already sync to Google Calendar when assigned crew members have Google email addresses.</p>
                <p>Jobs marked "Google synced" already have a live event. "Local only" means the job is confirmed here, but no Google event is attached yet.</p>
                {user?.role === 'admin' && (
                  <p>
                    Current Google Calendar status:{' '}
                    <span className={calendarStatus?.connected ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-amber-600 dark:text-amber-400 font-medium'}>
                      {calendarStatus?.connected ? 'Connected' : calendarStatus?.configured ? 'Not connected' : 'Not configured'}
                    </span>
                  </p>
                )}
                {user?.role === 'admin' && calendarStatus?.detail && (
                  <p className="text-amber-600 dark:text-amber-400">{calendarStatus.detail}</p>
                )}
              </div>
            </section>

            <section className="bg-white dark:bg-gray-800 rounded-2xl border dark:border-gray-700 shadow-sm p-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Unscheduled Confirmed Jobs</h2>
              <div className="mt-3 space-y-3">
                {unscheduledJobs.length === 0 && (
                  <p className="text-sm text-gray-400 dark:text-gray-500">Every booked job currently has a date.</p>
                )}
                {unscheduledJobs.map(job => (
                  <div key={job.id} className="rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-gray-900 dark:text-white">{job.customer_name ?? 'Unnamed customer'}</p>
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
                    {showQuote && !job.has_google_calendar_event && (
                      <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">Needs a confirmed date and assigned Google-email crew before it can sync.</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </div>
        </section>

        {isLoading && (
          <div className="text-sm text-gray-400 dark:text-gray-500">Loading calendar...</div>
        )}
      </main>
    </div>
  )
}
