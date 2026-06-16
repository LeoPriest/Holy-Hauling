import { useEffect, useRef, useState } from 'react'
import { buildUploadUrl } from '../services/api'
import {
  useDeleteConfirmation,
  useDeleteReceipt,
  useDeleteTruckRental,
  useExtractConfirmation,
  useTruckRental,
  useUploadConfirmation,
  useUploadReceipt,
  useUpsertTruckRental,
} from '../hooks/useTruckRental'
import {
  STATUS_LABELS,
  TRUCK_SIZES,
  type TruckRental,
  type TruckRentalInput,
  type TruckRentalStatus,
  type TruckSize,
} from '../types/truck_rental'
import type { Lead } from '../types/lead'

interface Props {
  lead: Lead
}

const STAGES: TruckRentalStatus[] = ['reserved', 'confirmed', 'completed']

const EMPTY_FORM: TruckRentalInput = {
  status: 'reserved',
  confirmation_number: null,
  truck_size: null,
  pickup_location: null,
  dropoff_location: null,
  pickup_datetime: null,
  dropoff_datetime: null,
  rental_cost_cents: null,
  one_way: false,
  estimated_miles: null,
  actual_miles: null,
  notes: null,
}

function centsToDisplay(cents: number | null): string {
  if (cents === null) return ''
  return (cents / 100).toFixed(2)
}

function displayToCents(value: string): number | null {
  const parsed = parseFloat(value.replace(/[^0-9.]/g, ''))
  if (!isFinite(parsed)) return null
  return Math.round(parsed * 100)
}

function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
}

function fmtDateTime(value: string | null): string {
  if (!value) return ''
  const d = new Date(value)
  if (isNaN(d.getTime())) return value
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function buildUhaulUrl(lead: Lead): string {
  const params = new URLSearchParams()
  if (lead.job_origin) params.set('pickupLocation', lead.job_origin)
  if (lead.job_destination) params.set('returnLocation', lead.job_destination)
  if (lead.job_date_requested) {
    const [y, m, d] = lead.job_date_requested.split('-')
    if (y && m && d) params.set('pickupDate', `${m}/${d}/${y}`)
  }
  const qs = params.toString()
  return `https://www.uhaul.com/Trucks/${qs ? '?' + qs : ''}`
}

function rentalToInput(r: TruckRental): TruckRentalInput {
  return {
    status: r.status,
    confirmation_number: r.confirmation_number,
    truck_size: r.truck_size,
    pickup_location: r.pickup_location,
    dropoff_location: r.dropoff_location,
    pickup_datetime: r.pickup_datetime,
    dropoff_datetime: r.dropoff_datetime,
    rental_cost_cents: r.rental_cost_cents,
    one_way: r.one_way,
    estimated_miles: r.estimated_miles,
    actual_miles: r.actual_miles,
    notes: r.notes,
  }
}

function TruckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className ?? 'w-5 h-5'}>
      <path d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 0 0-3.213-9.193 2.056 2.056 0 0 0-1.58-.86H14.25M8.25 18.75H16.5M3.375 18.75H2.25m2.625-9.75H14.25" />
    </svg>
  )
}

function StageStrip({ status }: { status: TruckRentalStatus }) {
  const idx = STAGES.indexOf(status)
  return (
    <div className="mb-3">
      <div className="flex items-center">
        {STAGES.map((s, i) => (
          <div key={s} className="flex items-center flex-1 last:flex-none">
            <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${i <= idx ? 'bg-orange-500' : 'bg-gray-200 dark:bg-gray-600'}`} />
            {i < STAGES.length - 1 && <span className={`h-0.5 flex-1 ${i < idx ? 'bg-orange-500' : 'bg-gray-200 dark:bg-gray-600'}`} />}
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-1">
        {STAGES.map(s => (
          <span key={s} className={`text-[10px] ${s === status ? 'font-semibold text-orange-600 dark:text-orange-400' : 'text-gray-400 dark:text-gray-500'}`}>
            {STATUS_LABELS[s]}
          </span>
        ))}
      </div>
    </div>
  )
}

function MapLink({ label, value }: { label: string; value: string }) {
  return (
    <a
      href={mapsUrl(value)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 shrink-0">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
      </svg>
      <span className="truncate">{label}</span>
    </a>
  )
}

export function TruckRentalSection({ lead }: Props) {
  const { data: rental, isLoading } = useTruckRental(lead.id)
  const upsert = useUpsertTruckRental(lead.id)
  const deleteMutation = useDeleteTruckRental(lead.id)
  const uploadReceipt = useUploadReceipt(lead.id)
  const deleteReceipt = useDeleteReceipt(lead.id)
  const uploadConfirmation = useUploadConfirmation(lead.id)
  const extractConfirmation = useExtractConfirmation(lead.id)
  const deleteConfirmation = useDeleteConfirmation(lead.id)

  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [form, setForm] = useState<TruckRentalInput>(EMPTY_FORM)
  const [costInput, setCostInput] = useState('')
  const [error, setError] = useState('')
  const [ocrHint, setOcrHint] = useState('')
  const receiptRef = useRef<HTMLInputElement>(null)
  const confRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setEditing(false)
    setConfirmDelete(false)
    setForm(EMPTY_FORM)
    setCostInput('')
    setError('')
    setOcrHint('')
  }, [lead.id])

  const canBook = !!(lead.job_origin || lead.job_destination || lead.job_date_requested)
  const scanning = uploadConfirmation.isPending || extractConfirmation.isPending

  function openForm(prefill: TruckRentalInput) {
    setForm(prefill)
    setCostInput(centsToDisplay(prefill.rental_cost_cents))
    setEditing(true)
    setExpanded(true)
    setError('')
  }

  function handleBookUhaul() {
    window.open(buildUhaulUrl(lead), '_blank', 'noopener,noreferrer')
    if (!rental) openForm(EMPTY_FORM)
  }

  function handleLogRental() {
    openForm(rental ? rentalToInput(rental) : EMPTY_FORM)
  }

  async function handleSave() {
    setError('')
    try {
      await upsert.mutateAsync({ ...form, rental_cost_cents: displayToCents(costInput) })
      setEditing(false)
      setExpanded(true)
      setOcrHint('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    }
  }

  async function advanceStage() {
    if (!rental) return
    const next = STAGES[Math.min(STAGES.indexOf(rental.status) + 1, STAGES.length - 1)]
    setError('')
    try {
      await upsert.mutateAsync({ ...rentalToInput(rental), status: next })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update status')
    }
  }

  async function handleDelete() {
    try {
      await deleteMutation.mutateAsync()
      setConfirmDelete(false)
      setEditing(false)
      setExpanded(false)
    } catch {
      setError('Delete failed')
    }
  }

  async function handleReceiptUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      await uploadReceipt.mutateAsync(file)
    } catch {
      setError('Receipt upload failed')
    }
    if (receiptRef.current) receiptRef.current.value = ''
  }

  async function handleDeleteReceipt() {
    try {
      await deleteReceipt.mutateAsync()
    } catch {
      setError('Failed to remove receipt')
    }
  }

  // Upload the confirmation screenshot, auto-extract, and pre-fill the form for review.
  async function handleConfirmationUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (e.target) e.target.value = ''
    if (!file) return
    setError('')
    setOcrHint('')
    try {
      if (!rental) await upsert.mutateAsync(EMPTY_FORM)
      await uploadConfirmation.mutateAsync(file)
      const ex = await extractConfirmation.mutateAsync()
      const base = rental ? rentalToInput(rental) : EMPTY_FORM
      openForm({
        ...base,
        confirmation_number: ex.confirmation_number ?? base.confirmation_number,
        truck_size: (ex.truck_size as TruckSize | null) ?? base.truck_size,
        pickup_location: ex.pickup_location ?? base.pickup_location,
        dropoff_location: ex.dropoff_location ?? base.dropoff_location,
        pickup_datetime: ex.pickup_datetime ?? base.pickup_datetime,
        dropoff_datetime: ex.dropoff_datetime ?? base.dropoff_datetime,
        rental_cost_cents: ex.rental_cost_cents ?? base.rental_cost_cents,
        one_way: ex.one_way ?? base.one_way,
        estimated_miles: ex.estimated_miles ?? base.estimated_miles,
      })
      setOcrHint('AI-filled from your confirmation — review and Save.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read confirmation')
    }
  }

  const statusBadge = rental ? (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">
      {STATUS_LABELS[rental.status]}
    </span>
  ) : (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400">
      No Rental
    </span>
  )

  return (
    <div className="border rounded-xl bg-white dark:bg-gray-800 dark:border-gray-700">
      <button
        aria-expanded={expanded}
        className="w-full flex items-center justify-between px-4 py-3 text-left min-h-12"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-2">
          <TruckIcon className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          <span className="font-semibold text-sm text-gray-900 dark:text-white">Truck Rental</span>
          {statusBadge}
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t dark:border-gray-700 pt-3">
          {isLoading && <p className="text-sm text-gray-400">Loading...</p>}

          <input ref={confRef} type="file" accept="image/*" className="hidden" onChange={handleConfirmationUpload} />

          {/* Empty state */}
          {!isLoading && !rental && !editing && (
            <div className="space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  onClick={handleBookUhaul}
                  disabled={!canBook}
                  title={canBook ? undefined : 'Add job date or address to pre-fill U-Haul'}
                  className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <TruckIcon className="w-4 h-4" />
                  Book U-Haul
                </button>
                <button
                  onClick={handleLogRental}
                  className="flex-1 rounded-lg border px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 active:scale-[0.98] dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  Log Rental
                </button>
              </div>
              <button
                onClick={() => confRef.current?.click()}
                disabled={scanning}
                className="w-full rounded-lg border border-dashed border-violet-300 dark:border-violet-700 px-4 py-2.5 text-sm font-medium text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/20 disabled:opacity-50"
              >
                {scanning ? 'Reading confirmation…' : '✨ Scan U-Haul confirmation (auto-fills)'}
              </button>
            </div>
          )}

          {/* Saved state */}
          {!isLoading && rental && !editing && (
            <div className="space-y-3">
              <StageStrip status={rental.status} />

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {rental.truck_size && (
                  <>
                    <dt className="text-gray-500 dark:text-gray-400">Truck</dt>
                    <dd className="font-medium text-gray-900 dark:text-white">{rental.truck_size}</dd>
                  </>
                )}
                {rental.confirmation_number && (
                  <>
                    <dt className="text-gray-500 dark:text-gray-400">Confirmation</dt>
                    <dd className="font-medium text-gray-900 dark:text-white">{rental.confirmation_number}</dd>
                  </>
                )}
                {rental.pickup_location && (
                  <>
                    <dt className="text-gray-500 dark:text-gray-400">Pickup</dt>
                    <dd className="font-medium"><MapLink label={rental.pickup_location} value={rental.pickup_location} /></dd>
                  </>
                )}
                {rental.dropoff_location && (
                  <>
                    <dt className="text-gray-500 dark:text-gray-400">Return</dt>
                    <dd className="font-medium"><MapLink label={rental.dropoff_location} value={rental.dropoff_location} /></dd>
                  </>
                )}
                {rental.pickup_datetime && (
                  <>
                    <dt className="text-gray-500 dark:text-gray-400">Pickup time</dt>
                    <dd className="font-medium text-gray-900 dark:text-white">{fmtDateTime(rental.pickup_datetime)}</dd>
                  </>
                )}
                {rental.dropoff_datetime && (
                  <>
                    <dt className="text-gray-500 dark:text-gray-400">Return time</dt>
                    <dd className="font-medium text-gray-900 dark:text-white">{fmtDateTime(rental.dropoff_datetime)}</dd>
                  </>
                )}
                {rental.rental_cost_cents !== null && (
                  <>
                    <dt className="text-gray-500 dark:text-gray-400">Cost</dt>
                    <dd className="font-medium text-gray-900 dark:text-white">${centsToDisplay(rental.rental_cost_cents)}</dd>
                  </>
                )}
                {rental.estimated_miles !== null && (
                  <>
                    <dt className="text-gray-500 dark:text-gray-400">Est. miles</dt>
                    <dd className="font-medium text-gray-900 dark:text-white">{rental.estimated_miles}</dd>
                  </>
                )}
                <dt className="text-gray-500 dark:text-gray-400">Type</dt>
                <dd className="font-medium text-gray-900 dark:text-white">{rental.one_way ? 'One-way' : 'Round-trip'}</dd>
              </dl>

              {rental.rental_cost_cents !== null && rental.rental_cost_cents > 0 && (
                <span className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                  ✓ Synced to finances
                </span>
              )}

              {/* Confirmation screenshot */}
              <div className="flex items-center gap-3 text-sm">
                {rental.confirmation_url ? (
                  <>
                    <a href={buildUploadUrl(rental.confirmation_url)} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline dark:text-blue-400">View confirmation</a>
                    <button onClick={() => confRef.current?.click()} disabled={scanning} className="text-violet-600 dark:text-violet-400 hover:underline disabled:opacity-50">{scanning ? 'Reading…' : 'Re-scan'}</button>
                    <button onClick={() => deleteConfirmation.mutateAsync().catch(() => setError('Failed to remove confirmation'))} className="text-red-500 hover:underline">Remove</button>
                  </>
                ) : (
                  <button onClick={() => confRef.current?.click()} disabled={scanning} className="text-violet-600 dark:text-violet-400 hover:underline disabled:opacity-50">
                    {scanning ? 'Reading confirmation…' : '✨ Scan confirmation (auto-fills)'}
                  </button>
                )}
              </div>

              {/* Receipt */}
              <div className="flex items-center gap-2 text-sm">
                {rental.receipt_url ? (
                  <>
                    <a href={buildUploadUrl(rental.receipt_url)} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline dark:text-blue-400">View receipt</a>
                    <button onClick={handleDeleteReceipt} disabled={deleteReceipt.isPending} className="text-xs text-red-500 hover:underline disabled:opacity-50">{deleteReceipt.isPending ? 'Removing...' : 'Remove'}</button>
                  </>
                ) : (
                  <>
                    <input ref={receiptRef} type="file" accept="image/*,.pdf" className="hidden" onChange={handleReceiptUpload} />
                    <button onClick={() => receiptRef.current?.click()} disabled={uploadReceipt.isPending} className="text-gray-500 hover:text-gray-700 underline dark:text-gray-400 disabled:opacity-50">{uploadReceipt.isPending ? 'Uploading...' : 'Upload receipt'}</button>
                  </>
                )}
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}

              <div className="flex gap-2 pt-1">
                {rental.status !== 'completed' && (
                  <button
                    onClick={advanceStage}
                    disabled={upsert.isPending}
                    className="flex-1 rounded-lg bg-orange-500 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50"
                  >
                    {rental.status === 'reserved' ? 'Mark Confirmed' : 'Mark Completed'}
                  </button>
                )}
                <button
                  onClick={handleLogRental}
                  className="flex-1 rounded-lg border px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  Edit
                </button>
              </div>
            </div>
          )}

          {/* Edit form */}
          {editing && (
            <div className="space-y-3">
              {ocrHint && (
                <div className="rounded-lg border border-violet-200 bg-violet-50 dark:border-violet-800 dark:bg-violet-900/20 px-3 py-2 text-xs font-medium text-violet-700 dark:text-violet-300">
                  {ocrHint}
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Status</label>
                <select
                  value={form.status}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value as TruckRentalStatus }))}
                  className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                >
                  <option value="reserved">Reserved</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="completed">Completed</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Confirmation #</label>
                <input type="text" value={form.confirmation_number ?? ''} onChange={e => setForm(f => ({ ...f, confirmation_number: e.target.value || null }))} placeholder="e.g. HHL-12345" className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Truck size</label>
                <select value={form.truck_size ?? ''} onChange={e => setForm(f => ({ ...f, truck_size: (e.target.value || null) as typeof f.truck_size }))} className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                  <option value="">Select size...</option>
                  {TRUCK_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">One-way</label>
                <button type="button" role="switch" aria-checked={form.one_way} aria-label="One-way rental" onClick={() => setForm(f => ({ ...f, one_way: !f.one_way }))} className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${form.one_way ? 'bg-orange-500' : 'bg-gray-200 dark:bg-gray-600'}`}>
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${form.one_way ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Pickup location</label>
                <input type="text" value={form.pickup_location ?? ''} onChange={e => setForm(f => ({ ...f, pickup_location: e.target.value || null }))} placeholder="U-Haul branch address" className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Return location {!form.one_way && <span className="text-gray-400">(one-way)</span>}</label>
                <input type="text" value={form.dropoff_location ?? ''} onChange={e => setForm(f => ({ ...f, dropoff_location: e.target.value || null }))} placeholder="Return branch address" className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Pickup date & time</label>
                <input type="datetime-local" value={form.pickup_datetime?.slice(0, 16) ?? ''} onChange={e => setForm(f => ({ ...f, pickup_datetime: e.target.value || null }))} className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Return date & time</label>
                <input type="datetime-local" value={form.dropoff_datetime?.slice(0, 16) ?? ''} onChange={e => setForm(f => ({ ...f, dropoff_datetime: e.target.value || null }))} className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Rental cost ($)</label>
                <input type="number" min="0" step="0.01" value={costInput} onChange={e => setCostInput(e.target.value)} placeholder="0.00" className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
                <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">Auto-tracked as a "Truck Rental" expense in Finances.</p>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Estimated miles</label>
                <input type="number" min="0" step="0.1" value={form.estimated_miles ?? ''} onChange={e => setForm(f => ({ ...f, estimated_miles: e.target.value ? parseFloat(e.target.value) : null }))} placeholder="0" className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Actual miles (after job)</label>
                <input type="number" min="0" step="0.1" value={form.actual_miles ?? ''} onChange={e => setForm(f => ({ ...f, actual_miles: e.target.value ? parseFloat(e.target.value) : null }))} placeholder="0" className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Notes</label>
                <textarea value={form.notes ?? ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value || null }))} rows={2} placeholder="Any additional details..." className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}

              <div className="flex gap-2">
                <button onClick={handleSave} disabled={upsert.isPending} className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                  {upsert.isPending ? 'Saving...' : 'Save'}
                </button>
                <button onClick={() => { setEditing(false); setConfirmDelete(false); setError(''); setOcrHint('') }} className="rounded-lg border px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700">
                  Cancel
                </button>
              </div>

              {rental && (
                <div className="border-t pt-3 dark:border-gray-700">
                  {!confirmDelete ? (
                    <button onClick={() => setConfirmDelete(true)} className="text-sm text-red-500 hover:underline">Delete rental</button>
                  ) : (
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-700 dark:text-gray-300">Are you sure?</span>
                      <button onClick={handleDelete} disabled={deleteMutation.isPending} className="text-sm font-semibold text-red-600 hover:underline disabled:opacity-50">{deleteMutation.isPending ? 'Deleting...' : 'Yes, delete'}</button>
                      <button onClick={() => setConfirmDelete(false)} className="text-sm text-gray-500 hover:underline">Cancel</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
