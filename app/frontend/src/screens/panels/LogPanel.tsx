import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { DateOptionsEditor } from '../../components/DateOptionsEditor'
import { EscalateSheet } from '../../components/EscalateSheet'
import { buildUploadUrl } from '../../services/api'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { mergeDateOptions, parseDateOptions, serializeDateOptions } from '../../utils/dateOptions'
import { fmtLocalDateTime } from '../../utils/time'
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

/** The log shows the latest few entries until asked for the whole history. */
const HISTORY_PREVIEW = 6

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
  const [showEscalate, setShowEscalate] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
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
    deleteLead.mutate(leadId, { onSuccess: () => navigate('/') })
  }

  const events = lead.events ?? []
  const shownEvents = showHistory ? events : events.slice(-HISTORY_PREVIEW)

  return (
    <>
      <div className="wd-pane flex flex-col gap-3 px-3.5 pb-6 pt-3">
        <section className="wd-box wd-box-soft">
          <h3 className="wd-fl">Activity</h3>
          {events.length === 0 ? (
            <p className="text-sm text-mu">Nothing logged yet.</p>
          ) : (
            <>
              {events.length > HISTORY_PREVIEW && (
                <button
                  type="button"
                  onClick={() => setShowHistory(current => !current)}
                  className="wd-btn-sm wd-btn-ghost mb-3 w-full"
                >
                  {showHistory ? 'Show latest only' : `Show all ${events.length}`}
                </button>
              )}
              <ol className="flex flex-col" aria-label="Activity">
                {shownEvents.map((event, i) => (
                  <li key={event.id} className={`wd-tl-i ${i === shownEvents.length - 1 ? 'hot' : ''}`}>
                    <span className="wd-tl-d" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="wd-tl-t">
                        {EVENT_LABELS[event.event_type] ?? event.event_type}
                        {event.from_status && event.to_status && (
                          <span className="font-normal text-mu">
                            {' '}· {event.from_status.replace(/_/g, ' ')} to {event.to_status.replace(/_/g, ' ')}
                          </span>
                        )}
                      </p>
                      {event.note && event.event_type === 'note_added' && (
                        <p className="mt-0.5 text-sm italic [overflow-wrap:anywhere]">"{event.note}"</p>
                      )}
                      <p className="wd-tl-s">
                        {event.actor ? `${event.actor} · ` : ''}{fmtLocalDateTime(event.created_at)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>

        <form onSubmit={handleNoteSubmit} className="flex gap-2">
          <input
            className="wd-input min-w-0 flex-1"
            placeholder="Add a note…"
            aria-label="Note"
            value={noteBody}
            onChange={event => setNoteBody(event.target.value)}
          />
          <button type="submit" disabled={addNote.isPending || !noteBody.trim()} className="wd-btn shrink-0">
            {addNote.isPending ? 'Saving…' : 'Add'}
          </button>
        </form>
        {addNote.isError && <p className="wd-err -mt-1 px-1">Couldn't save the note. Try again.</p>}

        <section className="wd-box wd-box-soft">
          <h3 className="wd-fl">Move to status</h3>
          <div className="flex flex-wrap gap-2">
            {ALL_STATUSES.map(status => {
              const isCurrent = status === lead.status
              return (
                <button
                  key={status}
                  onClick={() => !isCurrent && handleStatusChange(status)}
                  disabled={isCurrent || updateStatus.isPending}
                  aria-pressed={isCurrent}
                  className={isCurrent
                    ? 'wd-btn-sm !bg-ink !text-bg !opacity-100'
                    : 'wd-btn-sm wd-btn-ghost !shadow-[inset_0_0_0_1.5px_var(--ln)]'
                  }
                >
                  {STATUS_LABELS[status]}
                </button>
              )
            })}
          </div>
          {updateStatus.isError && <p className="wd-err mt-2">Couldn't change the status. Try again.</p>}
          <button
            onClick={() => setShowEscalate(true)}
            className="wd-btn-sm wd-btn-ghost mt-3 !shadow-[inset_0_0_0_1.5px_var(--ac)]"
          >
            ⚠ Escalate to owner
          </button>
        </section>

        <section className="wd-box wd-box-soft">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="wd-fl !mb-0">
              Screenshots {lead.screenshots && lead.screenshots.length > 0 && `(${lead.screenshots.length})`}
            </h3>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploadShot.isPending}
              className="wd-btn-sm wd-btn-ghost"
            >
              {uploadShot.isPending ? 'Uploading…' : '+ Add screenshot'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAddScreenshot}
            />
          </div>
          {uploadShot.isError && <p className="wd-err mb-2">Upload failed. Try again.</p>}

          {lead.screenshots && lead.screenshots.length > 0 ? (
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
                  <div key={screenshot.id} className="space-y-3 rounded-card bg-bg p-3">
                    <div className="flex items-center justify-between gap-2">
                      <a
                        href={buildUploadUrl(screenshot.stored_path)}
                        target="_blank"
                        rel="noreferrer"
                        className="flex min-h-11 min-w-0 flex-1 items-center truncate text-sm font-medium text-ok underline"
                      >
                        {screenshot.original_filename}
                      </a>
                      <div className="flex shrink-0 items-center gap-2">
                        {screenshot.ocr_status && (
                          <span
                            className={`wd-st ${
                              screenshot.ocr_status === 'done'
                                ? 'wd-st-green'
                                : screenshot.ocr_status === 'failed'
                                  ? 'wd-st-red'
                                  : 'wd-st-new'
                            }`}
                          >
                            {screenshot.ocr_status}
                          </span>
                        )}
                        <button
                          onClick={() => handleExtract(screenshot.id)}
                          disabled={isExtracting}
                          className="wd-btn-sm"
                        >
                          {isExtracting ? 'Reading…' : 'Extract'}
                        </button>
                      </div>
                    </div>
                    {triggerExtract.isError && isExtracting === false && (triggerExtract.variables as { screenshotId: string } | undefined)?.screenshotId === screenshot.id && (
                      <p className="wd-err">Couldn't read this screenshot. Try again.</p>
                    )}

                    {extractedFields.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-mu">Extracted fields. Review before applying.</p>
                        {showRequestedDatesEditor && (
                          <div className="space-y-2 rounded-card bg-sf p-3">
                            <div>
                              <span className="wd-fl !mb-1">Requested dates</span>
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
                              <p className="wd-hint">
                                Keep every date option shown in the screenshot here.
                              </p>
                            </div>

                            <label className="block">
                              <span className="wd-fl !mb-1">Actual booking date</span>
                              <input
                                type="date"
                                className="wd-input"
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
                          <label key={field.field} className="flex items-center gap-2">
                            <span className="w-28 shrink-0 text-xs capitalize text-mu">
                              {field.field.replace(/_/g, ' ')}
                            </span>
                            <input
                              className="wd-input min-w-0 flex-1"
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
                          </label>
                          ))}
                        <button
                          onClick={() => handleApply(screenshot.id)}
                          disabled={applyOcr.isPending}
                          className="wd-btn w-full"
                        >
                          {applyOcr.isPending ? 'Applying…' : 'Apply to lead'}
                        </button>
                        {applyOcr.isError && <p className="wd-err">Couldn't apply these fields. Try again.</p>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-mu">No screenshots on this lead.</p>
          )}
        </section>

        <section className="pt-2">
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={deleteLead.isPending}
              className="wd-btn-sm wd-btn-ghost !text-danger !shadow-[inset_0_0_0_1.5px_var(--red)]"
            >
              Delete lead
            </button>
          ) : (
            <div className="wd-box !shadow-[inset_0_0_0_1.5px_var(--red)]" role="alertdialog" aria-label="Delete this lead">
              <p className="text-sm font-semibold">Delete this lead and all its data?</p>
              <p className="mt-1 text-xs text-mu">This can't be undone.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={handleDelete} disabled={deleteLead.isPending} className="wd-btn-sm !bg-danger">
                  {deleteLead.isPending ? 'Deleting…' : 'Yes, delete for good'}
                </button>
                <button onClick={() => setConfirmDelete(false)} disabled={deleteLead.isPending} className="wd-btn-sm wd-btn-ghost">
                  Keep it
                </button>
              </div>
            </div>
          )}
          {deleteLead.isError && (
            <p className="wd-err mt-2">
              {(deleteLead.error as Error)?.message ?? 'Delete failed'}
            </p>
          )}
        </section>
      </div>
        {showEscalate && <EscalateSheet leadId={leadId} onClose={() => setShowEscalate(false)} />}
    </>
  )
}
