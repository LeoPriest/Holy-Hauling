import { useState } from 'react'
import { useAcknowledgeLead, usePatchLead } from '../../hooks/useLeads'
import { useUsers } from '../../hooks/useUsers'
import type { AiReview, Lead } from '../../types/lead'

interface Props {
  lead: Lead
  aiReview: AiReview | undefined
}

export function BriefPanel({ lead, aiReview }: Props) {
  const acknowledge = useAcknowledgeLead()
  const patch = usePatchLead()
  const { data: teamMembers = [] } = useUsers()
  const [copied, setCopied] = useState(false)

  const intakeShot = lead.screenshots?.find(s => s.screenshot_type === 'intake')

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

      {/* Contact */}
      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Contact</h3>
        <div className="bg-white rounded-xl border p-4 space-y-2">
          <p className="font-semibold text-gray-900">
            {lead.customer_name ?? <span className="italic text-gray-400 font-normal">No name captured</span>}
          </p>
          {lead.customer_phone ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-700">📞 {lead.customer_phone}</span>
              <a href={`tel:${lead.customer_phone}`}
                className="text-xs bg-green-600 text-white rounded-lg px-3 py-1 font-medium hover:bg-green-700">
                Call
              </a>
              <a href={`sms:${lead.customer_phone}`}
                className="text-xs bg-blue-600 text-white rounded-lg px-3 py-1 font-medium hover:bg-blue-700">
                Text
              </a>
            </div>
          ) : (
            <p className="text-sm text-gray-400 italic">Phone not captured</p>
          )}
          <p className="text-xs text-gray-400">{lead.source_category_label}</p>
        </div>
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
