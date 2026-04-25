import { useRef, useState } from 'react'
import { useCreateLead, useIngestScreenshot, usePatchLead } from '../hooks/useLeads'
import type { IngestResult, LeadCreate, LeadSourceType, LeadUpdate, OcrField, ServiceType } from '../types/lead'

type Mode = 'select' | 'screenshot' | 'manual'
type ScreenshotStage = 'upload' | 'processing' | 'review'

const SCREENSHOT_SOURCES: { value: LeadSourceType; label: string }[] = [
  { value: 'thumbtack_screenshot', label: 'Thumbtack' },
  { value: 'yelp_screenshot', label: 'Yelp' },
  { value: 'google_screenshot', label: 'Google' },
]

interface Props {
  onClose: () => void
}

function parseAllFields(extraction: IngestResult['extraction']): Record<string, string> {
  if (!extraction?.extracted_fields) return {}
  try {
    const fields: OcrField[] = JSON.parse(extraction.extracted_fields)
    return Object.fromEntries(fields.map(f => [f.field, f.value]))
  } catch {
    return {}
  }
}

export function LeadCreate({ onClose }: Props) {
  const [mode, setMode] = useState<Mode>('select')
  const [stage, setStage] = useState<ScreenshotStage>('upload')
  const [sourceType, setSourceType] = useState<LeadSourceType>('thumbtack_screenshot')
  const [ingestResult, setIngestResult] = useState<IngestResult | null>(null)
  const [ingestError, setIngestError] = useState<string | null>(null)

  // Review form (screenshot path) — customer_name starts empty, not pre-filled with a placeholder
  const [review, setReview] = useState({
    customer_name: '',
    customer_phone: '',
    job_location: '',
    job_date_requested: '',
    service_type: 'unknown' as ServiceType,
    urgency_flag: false,
    notes: '',
  })
  const [reviewError, setReviewError] = useState<string | null>(null)

  // Manual form (fallback path)
  const [form, setForm] = useState<LeadCreate>({
    source_type: 'manual',
    customer_name: '',
    service_type: 'unknown',
    urgency_flag: false,
  })
  const [manualError, setManualError] = useState<string | null>(null)

  const fileRef = useRef<HTMLInputElement>(null)
  const ingest = useIngestScreenshot()
  const { mutate: createLead, isPending: creating } = useCreateLead()
  const { mutate: patchLead, isPending: patching } = usePatchLead()
  const canDismiss = !(mode === 'screenshot' && stage === 'processing') && !creating && !patching

  // ── screenshot path ──────────────────────────────────────────────────────

  const handleFileSelect = (file: File) => {
    setIngestError(null)
    setStage('processing')
    ingest.mutate(
      { file, sourceType },
      {
        onSuccess: (result) => {
          setIngestResult(result)
          const extracted = parseAllFields(result.extraction)
          setReview({
            // customer_name: use auto-applied value or OCR suggestion; never a fake placeholder
            customer_name: result.lead.customer_name ?? extracted['customer_name'] ?? '',
            customer_phone: result.lead.customer_phone ?? extracted['customer_phone'] ?? '',
            job_location: result.lead.job_location ?? extracted['job_location'] ?? '',
            job_date_requested: result.lead.job_date_requested ?? extracted['job_date_requested'] ?? '',
            service_type: (result.lead.service_type !== 'unknown'
              ? result.lead.service_type
              : ((extracted['service_type'] as ServiceType) ?? 'unknown')),
            urgency_flag: false,
            notes: result.lead.notes ?? extracted['notes'] ?? '',
          })
          setStage('review')
        },
        onError: () => {
          setIngestError('Upload failed. Check your connection and try again.')
          setStage('upload')
        },
      },
    )
  }

  const handleConfirm = () => {
    if (!ingestResult) return
    if (!review.customer_name.trim()) {
      setReviewError('Customer name is required before adding to the queue.')
      return
    }
    setReviewError(null)
    const data: LeadUpdate = {
      customer_name: review.customer_name.trim(),
      customer_phone: review.customer_phone.trim() || undefined,
      job_location: review.job_location.trim() || undefined,
      job_date_requested: review.job_date_requested || undefined,
      service_type: review.service_type,
      urgency_flag: review.urgency_flag,
      notes: review.notes.trim() || undefined,
    }
    patchLead({ id: ingestResult.lead.id, data }, { onSuccess: () => onClose() })
  }

  const setR = (field: keyof typeof review, value: unknown) =>
    setReview(r => ({ ...r, [field]: value }))

  // ── manual path ──────────────────────────────────────────────────────────

  const set = (field: keyof LeadCreate, value: unknown) =>
    setForm(f => ({ ...f, [field]: value }))

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setManualError(null)
    createLead(form, {
      onSuccess: () => onClose(),
      onError: () => setManualError('Failed to create lead. Try again.'),
    })
  }

  // ── render ───────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 overflow-y-auto">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={canDismiss ? onClose : undefined}
      />
      <div className="relative bg-white rounded-xl w-full max-w-lg shadow-xl my-4 max-h-[calc(100vh-2rem)] overflow-y-auto">

        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-semibold text-gray-900">
            {mode === 'manual'
              ? 'Manual Entry'
              : mode === 'screenshot' && stage === 'review'
              ? 'Review Extracted Info'
              : 'New Lead'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        <div className="p-5 overflow-y-auto max-h-[80vh]">

          {/* ── mode select ── */}
          {mode === 'select' && (
            <div className="space-y-3">
              <button
                onClick={() => setMode('screenshot')}
                className="w-full flex items-center gap-4 border-2 border-blue-200 rounded-xl p-4 text-left hover:border-blue-400 hover:bg-blue-50 transition-colors"
              >
                <span className="text-3xl">📷</span>
                <div>
                  <p className="font-semibold text-gray-900">Upload Screenshot</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Auto-extract customer info from a Thumbtack, Yelp, or Google screenshot
                  </p>
                </div>
              </button>
              <button
                onClick={() => setMode('manual')}
                className="w-full text-sm text-gray-500 hover:text-gray-700 py-2 transition-colors"
              >
                Manual entry instead →
              </button>
            </div>
          )}

          {/* ── screenshot: upload ── */}
          {mode === 'screenshot' && stage === 'upload' && (
            <div className="space-y-4">
              <div className="flex gap-2 flex-wrap">
                {SCREENSHOT_SOURCES.map(s => (
                  <button
                    key={s.value}
                    onClick={() => setSourceType(s.value)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                      sourceType === s.value
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              <div
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault()
                  const f = e.dataTransfer.files[0]
                  if (f) handleFileSelect(f)
                }}
                onClick={() => fileRef.current?.click()}
                className="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
              >
                <p className="text-3xl mb-2">📂</p>
                <p className="text-sm font-medium text-gray-700">Drop screenshot here, or tap to select</p>
                <p className="text-xs text-gray-400 mt-1">JPEG, PNG, or WebP</p>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) handleFileSelect(f)
                  }}
                />
              </div>

              {ingestError && <p className="text-sm text-red-600">{ingestError}</p>}

              <button
                onClick={() => setMode('select')}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                ← Back
              </button>
            </div>
          )}

          {/* ── screenshot: processing ── */}
          {mode === 'screenshot' && stage === 'processing' && (
            <div className="py-12 text-center space-y-3">
              <div className="inline-block w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-gray-500">Uploading and extracting info…</p>
            </div>
          )}

          {/* ── screenshot: review ── */}
          {mode === 'screenshot' && stage === 'review' && ingestResult && (
            <div className="space-y-4">
              {ingestResult.auto_applied_fields.length > 0 && (
                <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                  <p className="text-xs text-green-700">
                    Auto-filled from screenshot:{' '}
                    <span className="font-medium">
                      {ingestResult.auto_applied_fields.join(', ').replace(/_/g, ' ')}
                    </span>
                    . Review and correct below.
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Customer Name <span className="text-red-500">*</span>
                </label>
                <input
                  autoFocus
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  placeholder="Enter customer name"
                  value={review.customer_name}
                  onChange={e => setR('customer_name', e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                <input
                  type="tel"
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={review.customer_phone}
                  onChange={e => setR('customer_phone', e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Service Type</label>
                <select
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={review.service_type}
                  onChange={e => setR('service_type', e.target.value as ServiceType)}
                >
                  <option value="unknown">Unknown</option>
                  <option value="moving">Moving</option>
                  <option value="hauling">Hauling</option>
                  <option value="both">Both</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={review.job_location}
                  onChange={e => setR('job_location', e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date Requested</label>
                <input
                  type="date"
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={review.job_date_requested}
                  onChange={e => setR('job_date_requested', e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  rows={2}
                  className="w-full border rounded-lg px-3 py-2 text-sm resize-none"
                  value={review.notes}
                  onChange={e => setR('notes', e.target.value)}
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={review.urgency_flag}
                  onChange={e => setR('urgency_flag', e.target.checked)}
                />
                <span className="text-sm font-medium text-orange-600">Mark as Urgent</span>
              </label>

              {reviewError && <p className="text-sm text-red-600">{reviewError}</p>}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 border border-gray-300 rounded-lg py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Close
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={patching}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50"
                >
                  {patching ? 'Saving…' : 'Add to Queue'}
                </button>
              </div>
            </div>
          )}

          {/* ── manual entry ── */}
          {mode === 'manual' && (
            <form onSubmit={handleManualSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Source</label>
                <select
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={form.source_type}
                  onChange={e => set('source_type', e.target.value as LeadSourceType)}
                >
                  <option value="manual">Manual</option>
                  <option value="thumbtack_api">Thumbtack API</option>
                  <option value="website_form">Website Form</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Customer Name *</label>
                <input
                  required
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={form.customer_name}
                  onChange={e => set('customer_name', e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                <input
                  type="tel"
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  onChange={e => set('customer_phone', e.target.value || undefined)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Service Type</label>
                <select
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={form.service_type}
                  onChange={e => set('service_type', e.target.value as ServiceType)}
                >
                  <option value="unknown">Unknown</option>
                  <option value="moving">Moving</option>
                  <option value="hauling">Hauling</option>
                  <option value="both">Both</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  onChange={e => set('job_location', e.target.value || undefined)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date Requested</label>
                <input
                  type="date"
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  onChange={e => set('job_date_requested', e.target.value || undefined)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  rows={2}
                  className="w-full border rounded-lg px-3 py-2 text-sm resize-none"
                  onChange={e => set('notes', e.target.value || undefined)}
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={!!form.urgency_flag}
                  onChange={e => set('urgency_flag', e.target.checked)}
                />
                <span className="text-sm font-medium text-orange-600">Mark as Urgent</span>
              </label>

              {manualError && <p className="text-sm text-red-600">{manualError}</p>}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setMode('select')}
                  className="flex-1 border border-gray-300 rounded-lg py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  ← Back
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50"
                >
                  {creating ? 'Saving…' : 'Create Lead'}
                </button>
              </div>
            </form>
          )}

        </div>
      </div>
    </div>
  )
}
