import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { DateOptionsEditor } from '../../components/DateOptionsEditor'
import { buildUploadUrl } from '../../services/api'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { mergeDateOptions, parseDateOptions, serializeDateOptions } from '../../utils/dateOptions'
import { fmtDurationMinutes, fmtLocalDateTime, fmtTimeSlot } from '../../utils/time'
import {
  useAddNote,
  useApplyOcrFields,
  useDeleteLead,
  useTriggerExtraction,
  useUpdateStatus,
  useUploadScreenshot,
} from '../../hooks/useLeads'
import type { Lead, LeadStatus, OcrField, OcrResult } from '../../types/lead'

const ALL_STATUSES: LeadStatus[] = [
  'new',
  'in_review',
  'replied',
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
  replied: 'Replied',
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

interface Props {
  lead: Lead
  leadId: string
  onGoToQuote: () => void
}



export function LogPanel({ lead, leadId, onGoToQuote }: Props) {
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
  const [extractResults, setExtractResults] = useState<Record<string, OcrResult>>({})
  const [applyDraft, setApplyDraft] = useState<Record<string, Record<string, string>>>({})
  const fileRef = useRef<HTMLInputElement>(null)

  const handleStatusChange = (status: LeadStatus) => {
    if (status === 'booked') {
      onGoToQuote()
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
          const requestedDates = mergeDateOptions(
            ...fields
              .filter(field => field.field === 'move_date_options' || field.field === 'job_date_requested')
              .map(field => field.value),
          )
          fields.forEach(field => {
            if (field.field === 'move_date_options' || field.field === 'job_date_requested') return
            draft[field.field] = field.value
          })
          if (requestedDates.length > 0) {
            draft.move_date_options = serializeDateOptions(requestedDates)
          }
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
      <div className="space-y-5 p-4 pb-24">
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Move to Status</h3>
          <div className="flex flex-wrap gap-2">
            {ALL_STATUSES.map(status => {
              const isCurrent = status === lead.status
              return (
                <button
                  key={status}
                  onClick={() => !isCurrent && handleStatusChange(status)}
                  disabled={isCurrent || updateStatus.isPending}
                  className={isCurrent
                    ? 'rounded-lg border border-indigo-600 bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white cursor-default dark:border-indigo-500 dark:bg-indigo-500'
                    : 'rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700'
                  }
                >
                  {STATUS_LABELS[status]}
                </button>
              )
            })}
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
                const requestedDates = parseDateOptions(draft.move_date_options)
                const showRequestedDatesEditor =
                  extractedFields.some(field => field.field === 'move_date_options' || field.field === 'job_date_requested') ||
                  requestedDates.length > 0
                const isExtracting =
                  triggerExtract.isPending &&
                  (triggerExtract.variables as { leadId: string; screenshotId: string } | undefined)?.screenshotId === screenshot.id

                return (
                  <div key={screenshot.id} className="space-y-3 rounded-xl border bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
                    <div className="flex items-center justify-between gap-2">
                      <a
                        href={buildUploadUrl(screenshot.stored_path)}
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
                        {showRequestedDatesEditor && (
                          <div className="space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                            <div>
                              <span className="block text-xs font-medium text-gray-500 dark:text-gray-400">
                                Requested Dates
                              </span>
                              <div className="mt-1">
                                <DateOptionsEditor
                                  values={requestedDates}
                                  onChange={values =>
                                    setApplyDraft(prev => ({
                                      ...prev,
                                      [screenshot.id]: {
                                        ...prev[screenshot.id],
                                        move_date_options: serializeDateOptions(values),
                                      },
                                    }))
                                  }
                                />
                              </div>
                              <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                                Keep every date option shown in the screenshot here.
                              </p>
                            </div>

                            <label className="block">
                              <span className="block text-xs font-medium text-gray-500 dark:text-gray-400">
                                Actual Booking Date
                              </span>
                              <input
                                type="date"
                                className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                                value={draft.job_date_requested ?? ''}
                                onChange={event =>
                                  setApplyDraft(prev => ({
                                    ...prev,
                                    [screenshot.id]: {
                                      ...prev[screenshot.id],
                                      job_date_requested: event.target.value,
                                    },
                                  }))
                                }
                              />
                            </label>
                          </div>
                        )}
                        {extractedFields
                          .filter(field => field.field !== 'move_date_options' && field.field !== 'job_date_requested')
                          .map(field => (
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
    </>
  )
}
