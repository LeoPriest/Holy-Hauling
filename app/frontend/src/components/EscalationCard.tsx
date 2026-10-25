import { useState } from 'react'
import { useLeadEscalation, useResolveEscalation } from '../hooks/useEscalation'
import { LEVEL_LABELS, OUTCOME_LABELS, type EscalationOutcome } from '../types/escalation'

const OUTCOMES: EscalationOutcome[] = ['approved', 'adjusted', 'owner_takeover', 'release', 'need_more_info']

export function EscalationCard({ leadId }: { leadId: string }) {
  const { data: esc } = useLeadEscalation(leadId)
  const resolve = useResolveEscalation(leadId)
  const [outcome, setOutcome] = useState<EscalationOutcome>('approved')
  const [note, setNote] = useState('')
  const [showResolve, setShowResolve] = useState(false)

  if (!esc) return null

  const handleResolve = () => {
    resolve.mutate(
      { escalationId: esc.id, outcome, resolution_note: note.trim() || undefined },
      { onSuccess: () => { setShowResolve(false); setNote('') } },
    )
  }

  return (
    <div className="wd-box mx-3.5 mt-3.5 overflow-hidden !p-0">
      <div className="haz h-1.5" aria-hidden="true" />
      <div className="px-3.5 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="wd-fl !mb-1 !text-[#b86e00] dark:!text-ac">
            ⚠ Escalated · {LEVEL_LABELS[esc.level]}
            {esc.source === 'auto_idle' && ' · auto'}
          </p>
          <p className="text-sm font-semibold">Decision needed: {esc.decision_needed}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-mu">{esc.summary}</p>
          <p className="wd-hint">Raised by {esc.raised_by ?? 'system'}</p>
        </div>
        {!showResolve && (
          <button
            onClick={() => setShowResolve(true)}
            className="wd-btn-sm wd-btn-amber shrink-0"
          >
            Resolve
          </button>
        )}
      </div>

      {showResolve && (
        <div className="mt-3 space-y-2">
          <select
            value={outcome}
            onChange={e => setOutcome(e.target.value as EscalationOutcome)}
            className="wd-input"
            aria-label="Decision"
          >
            {OUTCOMES.map(o => <option key={o} value={o}>{OUTCOME_LABELS[o]}</option>)}
          </select>
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Decision note (sent back to the handler)"
            className="wd-input"
          />
          {resolve.isError && (
            <p className="wd-err">{(resolve.error as Error).message}</p>
          )}
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowResolve(false)} className="wd-btn-sm wd-btn-ghost">
              Cancel
            </button>
            <button
              onClick={handleResolve}
              disabled={resolve.isPending}
              className="wd-btn-sm"
            >
              {resolve.isPending ? 'Resolving…' : 'Confirm decision'}
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}
