import { useEffect, useState, type ChangeEvent } from 'react'
import { buildUploadUrl } from '../services/api'
import { buildConfirmationText } from '../utils/confirmationText'
import { useNavigate } from 'react-router-dom'
import { UseMutationResult } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { BottomNav } from '../components/BottomNav'
import { CrewAgenda } from '../components/CrewAgenda'
import { JobChecklist } from '../components/JobChecklist'
import { CitySwitcher } from '../components/CitySwitcher'
import { Segmented } from '../components/Segmented'
import { useCity } from '../context/CityContext'
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
import { fmtDurationMinutes, fmtTimeSlot, parseUtc, fmtLocalTime, fmtLocalDateTime } from '../utils/time'

const MAPS_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY ||
  import.meta.env.VITE_GOOGLE_MAPS_KEY) as string | undefined

type JobView = 'scheduled' | 'in_progress' | 'completed'
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
  if (level === 'red') return 'text-danger'
  if (level === 'orange') return 'text-[#b86e00] dark:text-ac'
  return 'text-mu'
}

/** A timer flag turns amber, then red, as a phase runs long. */
function flagTone(level: 'red' | 'orange' | 'normal') {
  if (level === 'red') return 'wd-flag-red'
  if (level === 'orange') return 'wd-flag-amber'
  return ''
}

const ICON = {
  back: 'M15.75 19.5 8.25 12l7.5-7.5',
  check: 'm4.5 12.75 6 6 9-13.5',
  camera: 'M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316ZM16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z',
}

function Icon({ d }: { d: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>
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

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

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
  showCity,
  onClick,
}: {
  job: Job
  showQuote: boolean
  showCity: boolean
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
      return <span className={`wd-flag ${flagTone(workingWarn)}`}>Working {workingElapsed}</span>
    }
    if (job.job_phase === 'arrived' && setupElapsed) {
      return <span className="wd-flag">On site {setupElapsed}</span>
    }
    if (job.job_phase === 'en_route' && travelElapsed) {
      return <span className={`wd-flag ${flagTone(travelWarn)}`}>En route {travelElapsed}</span>
    }
    if (job.job_phase === 'dispatched' && dispatchElapsed) {
      return <span className="wd-flag !bg-ln !text-ink">Dispatch {dispatchElapsed}</span>
    }
    return null
  })()

  return (
    <button type="button" onClick={onClick} className="wd-card">
      <span className="flex w-full items-start justify-between gap-2">
        <span className="wd-disp min-w-0 text-[19px] leading-tight">
          {job.customer_name ?? <i className="font-normal normal-case text-mu">Unnamed</i>}
        </span>
        {job.crew.length > 0 && (
          <span className="max-w-[45%] shrink-0 truncate text-right text-xs text-mu">{job.crew.join(', ')}</span>
        )}
      </span>
      <span className="text-[13px] capitalize text-mu">{job.service_type}</span>
      {mapTarget && <span className="truncate text-[13px] text-mu">{mapTarget}</span>}
      {fmtJobSchedule(job) && <span className="text-[13px] text-mu">{fmtJobSchedule(job)}</span>}
      {job.estimated_job_duration_minutes != null && (
        <span className="text-[13px] text-mu">Est. {fmtDurationMinutes(job.estimated_job_duration_minutes)}</span>
      )}
      {showQuote && job.quoted_price_total != null && (
        <span className="text-sm font-semibold text-ok">Quoted {formatCurrency(job.quoted_price_total)}</span>
      )}
      {(badge || (showCity && job.city_name)) && (
        <span className="mt-1 flex flex-wrap gap-1.5">
          {badge}
          {showCity && job.city_name && <span className="wd-flag !bg-ln !text-ink">{job.city_name}</span>}
        </span>
      )}
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
    <div className={`flex flex-wrap items-baseline gap-1.5 text-sm ${live ? timerColor(warn) : 'text-mu'}`}>
      <span className="font-medium">{label}</span>
      {live ? (
        <>
          <span className="font-bold">{elapsed ?? '…'}</span>
          <span className="text-xs text-mu">since {fmtTime(fromIso)}</span>
        </>
      ) : (
        <>
          <span className="font-semibold text-ink">{toIso ? fmtDuration(fromIso, toIso) : elapsed ?? '…'}</span>
          <span className="text-xs">
            {fmtTime(fromIso)} – {fmtTime(toIso)}
          </span>
        </>
      )}
    </div>
  )
}

function PhotoSlot({
  type,
  photos,
  isUploading,
  onUpload,
}: {
  type: JobPhotoType
  photos: Screenshot[]
  isUploading: boolean
  onUpload: (type: JobPhotoType, event: ChangeEvent<HTMLInputElement>) => void
}) {
  const label = type === 'before_job' ? 'Before' : 'After'
  const got = photos.length > 0
  return (
    <div className="flex flex-col gap-2">
      <label className={`wd-ph-slot cursor-pointer ${got ? 'got' : ''}`}>
        <Icon d={got ? ICON.check : ICON.camera} />
        <span className="wd-label !text-current">{label}</span>
        <span>
          {isUploading ? 'Uploading…' : got ? `${photos.length} photo${photos.length === 1 ? '' : 's'} · add more` : type === 'before_job' ? 'Add a before photo' : 'Add an after photo'}
        </span>
        <input
          type="file"
          accept="image/*"
          className="hidden"
          disabled={isUploading}
          aria-label={`Add ${label.toLowerCase()} photo`}
          onChange={event => onUpload(type, event)}
        />
      </label>
      {got && (
        <div className="grid grid-cols-2 gap-2">
          {photos.map(photo => (
            <a key={photo.id} href={buildUploadUrl(photo.stored_path)} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-chip">
              <img src={buildUploadUrl(photo.stored_path)} alt={`${label} photo ${photo.original_filename}`} className="h-24 w-full object-cover" />
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

/** The crew-facing stepper, Dispatched → Done. */
const STEPS: { value: PhaseValue; label: string }[] = [
  { value: 'dispatched', label: 'Dispatched' },
  { value: 'en_route', label: 'En route' },
  { value: 'arrived', label: 'On site' },
  { value: 'started', label: 'Working' },
  { value: 'completed', label: 'Done' },
]

/** What the one big button does next, from where the job is now. */
const NEXT: Record<'none' | NonNullable<Job['job_phase']>, { status: PhaseValue; label: string }> = {
  none: { status: 'dispatched', label: 'Dispatch' },
  dispatched: { status: 'en_route', label: 'Start driving' },
  en_route: { status: 'arrived', label: "I've arrived" },
  arrived: { status: 'started', label: 'Start work' },
  started: { status: 'completed', label: 'Finish job' },
}

interface JobDetailProps {
  job: Job
  userRole: string | undefined
  username: string | undefined
  users: TeamMember[]
  patchStatus: UseMutationResult<Job, Error, { id: string; status: string }>
  addAssignment: UseMutationResult<Job, Error, { jobId: string; userId: string }>
  removeAssignment: UseMutationResult<Job, Error, { jobId: string; userId: string }>
  onClose: () => void
  onViewCalendar: (job: Job) => void
  onViewLead: () => void
}

function JobDetail({
  job,
  userRole,
  username,
  users,
  patchStatus,
  addAssignment,
  removeAssignment,
  onClose,
  onViewCalendar,
  onViewLead,
}: JobDetailProps) {
  const [confirmComplete, setConfirmComplete] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [note, setNote] = useState('')
  const [streetViewFailed, setStreetViewFailed] = useState(false)
  const [photoUploadTarget, setPhotoUploadTarget] = useState<JobPhotoType | null>(null)
  const [confirmationCopied, setConfirmationCopied] = useState(false)
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
  const cityUsers = users.filter(user => user.city_id === job.city_id)
  const blockedUsers = cityUsers.filter(user => user.is_active && isUnavailableOnDate(user, jobDate))
  const beforePhotos = (leadDetail?.screenshots ?? []).filter(photo => photo.screenshot_type === 'before_job')
  const afterPhotos = (leadDetail?.screenshots ?? []).filter(photo => photo.screenshot_type === 'after_job')

  const currentStep = job.job_phase ? STEPS.findIndex(s => s.value === job.job_phase) : -1
  const next = NEXT[job.job_phase ?? 'none']
  const title = job.customer_name ?? 'Unnamed customer'

  const close = () => {
    if (leaving) return
    setLeaving(true)
    setTimeout(onClose, 280)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  })

  useEffect(() => {
    setStreetViewFailed(false)
  }, [streetView, job.id])

  const submitNote = () => {
    const body = note.trim()
    if (!body) return
    addNote.mutate({ leadId: job.id, note: body, actor: username }, { onSuccess: () => setNote('') })
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

  const goNext = () => {
    if (next.status === 'completed') {
      setConfirmComplete(true)
      return
    }
    patchStatus.mutate({ id: job.id, status: next.status })
  }

  return (
    <div className={`wd-jd ${leaving ? 'out' : ''}`} role="dialog" aria-label={title}>
      <header className="wd-hdr shrink-0 !pl-2">
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={close} className="wd-ib" aria-label="Back to jobs">
            <Icon d={ICON.back} />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="wd-disp truncate text-[26px] leading-none">{title}</h2>
            <p className="wd-h-s truncate capitalize">
              {[job.service_type, job.appointment_time_slot ? fmtTimeSlot(job.appointment_time_slot) : null].filter(Boolean).join(' · ')}
            </p>
          </div>
          {job.job_phase && <span className="wd-st wd-st-green shrink-0">{STEPS[currentStep]?.label}</span>}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="wd-pane mx-auto flex w-full max-w-3xl flex-col gap-3 px-3.5 pb-6 pt-3.5">
          <section className="wd-box">
            <ol className="wd-steps" aria-label="Job progress">
              {STEPS.map((step, i) => {
                const done = i < currentStep
                const cur = i === currentStep
                return (
                  <li key={step.value} className={`wd-stp ${done ? 'done' : cur ? 'cur' : ''}`} aria-current={cur ? 'step' : undefined}>
                    <i aria-hidden="true">{done ? '✓' : i + 1}</i>
                    <span>{step.label}</span>
                  </li>
                )
              })}
            </ol>
            {canManageStatus && !confirmComplete && (
              <button type="button" onClick={goNext} disabled={patchStatus.isPending} className="wd-btn mt-4 w-full">
                {patchStatus.isPending ? 'Saving…' : next.label}
              </button>
            )}
            {canManageStatus && confirmComplete && (
              <div className="mt-4 rounded-card bg-tint p-3">
                <p className="text-sm font-semibold">Mark job complete?</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => setConfirmComplete(false)} className="wd-btn wd-btn-ghost flex-1">
                    Not yet
                  </button>
                  <button
                    type="button"
                    onClick={() => patchStatus.mutate({ id: job.id, status: 'completed' }, { onSuccess: close, onSettled: () => setConfirmComplete(false) })}
                    disabled={patchStatus.isPending}
                    className="wd-btn flex-1"
                  >
                    {patchStatus.isPending ? 'Saving…' : "Yes, it's done"}
                  </button>
                </div>
              </div>
            )}
            {patchStatus.isError && <p className="wd-err mt-2">Couldn't update the job. Try again.</p>}
            {!canManageStatus && (
              <p className="wd-hint">Your supervisor moves the job along as you go.</p>
            )}
            {(job.dispatched_at || job.en_route_at || job.arrived_at || job.started_at) && (
              <div className="mt-3 space-y-1.5 border-t pt-3">
                <TimelineRow label="Dispatch wait" fromIso={job.dispatched_at} toIso={job.en_route_at} elapsed={dispatchElapsed} warn="normal" live={!job.en_route_at} />
                <TimelineRow label="Travel" fromIso={job.en_route_at} toIso={job.arrived_at} elapsed={travelElapsed} warn={travelWarn} live={!job.arrived_at} />
                <TimelineRow label="On-site setup" fromIso={job.arrived_at} toIso={job.started_at} elapsed={setupElapsed} warn={setupWarn} live={!job.started_at} />
                <TimelineRow label="Working" fromIso={job.started_at} toIso={null} elapsed={workingElapsed} warn={workingWarn} live={true} />
              </div>
            )}
          </section>

          {mapTarget && (
            <section className="wd-box wd-box-soft overflow-hidden !p-0">
              {streetView && !streetViewFailed && (
                <img
                  src={streetView}
                  alt={`Street view for ${mapTarget}`}
                  className="h-44 w-full object-cover"
                  onError={() => setStreetViewFailed(true)}
                />
              )}
              <div className="flex items-center gap-3 px-3.5 py-3">
                <p className="min-w-0 flex-1 text-sm font-medium">{mapTarget}</p>
                {navUrl && (
                  <a href={navUrl} target="_blank" rel="noopener noreferrer" className="wd-btn-sm shrink-0">
                    Navigate
                  </a>
                )}
              </div>
            </section>
          )}

          {job.customer_phone && (
            <div className="wd-call">
              <a href={`tel:${job.customer_phone}`} className="wd-btn">Call</a>
              <a href={`sms:${job.customer_phone}`} className="wd-btn wd-btn-ghost">Text</a>
            </div>
          )}

          {job.scope_notes && (
            <section className="wd-box wd-heads">
              <div className="haz h-2" aria-hidden="true" />
              <div>
                <p className="wd-fl !mb-1">Heads up</p>
                {job.scope_notes}
              </div>
            </section>
          )}

          {job.quote_context && (
            <section className="wd-box wd-box-soft !shadow-[inset_0_0_0_1.5px_var(--ac)]">
              <p className="wd-fl">Quote context</p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{job.quote_context}</p>
            </section>
          )}

          {showQuote && job.quoted_price_total != null && (
            <section className="wd-box wd-box-soft">
              <div className="flex items-center justify-between gap-3">
                <p className="wd-fl !mb-0">Quoted price</p>
                <p className="wd-disp text-[22px] text-ok">{formatCurrency(job.quoted_price_total)}</p>
              </div>
              {job.quote_modifiers && job.quote_modifiers.length > 0 && (
                <div className="mt-2 space-y-1.5 border-t pt-2">
                  {job.quote_modifiers.map((modifier, index) => (
                    <div key={`${modifier.note}-${index}`} className="flex items-start justify-between gap-3 text-sm">
                      <span>{modifier.note}</span>
                      <span className="font-semibold tabular-nums">{formatCurrency(modifier.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
              {leadDetail && (
                <button
                  type="button"
                  onClick={() => {
                    const text = buildConfirmationText(leadDetail, job.quoted_price_total!)
                    navigator.clipboard.writeText(text).then(() => {
                      setConfirmationCopied(true)
                      setTimeout(() => setConfirmationCopied(false), 2500)
                    })
                  }}
                  className="wd-btn-sm wd-btn-ghost mt-3"
                >
                  {confirmationCopied ? 'Copied' : 'Copy confirmation'}
                </button>
              )}
            </section>
          )}

          <section className="wd-box wd-box-soft">
            <JobChecklist leadId={job.id} />
          </section>

          <section className="wd-box wd-box-soft">
            <p className="wd-fl">Before &amp; after photos</p>
            <div className="grid grid-cols-2 gap-2">
              <PhotoSlot type="before_job" photos={beforePhotos} isUploading={uploadScreenshot.isPending && photoUploadTarget === 'before_job'} onUpload={handlePhotoUpload} />
              <PhotoSlot type="after_job" photos={afterPhotos} isUploading={uploadScreenshot.isPending && photoUploadTarget === 'after_job'} onUpload={handlePhotoUpload} />
            </div>
            {uploadScreenshot.isError && (
              <p className="wd-err mt-2">{(uploadScreenshot.error as Error)?.message ?? 'Upload failed'}</p>
            )}
          </section>

          {job.crew.length > 0 && !canAssign && (
            <section className="wd-box wd-box-soft">
              <p className="wd-fl">Crew</p>
              <div className="flex flex-wrap gap-1.5">
                {job.crew.map(name => <span key={name} className="wd-flag">{name}</span>)}
              </div>
            </section>
          )}

          {canAssign && (
            <section className="wd-box wd-box-soft">
              <p className="wd-fl">Crew</p>
              {jobDate && blockedUsers.length > 0 && (
                <p className="mb-2 text-xs font-semibold text-[#b86e00] dark:text-ac">
                  Unavailable for this day: {blockedUsers.map(user => user.username).join(', ')}
                </p>
              )}
              <select
                className="wd-input"
                aria-label="Add crew member"
                defaultValue=""
                onChange={event => {
                  if (!event.target.value) return
                  addAssignment.mutate({ jobId: job.id, userId: event.target.value })
                  event.target.value = ''
                }}
              >
                <option value="" disabled>Add member…</option>
                {cityUsers
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
              {job.crew.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {job.crew.map(crewName => {
                    const crewUser = users.find(user => user.username === crewName)
                    const blocked = isUnavailableOnDate(crewUser, jobDate)
                    return (
                      <span key={crewName} className={`inline-flex items-center gap-1 rounded-chip pl-3 text-sm font-semibold ${blocked ? 'bg-bg shadow-[inset_0_0_0_1.5px_var(--ac)]' : 'bg-tint text-ok'}`}>
                        {crewName}
                        {blocked && <span className="text-xs font-normal">(unavailable)</span>}
                        <button
                          type="button"
                          onClick={() => crewUser && removeAssignment.mutate({ jobId: job.id, userId: crewUser.id })}
                          disabled={!crewUser}
                          aria-label={`Remove ${crewName}`}
                          className="flex h-11 w-11 items-center justify-center disabled:opacity-40"
                        >
                          ✕
                        </button>
                      </span>
                    )
                  })}
                </div>
              )}
              {(addAssignment.isError || removeAssignment.isError) && <p className="wd-err mt-2">Couldn't change the crew. Try again.</p>}
            </section>
          )}

          <section className="wd-box wd-box-soft">
            <label htmlFor="job-note" className="wd-fl">Add job note</label>
            <div className="flex gap-2">
              <input
                id="job-note"
                value={note}
                onChange={event => setNote(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter') submitNote() }}
                placeholder="Flag an issue, scope change, or request."
                className="wd-input min-w-0 flex-1"
              />
              <button onClick={submitNote} disabled={!note.trim() || addNote.isPending} className="wd-btn shrink-0">
                {addNote.isPending ? 'Saving…' : 'Log'}
              </button>
            </div>
            {addNote.isSuccess && <p className="wd-hint !text-ok font-semibold">Note logged.</p>}
            {addNote.isError && <p className="wd-err mt-1.5">Couldn't log the note. Try again.</p>}
          </section>

          {canManageStatus && (
            <details className="wd-box wd-box-soft group">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm font-semibold">
                Set a phase by hand
                <span className="text-mu transition-transform group-open:rotate-180" aria-hidden="true">⌄</span>
              </summary>
              <div className="mt-2 flex flex-wrap gap-2">
                {PHASES.map(button => {
                  if (button.value === 'completed') return null
                  const isActive = job.job_phase === button.value
                  const isLocked = !isAdmin && isPhaseLockedForNonAdmin(job, button.value)
                  return (
                    <button
                      key={button.value}
                      onClick={() => patchStatus.mutate({ id: job.id, status: button.value })}
                      disabled={patchStatus.isPending || isLocked}
                      aria-pressed={isActive}
                      className={isActive ? 'wd-btn-sm !bg-ink !text-bg' : 'wd-btn-sm wd-btn-ghost !shadow-[inset_0_0_0_1.5px_var(--ln)]'}
                    >
                      {button.label}
                    </button>
                  )
                })}
              </div>
              {!isAdmin && <p className="wd-hint">Phases already passed can only be re-stamped by an admin.</p>}
              {isAdmin && (job.dispatched_at || job.en_route_at || job.arrived_at || job.started_at) && (
                <button
                  onClick={() => patchStatus.mutate({ id: job.id, status: 'reset' })}
                  disabled={patchStatus.isPending}
                  className="wd-btn-sm wd-btn-ghost mt-3 !text-danger !shadow-[inset_0_0_0_1.5px_var(--red)]"
                >
                  Reset phase timers
                </button>
              )}
            </details>
          )}

          <div className="flex flex-wrap gap-2">
            {job.job_date_requested && (
              <button type="button" onClick={() => onViewCalendar(job)} className="wd-btn-sm wd-btn-ghost">
                View in calendar
              </button>
            )}
            {userRole !== 'crew' && (
              <button type="button" onClick={onViewLead} className="wd-btn-sm wd-btn-ghost">
                View lead
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function JobsScreen() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { isAllCities } = useCity()
  const [jobView, setJobView] = useState<JobView>('scheduled')
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [now, setNow] = useState(Date.now())

  const { data: jobs = [], isLoading } = useJobs()
  const { data: completedJobs = [] } = useJobs('completed')
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
  const today = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="wd-hdr flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="wd-disp text-[26px] leading-none">Jobs</h1>
          <p className="wd-h-s truncate">{today}{user?.username ? ` · ${user.username}` : ''}</p>
        </div>
        {user?.role === 'admin' && <CitySwitcher variant="pill" />}
      </header>

      {user?.role === 'crew' ? (
        <CrewAgenda
          jobs={jobs}
          completedJobs={completedJobs}
          isLoading={isLoading}
          onOpenJob={setSelectedJob}
        />
      ) : (
        <div className="mx-auto max-w-3xl">
          <div className="px-3.5 pt-4">
            <Segmented
              options={[
                { key: 'scheduled', label: 'Scheduled' },
                { key: 'in_progress', label: 'In progress', badge: inProgressCount },
                { key: 'completed', label: 'Completed' },
              ]}
              value={jobView}
              onChange={setJobView}
            />
          </div>

          <main key={jobView} className="wd-pane flex flex-col gap-3 px-3.5 pb-6 pt-4">
            {lateJobs.length > 0 && (
              <div className="wd-box wd-warn" role="alert">
                <div className="haz h-2" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold">
                    {lateJobs.length === 1
                      ? `${lateJobs[0].customer_name ?? 'A job'} may need attention. Check In progress.`
                      : `${lateJobs.length} jobs may need attention. Check In progress.`}
                  </p>
                </div>
              </div>
            )}

            {jobView !== 'completed' && (
              <>
                {isLoading && <p className="py-10 text-center text-sm text-mu">Loading jobs…</p>}
                {!isLoading && jobGroups.length === 0 && (
                  <p className="py-10 text-center text-sm text-mu">
                    {jobView === 'scheduled' ? 'No scheduled jobs.' : 'No jobs in progress right now.'}
                  </p>
                )}
                {jobGroups.map(group => (
                  <section key={group.key} className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-3 px-0.5 pt-1">
                      <h2 className="wd-label">{group.label}</h2>
                      <span className="text-xs text-mu">
                        {group.jobs.length} {group.jobs.length === 1 ? 'job' : 'jobs'}
                      </span>
                    </div>
                    {group.jobs.map(job => (
                      <JobCard key={job.id} job={job} showQuote={showQuote} showCity={isAllCities} onClick={() => setSelectedJob(job)} />
                    ))}
                  </section>
                ))}
              </>
            )}

            {jobView === 'completed' && (
              <>
                <p className="px-1 text-sm text-mu">
                  {completedJobs.length} completed · {fmtMoney(completedJobs.reduce((sum, j) => sum + (j.realized_revenue_cents ?? 0), 0) / 100)} realized
                </p>
                {completedJobs.length === 0 ? (
                  <p className="py-10 text-center text-sm text-mu">No completed jobs yet.</p>
                ) : (
                  completedJobs.map(job => (
                    <button key={job.id} type="button" onClick={() => navigate(`/leads/${job.id}`)} className="wd-card">
                      <span className="flex w-full items-start justify-between gap-2">
                        <span className="wd-disp min-w-0 text-[19px] leading-tight">
                          {job.customer_name ?? <i className="font-normal normal-case text-mu">Unnamed</i>}
                        </span>
                        {isAllCities && job.city_name && <span className="wd-flag !bg-ln !text-ink">{job.city_name}</span>}
                      </span>
                      <span className="text-[13px] capitalize text-mu">{job.service_type}</span>
                      {job.crew.length > 0 && <span className="text-[13px] text-mu">Crew: {job.crew.join(', ')}</span>}
                      {job.arrived_at && job.started_at && (
                        <span className="text-[13px] text-mu">On-site: {fmtDuration(job.arrived_at, job.started_at)}</span>
                      )}
                      {job.completed_at && (
                        <span className="text-[13px] text-mu">Completed {fmtLocalDateTime(job.completed_at)}</span>
                      )}
                      <span className="mt-1 flex flex-wrap gap-3 text-sm">
                        {job.quoted_price_total != null && <span className="text-mu">Quoted {fmtMoney(job.quoted_price_total)}</span>}
                        <span className={job.realized_revenue_cents != null ? 'font-semibold text-ok' : 'text-mu'}>
                          Realized {job.realized_revenue_cents != null ? fmtMoney(job.realized_revenue_cents / 100) : '—'}
                        </span>
                      </span>
                    </button>
                  ))
                )}
              </>
            )}
          </main>
        </div>
      )}

      {liveSelectedJob && (
        <JobDetail
          key={liveSelectedJob.id}
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
          onViewLead={() => {
            setSelectedJob(null)
            navigate(`/leads/${liveSelectedJob.id}`)
          }}
        />
      )}
      <BottomNav />
    </div>
  )
}
