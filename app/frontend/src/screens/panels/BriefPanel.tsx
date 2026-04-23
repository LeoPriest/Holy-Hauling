import { useRef, useState } from 'react'
import { useAcknowledgeLead, usePatchLead } from '../../hooks/useLeads'
import { useUsers } from '../../hooks/useUsers'
import type { AiReview, Lead } from '../../types/lead'

interface Props {
  lead: Lead
  aiReview: AiReview | undefined
}

// ── Inline editable field ─────────────────────────────────────────────────────

interface EditableFieldProps {
  value: string | null | undefined
  onSave: (val: string | null) => void
  placeholder?: string
  type?: 'text' | 'tel' | 'date' | 'textarea' | 'select'
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
        className="w-full text-left group"
      >
        {displayValue ? (
          <span className="text-sm text-gray-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
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
    patch.mutate({ id: lead.id, data: { [field]: value ?? undefined } })

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
            href={`/uploads/${intakeShot.stored_path}`}
            target="_blank"
            rel="noreferrer"
            className="block rounded-xl overflow-hidden border border-gray-200 bg-gray-100"
          >
            <img
              src={`/uploads/${intakeShot.stored_path}`}
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
            Acknowledged {new Date(lead.acknowledged_at).toLocaleString()}
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

          <FieldRow label="Location">
            <EditableField
              value={lead.job_location}
              onSave={v => save('job_location', v)}
              placeholder="Tap to add location…"
            />
          </FieldRow>

          <FieldRow label="Date">
            <EditableField
              value={lead.job_date_requested}
              onSave={v => save('job_date_requested', v)}
              placeholder="Tap to add date…"
              type="date"
            />
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
