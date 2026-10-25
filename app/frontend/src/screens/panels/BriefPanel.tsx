import { useEffect, useRef, useState } from 'react'
import { DateOptionsEditor } from '../../components/DateOptionsEditor'
import { TruckRentalSection } from '../../components/TruckRentalSection'
import { PayrollSection } from '../../components/PayrollSection'
import { LeadCostCard } from '../../components/LeadCostCard'
import { LeadContact } from '../../components/LeadContact'
import { buildUploadUrl } from '../../services/api'
import { useAcknowledgeLead, usePatchLead } from '../../hooks/useLeads'
import { useUsers } from '../../hooks/useUsers'
import { fmtDurationMinutes, fmtLocalDateTime, fmtTimeSlot } from '../../utils/time'
import type { AiReview, Lead } from '../../types/lead'

const MAPS_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY ||
  import.meta.env.VITE_GOOGLE_MAPS_KEY) as string | undefined

interface Props {
  lead: Lead
  aiReview: AiReview | null | undefined
  onBookingDateSet?: () => void
}

// ── Inline editable field ─────────────────────────────────────────────────────

interface EditableFieldProps {
  value: string | null | undefined
  onSave: (val: string | null) => void
  placeholder?: string
  type?: 'text' | 'tel' | 'date' | 'time' | 'number' | 'textarea' | 'select'
  options?: { value: string; label: string }[]
  display?: (val: string) => string
}

function EditableField({
  value,
  onSave,
  placeholder = 'Tap to add…',
  type = 'text',
  options,
  display,
}: EditableFieldProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement>(null)

  const open = () => {
    setDraft(value ?? '')
    setEditing(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const save = () => {
    setEditing(false)
    const trimmed = draft.trim()
    const next = trimmed === '' ? null : trimmed
    if (next !== (value ?? null)) onSave(next)
  }

  const cancel = () => {
    setEditing(false)
    setDraft(value ?? '')
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && type !== 'textarea') save()
    if (e.key === 'Escape') cancel()
  }

  const displayValue = value
    ? (display ? display(value) : value)
    : null

  if (!editing) {
    return (
      <button onClick={open} className="wd-ed">
        {displayValue ? displayValue : <span className="ph">{placeholder}</span>}
      </button>
    )
  }

  const inputClass = 'wd-input my-1'

  if (type === 'select' && options) {
    return (
      <select
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={onKey}
        className={inputClass}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    )
  }

  if (type === 'textarea') {
    return (
      <textarea
        ref={inputRef as React.RefObject<HTMLTextAreaElement>}
        value={draft}
        rows={3}
        onChange={e => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={onKey}
        className={inputClass + ' resize-none'}
      />
    )
  }

  return (
    <input
      ref={inputRef as React.RefObject<HTMLInputElement>}
      type={type}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={onKey}
      className={inputClass}
    />
  )
}

// ── Address field with Places Autocomplete (New) via REST ────────────────────

interface PlacePrediction {
  placeId: string
  text: { text: string }
  structuredFormat?: {
    mainText?: { text: string }
    secondaryText?: { text: string }
  }
}

interface PlaceDetailsResponse {
  formattedAddress?: string
  addressComponents?: Array<{
    longText?: string
    shortText?: string
    types?: string[]
  }>
}

interface AddressFieldProps {
  value: string | null | undefined
  onSave: (address: string | null, area?: string | null) => void
}

function deriveAreaFromPlace(details: PlaceDetailsResponse): string | null {
  const components = details.addressComponents ?? []
  const findComponent = (...types: string[]) =>
    components.find(component => types.some(type => component.types?.includes(type)))

  const city =
    findComponent('locality')?.longText ??
    findComponent('postal_town')?.longText ??
    findComponent('sublocality_level_1', 'sublocality')?.longText ??
    null
  const state = findComponent('administrative_area_level_1')?.shortText ?? null
  const postalCode = findComponent('postal_code')?.longText ?? null

  if (!city && !state && !postalCode) return null

  const cityState = [city, state].filter(Boolean).join(', ')
  if (cityState && postalCode) return `${cityState} ${postalCode}`
  return cityState || postalCode
}

function AddressField({ value, onSave }: AddressFieldProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [suggestions, setSuggestions] = useState<PlacePrediction[]>([])
  const [lookupError, setLookupError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  const fetchSuggestions = async (input: string) => {
    if (!MAPS_KEY || !input.trim()) {
      setSuggestions([])
      setLookupError('')
      return
    }
    try {
      const resp = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': MAPS_KEY,
          'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat.mainText.text,suggestions.placePrediction.structuredFormat.secondaryText.text',
        },
        body: JSON.stringify({ input, includedRegionCodes: ['us'] }),
      })
      if (!resp.ok) {
        setSuggestions([])
        setLookupError('Google Places lookup failed. Check that the Places API is enabled for this key.')
        return
      }
      const data = await resp.json()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setSuggestions((data.suggestions ?? []).map((s: any) => s.placePrediction).filter(Boolean))
      setLookupError('')
    } catch {
      setSuggestions([])
      setLookupError('Google Places lookup failed. Check your Maps key and network access.')
    }
  }

  const fetchPlaceDetails = async (placeId: string): Promise<{ address: string; area: string | null }> => {
    if (!MAPS_KEY) {
      return { address: draft.trim(), area: null }
    }

    const response = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': MAPS_KEY,
        'X-Goog-FieldMask': 'formattedAddress,addressComponents',
      },
    })
    if (!response.ok) {
      throw new Error('Place details lookup failed')
    }
    const details = await response.json() as PlaceDetailsResponse
    return {
      address: details.formattedAddress ?? draft.trim(),
      area: deriveAreaFromPlace(details),
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setDraft(val)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchSuggestions(val), 300)
  }

  const selectSuggestion = async (pred: PlacePrediction) => {
    const fallbackAddress = pred.text.text
    setSuggestions([])
    setLookupError('')
    try {
      const details = await fetchPlaceDetails(pred.placeId)
      const nextAddress = details.address || fallbackAddress
      setDraft(nextAddress)
      onSave(nextAddress, details.area)
    } catch {
      setDraft(fallbackAddress)
      setLookupError('Address selected, but area could not be derived from Google Places.')
      onSave(fallbackAddress)
    } finally {
      setEditing(false)
    }
  }

  const open = () => {
    setDraft(value ?? '')
    setSuggestions([])
    setLookupError('')
    setEditing(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const commit = () => {
    setSuggestions([])
    setLookupError('')
    setEditing(false)
    const trimmed = draft.trim()
    const next = trimmed === '' ? null : trimmed
    if (next !== (value ?? null)) onSave(next)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commit()
    if (e.key === 'Escape') { setSuggestions([]); setLookupError(''); setEditing(false); setDraft(value ?? '') }
  }

  useEffect(() => {
    return () => {
      clearTimeout(debounceRef.current)
    }
  }, [])

  const inputClass = 'wd-input my-1'

  const mapsUrl = value
    ? `https://maps.google.com/maps?q=${encodeURIComponent(value)}`
    : null

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <button onClick={open} className="wd-ed min-w-0 flex-1">
          {value ? value : <span className="ph">Confirmed street address — books job</span>}
        </button>
        {mapsUrl && (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="wd-btn-sm wd-btn-ghost shrink-0"
          >
            Navigate
          </a>
        )}
      </div>
    )
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={handleChange}
        onBlur={commit}
        onKeyDown={onKey}
        placeholder={MAPS_KEY ? 'Start typing an address…' : 'Enter address…'}
        className={inputClass}
        autoComplete="off"
      />
      {lookupError && (
        <p className="wd-hint !text-[#b86e00] dark:!text-ac">{lookupError}</p>
      )}
      {suggestions.length > 0 && (
        <ul className="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-card bg-sf shadow-[inset_0_0_0_1.5px_var(--edge),0_10px_24px_rgba(0,0,0,.2)]">
          {suggestions.map((pred, i) => (
            <li key={i}>
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => { void selectSuggestion(pred) }}
                className="min-h-11 w-full border-b px-3 py-2 text-left text-sm last:border-0 active:bg-tint"
              >
                <span className="font-medium">
                  {pred.structuredFormat?.mainText?.text ?? pred.text.text}
                </span>
                {pred.structuredFormat?.secondaryText && (
                  <span className="ml-1 text-mu">
                    {pred.structuredFormat.secondaryText.text}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────────

const SERVICE_OPTIONS = [
  { value: 'unknown', label: 'Unknown' },
  { value: 'moving', label: 'Moving' },
  { value: 'hauling', label: 'Hauling' },
  { value: 'both', label: 'Both' },
]

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-x-2.5 border-b last:border-0">
      <span className="pt-3 text-[13px] text-mu">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function BriefPanel({ lead, aiReview, onBookingDateSet }: Props) {
  const acknowledge = useAcknowledgeLead()
  const patch = usePatchLead()
  const { data: teamMembers = [] } = useUsers()
  const [copied, setCopied] = useState(false)
  const [quoteInput, setQuoteInput] = useState<string>(() =>
    lead.quote_cents !== null && lead.quote_cents !== undefined
      ? (lead.quote_cents / 100).toFixed(2)
      : ''
  )
  const [quoteError, setQuoteError] = useState('')
  const [showClearQuoteWarning, setShowClearQuoteWarning] = useState(false)

  useEffect(() => {
    setQuoteInput(
      lead.quote_cents !== null && lead.quote_cents !== undefined
        ? (lead.quote_cents / 100).toFixed(2)
        : ''
    )
    setQuoteError('')
    setShowClearQuoteWarning(false)
  }, [lead.id, lead.quote_cents])

  const intakeShot = lead.screenshots?.find(s => s.screenshot_type === 'intake')

  const save = (field: string, value: string | null) =>
    patch.mutate({ id: lead.id, data: { [field]: value } })

  const saveJobDateRange = (start: string | null, end: string | null) =>
    patch.mutate({ id: lead.id, data: { job_date_requested: start, job_date_end: end } })

  const saveAddressAndArea = (address: string | null, area?: string | null) => {
    const data: Record<string, string | null> = { job_address: address }
    if (area !== undefined) data.job_location = area
    patch.mutate({ id: lead.id, data })
  }

  const saveMoveDateOptions = (values: string[]) => {
    patch.mutate({
      id: lead.id,
      data: { move_date_options: values.length > 0 ? values : null },
    })
  }

  const handleQuoteBlur = () => {
    setQuoteError('')
    const trimmed = quoteInput.trim()
    if (trimmed === '') {
      // Clearing the quote — warn if the lead already has a quote set
      if (lead.quote_cents !== null && lead.quote_cents !== undefined) {
        setShowClearQuoteWarning(true)
      }
      return
    }
    const dollars = parseFloat(trimmed)
    if (!isFinite(dollars) || dollars < 0) {
      setQuoteError('Enter a valid dollar amount')
      setQuoteInput(
        lead.quote_cents !== null && lead.quote_cents !== undefined
          ? (lead.quote_cents / 100).toFixed(2)
          : ''
      )
      return
    }
    const cents = Math.round(dollars * 100)
    if (cents === lead.quote_cents) return
    patch.mutate(
      { id: lead.id, data: { quote_cents: cents } },
      {
        onError: () => {
          setQuoteError('Failed to save quote — please try again')
          setQuoteInput(
            lead.quote_cents !== null && lead.quote_cents !== undefined
              ? (lead.quote_cents / 100).toFixed(2)
              : ''
          )
        },
      }
    )
  }

  const confirmClearQuote = () => {
    setShowClearQuoteWarning(false)
    patch.mutate(
      { id: lead.id, data: { quote_cents: null } },
      {
        onError: () => {
          setQuoteError('Failed to clear quote — please try again')
          setQuoteInput(
            lead.quote_cents !== null && lead.quote_cents !== undefined
              ? (lead.quote_cents / 100).toFixed(2)
              : ''
          )
        },
      }
    )
  }

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="wd-pane flex flex-col gap-3 px-3.5 pb-6 pt-3">

      {/* Acknowledgment */}
      {!lead.acknowledged_at ? (
        <div className="wd-box overflow-hidden !p-0">
          <div className="haz h-1.5" aria-hidden="true" />
          <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
            <span className="text-sm font-semibold">Not yet acknowledged</span>
            <button
              onClick={() => acknowledge.mutate({ id: lead.id })}
              disabled={acknowledge.isPending}
              className="wd-btn-sm wd-btn-amber shrink-0"
            >
              {acknowledge.isPending ? 'Saving…' : 'Acknowledge'}
            </button>
          </div>
          {acknowledge.isError && <p className="wd-err px-3.5 pb-2.5">Couldn't save. Try again.</p>}
        </div>
      ) : (
        <p className="rounded-card bg-tint px-3.5 py-2.5 text-sm text-ok">
          Acknowledged {fmtLocalDateTime(lead.acknowledged_at!)}
        </p>
      )}

      {/* What the customer said, with the screenshot it came from */}
      <section className="wd-box wd-box-soft">
        <h3 className="wd-fl">Customer says</h3>
        <div className="italic">
          <EditableField
            value={lead.scope_notes}
            onSave={v => save('scope_notes', v)}
            placeholder="Tap to add scope notes…"
            type="textarea"
          />
        </div>
        {intakeShot && (
          <a
            href={buildUploadUrl(intakeShot.stored_path)}
            target="_blank"
            rel="noreferrer"
            className="mt-2 flex items-center gap-3 rounded-card bg-bg p-2 active:bg-tint"
          >
            <img
              src={buildUploadUrl(intakeShot.stored_path)}
              alt="Intake screenshot"
              className="h-16 w-16 shrink-0 rounded-chip object-cover"
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Lead screenshot</span>
              <span className="block text-xs text-mu">Tap to open</span>
            </span>
          </a>
        )}
      </section>

      {/* Editable lead fields */}
      <section className="wd-box wd-box-soft">
        <h3 className="wd-fl">Job details</h3>
        <div>
          <FieldRow label="Name">
            <EditableField
              value={lead.customer_name}
              onSave={v => save('customer_name', v)}
              placeholder="Tap to add name…"
            />
          </FieldRow>

          <FieldRow label="Ingested by">
            <span className="block py-3 text-sm font-medium [overflow-wrap:anywhere]">
              {lead.ingested_by ?? 'Unknown'}
            </span>
          </FieldRow>

          <FieldRow label="Phone">
            <div className="py-1.5">
              <LeadContact lead={lead} save={save} />
            </div>
          </FieldRow>

          <FieldRow label="Service">
            <EditableField
              value={lead.service_type ?? 'unknown'}
              onSave={v => save('service_type', v)}
              type="select"
              options={SERVICE_OPTIONS}
              display={v => SERVICE_OPTIONS.find(o => o.value === v)?.label ?? v}
            />
          </FieldRow>

          <FieldRow label="Area">
            <EditableField
              value={lead.job_location}
              onSave={v => save('job_location', v)}
              placeholder="City / zip from lead…"
            />
          </FieldRow>

          <FieldRow label="Address">
            <AddressField
              value={lead.job_address}
              onSave={saveAddressAndArea}
            />
          </FieldRow>

          <FieldRow label="Moving to">
            <div className="flex min-w-0 items-center gap-2">
              <div className="min-w-0 flex-1">
                <EditableField
                  value={lead.job_destination}
                  onSave={v => save('job_destination', v)}
                  placeholder="Destination address?"
                />
              </div>
              {lead.job_destination && lead.dispatched_at ? (
                <a
                  href={`https://maps.google.com/maps?q=${encodeURIComponent(lead.job_destination)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="wd-btn-sm wd-btn-ghost shrink-0"
                >
                  Navigate
                </a>
              ) : lead.job_destination ? (
                <span className="shrink-0 text-xs text-mu">Nav at dispatch</span>
              ) : null}
            </div>
          </FieldRow>

          <FieldRow label="Requested dates">
            <div className="py-1.5">
              <DateOptionsEditor
                values={lead.move_date_options ?? []}
                onChange={saveMoveDateOptions}
                onSelectDate={d => { saveJobDateRange(d, null); onBookingDateSet?.() }}
              />
            </div>
          </FieldRow>

          <FieldRow label="Time slot">
            <EditableField
              value={lead.appointment_time_slot}
              onSave={v => save('appointment_time_slot', v)}
              placeholder="Tap to add time…"
              type="time"
              display={fmtTimeSlot}
            />
          </FieldRow>

          <FieldRow label="Est. duration">
            {lead.estimated_job_duration_minutes != null ? (
              <p className="py-3 text-sm font-medium">
                {fmtDurationMinutes(lead.estimated_job_duration_minutes)}
                <span className="ml-2 text-xs font-normal text-mu">set on Quote</span>
              </p>
            ) : (
              <p className="py-3 text-sm text-mu">Set on the Quote tab</p>
            )}
          </FieldRow>

          <FieldRow label="Booking date">
            <div>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <EditableField
                    value={lead.job_date_requested}
                    onSave={v => { saveJobDateRange(v, v ? (lead.job_date_end ?? null) : null); if (v) onBookingDateSet?.() }}
                    placeholder="Tap to set date…"
                    type="date"
                  />
                </div>
                {lead.job_date_requested && (
                  <button
                    onClick={() => saveJobDateRange(null, null)}
                    className="wd-btn-sm wd-btn-ghost shrink-0"
                  >
                    Clear
                  </button>
                )}
              </div>
              {lead.job_date_requested && (
                <div className="flex items-center gap-2">
                  <span className="w-14 shrink-0 text-xs text-mu">Through</span>
                  <div className="min-w-0 flex-1">
                    <EditableField
                      value={lead.job_date_end ?? null}
                      onSave={v => save('job_date_end', v)}
                      placeholder="End date (optional)…"
                      type="date"
                    />
                  </div>
                </div>
              )}
            </div>
          </FieldRow>

          {lead.status === 'booked' && (
            <FieldRow label="$/quote">
              <div className="space-y-1 py-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-mu">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={quoteInput}
                    onChange={e => setQuoteInput(e.target.value)}
                    onBlur={handleQuoteBlur}
                    placeholder="0.00"
                    aria-label="Quote"
                    className="wd-input min-w-0 flex-1"
                  />
                  {lead.quote_cents !== null && lead.quote_cents !== undefined && (
                    <span className="shrink-0 text-xs text-mu">
                      {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(lead.quote_cents / 100)}
                    </span>
                  )}
                </div>
                {quoteError && (
                  <p className="wd-err">{quoteError}</p>
                )}
                {showClearQuoteWarning && (
                  <div className="rounded-card bg-bg p-2.5 shadow-[inset_0_0_0_1.5px_var(--ac)]">
                    <p className="mb-2 text-xs">
                      Clearing the quote will remove facilitator pay calculations for this job. Continue?
                    </p>
                    <div className="flex gap-2">
                      <button onClick={confirmClearQuote} className="wd-btn-sm !bg-danger">
                        Yes, clear
                      </button>
                      <button
                        onClick={() => {
                          setShowClearQuoteWarning(false)
                          setQuoteInput(
                            lead.quote_cents !== null && lead.quote_cents !== undefined
                              ? (lead.quote_cents / 100).toFixed(2)
                              : ''
                          )
                        }}
                        className="wd-btn-sm wd-btn-ghost"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </FieldRow>
          )}
        </div>
        {patch.isPending && (
          <p className="wd-hint">Saving…</p>
        )}
        {patch.isError && (
          <p className="wd-err mt-1.5">Failed to save — please try again.</p>
        )}
      </section>

      {/* Lead cost */}
      <LeadCostCard
        leadCostCents={lead.lead_cost_cents}
        leadCostGrossCents={lead.lead_cost_gross_cents}
        leadCostBonusCents={lead.lead_cost_bonus_cents}
        prosContacted={lead.pros_contacted}
        prosResponded={lead.pros_responded}
        fieldSources={lead.field_sources ? JSON.stringify(lead.field_sources) : null}
        onSave={costPatch => patch.mutateAsync({ id: lead.id, data: costPatch })}
      />

      {/* Assigned to */}
      <section className="wd-box wd-box-soft">
        <label htmlFor="assigned-to" className="wd-fl">Assigned to</label>
        <select
          id="assigned-to"
          className="wd-input"
          value={lead.assigned_to ?? ''}
          onChange={e => patch.mutate(
            { id: lead.id, data: { assigned_to: e.target.value || null } },
            { onError: (err) => console.error('Failed to update assigned_to:', err) }
          )}
        >
          <option value="">— Unassigned —</option>
          {(['admin', 'facilitator', 'supervisor', 'crew'] as const).map(role => {
            const members = teamMembers.filter(m => m.role === role && m.is_active)
            if (members.length === 0) return null
            return (
              <optgroup key={role} label={role.charAt(0).toUpperCase() + role.slice(1)}>
                {members.map(m => (
                  <option key={m.id} value={m.username}>{m.username}</option>
                ))}
              </optgroup>
            )
          })}
        </select>
      </section>

      {/* AI Quick Read */}
      {aiReview ? (
        <>
          <section className="wd-box wd-box-soft">
            <h3 className="wd-fl">Quick read</h3>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {aiReview.sections.m_quick_read || '—'}
            </p>
          </section>

          <section className="wd-box wd-box-soft">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="wd-fl !mb-0">Next best message</h3>
              <button
                onClick={() => handleCopy(aiReview.sections.a_next_message)}
                className="wd-btn-sm wd-btn-ghost"
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <p className="whitespace-pre-wrap rounded-card bg-tint p-3 text-sm leading-relaxed">
              {aiReview.sections.a_next_message || '—'}
            </p>
          </section>
        </>
      ) : (
        <p className="rounded-card bg-sf p-4 text-center text-sm text-mu shadow-[inset_0_0_0_1px_var(--ln)]">
          No AI review yet — tap <strong>Run AI review</strong> above.
        </p>
      )}

      <TruckRentalSection lead={lead} />
      <PayrollSection lead={lead} />

    </div>
  )
}
