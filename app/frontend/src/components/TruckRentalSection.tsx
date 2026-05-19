import { useRef, useState } from 'react'
import { buildUploadUrl } from '../services/api'
import {
  useDeleteReceipt,
  useDeleteTruckRental,
  useTruckRental,
  useUploadReceipt,
  useUpsertTruckRental,
} from '../hooks/useTruckRental'
import {
  STATUS_COLORS,
  STATUS_LABELS,
  TRUCK_SIZES,
  type TruckRentalInput,
  type TruckRentalStatus,
} from '../types/truck_rental'
import type { Lead } from '../types/lead'

interface Props {
  lead: Lead
}

const EMPTY_FORM: TruckRentalInput = {
  status: 'reserved',
  confirmation_number: null,
  truck_size: null,
  pickup_location: null,
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

function TruckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className ?? 'w-5 h-5'}>
      <path d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 0 0-3.213-9.193 2.056 2.056 0 0 0-1.58-.86H14.25M8.25 18.75H16.5M3.375 18.75H2.25m2.625-9.75H14.25" />
    </svg>
  )
}

export function TruckRentalSection({ lead }: Props) {
  const { data: rental, isLoading } = useTruckRental(lead.id)
  const upsert = useUpsertTruckRental(lead.id)
  const deleteMutation = useDeleteTruckRental(lead.id)
  const uploadReceipt = useUploadReceipt(lead.id)
  const deleteReceipt = useDeleteReceipt(lead.id)

  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [form, setForm] = useState<TruckRentalInput>(EMPTY_FORM)
  const [costInput, setCostInput] = useState('')
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const canBook = !!(lead.job_origin || lead.job_destination || lead.job_date_requested)

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
    if (rental) {
      openForm({
        status: rental.status,
        confirmation_number: rental.confirmation_number,
        truck_size: rental.truck_size,
        pickup_location: rental.pickup_location,
        pickup_datetime: rental.pickup_datetime,
        dropoff_datetime: rental.dropoff_datetime,
        rental_cost_cents: rental.rental_cost_cents,
        one_way: rental.one_way,
        estimated_miles: rental.estimated_miles,
        actual_miles: rental.actual_miles,
        notes: rental.notes,
      })
    } else {
      openForm(EMPTY_FORM)
    }
  }

  async function handleSave() {
    setError('')
    const payload: TruckRentalInput = {
      ...form,
      rental_cost_cents: displayToCents(costInput),
    }
    try {
      await upsert.mutateAsync(payload)
      setEditing(false)
      setExpanded(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
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
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleDeleteReceipt() {
    try {
      await deleteReceipt.mutateAsync()
    } catch {
      setError('Failed to remove receipt')
    }
  }

  const statusBadge = rental ? (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[rental.status]}`}>
      {STATUS_LABELS[rental.status]}
    </span>
  ) : (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400">
      No Rental
    </span>
  )

  return (
    <div className="border rounded-xl bg-white dark:bg-gray-800 dark:border-gray-700">
      {/* Header */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left"
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
          {isLoading && (
            <p className="text-sm text-gray-400">Loading...</p>
          )}

          {/* Empty state */}
          {!isLoading && !rental && !editing && (
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
          )}

          {/* Saved state */}
          {!isLoading && rental && !editing && (
            <div className="space-y-3">
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
                    <dt className="text-gray-500 dark:text-gray-400">Pickup location</dt>
                    <dd className="font-medium text-gray-900 dark:text-white">{rental.pickup_location}</dd>
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
                {rental.actual_miles !== null && (
                  <>
                    <dt className="text-gray-500 dark:text-gray-400">Actual miles</dt>
                    <dd className="font-medium text-gray-900 dark:text-white">{rental.actual_miles}</dd>
                  </>
                )}
                <dt className="text-gray-500 dark:text-gray-400">Type</dt>
                <dd className="font-medium text-gray-900 dark:text-white">{rental.one_way ? 'One-way' : 'Round-trip'}</dd>
              </dl>

              {/* Receipt */}
              {rental.receipt_url ? (
                <div className="flex items-center gap-2">
                  <a
                    href={buildUploadUrl(rental.receipt_url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 underline dark:text-blue-400"
                  >
                    View receipt
                  </a>
                  <button
                    onClick={handleDeleteReceipt}
                    className="text-xs text-red-500 hover:underline"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div>
                  <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={handleReceiptUpload} />
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="text-sm text-gray-500 hover:text-gray-700 underline dark:text-gray-400"
                  >
                    Upload receipt
                  </button>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleLogRental}
                  className="flex-1 rounded-lg border px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  Edit
                </button>
                <button
                  onClick={handleBookUhaul}
                  className="flex-1 rounded-lg bg-orange-500 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-600"
                >
                  Rebook U-Haul
                </button>
              </div>
            </div>
          )}

          {/* Edit form */}
          {editing && (
            <div className="space-y-3">
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
                <input
                  type="text"
                  value={form.confirmation_number ?? ''}
                  onChange={e => setForm(f => ({ ...f, confirmation_number: e.target.value || null }))}
                  placeholder="e.g. HHL-12345"
                  className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Truck size</label>
                <select
                  value={form.truck_size ?? ''}
                  onChange={e => setForm(f => ({ ...f, truck_size: (e.target.value || null) as typeof f.truck_size }))}
                  className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                >
                  <option value="">Select size...</option>
                  {TRUCK_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">One-way</label>
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, one_way: !f.one_way }))}
                  className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${form.one_way ? 'bg-orange-500' : 'bg-gray-200 dark:bg-gray-600'}`}
                >
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${form.one_way ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Pickup location</label>
                <input
                  type="text"
                  value={form.pickup_location ?? ''}
                  onChange={e => setForm(f => ({ ...f, pickup_location: e.target.value || null }))}
                  placeholder="U-Haul branch address"
                  className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Pickup date & time</label>
                <input
                  type="datetime-local"
                  value={form.pickup_datetime?.slice(0, 16) ?? ''}
                  onChange={e => setForm(f => ({ ...f, pickup_datetime: e.target.value || null }))}
                  className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Return date & time</label>
                <input
                  type="datetime-local"
                  value={form.dropoff_datetime?.slice(0, 16) ?? ''}
                  onChange={e => setForm(f => ({ ...f, dropoff_datetime: e.target.value || null }))}
                  className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Rental cost ($)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={costInput}
                  onChange={e => setCostInput(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Estimated miles</label>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={form.estimated_miles ?? ''}
                  onChange={e => setForm(f => ({ ...f, estimated_miles: e.target.value ? parseFloat(e.target.value) : null }))}
                  placeholder="0"
                  className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Actual miles (after job)</label>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={form.actual_miles ?? ''}
                  onChange={e => setForm(f => ({ ...f, actual_miles: e.target.value ? parseFloat(e.target.value) : null }))}
                  placeholder="0"
                  className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Notes</label>
                <textarea
                  value={form.notes ?? ''}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value || null }))}
                  rows={2}
                  placeholder="Any additional details..."
                  className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}

              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={upsert.isPending}
                  className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {upsert.isPending ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => { setEditing(false); setError('') }}
                  className="rounded-lg border px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
              </div>

              {rental && (
                <div className="border-t pt-3 dark:border-gray-700">
                  {!confirmDelete ? (
                    <button
                      onClick={() => setConfirmDelete(true)}
                      className="text-sm text-red-500 hover:underline"
                    >
                      Delete rental
                    </button>
                  ) : (
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-700 dark:text-gray-300">Are you sure?</span>
                      <button
                        onClick={handleDelete}
                        disabled={deleteMutation.isPending}
                        className="text-sm font-semibold text-red-600 hover:underline disabled:opacity-50"
                      >
                        {deleteMutation.isPending ? 'Deleting...' : 'Yes, delete'}
                      </button>
                      <button
                        onClick={() => setConfirmDelete(false)}
                        className="text-sm text-gray-500 hover:underline"
                      >
                        Cancel
                      </button>
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
