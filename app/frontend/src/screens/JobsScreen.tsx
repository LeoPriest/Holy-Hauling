import { useEffect, useState, type ChangeEvent } from 'react'
import { buildUploadUrl } from '../services/api'
import { useNavigate } from 'react-router-dom'
import { UseMutationResult } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import {
  type Job,
  useJobs,
  usePatchJobStatus,
  useAddJobAssignment,
  useRemoveJobAssignment,
  useAddJobNote,
  useElapsedTime,
} from '../hooks/useJobs'
import { useLead, useUploadScreenshot } from '../hooks/useLeads'
import { type TeamMember, useUsers } from '../hooks/useUsers'
import type { Screenshot } from '../types/lead'
import { fmtDurationMinutes, fmtTimeSlot, parseUtc, fmtLocalTime } from '../utils/time'

const MAPS_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY ||
  import.meta.env.VITE_GOOGLE_MAPS_KEY) as string | undefined

type JobView = 'scheduled' | 'in_progress'
type PhaseValue = 'dispatched' | 'en_route' | 'arrived' | 'started' | 'completed'
type JobPhotoType = 'before_job' | 'after_job'

const PHASES: Array<{ value: PhaseValue; label: string; lockedAfter: keyof Job | null }> = [
  { value: 'dispatched', label: 'Dispatch', lockedAfter: 'en_route_at' },
  { value: 'en_route', label: 'En Route', lockedAfter: 'arrived_at' },
  { value: 'arrived', label: 'On Site', lockedAfter: 'started_at' },
  { value: 'started', label: 'Started', lockedAfter: 'started_at' },
  { value: 'completed', label: 'Complete', lockedAfter: null },
]

type JobGroup = {
  key: string
  label: string
  jobs: Job[]
}

function isPhaseLockedForNonAdmin(job: Job, phaseValue: PhaseValue): boolean {
  const phase = PHASES.find(item => item.value === phaseValue)
  if (!phase || !phase.lockedAfter) return false
  return job[phase.lockedAfter] !== null
}

function timerColor(level: 'red' | 'orange' | 'normal') {
  if (level === 'red') return 'text-red-600 dark:text-red-400'
  if (level === 'orange') return 'text-orange-500 dark:text-orange-400'
  return 'text-gray-500 dark:text-gray-400'
}

function threshold(ms: number, warnMs: number, critMs: number): 'red' | 'orange' | 'normal' {
  if (ms >= critMs) return 'red'
  if (ms >= warnMs) return 'orange'
  return 'normal'
}

function fmtTime(iso: string | null): string | null {
  if (!iso) return null
  return fmtLocalTime(iso)
}

function fmtDuration(fromIso: string, toIso: string): string {
  const ms = parseUtc(toIso).getTime() - parseUtc(fromIso).getTime()
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.floor((ms % 3_600_000) / 60_000)
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

function streetViewUrl(address: string): string | null {
  if (!MAPS_KEY) return null
  return (
    `https://maps.googleapis.com/maps/api/streetview` +
    `?size=640x260&location=${encodeURIComponent(address)}` +
    `&key=${MAPS_KEY}&return_error_code=true&source=outdoor`
  )
}

function googleMapsUrl(address: string) {
  return `https://maps.google.com/maps?q=${encodeURIComponent(address)}`
}

function photoLabel(type: JobPhotoType) {
  return type === 'before_job' ? 'Before Photos' : 'After Photos'
}

function photoButtonLabel(type: JobPhotoType) {
  return type === 'before_job' ? 'Add Before Pic' : 'Add After Pic'
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

function fmtJobSchedule(job: Job): string | null {
  if (!job.job_date_requested) return null
  if (!job.appointment_time_slot) return job.job_date_requested
  return `${job.job_date_requested} at ${fmtTimeSlot(job.appointment_time_slot)}`
}

function fmtJobGroupLabel(jobDate: string | null): string {
  if (!jobDate) return 'No date scheduled'

  const [yearRaw, monthRaw, dayRaw] = jobDate.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const day = Number(dayRaw)
  if ([year, month, day].some(Number.isNaN)) return jobDate

  const date = new Date(year, month - 1, day, 12)
  const weekday = date.toLocaleDateString([], { weekday: 'long' })
  const monthDayYear = date.toLocaleDateString([], {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  return `${weekday} - ${monthDayYear}`
}

function groupJobsByDay(jobs: Job[]): JobGroup[] {
  const groups: JobGroup[] = []

  for (const job of jobs) {
    const key = job.job_date_requested ?? 'unscheduled'
    const current = groups[groups.length - 1]
    if (!current || current.key !== key) {
      groups.push({
        key,
        label: fmtJobGroupLabel(job.job_date_requested),
        jobs: [job],
      })
      continue
    }
    current.jobs.push(job)
  }

  return groups
}

function weekdayKeyFromDate(jobDate: string | null): TeamMember['unavailable_weekdays'][number] | null {
  if (!jobDate) return null
  const [yearRaw, monthRaw, dayRaw] = jobDate.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const day = Number(dayRaw)
  if ([year, month, day].some(Number.isNaN)) return null
  const date = new Date(year, month - 1, day, 12)
  return ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][date.getDay()] as TeamMember['unavailable_weekdays'][number]
}

function isUnavailableOnDate(user: TeamMember | undefined, day: string | null): boolean {
  const weekday = weekdayKeyFromDate(day)
  return Boolean(user && weekday && user.unavailable_weekdays.includes(weekday))
}

function JobCard({
  job,
  showQuote,
  onClick,
}: {
  job: Job
  showQuote: boolean
  onClick: () => void
}) {
  const dispatchElapsed = useElapsedTime(job.en_route_at ? null : job.dispatched_at)
  const travelElapsed = useElapsedTime(job.arrived_at ? null : job.en_route_at)
  const setupElapsed = useElapsedTime(job.started_at ? null : job.arrived_at)
  const workingElapsed = useElapsedTime(job.started_at)

  const now = Date.now()
  const travelMs = job.en_route_at
    ? (job.arrived_at ? parseUtc(job.arrived_at).getTime() : now) - parseUtc(job.en_route_at).getTime()
    : 0
  const workingMs = job.started_at ? now - parseUtc(job.started_at).getTime() : 0
  const travelWarn = threshold(travelMs, 45 * 60_000, 90 * 60_000)
  const workingWarn = threshold(workingMs, 3 * 3_600_000, 5 * 3_600_000)

  const mapTarget = job.job_address || job.job_location

  const badge = (() => {
    if (job.job_phase === 'started' && workingElapsed) {
      return (
        <span className={`rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium dark:border-amber-800 dark:bg-amber-900/30 ${timerColor(workingWarn)}`}>
          Working {workingElapsed}
        </span>
      )
    }
    if (job.job_phase === 'arrived' && setupElapsed) {
      return (
        <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 dark:border-green-800 dark:bg-green-900/30 dark:text-green-400">
          On site {setupElapsed}
        </span>
      )
    }
    if (job.job_phase === 'en_route' && travelElapsed) {
      return (
        <span className={`rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium dark:border-blue-800 dark:bg-blue-900/30 ${timerColor(travelWarn)}`}>
          En route {travelElapsed}
        </span>
      )
    }
    if (job.job_phase === 'dispatched' && dispatchElapsed) {
      return (
        <span className="rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-400">
          Dispatch {dispatchElapsed}
        </span>
      )
    }
    return null
  })()

  return (
    <button
      onClick={onClick}
      className="w-full rounded-xl border border-gray-100 bg-white p-4 text-left shadow-sm transition-colors hover:border-indigo-300 active:scale-[0.99] dark:border-gray-700 dark:bg-gray-800 dark:hover:border-indigo-600"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-gray-900 dark:text-white">
              {job.customer_name ?? <span className="font-normal italic text-gray-400">Unnamed</span>}
            </p>
            {badge}
          </div>
          <p className="mt-0.5 text-sm capitalize text-gray-500 dark:text-gray-400">{job.service_type}</p>
          {mapTarget && <p className="mt-0.5 truncate text-sm text-gray-400 dark:text-gray-500">Location: {mapTarget}</p>}
          {fmtJobSchedule(job) && <p className="mt-0.5 text-sm text-gray-400 dark:text-gray-500">Scheduled: {fmtJobSchedule(job)}</p>}
          {job.estimated_job_duration_minutes != null && (
            <p className="mt-0.5 text-sm text-gray-400 dark:text-gray-500">
              Est. duration: {fmtDurationMinutes(job.estimated_job_duration_minutes)}
            </p>
          )}
          {showQuote && job.quoted_price_total != null && (
            <p className="mt-0.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
              Quoted: {formatCurrency(job.quoted_price_total)}
            </p>
          )}
        </div>
        <div className="mt-0.5 flex shrink-0 flex-col items-end gap-1.5">
          {job.crew.length > 0 && (
            <span className="max-w-32 break-words rounded-lg bg-blue-100 px-2 py-0.5 text-right text-xs text-blue-700 leading-snug dark:bg-blue-900 dark:text-blue-200">
              {job.crew.join(', ')}
            </span>
          )}
          <span className="text-xs text-gray-300 dark:text-gray-600">&gt;</span>
        </div>
      </div>
    </button>
  )
}

function TimelineRow({
  label,
  fromIso,
  toIso,
  elapsed,
  warn,
  live,
}: {
  label: string
  fromIso: string | null
  toIso: string | null
  elapsed: string | null
  warn: 'red' | 'orange' | 'normal'
  live: boolean
}) {
  if (!fromIso) return null

  return (
    <div className={`flex items-baseline gap-1.5 text-sm ${live ? timerColor(warn) : 'text-gray-500 dark:text-gray-400'}`}>
      <span className="font-medium">{label}</span>
      {live ? (
        <>
          <span className="font-bold">{elapsed ?? '...'}</span>
          <span className="text-xs text-gray-400">since {fmtTime(fromIso)}</span>
        </>
      ) : (
        <>
          <span className="font-semibold">{toIso ? fmtDuration(fromIso, toIso) : elapsed ?? '...'}</span>
          <span className="text-xs text-gray-400">
            {fmtTime(fromIso)} - {fmtTime(toIso)}
          </span>
        </>
      )}
    </div>
  )
}

function JobPhotoSection({
  title,
  screenshotType,
  photos,
  isUploading,
  onUpload,
}: {
  title: string
  screenshotType: JobPhotoType
  photos: Screenshot[]
  isUploading: boolean
  onUpload: (type: JobPhotoType, event: ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{title}</p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {photos.length === 0 ? 'No photos uploaded yet.' : `${photos.length} photo${photos.length === 1 ? '' : 's'} uploaded`}
          </p>
        </div>
        <label className="cursor-pointer rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700">
          {isUploading ? 'Uploading...' : photoButtonLabel(screenshotType)}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={isUploading}
            onChange={event => onUpload(screenshotType, event)}
          />
        </label>
      </div>

      {photos.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-3">
          {photos.map(photo => (
            <a
              key={photo.id}
              href={buildUploadUrl(photo.stored_path)}
              target="_blank"
              rel="noreferrer"
              className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-colors hover:border-indigo-300 dark:border-gray-700 dark:bg-gray-900"
            >
              <img
                src={buildUploadUrl(photo.stored_path)}
                alt={`${title} ${photo.original_filename}`}
                className="h-28 w-full object-cover"
              />
              <div className="px-3 py-2">
                <p className="truncate text-xs font-medium text-gray-700 dark:text-gray-200">{photo.original_filename}</p>
                <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                  {new Date(photo.created_at).toLocaleString([], {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

interface JobModalProps {
  job: Job
  userRole: string | undefined
  username: string | undefined
  users: TeamMember[]
  patchStatus: UseMutationResult<Job, Error, { id: string; status: string }>
  addAssignment: UseMutationResult<Job, Error, { jobId: string; userId: string }>
  removeAssignment: UseMutationResult<Job, Error, { jobId: string; userId: string }>
  onClose: () => void
  onViewCalendar: (job: Job) => void
}

function JobModal({
  job,
  userRole,
  username,
  users,
  patchStatus,
  addAssignment,
  removeAssignment,
  onClose,
  onViewCalendar,
}: JobModalProps) {
  const [confirmComplete, setConfirmComplete] = useState(false)
  const [note, setNote] = useState('')
  const [streetViewFailed, setStreetViewFailed] = useState(false)
  const [photoUploadTarget, setPhotoUploadTarget] = useState<JobPhotoType | null>(null)
  const addNote = useAddJobNote()
  const uploadScreenshot = useUploadScreenshot()
  const { data: leadDetail } = useLead(job.id)

  const dispatchElapsed = useElapsedTime(job.en_route_at ? null : job.dispatched_at)
  const travelElapsed = useElapsedTime(job.arrived_at ? null : job.en_route_at)
  const setupElapsed = useElapsedTime(job.started_at ? null : job.arrived_at)
  const workingElapsed = useElapsedTime(job.started_at)

  const now = Date.now()
  const travelMs = job.en_route_at
    ? (job.arrived_at ? parseUtc(job.arrived_at).getTime() : now) - parseUtc(job.en_route_at).getTime()
    : 0
  const setupMs = job.arrived_at
    ? (job.started_at ? parseUtc(job.started_at).getTime() : now) - parseUtc(job.arrived_at).getTime()
    : 0
  const workingMs = job.started_at ? now - parseUtc(job.started_at).getTime() : 0
  const travelWarn = threshold(travelMs, 45 * 60_000, 90 * 60_000)
  const setupWarn = threshold(setupMs, 20 * 60_000, 30 * 60_000)
  const workingWarn = threshold(workingMs, 3 * 3_600_000, 5 * 3_600_000)

  const mapTarget = job.job_address || job.job_location
  const streetView = mapTarget ? streetViewUrl(mapTarget) : null
  const navUrl = mapTarget ? googleMapsUrl(mapTarget) : null

  const canManageStatus = userRole === 'supervisor' || userRole === 'admin'
  const canAssign = userRole === 'supervisor' || userRole === 'admin' || userRole === 'facilitator'
  const isAdmin = userRole === 'admin'
  const showQuote = userRole === 'admin' || userRole === 'facilitator'
  const jobDate = job.job_date_requested
  const blockedUsers = users.filter(user => user.is_active && isUnavailableOnDate(user, jobDate))
  const beforePhotos = (leadDetail?.screenshots ?? []).filter(photo => photo.screenshot_type === 'before_job')
  const afterPhotos = (leadDetail?.screenshots ?? []).filter(photo => photo.screenshot_type === 'after_job')

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = ''
    }
  }, [onClose])

  useEffect(() => {
    setStreetViewFailed(false)
  }, [streetView, job.id])

  const submitNote = () => {
    const body = note.trim()
    if (!body) return
    addNote.mutate({ leadId: job.id, note: body, actor: username })
    setNote('')
  }

  const handlePhotoUpload = (type: JobPhotoType, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setPhotoUploadTarget(type)
    uploadScreenshot.mutate(
      { leadId: job.id, file, screenshotType: type },
      { onSettled: () => setPhotoUploadTarget(null) },
    )
    event.target.value = ''
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <button type="button" className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-label="Close job modal" />

      <div className="relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-w-lg sm:rounded-2xl dark:bg-gray-900">
        {streetView && !streetViewFailed ? (
          <div className="relative h-52 shrink-0 bg-gray-200 dark:bg-gray-800">
            <img
              src={streetView}
              alt={`Street view for ${mapTarget}`}
              className="h-full w-full object-cover"
              onError={event => {
                const element = event.target as HTMLImageElement
                element.style.display = 'none'
                setStreetViewFailed(true)
              }}
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
            <button
              onClick={onClose}
              className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
            >
              X
            </button>
          </div>
        ) : mapTarget ? (
          <div className="relative shrink-0 overflow-hidden border-b bg-gray-100 px-5 py-4 dark:border-gray-700 dark:bg-gray-800">
            <div className="pr-12">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                {MAPS_KEY ? 'Street View Unavailable' : 'Street View Needs Maps Key'}
              </p>
              <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">{mapTarget}</p>
              {navUrl && (
                <a
                  href={navUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
                >
                  Open in Google Maps
                </a>
              )}
            </div>
            <button
              onClick={onClose}
              className="absolute right-4 top-4 text-xl text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              X
            </button>
          </div>
        ) : (
          <div className="relative flex shrink-0 items-center justify-center pb-1 pt-3">
            <div className="h-1 w-10 rounded-full bg-gray-300 dark:bg-gray-600" />
            <button
              onClick={onClose}
              className="absolute right-4 text-xl text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              X
            </button>
          </div>
        )}

        <div className="flex-1 space-y-5 overflow-y-auto p-5 pb-10">
          <div>
            <h2 className="text-xl font-bold leading-tight text-gray-900 dark:text-white">
              {job.customer_name ?? <span className="font-normal italic text-gray-400">Unnamed customer</span>}
            </h2>
            <p className="mt-0.5 capitalize text-gray-500 dark:text-gray-400">{job.service_type}</p>
            {fmtJobSchedule(job) && (
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Scheduled: {fmtJobSchedule(job)}</p>
            )}
            {job.estimated_job_duration_minutes != null && (
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Est. duration: {fmtDurationMinutes(job.estimated_job_duration_minutes)}
              </p>
            )}
            {job.job_date_requested && (
              <button
                type="button"
                onClick={() => onViewCalendar(job)}
                className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 dark:border-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-200 dark:hover:bg-indigo-900/50"
              >
                View in Calendar
              </button>
            )}
          </div>

          {mapTarget && (
            <div className="flex items-center gap-3 rounded-xl bg-gray-50 px-4 py-3 dark:bg-gray-800">
              <p className="flex-1 text-sm leading-snug text-gray-700 dark:text-gray-300">{mapTarget}</p>
              {navUrl && (
                <a
                  href={navUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700"
                >
                  Navigate
                </a>
              )}
            </div>
          )}

          {(job.dispatched_at || job.en_route_at || job.arrived_at || job.started_at) && (
            <div className="space-y-2">
              <TimelineRow
                label="Dispatch wait"
                fromIso={job.dispatched_at}
                toIso={job.en_route_at}
                elapsed={dispatchElapsed}
                warn="normal"
                live={!job.en_route_at}
              />
              <TimelineRow
                label="Travel"
                fromIso={job.en_route_at}
                toIso={job.arrived_at}
                elapsed={travelElapsed}
                warn={travelWarn}
                live={!job.arrived_at}
              />
              <TimelineRow
                label="On-site setup"
                fromIso={job.arrived_at}
                toIso={job.started_at}
                elapsed={setupElapsed}
                warn={setupWarn}
                live={!job.started_at}
              />
              <TimelineRow
                label="Working"
                fromIso={job.started_at}
                toIso={null}
                elapsed={workingElapsed}
                warn={workingWarn}
                live={true}
              />
            </div>
          )}

          {job.customer_phone && (
            <div className="flex gap-2">
              <a href={`tel:${job.customer_phone}`} className="flex-1 rounded-xl bg-green-600 py-3 text-center text-sm font-semibold text-white hover:bg-green-700">
                Call
              </a>
              <a href={`sms:${job.customer_phone}`} className="flex-1 rounded-xl bg-blue-600 py-3 text-center text-sm font-semibold text-white hover:bg-blue-700">
                Text
              </a>
            </div>
          )}

          {job.scope_notes && (
            <div className="rounded-xl bg-gray-50 px-4 py-3 dark:bg-gray-800">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Scope</p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-300">{job.scope_notes}</p>
            </div>
          )}

          {job.quote_context && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-900/20">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">Quote Context</p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-amber-900 dark:text-amber-200">{job.quote_context}</p>
            </div>
          )}

          {showQuote && job.quoted_price_total != null && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-800 dark:bg-emerald-900/20">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Quoted Price</p>
                <p className="text-lg font-semibold text-emerald-700 dark:text-emerald-300">
                  {formatCurrency(job.quoted_price_total)}
                </p>
              </div>
              {job.quote_modifiers && job.quote_modifiers.length > 0 && (
                <div className="mt-3 space-y-2 border-t border-emerald-200 pt-3 dark:border-emerald-800">
                  {job.quote_modifiers.map((modifier, index) => (
                    <div key={`${modifier.note}-${index}`} className="flex items-start justify-between gap-3 text-sm">
                      <span className="text-emerald-900 dark:text-emerald-100">{modifier.note}</span>
                      <span className="font-medium text-emerald-700 dark:text-emerald-300">
                        {formatCurrency(modifier.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Job Photos</p>
              {uploadScreenshot.isError && (
                <p className="text-xs text-red-500">
                  {(uploadScreenshot.error as Error)?.message ?? 'Upload failed'}
                </p>
              )}
            </div>
            <JobPhotoSection
              title={photoLabel('before_job')}
              screenshotType="before_job"
              photos={beforePhotos}
              isUploading={uploadScreenshot.isPending && photoUploadTarget === 'before_job'}
              onUpload={handlePhotoUpload}
            />
            <JobPhotoSection
              title={photoLabel('after_job')}
              screenshotType="after_job"
              photos={afterPhotos}
              isUploading={uploadScreenshot.isPending && photoUploadTarget === 'after_job'}
              onUpload={handlePhotoUpload}
            />
          </div>

          {job.crew.length > 0 && !canAssign && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Crew</p>
              <div className="flex flex-wrap gap-1.5">
                {job.crew.map(name => (
                  <span key={name} className="rounded-full bg-blue-100 px-2.5 py-1 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-200">
                    {name}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Add Job Note</p>
            <div className="flex gap-2">
              <textarea
                value={note}
                onChange={event => setNote(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    submitNote()
                  }
                }}
                placeholder="Flag an issue, scope change, or customer request."
                rows={2}
                className="flex-1 resize-none rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              />
              <button
                onClick={submitNote}
                disabled={!note.trim() || addNote.isPending}
                className="self-end rounded-xl bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
              >
                {addNote.isPending ? '...' : 'Log'}
              </button>
            </div>
            {addNote.isSuccess && <p className="mt-1 text-xs text-green-600 dark:text-green-400">Note logged.</p>}
            {addNote.isError && <p className="mt-1 text-xs text-red-500">Failed to log note.</p>}
          </div>

          {canManageStatus && (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Update Status</p>
              <div className="flex flex-wrap gap-2">
                {PHASES.map(button => {
                  if (button.value === 'completed') return null
                  const isActive = job.job_phase === button.value
                  const isLocked = !isAdmin && isPhaseLockedForNonAdmin(job, button.value)
                  return (
                    <button
                      key={button.value}
                      onClick={() => patchStatus.mutate({ id: job.id, status: button.value })}
                      disabled={patchStatus.isPending || isLocked}
                      title={isLocked ? 'Already passed. Only admins can re-stamp.' : undefined}
                      className={`rounded-xl px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                        isActive
                          ? 'bg-indigo-600 text-white ring-2 ring-indigo-300 dark:ring-indigo-700'
                          : 'bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'
                      }`}
                    >
                      {button.label}
                    </button>
                  )
                })}
              </div>

              {!confirmComplete ? (
                <button
                  onClick={() => setConfirmComplete(true)}
                  disabled={patchStatus.isPending}
                  className="rounded-xl bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-40"
                >
                  Complete
                </button>
              ) : (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-900/20">
                  <p className="text-sm font-medium text-green-800 dark:text-green-200">Mark job complete?</p>
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => setConfirmComplete(false)}
                      className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        setConfirmComplete(false)
                        patchStatus.mutate({ id: job.id, status: 'completed' }, { onSuccess: onClose })
                      }}
                      disabled={patchStatus.isPending}
                      className="rounded-lg bg-green-600 px-3 py-1.5 text-xs text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      Confirm
                    </button>
                  </div>
                </div>
              )}

              {isAdmin && (job.dispatched_at || job.en_route_at || job.arrived_at || job.started_at) && (
                <button
                  onClick={() => patchStatus.mutate({ id: job.id, status: 'reset' })}
                  disabled={patchStatus.isPending}
                  className="text-xs text-red-500 underline hover:text-red-700 disabled:opacity-50 dark:text-red-400 dark:hover:text-red-300"
                >
                  Reset phase timers
                </button>
              )}

              {patchStatus.isError && <p className="text-xs text-red-500">Failed to update status.</p>}
            </div>
          )}

          {canAssign && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Crew</p>
              {jobDate && blockedUsers.length > 0 && (
                <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">
                  Unavailable for this day: {blockedUsers.map(user => user.username).join(', ')}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  defaultValue=""
                  onChange={event => {
                    if (!event.target.value) return
                    addAssignment.mutate({ jobId: job.id, userId: event.target.value })
                    event.target.value = ''
                  }}
                >
                  <option value="" disabled>
                    Add member...
                  </option>
                  {users
                    .filter(user => user.is_active && !job.crew.includes(user.username))
                    .map(user => {
                      const blocked = isUnavailableOnDate(user, jobDate)
                      return (
                        <option key={user.id} value={user.id} disabled={blocked}>
                          {user.username} ({user.role}){blocked ? ' - unavailable' : ''}
                        </option>
                      )
                    })}
                </select>
                {job.crew.map(crewName => {
                  const crewUser = users.find(user => user.username === crewName)
                  const blocked = isUnavailableOnDate(crewUser, jobDate)
                  return (
                    <span
                      key={crewName}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${
                        blocked
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200'
                          : 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200'
                      }`}
                    >
                      {crewName}
                      {blocked && <span className="font-medium">(Unavailable)</span>}
                      <button
                        onClick={() => crewUser && removeAssignment.mutate({ jobId: job.id, userId: crewUser.id })}
                        disabled={!crewUser}
                        className="font-bold leading-none text-blue-400 hover:text-blue-700 disabled:opacity-40 dark:hover:text-blue-100"
                      >
                        x
                      </button>
                    </span>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function JobsScreen() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [jobView, setJobView] = useState<JobView>('scheduled')
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [now, setNow] = useState(Date.now())

  const { data: jobs = [], isLoading } = useJobs()
  const { data: users = [] } = useUsers(user?.role !== 'crew')
  const patchStatus = usePatchJobStatus()
  const addAssignment = useAddJobAssignment()
  const removeAssignment = useRemoveJobAssignment()

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const displayJobs = jobView === 'scheduled'
    ? jobs.filter(job => job.job_phase === null)
    : jobs.filter(job => job.job_phase !== null)
  const jobGroups = groupJobsByDay(displayJobs)

  const inProgressCount = jobs.filter(job => job.job_phase !== null).length
  const showQuote = user?.role === 'admin' || user?.role === 'facilitator'

  const lateJobs = jobs.filter(job => {
    if (job.en_route_at && !job.arrived_at && now - parseUtc(job.en_route_at).getTime() > 90 * 60_000) return true
    if (job.started_at && now - parseUtc(job.started_at).getTime() > 5 * 3_600_000) return true
    return false
  })

  const liveSelectedJob = selectedJob ? jobs.find(job => job.id === selectedJob.id) ?? null : null

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
        <h1 className="text-lg font-bold text-gray-900 dark:text-white">Jobs</h1>
        <div className="flex items-center gap-3">
          {(user?.role === 'admin' || user?.role === 'facilitator') && (
            <button onClick={() => navigate('/')} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" title="Lead Queue">
              Inbox
            </button>
          )}
          <button onClick={() => navigate('/calendar')} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" title="Calendar">
            Calendar
          </button>
          <button onClick={() => navigate('/settings')} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" title="Settings">
            Settings
          </button>
          <span className="text-xs text-gray-500 dark:text-gray-400">{user?.username}</span>
        </div>
      </header>

      {lateJobs.length > 0 && (
        <div className="flex items-center gap-2 bg-red-600 px-4 py-2.5 text-white">
          <p className="text-sm font-medium">
            {lateJobs.length === 1
              ? `${lateJobs[0].customer_name ?? 'A job'} may need attention. Check In Progress.`
              : `${lateJobs.length} jobs may need attention. Check In Progress.`}
          </p>
        </div>
      )}

      <div className="flex border-b bg-white px-4 dark:border-gray-700 dark:bg-gray-800">
        {([
          { key: 'scheduled' as JobView, label: 'Scheduled' },
          { key: 'in_progress' as JobView, label: 'In Progress', badge: inProgressCount },
        ]).map(tab => (
          <button
            key={tab.key}
            onClick={() => setJobView(tab.key)}
            className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              jobView === tab.key
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            {tab.label}
            {tab.badge != null && tab.badge > 0 && (
              <span className={`rounded-full px-1.5 py-0.5 text-xs font-semibold leading-none text-white ${lateJobs.length > 0 ? 'bg-red-500' : 'bg-amber-500'}`}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      <main className="space-y-3 p-4 pb-10">
        {isLoading && <p className="py-10 text-center text-sm text-gray-400 dark:text-gray-500">Loading jobs...</p>}
        {!isLoading && jobGroups.length === 0 && (
          <p className="py-10 text-center text-sm text-gray-400 dark:text-gray-500">
            {jobView === 'scheduled' ? 'No scheduled jobs.' : 'No jobs currently in progress.'}
          </p>
        )}
        {jobGroups.map(group => (
          <section key={group.key} className="space-y-3 pt-1 first:pt-0">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{group.label}</h2>
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {group.jobs.length} {group.jobs.length === 1 ? 'job' : 'jobs'}
              </span>
            </div>
            <div className="space-y-3">
              {group.jobs.map(job => (
                <JobCard key={job.id} job={job} showQuote={showQuote} onClick={() => setSelectedJob(job)} />
              ))}
            </div>
          </section>
        ))}
      </main>

      {liveSelectedJob && (
        <JobModal
          job={liveSelectedJob}
          userRole={user?.role}
          username={user?.username}
          users={users}
          patchStatus={patchStatus}
          addAssignment={addAssignment}
          removeAssignment={removeAssignment}
          onClose={() => setSelectedJob(null)}
          onViewCalendar={job => {
            setSelectedJob(null)
            navigate(`/calendar?date=${job.job_date_requested ?? ''}`)
          }}
        />
      )}
    </div>
  )
}
