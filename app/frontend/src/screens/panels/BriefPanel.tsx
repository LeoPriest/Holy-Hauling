import { useEffect, useRef, useState } from 'react'
import { DateOptionsEditor } from '../../components/DateOptionsEditor'
import { DurationWheelInput } from '../../components/DurationWheelInput'
import { buildUploadUrl } from '../../services/api'
import { useAcknowledgeLead, usePatchLead } from '../../hooks/useLeads'
import { useUsers } from '../../hooks/useUsers'
import { fmtDurationMinutes, fmtLocalDateTime, fmtTimeSlot } from '../../utils/time'
import type { AiReview, Lead } from '../../types/lead'

const MAPS_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY ||
  import.meta.env.VITE_GOOGLE_MAPS_KEY) as string | undefined

interface Props {
  lead: Lead
  aiReview: AiReview | undefined
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
      <button
        onClick={open}
        className="w-full min-w-0 text-left group"
      >
        {displayValue ? (
          <span className="block text-sm text-gray-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors whitespace-normal break-words">
            {displayValue}
          </span>
        ) : (
          <span className="text-sm text-gray-300 dark:text-gray-600 italic">
            {placeholder}
          </span>
        )}
      </button>
    )
  }

  const inputClass =
    'w-full text-sm border border-indigo-400 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 dark:text-white dark:border-indigo-500'

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

  const inputClass =
    'w-full text-sm border border-indigo-400 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 dark:text-white dark:border-indigo-500'

  const mapsUrl = value
    ? `https://maps.google.com/maps?q=${encodeURIComponent(value)}`
    : null

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <button onClick={open} className="flex-1 text-left group min-w-0">
          {value ? (
            <span className="text-sm text-gray-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors break-words">
              {value}
            </span>
          ) : (
            <span className="text-sm text-gray-300 dark:text-gray-600 italic">
              Confirmed street address — books job
            </span>
          )}
        </button>
        {mapsUrl && (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-xs bg-indigo-600 text-white rounded-lg px-2 py-1 font-medium hover:bg-indigo-700"
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
        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{lookupError}</p>
      )}
      {suggestions.length > 0 && (
        <ul className="absolute z-50 left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg overflow-hidden">
          {suggestions.map((pred, i) => (
            <li key={i}>
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => { void selectSuggestion(pred) }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 dark:hover:bg-gray-700 border-b last:border-0 dark:border-gray-700"
              >
                <span className="font-medium text-gray-900 dark:text-white">
                  {pred.structuredFormat?.mainText?.text ?? pred.text.text}
                </span>
                {pred.structuredFormat?.secondaryText && (
                  <span className="text-gray-400 dark:text-gray-500 ml-1">
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
    <div className="flex items-start gap-3 px-4 py-2.5 border-b last:border-0 dark:border-gray-700">
      <span className="text-xs text-gray-400 w-24 shrink-0 mt-1.5">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

export function BriefPanel({ lead, aiReview }: Props) {
  const acknowledge = useAcknowledgeLead()
  const patch = usePatchLead()
  const { data: teamMembers = [] } = useUsers()
  const [copied, setCopied] = useState(false)

  const intakeShot = lead.screenshots?.find(s => s.screenshot_type === 'intake')

  const save = (field: string, value: string | null) =>
    patch.mutate({ id: lead.id, data: { [field]: value } })

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

  const saveEstimatedDuration = (value: number | null) => {
    if (value == null) {
      patch.mutate({ id: lead.id, data: { estimated_job_duration_minutes: null } })
      return
    }
    patch.mutate({ id: lead.id, data: { estimated_job_duration_minutes: value } })
  }

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="p-4 space-y-4 pb-10">

      {/* Screenshot thumbnail */}
      {intakeShot && (
        <section>
          <a
            href={buildUploadUrl(intakeShot.stored_path)}
            target="_blank"
            rel="noreferrer"
            className="block rounded-xl overflow-hidden border border-gray-200 bg-gray-100"
          >
            <img
              src={buildUploadUrl(intakeShot.stored_path)}
              alt="Thumbtack screenshot"
              className="w-full object-cover max-h-48"
            />
            <p className="text-xs text-gray-400 px-3 py-1.5">Tap to open full size</p>
          </a>
        </section>
      )}

      {/* Acknowledgment banner */}
      {!lead.acknowledged_at ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center justify-between gap-3">
          <span className="text-sm text-red-700 font-medium">Not yet acknowledged</span>
          <button
            onClick={() => acknowledge.mutate({ id: lead.id })}
            disabled={acknowledge.isPending}
            className="text-xs bg-red-600 text-white rounded-lg px-3 py-1.5 hover:bg-red-700 disabled:opacity-50 shrink-0"
          >
            {acknowledge.isPending ? 'Saving…' : 'Acknowledge'}
          </button>
        </div>
      ) : (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3">
          <p className="text-sm text-green-700">
            Acknowledged {fmtLocalDateTime(lead.acknowledged_at!)}
          </p>
        </div>
      )}

      {/* Editable lead fields */}
      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Lead Info</h3>
        <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 divide-y dark:divide-gray-700">

          <FieldRow label="Name">
            <EditableField
              value={lead.customer_name}
              onSave={v => save('customer_name', v)}
              placeholder="Tap to add name…"
            />
          </FieldRow>

          <FieldRow label="Ingested By">
            <span className="block text-sm text-gray-900 dark:text-white whitespace-normal break-words">
              {lead.ingested_by ?? 'Unknown'}
            </span>
          </FieldRow>

          <FieldRow label="Phone">
            <div className="flex items-center gap-2 flex-wrap">
              <EditableField
                value={lead.customer_phone}
                onSave={v => save('customer_phone', v)}
                placeholder="Tap to add phone…"
                type="tel"
              />
              {lead.customer_phone && (
                <div className="flex gap-1 shrink-0">
                  <a href={`tel:${lead.customer_phone}`}
                    className="text-xs bg-green-600 text-white rounded-lg px-2 py-1 font-medium hover:bg-green-700">
                    Call
                  </a>
                  <a href={`sms:${lead.customer_phone}`}
                    className="text-xs bg-blue-600 text-white rounded-lg px-2 py-1 font-medium hover:bg-blue-700">
                    Text
                  </a>
                </div>
              )}
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

          <FieldRow label="Requested Dates">
            <DateOptionsEditor
              values={lead.move_date_options ?? []}
              onChange={saveMoveDateOptions}
            />
          </FieldRow>

          <FieldRow label="Booking Date">
            <EditableField
              value={lead.job_date_requested}
              onSave={v => save('job_date_requested', v)}
              placeholder="Tap to add date…"
              type="date"
            />
          </FieldRow>

          <FieldRow label="Time Slot">
            <EditableField
              value={lead.appointment_time_slot}
              onSave={v => save('appointment_time_slot', v)}
              placeholder="Tap to add time…"
              type="time"
              display={fmtTimeSlot}
            />
          </FieldRow>

          <FieldRow label="Est. Duration">
            <div className="space-y-2">
              <DurationWheelInput
                value={lead.estimated_job_duration_minutes}
                onChange={saveEstimatedDuration}
                allowClear
              />
              {lead.estimated_job_duration_minutes != null && (
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  Current: {fmtDurationMinutes(lead.estimated_job_duration_minutes)}
                </p>
              )}
            </div>
          </FieldRow>

          <FieldRow label="Notes">
            <EditableField
              value={lead.scope_notes}
              onSave={v => save('scope_notes', v)}
              placeholder="Tap to add scope notes…"
              type="textarea"
            />
          </FieldRow>

        </div>
        {patch.isPending && (
          <p className="text-xs text-gray-400 mt-1 px-1">Saving…</p>
        )}
        {patch.isError && (
          <p className="text-xs text-red-500 mt-1 px-1">Failed to save — please try again.</p>
        )}
      </section>

      {/* Assigned to */}
      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Assigned To</h3>
        <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-3">
          <select
            className="w-full text-sm text-gray-900 dark:text-white dark:bg-gray-800 focus:outline-none"
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
        </div>
      </section>

      {/* AI Quick Read */}
      {aiReview ? (
        <>
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Quick Read
            </h3>
            <div className="bg-white rounded-xl border p-4">
              <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                {aiReview.sections.m_quick_read || '—'}
              </p>
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Next Best Message
              </h3>
              <button
                onClick={() => handleCopy(aiReview.sections.a_next_message)}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4">
              <p className="text-sm text-indigo-900 leading-relaxed whitespace-pre-wrap">
                {aiReview.sections.a_next_message || '—'}
              </p>
            </div>
          </section>
        </>
      ) : (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
          <p className="text-sm text-gray-400">
            No AI review yet — tap <strong>Run AI Review</strong> above.
          </p>
        </div>
      )}

    </div>
  )
}
