import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
  'new', 'in_review', 'waiting_on_customer', 'ready_for_quote',
  'ready_for_booking', 'escalated', 'booked', 'released', 'lost',
]

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  in_review: 'In Review',
  waiting_on_customer: 'Waiting',
  ready_for_quote: 'Ready to Quote',
  ready_for_booking: 'Ready to Book',
  escalated: 'Escalated',
  booked: 'Booked',
  released: 'Won ✓',
  lost: 'Lost',
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
}

export function LogPanel({ lead, leadId }: Props) {
  const navigate = useNavigate()
  const updateStatus   = useUpdateStatus()
  const addNote        = useAddNote()
  const uploadShot     = useUploadScreenshot()
  const triggerExtract = useTriggerExtraction()
  const applyOcr       = useApplyOcrFields()
  const deleteLead     = useDeleteLead()

  const [noteBody, setNoteBody] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [extractResults, setExtractResults] = useState<Record<string, OcrResult>>({})
  const [applyDraft, setApplyDraft] = useState<Record<string, Record<string, string>>>({})
  const fileRef = useRef<HTMLInputElement>(null)

  const handleNoteSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!noteBody.trim()) return
    addNote.mutate(
      { leadId, body: noteBody.trim() },
      { onSuccess: () => setNoteBody('') },
    )
  }

  const handleAddScreenshot = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    uploadShot.mutate({ leadId, file })
    e.target.value = ''
  }

  const handleExtract = (screenshotId: string) => {
    triggerExtract.mutate(
      { leadId, screenshotId },
      {
        onSuccess: result => {
          setExtractResults(prev => ({ ...prev, [screenshotId]: result }))
          if (result.extracted_fields) {
            const fields: OcrField[] = JSON.parse(result.extracted_fields)
            const draft: Record<string, string> = {}
            fields.forEach(f => { draft[f.field] = f.value })
            setApplyDraft(prev => ({ ...prev, [screenshotId]: draft }))
          }
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
    <div className="p-4 space-y-5 pb-10">

      {/* ── Status transitions ─────────────────────────────────────── */}
      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Move to Status</h3>
        <div className="flex flex-wrap gap-2">
          {ALL_STATUSES.filter(s => s !== lead.status).map(s => (
            <button
              key={s}
              onClick={() => updateStatus.mutate({ id: leadId, status: s })}
              disabled={updateStatus.isPending}
              className="text-xs border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </section>

      {/* ── Operational note ───────────────────────────────────────── */}
      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Add Note</h3>
        <form onSubmit={handleNoteSubmit} className="space-y-2">
          <textarea
            rows={2}
            className="w-full border rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="e.g. Called customer — left voicemail. Gate 1 attempt."
            value={noteBody}
            onChange={e => setNoteBody(e.target.value)}
          />
          <button
            type="submit"
            disabled={addNote.isPending || !noteBody.trim()}
            className="text-xs bg-blue-600 text-white rounded-lg px-4 py-1.5 hover:bg-blue-700 disabled:opacity-50"
          >
            {addNote.isPending ? 'Saving…' : 'Add Note'}
          </button>
        </form>
      </section>

      {/* ── Screenshots ────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Screenshots {lead.screenshots && lead.screenshots.length > 0 && `(${lead.screenshots.length})`}
          </h3>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploadShot.isPending}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50"
          >
            {uploadShot.isPending ? 'Uploading…' : '+ Add Screenshot'}
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
            {lead.screenshots.map(s => {
              const result = extractResults[s.id]
              const draft = applyDraft[s.id] ?? {}
              const extractedFields: OcrField[] = result?.extracted_fields
                ? JSON.parse(result.extracted_fields)
                : []
              const isExtracting =
                triggerExtract.isPending &&
                (triggerExtract.variables as { leadId: string; screenshotId: string } | undefined)?.screenshotId === s.id

              return (
                <div key={s.id} className="bg-white border rounded-xl p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <a
                      href={`/uploads/${s.stored_path}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-blue-600 hover:underline truncate flex-1"
                    >
                      {s.original_filename}
                    </a>
                    <div className="flex items-center gap-2 shrink-0">
                      {s.ocr_status && (
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                          s.ocr_status === 'done' ? 'bg-green-100 text-green-700' :
                          s.ocr_status === 'failed' ? 'bg-red-100 text-red-600' :
                          'bg-yellow-100 text-yellow-700'
                        }`}>{s.ocr_status}</span>
                      )}
                      <button
                        onClick={() => handleExtract(s.id)}
                        disabled={isExtracting}
                        className="text-xs bg-gray-700 text-white rounded px-2.5 py-1 hover:bg-gray-600 disabled:opacity-50"
                      >
                        {isExtracting ? 'Extracting…' : 'Extract'}
                      </button>
                    </div>
                  </div>

                  {extractedFields.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-gray-500">Extracted — edit then apply:</p>
                      {extractedFields.map(f => (
                        <div key={f.field} className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 w-28 shrink-0 capitalize">
                            {f.field.replace(/_/g, ' ')}
                          </span>
                          <input
                            className="flex-1 border rounded px-2 py-1 text-xs bg-white"
                            value={draft[f.field] ?? f.value}
                            onChange={e =>
                              setApplyDraft(prev => ({
                                ...prev,
                                [s.id]: { ...prev[s.id], [f.field]: e.target.value },
                              }))
                            }
                          />
                        </div>
                      ))}
                      <button
                        onClick={() => handleApply(s.id)}
                        disabled={applyOcr.isPending}
                        className="text-xs bg-blue-600 text-white rounded-lg px-3 py-1.5 hover:bg-blue-700 disabled:opacity-50"
                      >
                        {applyOcr.isPending ? 'Applying…' : 'Apply to Lead'}
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Activity history ───────────────────────────────────────── */}
      {lead.events && lead.events.length > 0 && (
        <section>
          <button
            onClick={() => setShowHistory(h => !h)}
            className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1"
          >
            Activity ({lead.events.length}) {showHistory ? '▲' : '▼'}
          </button>
          {showHistory && (
            <div className="space-y-2">
              {lead.events.map(ev => (
                <div key={ev.id} className="flex gap-2 text-xs text-gray-600">
                  <span className="text-gray-300 mt-0.5 shrink-0">•</span>
                  <div>
                    <span className="font-medium">{EVENT_LABELS[ev.event_type] ?? ev.event_type}</span>
                    {ev.from_status && ev.to_status && (
                      <span className="text-gray-400"> · {ev.from_status.replace(/_/g, ' ')} → {ev.to_status.replace(/_/g, ' ')}</span>
                    )}
                    {ev.actor && <span className="text-gray-400"> · {ev.actor}</span>}
                    {ev.note && ev.event_type === 'note_added' && (
                      <p className="mt-0.5 text-blue-600 italic">"{ev.note}"</p>
                    )}
                    <p className="text-gray-300 mt-0.5">{new Date(ev.created_at).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Danger zone ────────────────────────────────────────────── */}
      <section className="pt-2 border-t">
        <button
          onClick={handleDelete}
          disabled={deleteLead.isPending}
          className="text-xs border border-red-300 text-red-600 rounded-lg px-4 py-2 hover:bg-red-50 disabled:opacity-50"
        >
          {deleteLead.isPending ? 'Deleting…' : 'Delete Lead Permanently'}
        </button>
        {deleteLead.isError && (
          <p className="text-xs text-red-600 mt-1">
            {(deleteLead.error as Error)?.message ?? 'Delete failed'}
          </p>
        )}
      </section>

    </div>
  )
}
