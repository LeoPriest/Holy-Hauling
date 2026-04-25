import { useEffect, useRef, useState, type ChangeEvent, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { fmtLocalDateTime } from '../../utils/time'
import {
  useAddNote,
  useApplyOcrFields,
  useDeleteLead,
  useTriggerExtraction,
  useUpdateStatus,
  useUploadScreenshot,
} from '../../hooks/useLeads'
import type { Lead, LeadStatus, OcrField, OcrResult, QuoteModifier } from '../../types/lead'

const ALL_STATUSES: LeadStatus[] = [
  'new',
  'in_review',
  'waiting_on_customer',
  'ready_for_quote',
  'ready_for_booking',
  'escalated',
  'booked',
  'released',
  'lost',
]

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  in_review: 'In Review',
  waiting_on_customer: 'Waiting',
  ready_for_quote: 'Ready to Quote',
  ready_for_booking: 'Ready to Book',
  escalated: 'Escalated',
  booked: 'Booked',
  released: 'Completed',
  lost: 'Released',
}

const EVENT_LABELS: Record<string, string> = {
  created: 'Lead created',
  status_changed: 'Status changed',
  acknowledged: 'Acknowledged',
  field_updated: 'Fields updated',
  note_added: 'Operational note',
  screenshot_added: 'Screenshot attached',
  assigned: 'Assigned',
  ocr_fields_applied: 'Extraction applied',
}

type BookingLineItemDraft = {
  id: string
  amount: string
  note: string
}

interface Props {
  lead: Lead
  leadId: string
}

function createLineItem(note = '', amount = ''): BookingLineItemDraft {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    amount,
    note,
  }
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}

function parseMoney(value: string): number | null {
  const normalized = value.replace(/[$,\s]/g, '')
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? roundMoney(parsed) : null
}

function parseDurationMinutes(value: string): number | null {
  const normalized = value.trim()
  if (!normalized) return null
  if (!/^\d+$/.test(normalized)) return null
  const parsed = Number.parseInt(normalized, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

function buildInitialQuoteDraft(lead: Lead) {
  if (lead.quoted_price_total != null && lead.quote_modifiers?.length) {
    return {
      total: String(lead.quoted_price_total),
      lineItems: lead.quote_modifiers.map(item => createLineItem(item.note, String(item.amount))),
      estimatedDurationMinutes: lead.estimated_job_duration_minutes != null
        ? String(lead.estimated_job_duration_minutes)
        : '',
    }
  }

  if (lead.quoted_price_total != null) {
    return {
      total: String(lead.quoted_price_total),
      lineItems: [createLineItem('Base quote', String(lead.quoted_price_total))],
      estimatedDurationMinutes: lead.estimated_job_duration_minutes != null
        ? String(lead.estimated_job_duration_minutes)
        : '',
    }
  }

  return {
    total: '',
    lineItems: [createLineItem('Base quote')],
    estimatedDurationMinutes: lead.estimated_job_duration_minutes != null
      ? String(lead.estimated_job_duration_minutes)
      : '',
  }
}

function BookingModal({
  quotedPriceTotal,
  setQuotedPriceTotal,
  estimatedDurationMinutes,
  setEstimatedDurationMinutes,
  lineItems,
  setLineItems,
  error,
  isSubmitting,
  onClose,
  onConfirm,
}: {
  quotedPriceTotal: string
  setQuotedPriceTotal: (value: string) => void
  estimatedDurationMinutes: string
  setEstimatedDurationMinutes: (value: string) => void
  lineItems: BookingLineItemDraft[]
  setLineItems: Dispatch<SetStateAction<BookingLineItemDraft[]>>
  error: string
  isSubmitting: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const quotedTotalValue = parseMoney(quotedPriceTotal)
  const summedLineItems = roundMoney(
    lineItems.reduce((sum, item) => sum + (parseMoney(item.amount) ?? 0), 0),
  )
  const difference = quotedTotalValue == null ? null : roundMoney(quotedTotalValue - summedLineItems)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSubmitting) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = ''
    }
  }, [isSubmitting, onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-label="Close booking modal"
        onClick={() => {
          if (!isSubmitting) onClose()
        }}
      />

      <div className="relative z-10 w-full max-w-xl overflow-hidden rounded-2xl border bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
        <div className="border-b px-5 py-4 dark:border-gray-700">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">Book lead</h3>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Enter the quoted total and the line items that make up that price.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="text-sm text-gray-400 hover:text-gray-700 disabled:opacity-50 dark:hover:text-gray-200"
            >
              Close
            </button>
          </div>
        </div>

        <div className="max-h-[80vh] space-y-4 overflow-y-auto px-5 py-4">
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Quoted price</span>
            <input
              type="text"
              inputMode="decimal"
              value={quotedPriceTotal}
              onChange={event => setQuotedPriceTotal(event.target.value)}
              placeholder="500.00"
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Estimated duration (minutes)</span>
            <input
              type="number"
              min="1"
              step="15"
              inputMode="numeric"
              value={estimatedDurationMinutes}
              onChange={event => setEstimatedDurationMinutes(event.target.value)}
              placeholder="120"
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            />
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Google Calendar will use this length when the job has a scheduled time slot.
            </p>
          </label>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Price breakdown</span>
              <button
                type="button"
                onClick={() => setLineItems(prev => [...prev, createLineItem('', '')])}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                Add modifier
              </button>
            </div>

            {lineItems.map((item, index) => (
              <div
                key={item.id}
                className="grid grid-cols-1 gap-2 rounded-xl border border-gray-200 p-3 dark:border-gray-700 md:grid-cols-[140px_minmax(0,1fr)_auto]"
              >
                <input
                  type="text"
                  inputMode="decimal"
                  value={item.amount}
                  onChange={event =>
                    setLineItems(prev =>
                      prev.map(entry =>
                        entry.id === item.id ? { ...entry, amount: event.target.value } : entry,
                      ),
                    )
                  }
                  placeholder="0.00"
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                />
                <input
                  type="text"
                  value={item.note}
                  onChange={event =>
                    setLineItems(prev =>
                      prev.map(entry =>
                        entry.id === item.id ? { ...entry, note: event.target.value } : entry,
                      ),
                    )
                  }
                  placeholder={index === 0 ? 'Base quote' : 'Modifier note'}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                />
                <button
                  type="button"
                  onClick={() =>
                    setLineItems(prev => (prev.length === 1 ? [createLineItem('Base quote')] : prev.filter(entry => entry.id !== item.id)))
                  }
                  className="rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-900/20"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          <div className="rounded-xl bg-gray-50 px-4 py-3 text-sm dark:bg-gray-800">
            <div className="flex items-center justify-between gap-3">
              <span className="text-gray-500 dark:text-gray-400">Modifier sum</span>
              <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(summedLineItems)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="text-gray-500 dark:text-gray-400">Difference to quoted price</span>
              <span
                className={`font-medium ${
                  difference === 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-amber-600 dark:text-amber-400'
                }`}
              >
                {difference == null ? '--' : formatCurrency(difference)}
              </span>
            </div>
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-5 py-4 dark:border-gray-700">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {isSubmitting ? 'Booking...' : 'Confirm booking'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function LogPanel({ lead, leadId }: Props) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const updateStatus = useUpdateStatus()
  const addNote = useAddNote()
  const uploadShot = useUploadScreenshot()
  const triggerExtract = useTriggerExtraction()
  const applyOcr = useApplyOcrFields()
  const deleteLead = useDeleteLead()

  const [noteBody, setNoteBody] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [showBookingModal, setShowBookingModal] = useState(false)
  const [bookingError, setBookingError] = useState('')
  const [quotedPriceTotal, setQuotedPriceTotal] = useState('')
  const [estimatedDurationMinutes, setEstimatedDurationMinutes] = useState('')
  const [bookingLineItems, setBookingLineItems] = useState<BookingLineItemDraft[]>([])
  const [extractResults, setExtractResults] = useState<Record<string, OcrResult>>({})
  const [applyDraft, setApplyDraft] = useState<Record<string, Record<string, string>>>({})
  const fileRef = useRef<HTMLInputElement>(null)

  const resetBookingDraft = () => {
    const draft = buildInitialQuoteDraft(lead)
    setQuotedPriceTotal(draft.total)
    setEstimatedDurationMinutes(draft.estimatedDurationMinutes)
    setBookingLineItems(draft.lineItems)
    setBookingError('')
  }

  const handleOpenBookingModal = () => {
    resetBookingDraft()
    setShowBookingModal(true)
  }

  const handleCloseBookingModal = () => {
    if (updateStatus.isPending) return
    setShowBookingModal(false)
    setBookingError('')
  }

  const handleConfirmBooked = () => {
    const total = parseMoney(quotedPriceTotal)
    if (total == null || total <= 0) {
      setBookingError('Enter a valid quoted price greater than 0.')
      return
    }

    const durationMinutes = parseDurationMinutes(estimatedDurationMinutes)
    if (durationMinutes == null) {
      setBookingError('Enter a valid estimated duration in minutes.')
      return
    }

    const activeRows = bookingLineItems.filter(item => item.amount.trim() || item.note.trim())
    if (activeRows.length === 0) {
      setBookingError('Add at least one quote line item.')
      return
    }

    const modifiers: QuoteModifier[] = []
    for (const item of activeRows) {
      const amount = parseMoney(item.amount)
      if (amount == null) {
        setBookingError('Each modifier needs a valid amount.')
        return
      }
      if (!item.note.trim()) {
        setBookingError('Each modifier needs a note.')
        return
      }
      modifiers.push({ amount, note: item.note.trim() })
    }

    const summed = roundMoney(modifiers.reduce((sum, item) => sum + item.amount, 0))
    if (roundMoney(total - summed) !== 0) {
      setBookingError('Modifier amounts must add up exactly to the quoted price.')
      return
    }

    setBookingError('')
    updateStatus.mutate(
      {
        id: leadId,
        status: 'booked',
        actor: user?.username,
        quotedPriceTotal: total,
        quoteModifiers: modifiers,
        estimatedJobDurationMinutes: durationMinutes,
      },
      {
        onSuccess: () => {
          setShowBookingModal(false)
        },
        onError: error => {
          setBookingError((error as Error)?.message ?? 'Failed to book lead.')
        },
      },
    )
  }

  const handleStatusChange = (status: LeadStatus) => {
    if (status === 'booked') {
      handleOpenBookingModal()
      return
    }
    updateStatus.mutate({ id: leadId, status, actor: user?.username })
  }

  const handleNoteSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!noteBody.trim()) return
    addNote.mutate(
      { leadId, body: noteBody.trim(), actor: user?.username },
      { onSuccess: () => setNoteBody('') },
    )
  }

  const handleAddScreenshot = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    uploadShot.mutate({ leadId, file })
    event.target.value = ''
  }

  const handleExtract = (screenshotId: string) => {
    triggerExtract.mutate(
      { leadId, screenshotId },
      {
        onSuccess: result => {
          setExtractResults(prev => ({ ...prev, [screenshotId]: result }))
          if (!result.extracted_fields) return
          const fields = JSON.parse(result.extracted_fields) as OcrField[]
          const draft: Record<string, string> = {}
          fields.forEach(field => {
            draft[field.field] = field.value
          })
          setApplyDraft(prev => ({ ...prev, [screenshotId]: draft }))
        },
      },
    )
  }

  const handleApply = (screenshotId: string) => {
    applyOcr.mutate({ leadId, screenshotId, fields: applyDraft[screenshotId] ?? {} })
  }

  const handleDelete = () => {
    if (window.confirm('Permanently delete this lead and all its data? This cannot be undone.')) {
      deleteLead.mutate(leadId, { onSuccess: () => navigate('/') })
    }
  }

  return (
    <>
      <div className="space-y-5 p-4 pb-10">
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Move to Status</h3>
          <div className="flex flex-wrap gap-2">
            {ALL_STATUSES.filter(status => status !== lead.status).map(status => (
              <button
                key={status}
                onClick={() => handleStatusChange(status)}
                disabled={updateStatus.isPending}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
              >
                {STATUS_LABELS[status]}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Add Note</h3>
          <form onSubmit={handleNoteSubmit} className="space-y-2">
            <textarea
              rows={2}
              className="w-full resize-none rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              placeholder="Called customer, left voicemail, requested gate code."
              value={noteBody}
              onChange={event => setNoteBody(event.target.value)}
            />
            <button
              type="submit"
              disabled={addNote.isPending || !noteBody.trim()}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {addNote.isPending ? 'Saving...' : 'Add Note'}
            </button>
          </form>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              Screenshots {lead.screenshots && lead.screenshots.length > 0 && `(${lead.screenshots.length})`}
            </h3>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploadShot.isPending}
              className="text-xs font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50 dark:text-blue-400 dark:hover:text-blue-300"
            >
              {uploadShot.isPending ? 'Uploading...' : '+ Add Screenshot'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAddScreenshot}
            />
          </div>

          {lead.screenshots && lead.screenshots.length > 0 && (
            <div className="space-y-3">
              {lead.screenshots.map(screenshot => {
                const result = extractResults[screenshot.id]
                const draft = applyDraft[screenshot.id] ?? {}
                const extractedFields: OcrField[] = result?.extracted_fields
                  ? JSON.parse(result.extracted_fields)
                  : []
                const isExtracting =
                  triggerExtract.isPending &&
                  (triggerExtract.variables as { leadId: string; screenshotId: string } | undefined)?.screenshotId === screenshot.id

                return (
                  <div key={screenshot.id} className="space-y-3 rounded-xl border bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
                    <div className="flex items-center justify-between gap-2">
                      <a
                        href={`/uploads/${screenshot.stored_path}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex-1 truncate text-xs text-blue-600 hover:underline dark:text-blue-400"
                      >
                        {screenshot.original_filename}
                      </a>
                      <div className="flex shrink-0 items-center gap-2">
                        {screenshot.ocr_status && (
                          <span
                            className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                              screenshot.ocr_status === 'done'
                                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                                : screenshot.ocr_status === 'failed'
                                  ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300'
                                  : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
                            }`}
                          >
                            {screenshot.ocr_status}
                          </span>
                        )}
                        <button
                          onClick={() => handleExtract(screenshot.id)}
                          disabled={isExtracting}
                          className="rounded px-2.5 py-1 text-xs text-white bg-gray-700 hover:bg-gray-600 disabled:opacity-50"
                        >
                          {isExtracting ? 'Extracting...' : 'Extract'}
                        </button>
                      </div>
                    </div>

                    {extractedFields.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Extracted fields. Review before applying.</p>
                        {extractedFields.map(field => (
                          <div key={field.field} className="flex items-center gap-2">
                            <span className="w-28 shrink-0 text-xs capitalize text-gray-500 dark:text-gray-400">
                              {field.field.replace(/_/g, ' ')}
                            </span>
                            <input
                              className="flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                              value={draft[field.field] ?? field.value}
                              onChange={event =>
                                setApplyDraft(prev => ({
                                  ...prev,
                                  [screenshot.id]: {
                                    ...prev[screenshot.id],
                                    [field.field]: event.target.value,
                                  },
                                }))
                              }
                            />
                          </div>
                        ))}
                        <button
                          onClick={() => handleApply(screenshot.id)}
                          disabled={applyOcr.isPending}
                          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {applyOcr.isPending ? 'Applying...' : 'Apply to Lead'}
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {lead.events && lead.events.length > 0 && (
          <section>
            <button
              onClick={() => setShowHistory(current => !current)}
              className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-gray-400"
            >
              Activity ({lead.events.length}) {showHistory ? 'Hide' : 'Show'}
            </button>
            {showHistory && (
              <div className="space-y-2">
                {lead.events.map(event => (
                  <div key={event.id} className="flex gap-2 text-xs text-gray-600 dark:text-gray-300">
                    <span className="mt-0.5 shrink-0 text-gray-300 dark:text-gray-600">•</span>
                    <div>
                      <span className="font-medium">{EVENT_LABELS[event.event_type] ?? event.event_type}</span>
                      {event.from_status && event.to_status && (
                        <span className="text-gray-400 dark:text-gray-500">
                          {' '}
                          - {event.from_status.replace(/_/g, ' ')} to {event.to_status.replace(/_/g, ' ')}
                        </span>
                      )}
                      {event.actor && <span className="text-gray-400 dark:text-gray-500"> - {event.actor}</span>}
                      {event.note && event.event_type === 'note_added' && (
                        <p className="mt-0.5 italic text-blue-600 dark:text-blue-400">"{event.note}"</p>
                      )}
                      <p className="mt-0.5 text-gray-300 dark:text-gray-500">{fmtLocalDateTime(event.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        <section className="border-t pt-2 dark:border-gray-700">
          <button
            onClick={handleDelete}
            disabled={deleteLead.isPending}
            className="rounded-lg border border-red-300 px-4 py-2 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-900/20"
          >
            {deleteLead.isPending ? 'Deleting...' : 'Delete Lead Permanently'}
          </button>
          {deleteLead.isError && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
              {(deleteLead.error as Error)?.message ?? 'Delete failed'}
            </p>
          )}
        </section>
      </div>

      {showBookingModal && (
        <BookingModal
          quotedPriceTotal={quotedPriceTotal}
          setQuotedPriceTotal={setQuotedPriceTotal}
          estimatedDurationMinutes={estimatedDurationMinutes}
          setEstimatedDurationMinutes={setEstimatedDurationMinutes}
          lineItems={bookingLineItems}
          setLineItems={setBookingLineItems}
          error={bookingError}
          isSubmitting={updateStatus.isPending}
          onClose={handleCloseBookingModal}
          onConfirm={handleConfirmBooked}
        />
      )}
    </>
  )
}
