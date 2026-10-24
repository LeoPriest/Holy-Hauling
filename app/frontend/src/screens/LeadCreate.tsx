import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DateOptionsEditor } from '../components/DateOptionsEditor'
import { Switch } from '../components/Switch'
import { Logo } from '../components/Logo'
import { useAuth } from '../context/AuthContext'
import { useCity } from '../context/CityContext'
import { useCreateLead, useIngestScreenshot, usePatchLead } from '../hooks/useLeads'
import { triggerAiReview } from '../services/api'
import type { AiReview, IngestResult, LeadCreate as LeadCreateBody, LeadSourceType, LeadUpdate, OcrField, ServiceType } from '../types/lead'
import { mergeDateOptions } from '../utils/dateOptions'
import { leadTown } from '../utils/leadCard'

// Workday new-lead flow: one full screen that walks
// choose → reading → review (or upload failed) → "In the queue",
// with manual entry as the other door in.

type Mode = 'select' | 'screenshot' | 'manual'
type Step = 'choose' | 'reading' | 'error' | 'review' | 'manual'

interface Props {
  onClose: () => void
  initialMode?: Mode
}

const SCREENSHOT_SOURCES: { value: LeadSourceType; label: string }[] = [
  { value: 'thumbtack_screenshot', label: 'Thumbtack' },
  { value: 'yelp_screenshot', label: 'Yelp' },
  { value: 'google_screenshot', label: 'Google' },
]

const MANUAL_SOURCES: { value: LeadSourceType; label: string }[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'website_form', label: 'Website form' },
  { value: 'thumbtack_api', label: 'Thumbtack' },
]

const SERVICES: { value: ServiceType; label: string }[] = [
  { value: 'moving', label: 'Moving' },
  { value: 'hauling', label: 'Hauling' },
  { value: 'both', label: 'Both' },
  { value: 'unknown', label: 'Unknown' },
]

/** The backend caps one read at five shots (each is a paid vision call). */
const MAX_SHOTS = 5

/**
 * The fields the backend may auto-apply, and so the only ones the shots can
 * disagree on. Form fields are set in their own input; the rest get their own
 * row here and are written straight to the lead.
 */
const FIELD_META: Record<string, { label: string; short: string; kind: 'form' | 'money' | 'count'; column?: string }> = {
  customer_name: { label: 'Customer name', short: 'name', kind: 'form' },
  customer_phone: { label: 'Phone', short: 'phone', kind: 'form' },
  job_location: { label: 'Location', short: 'location', kind: 'form' },
  service_type: { label: 'Service', short: 'service', kind: 'form' },
  lead_cost_total: { label: 'Lead cost', short: 'lead cost', kind: 'money', column: 'lead_cost_cents' },
  lead_cost_gross: { label: 'Direct lead cost', short: 'direct lead cost', kind: 'money', column: 'lead_cost_gross_cents' },
  lead_cost_bonus: { label: 'Bonus', short: 'bonus', kind: 'money', column: 'lead_cost_bonus_cents' },
  pros_contacted: { label: 'Pros contacted', short: 'pros contacted', kind: 'count', column: 'pros_contacted' },
  pros_responded: { label: 'Pros responded', short: 'pros responded', kind: 'count', column: 'pros_responded' },
}

type Shot = { id: string; file: File; url: string }

type ReviewForm = {
  customer_name: string
  customer_phone: string
  job_location: string
  move_date_options: string[]
  job_date_requested: string
  service_type: ServiceType
  urgency_flag: boolean
  notes: string
}

function parseFields(raw: string | null | undefined): OcrField[] {
  if (!raw) return []
  try {
    return JSON.parse(raw) as OcrField[]
  } catch {
    return []
  }
}

function parseAllFields(extractions: IngestResult['extractions']): Record<string, string> {
  // Several shots of one lead each contribute fields. Where two shots offer
  // different values for the same field, suggest neither — the same rule the
  // backend applies to auto-writes, so the form never quietly picks a winner.
  const seen: Record<string, Set<string>> = {}
  for (const extraction of extractions ?? []) {
    for (const f of parseFields(extraction?.extracted_fields)) (seen[f.field] ??= new Set()).add(f.value)
  }
  return Object.fromEntries(
    Object.entries(seen)
      .filter(([, values]) => values.size === 1)
      .map(([field, values]) => [field, [...values][0]]),
  )
}

/** What each shot read for one field: [{ value, shot }], one entry per distinct value. */
function shotValues(result: IngestResult, field: string): { value: string; shot: number }[] {
  const out: { value: string; shot: number }[] = []
  result.extractions.forEach((extraction, i) => {
    const hit = parseFields(extraction.extracted_fields).find(f => f.field === field)
    if (hit && !out.some(o => o.value === hit.value)) out.push({ value: hit.value, shot: i + 1 })
  })
  return out
}

function moneyValue(raw: string): string {
  const n = Number(raw.replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) && raw.trim() ? n.toFixed(2) : raw
}

const ICON = {
  x: 'M6 18 18 6M6 6l12 12',
  camera: 'M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316ZM16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z',
  plus: 'M12 4.5v15m7.5-7.5h-15',
  check: 'm4.5 12.75 6 6 9-13.5',
  warn: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z',
}

function Icon({ d }: { d: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>
}

function Seg({ value, onChange, label, need, read = false }: { value: ServiceType; onChange: (v: ServiceType) => void; label: string; need?: boolean; read?: boolean }) {
  return (
    <div className={`wd-f ${need ? 'need' : ''}`}>
      <span className="wd-fl2" id={`${label}-seg`}>Service<Tag on={read} /></span>
      <div className="wd-sg" role="group" aria-labelledby={`${label}-seg`}>
        {SERVICES.map(s => (
          <button key={s.value} type="button" aria-pressed={value === s.value} onClick={() => onChange(s.value)}>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function Tag({ on }: { on: boolean }) {
  return on ? <span className="wd-rtag">Read</span> : null
}

export function LeadCreate({ onClose, initialMode = 'select' }: Props) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { cities, requiredCityId } = useCity()
  const [step, setStep] = useState<Step>(initialMode === 'manual' ? 'manual' : 'choose')
  const [selectedCityId, setSelectedCityId] = useState(requiredCityId)
  const cityId = selectedCityId || requiredCityId
  const cityName = cities.find(c => c.id === cityId)?.name ?? user?.city_name ?? ''

  // ── choose ──
  const [source, setSource] = useState<LeadSourceType>('thumbtack_screenshot')
  const [shots, setShots] = useState<Shot[]>([])
  const [tooMany, setTooMany] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const sourceLabel = SCREENSHOT_SOURCES.find(s => s.value === source)?.label ?? 'screenshot'

  // ── reading ──
  const [readStep, setReadStep] = useState(0)
  const ingest = useIngestScreenshot()

  // ── review ──
  const [result, setResult] = useState<IngestResult | null>(null)
  const [aiReview, setAiReview] = useState<AiReview | 'failed' | null>(null)
  const [extracted, setExtracted] = useState<Record<string, string>>({})
  const [review, setReview] = useState<ReviewForm>({
    customer_name: '', customer_phone: '', job_location: '', move_date_options: [],
    job_date_requested: '', service_type: 'unknown', urgency_flag: false, notes: '',
  })
  const [extras, setExtras] = useState<Record<string, string>>({})
  const [reviewError, setReviewError] = useState<string | null>(null)
  const { mutate: patchLead, isPending: patching } = usePatchLead()

  // ── manual ──
  const [manual, setManual] = useState<LeadCreateBody>({ source_type: 'manual', customer_name: '', service_type: 'unknown', urgency_flag: false })
  const [manualError, setManualError] = useState<string | null>(null)
  const { mutate: createLead, isPending: creating } = useCreateLead()

  // ── done ──
  const [done, setDone] = useState<{ id: string; line: string } | null>(null)
  // Where to go once the burnout-out finishes on the "In the queue" screen.
  const [leaveTo, setLeaveTo] = useState<string | null>(null)
  const [shake, setShake] = useState(0)

  const canClose = step !== 'reading' && !patching && !creating

  useEffect(() => {
    if (!selectedCityId && requiredCityId) setSelectedCityId(requiredCityId)
  }, [requiredCityId, selectedCityId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && canClose && !done) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canClose, done, onClose])

  // Thumbnails are object URLs; give them back when they go.
  const shotsRef = useRef(shots)
  shotsRef.current = shots
  useEffect(() => () => shotsRef.current.forEach(s => URL.revokeObjectURL(s.url)), [])

  function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list).filter(f => /^image\/(jpeg|png|webp)$/.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name))
    setShots(prev => {
      const room = MAX_SHOTS - prev.length
      setTooMany(incoming.length > room)
      return [...prev, ...incoming.slice(0, Math.max(0, room)).map(file => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, file, url: URL.createObjectURL(file),
      }))]
    })
  }

  function removeShot(id: string) {
    setTooMany(false)
    setShots(prev => {
      const gone = prev.find(s => s.id === id)
      if (gone) URL.revokeObjectURL(gone.url)
      return prev.filter(s => s.id !== id)
    })
  }

  async function read() {
    if (!shots.length) return
    setStep('reading')
    setReadStep(0)
    // fetch can't report upload progress; the server reads the shots straight
    // after they land, so move to "Reading" once the upload has had a moment.
    const moveOn = setTimeout(() => setReadStep(s => Math.max(s, 1)), 1200)
    let got: IngestResult
    try {
      got = await ingest.mutateAsync({ file: shots.map(s => s.file), sourceType: source, cityId })
    } catch {
      clearTimeout(moveOn)
      setStep('error')
      return
    }
    clearTimeout(moveOn)
    setReadStep(2)
    let reviewed: AiReview | 'failed'
    try {
      reviewed = await triggerAiReview(got.lead.id, user?.username)
    } catch {
      // The lead is in; the review can be re-run from the lead screen.
      reviewed = 'failed'
    }
    const fields = parseAllFields(got.extractions)
    setExtracted(fields)
    setResult(got)
    setAiReview(reviewed)
    setReview({
      customer_name: got.lead.customer_name ?? fields['customer_name'] ?? '',
      customer_phone: got.lead.customer_phone ?? fields['customer_phone'] ?? '',
      job_location: got.lead.job_location ?? fields['job_location'] ?? '',
      move_date_options: mergeDateOptions(got.lead.move_date_options ?? [], fields['move_date_options'], fields['job_date_requested']),
      job_date_requested: got.lead.job_date_requested ?? '',
      service_type: got.lead.service_type !== 'unknown' ? got.lead.service_type : ((fields['service_type'] as ServiceType) ?? 'unknown'),
      urgency_flag: false,
      notes: got.lead.notes ?? fields['notes'] ?? '',
    })
    setExtras({})
    setReviewError(null)
    setStep('review')
  }

  const setR = <K extends keyof ReviewForm>(field: K, value: ReviewForm[K]) => setReview(r => ({ ...r, [field]: value }))

  const conflicts = (result?.conflicts ?? []).filter(f => FIELD_META[f])
  const isSet = (field: string) => {
    const meta = FIELD_META[field]
    if (meta.kind !== 'form') return (extras[field] ?? '').trim() !== '' && Number.isFinite(Number(extras[field]))
    if (field === 'service_type') return review.service_type !== 'unknown'
    return (review[field as keyof ReviewForm] as string).trim() !== ''
  }

  function refuse(message: string) {
    setReviewError(message)
    setShake(n => n + 1)
  }

  function addToQueue() {
    if (!result) return
    if (!review.customer_name.trim()) return refuse('Customer name is required before adding to the queue.')
    const open = conflicts.find(f => !isSet(f))
    if (open) return refuse(`Set the ${FIELD_META[open].short}. The screenshots disagreed on it.`)
    setReviewError(null)
    const data: Record<string, unknown> = {
      customer_name: review.customer_name.trim(),
      customer_phone: review.customer_phone.trim() || undefined,
      job_location: review.job_location.trim() || undefined,
      move_date_options: review.move_date_options.length > 0 ? review.move_date_options : undefined,
      job_date_requested: review.job_date_requested || undefined,
      service_type: review.service_type,
      urgency_flag: review.urgency_flag,
      notes: review.notes.trim() || undefined,
    }
    for (const field of conflicts) {
      const meta = FIELD_META[field]
      if (meta.kind === 'money') data[meta.column!] = Math.round(Number(extras[field]) * 100)
      if (meta.kind === 'count') data[meta.column!] = Math.round(Number(extras[field]))
    }
    patchLead(
      { id: result.lead.id, data: data as LeadUpdate },
      {
        onSuccess: () => finish(result.lead.id, review.customer_name, review.service_type, review.job_location),
        onError: () => refuse("Couldn't save the lead. Try again."),
      },
    )
  }

  function createManual() {
    if (!manual.customer_name.trim()) {
      setManualError('Customer name is required.')
      setShake(n => n + 1)
      return
    }
    setManualError(null)
    createLead(
      { ...manual, customer_name: manual.customer_name.trim(), city_id: cityId },
      {
        onSuccess: created => finish(created.id, manual.customer_name, manual.service_type, manual.job_location ?? ''),
        onError: () => {
          setManualError("Couldn't create the lead. Try again.")
          setShake(n => n + 1)
        },
      },
    )
  }

  function finish(id: string, name: string, service: ServiceType, location: string) {
    const town = leadTown({ job_location: location } as Parameters<typeof leadTown>[0])
    const svc = SERVICES.find(s => s.value === service)?.label
    setDone({ id, line: [name.trim(), service !== 'unknown' ? svc : null, town].filter(Boolean).join(' · ') })
  }

  // ── header ──
  const title: Record<Step, [string, string]> = {
    choose: ['New lead', `${cityName ? `${cityName} · ` : ''}from a screenshot`],
    reading: ['Reading…', [cityName, sourceLabel].filter(Boolean).join(' · ')],
    error: ['Upload failed', [cityName, sourceLabel].filter(Boolean).join(' · ')],
    review: ['Review lead', 'Check what we read'],
    manual: ['Manual entry', cityName],
  }
  const shotCount = step === 'review' ? result?.extractions.length || shots.length : shots.length
  const readLabel = `Read ${shots.length} screenshot${shots.length === 1 ? '' : 's'}`
  const steps = [`Uploading ${shots.length} screenshot${shots.length === 1 ? '' : 's'}`, 'Reading lead details', 'Running AI review']

  const citySelect = cities.length > 1 && (
    <label className="wd-f">
      <span className="wd-fl2">City</span>
      <select value={cityId} onChange={e => setSelectedCityId(e.target.value)}>
        {cities.map(city => <option key={city.id} value={city.id}>{city.name}</option>)}
      </select>
    </label>
  )

  const s = aiReview && aiReview !== 'failed' ? aiReview.sections : null
  const hasRange = s?.target_low != null && s?.target_high != null && s?.sayability !== 'hold'
  const autoShort = (result?.auto_applied_fields ?? []).map(f => FIELD_META[f]?.short ?? f.replace(/_/g, ' '))
  const readFrom = (field: string) => !!result && (result.auto_applied_fields.includes(field) || field in extracted)

  function ConflictPick({ field, onPick, current }: { field: string; onPick: (v: string) => void; current: string }) {
    if (!result) return null
    const values = shotValues(result, field)
    if (values.length < 2) return null
    const money = FIELD_META[field].kind === 'money'
    return (
      <div className="wd-pick">
        {values.map(v => {
          const shown = money ? `$${moneyValue(v.value)}` : v.value
          const value = money ? moneyValue(v.value) : v.value
          return (
            <button key={v.shot} type="button" aria-pressed={current === value} aria-label={`${shown} from shot ${v.shot}`} onClick={() => onPick(value)}>
              <b>{shown}</b>
              <span>shot {v.shot}</span>
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div className="wd-flow" role="dialog" aria-modal="true" aria-label="Add a lead">
      <header className="wd-hdr shrink-0 !pl-2">
        <div className="flex items-center gap-1.5">
          <button type="button" className="wd-ib" aria-label="Close" onClick={onClose} disabled={!canClose}>
            <Icon d={ICON.x} />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="wd-disp truncate text-[26px] leading-none">{title[step][0]}</h2>
            {title[step][1] && <p className="wd-h-s truncate">{title[step][1]}</p>}
          </div>
          {(step === 'reading' || step === 'review' || step === 'error') && shotCount > 0 && (
            <span className="wd-city shrink-0">{shotCount} shot{shotCount === 1 ? '' : 's'}</span>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div key={step} className="wd-pane mx-auto flex w-full max-w-xl flex-col gap-3 px-3.5 pb-6 pt-4">

          {step === 'choose' && (
            <>
              <p className="wd-fl !mb-0">Where's it from?</p>
              <div className="wd-chips2">
                {SCREENSHOT_SOURCES.map(src => (
                  <button key={src.value} type="button" aria-pressed={source === src.value} onClick={() => setSource(src.value)}>
                    {src.label}
                  </button>
                ))}
              </div>
              {citySelect}
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="hidden"
                onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }}
              />
              {shots.length === 0 ? (
                <button
                  type="button"
                  className="wd-drop"
                  onClick={() => fileRef.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files) }}
                >
                  <span className="wd-drop-i"><Icon d={ICON.camera} /></span>
                  <b>Choose screenshots</b>
                  <span>JPEG, PNG or WebP. Several shots of one lead become one lead.</span>
                </button>
              ) : (
                <>
                  <p className="wd-fl !mb-0">Selected</p>
                  <div className="wd-shots">
                    {shots.map((shot, i) => (
                      <div key={shot.id} className="wd-shot" style={{ '--i': i } as React.CSSProperties}>
                        <img src={shot.url} alt={`Shot ${i + 1}`} />
                        <button type="button" className="wd-shot-x" aria-label={`Remove shot ${i + 1}`} onClick={() => removeShot(shot.id)}>
                          <i aria-hidden="true">×</i>
                        </button>
                      </div>
                    ))}
                    {shots.length < MAX_SHOTS && (
                      <button type="button" className="wd-shot-add" onClick={() => fileRef.current?.click()}>
                        <Icon d={ICON.plus} />
                        Add
                      </button>
                    )}
                  </div>
                  <p className="wd-hint !mt-0 px-0.5">
                    {tooMany
                      ? `Up to ${MAX_SHOTS} screenshots per lead. The extra ones were left out.`
                      : shots.length > 1 ? 'These become one lead.' : 'Add more if the lead runs past one screen.'}
                  </p>
                </>
              )}
              <button type="button" className="wd-lnk" onClick={() => setStep('manual')}>
                Manual entry instead →
              </button>
            </>
          )}

          {(step === 'reading' || step === 'error') && (
            <>
              <div className={`wd-rd ${step === 'error' ? 'err' : ''}`} aria-hidden="true">
                <Logo
                  mode={step === 'error' ? 'still' : 'load'}
                  color={step === 'error' ? '#fff' : '#161512'}
                  bg={step === 'error' ? 'var(--hd)' : 'var(--ac)'}
                  label=""
                />
              </div>
              <ol className="wd-box wd-box-soft grid gap-3" aria-label="Progress">
                {steps.map((label, i) => {
                  const bad = step === 'error' && i === 0
                  const state = bad ? 'bad' : step === 'error' ? '' : i < readStep ? 'done' : i === readStep ? 'cur' : ''
                  return (
                    <li key={label} className={`wd-rs ${state}`} aria-current={state === 'cur' ? 'step' : undefined}>
                      <i aria-hidden="true">{bad ? '✕' : state === 'done' ? '✓' : i + 1}</i>
                      <span>{label}</span>
                    </li>
                  )
                })}
              </ol>
              {step === 'error' ? (
                <div className="wd-box wd-warn" role="alert">
                  <div className="haz h-2" aria-hidden="true" />
                  <div>
                    <p className="wd-fl !mb-1">No connection</p>
                    <p>Upload failed. Check your connection and try again. Your screenshots are still selected, so Try again sends the same ones.</p>
                  </div>
                </div>
              ) : (
                <div className="wd-shots sm">
                  {shots.map((shot, i) => (
                    <div key={shot.id} className="wd-shot overflow-hidden" style={{ '--i': i } as React.CSSProperties}>
                      <img src={shot.url} alt={`Shot ${i + 1}`} />
                      <i className="wd-scan" aria-hidden="true" />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {step === 'review' && result && (
            <>
              {aiReview === 'failed' ? (
                <div className="wd-box wd-warn" role="status">
                  <div className="haz h-2" aria-hidden="true" />
                  <div>
                    <p className="wd-fl !mb-1">The AI review didn't run</p>
                    <p>The lead is read and saved. Run the review from the lead screen once it's in the queue.</p>
                  </div>
                </div>
              ) : s && (
                <div className="wd-aic">
                  <p className="wd-aic-l">AI review ready</p>
                  {hasRange ? (
                    <>
                      <p className="wd-aic-n">${s.target_low!.toLocaleString('en-US')}–${s.target_high!.toLocaleString('en-US')}</p>
                      <p className="wd-aic-s">
                        {s.floor != null ? `floor $${s.floor.toLocaleString('en-US')} · ` : ''}
                        {s.sayability === 'ready' ? 'Ready to quote' : s.sayability === 'confirm_first' ? 'Confirm first' : 'Check before quoting'}
                      </p>
                    </>
                  ) : (
                    <p className="wd-aic-s mt-1">{s.sayability === 'hold' ? 'Hold · scope not firm yet' : 'No quotable number yet'}</p>
                  )}
                </div>
              )}

              {autoShort.length > 0 && (
                <div className="wd-okb">
                  <Icon d={ICON.check} />
                  <span>Filled in from the screenshot: {autoShort.join(', ')}. Check them below.</span>
                </div>
              )}

              {conflicts.length > 0 && (
                <div className="wd-box wd-warn" role="alert">
                  <div className="haz h-2" aria-hidden="true" />
                  <div>
                    <p className="wd-fl !mb-1">Shots disagree on {conflicts.map(f => FIELD_META[f].short).join(', ')}</p>
                    <p>Left blank on purpose. Pick the right one or type it, so a wrong number never lands quietly.</p>
                  </div>
                </div>
              )}

              <div className="wd-box wd-box-soft grid gap-3.5">
                {citySelect}
                <label className={`wd-f ${conflicts.includes('customer_name') && !isSet('customer_name') ? 'need' : ''}`}>
                  <span className="wd-fl2">Customer name <em aria-hidden="true">*</em><Tag on={readFrom('customer_name')} /></span>
                  <input aria-label="Customer name" value={review.customer_name} placeholder="Enter customer name" onChange={e => setR('customer_name', e.target.value)} />
                  {conflicts.includes('customer_name') && <ConflictPick field="customer_name" current={review.customer_name} onPick={v => setR('customer_name', v)} />}
                </label>

                <label className={`wd-f ${conflicts.includes('customer_phone') && !isSet('customer_phone') ? 'need' : ''}`}>
                  <span className="wd-fl2">Phone<Tag on={readFrom('customer_phone')} /></span>
                  <input
                    type="tel"
                    aria-label="Phone"
                    value={review.customer_phone}
                    placeholder={source === 'thumbtack_screenshot' ? 'Shows after you reply on Thumbtack' : '(314) 555-0100'}
                    onChange={e => setR('customer_phone', e.target.value)}
                  />
                  {conflicts.includes('customer_phone') && <ConflictPick field="customer_phone" current={review.customer_phone} onPick={v => setR('customer_phone', v)} />}
                </label>

                <Seg
                  label="review"
                  value={review.service_type}
                  onChange={v => setR('service_type', v)}
                  need={conflicts.includes('service_type') && !isSet('service_type')}
                  read={readFrom('service_type')}
                />

                <label className={`wd-f ${conflicts.includes('job_location') && !isSet('job_location') ? 'need' : ''}`}>
                  <span className="wd-fl2">Location<Tag on={readFrom('job_location')} /></span>
                  <input aria-label="Location" value={review.job_location} onChange={e => setR('job_location', e.target.value)} />
                  {conflicts.includes('job_location') && <ConflictPick field="job_location" current={review.job_location} onPick={v => setR('job_location', v)} />}
                </label>

                <div className="wd-f">
                  <span className="wd-fl2">Requested dates<Tag on={readFrom('move_date_options') || readFrom('job_date_requested')} /></span>
                  <DateOptionsEditor values={review.move_date_options} onChange={values => setR('move_date_options', values)} />
                </div>

                <label className="wd-f">
                  <span className="wd-fl2">Booking date</span>
                  <input type="date" aria-label="Booking date" value={review.job_date_requested} onChange={e => setR('job_date_requested', e.target.value)} />
                  <span className="wd-hint !mt-0">Leave blank until the customer is actually booked.</span>
                </label>

                {conflicts.filter(f => FIELD_META[f].kind !== 'form').map(field => {
                  const meta = FIELD_META[field]
                  return (
                    <div key={field} className={`wd-f ${isSet(field) ? '' : 'need'}`}>
                      <label htmlFor={`extra-${field}`} className="wd-fl2">{meta.label}</label>
                      {meta.kind === 'money' ? (
                        <div className="wd-money !h-12">
                          <span aria-hidden="true">$</span>
                          <input
                            id={`extra-${field}`}
                            inputMode="decimal"
                            placeholder="0.00"
                            value={extras[field] ?? ''}
                            onChange={e => setExtras(x => ({ ...x, [field]: e.target.value }))}
                            className="!text-[22px]"
                          />
                        </div>
                      ) : (
                        <input
                          id={`extra-${field}`}
                          inputMode="numeric"
                          value={extras[field] ?? ''}
                          onChange={e => setExtras(x => ({ ...x, [field]: e.target.value }))}
                        />
                      )}
                      <ConflictPick field={field} current={extras[field] ?? ''} onPick={v => setExtras(x => ({ ...x, [field]: v }))} />
                    </div>
                  )
                })}

                <label className="wd-f">
                  <span className="wd-fl2">Notes<Tag on={readFrom('notes')} /></span>
                  <textarea rows={3} aria-label="Notes" value={review.notes} onChange={e => setR('notes', e.target.value)} />
                </label>

                <Switch on={review.urgency_flag} onChange={v => setR('urgency_flag', v)}>Mark as urgent</Switch>
              </div>
              {reviewError && <p className="wd-err px-1" role="alert">{reviewError}</p>}
            </>
          )}

          {step === 'manual' && (
            <>
              <p className="wd-fl !mb-0">Source</p>
              <div className="wd-chips2">
                {MANUAL_SOURCES.map(src => (
                  <button
                    key={src.value}
                    type="button"
                    aria-pressed={manual.source_type === src.value}
                    onClick={() => setManual(m => ({ ...m, source_type: src.value }))}
                  >
                    {src.label}
                  </button>
                ))}
              </div>
              <div className="wd-box wd-box-soft grid gap-3.5">
                {citySelect}
                <label className="wd-f">
                  <span className="wd-fl2">Customer name <em aria-hidden="true">*</em></span>
                  <input aria-label="Customer name" placeholder="Who's it for?" value={manual.customer_name} onChange={e => setManual(m => ({ ...m, customer_name: e.target.value }))} />
                </label>
                <label className="wd-f">
                  <span className="wd-fl2">Phone</span>
                  <input type="tel" aria-label="Phone" placeholder="(314) 555-0100" value={manual.customer_phone ?? ''} onChange={e => setManual(m => ({ ...m, customer_phone: e.target.value || undefined }))} />
                </label>
                <Seg label="manual" value={manual.service_type} onChange={v => setManual(m => ({ ...m, service_type: v }))} />
                <label className="wd-f">
                  <span className="wd-fl2">Location</span>
                  <input aria-label="Location" placeholder="Neighborhood or ZIP" value={manual.job_location ?? ''} onChange={e => setManual(m => ({ ...m, job_location: e.target.value || undefined }))} />
                </label>
                <label className="wd-f">
                  <span className="wd-fl2">Date requested</span>
                  <input type="date" aria-label="Date requested" value={manual.job_date_requested ?? ''} onChange={e => setManual(m => ({ ...m, job_date_requested: e.target.value || undefined }))} />
                </label>
                <label className="wd-f">
                  <span className="wd-fl2">Notes</span>
                  <textarea rows={3} aria-label="Notes" placeholder="What are we hauling?" value={manual.notes ?? ''} onChange={e => setManual(m => ({ ...m, notes: e.target.value || undefined }))} />
                </label>
                <Switch on={!!manual.urgency_flag} onChange={v => setManual(m => ({ ...m, urgency_flag: v }))}>Mark as urgent</Switch>
              </div>
              {manualError && <p className="wd-err px-1" role="alert">{manualError}</p>}
            </>
          )}
        </div>
      </div>

      {step !== 'reading' && (
        <div className="wd-foot">
          <div className="mx-auto flex w-full max-w-xl gap-2">
            {step === 'choose' && (
              <button type="button" className="wd-btn flex-1" disabled={!shots.length} onClick={() => { void read() }}>
                {shots.length ? readLabel : 'Choose a screenshot first'}
              </button>
            )}
            {step === 'error' && (
              <>
                <button type="button" className="wd-btn wd-btn-ghost" onClick={() => setStep('choose')}>Cancel</button>
                <button type="button" className="wd-btn wd-btn-amber flex-1" onClick={() => { void read() }}>Try again</button>
              </>
            )}
            {step === 'review' && (
              <>
                <button type="button" className="wd-btn wd-btn-ghost" onClick={onClose} disabled={patching}>Close</button>
                <button key={shake} type="button" className={`wd-btn flex-1 ${shake ? 'wd-shake' : ''}`} onClick={addToQueue} disabled={patching}>
                  {patching ? 'Saving…' : 'Add to queue'}
                </button>
              </>
            )}
            {step === 'manual' && (
              <>
                <button type="button" className="wd-btn wd-btn-ghost" onClick={() => setStep('choose')} disabled={creating}>Back</button>
                <button key={shake} type="button" className={`wd-btn flex-1 ${shake ? 'wd-shake' : ''}`} onClick={createManual} disabled={creating}>
                  {creating ? 'Saving…' : 'Create lead'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {done && (
        <div className="wd-ovl" role="dialog" aria-label="In the queue">
          <Logo
            mode={leaveTo ? 'leave' : 'arrive'}
            bg="var(--pr)"
            onDone={leaveTo ? () => { onClose(); navigate(leaveTo) } : undefined}
          />
          <h2 className="wd-ovl-t">In the queue</h2>
          <p className="wd-ovl-s">{done.line}</p>
          <div className="flex gap-2">
            <button type="button" className="wd-btn wd-btn-amber flex-1" onClick={() => setLeaveTo(`/leads/${done.id}`)} disabled={Boolean(leaveTo)}>
              Open lead
            </button>
            <button type="button" className="wd-btn wd-btn-ghost flex-1" onClick={() => setLeaveTo('/')} disabled={Boolean(leaveTo)}>
              Back to queue
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
