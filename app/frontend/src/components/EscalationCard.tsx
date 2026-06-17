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
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-900/20">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
            ⚠ Escalated · {LEVEL_LABELS[esc.level]}
            {esc.source === 'auto_idle' && ' · auto'}
          </p>
          <p className="mt-0.5 text-sm font-medium text-gray-900 dark:text-white">Decision needed: {esc.decision_needed}</p>
          <p className="mt-1 whitespace-pre-wrap text-xs text-gray-600 dark:text-gray-300">{esc.summary}</p>
          <p className="mt-1 text-[11px] text-gray-400">Raised by {esc.raised_by ?? 'system'}</p>
        </div>
        {!showResolve && (
          <button
            onClick={() => setShowResolve(true)}
            className="shrink-0 min-h-11 rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-700"
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
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          >
            {OUTCOMES.map(o => <option key={o} value={o}>{OUTCOME_LABELS[o]}</option>)}
          </select>
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Decision note (sent back to the handler)"
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          />
          {resolve.isError && (
            <p className="text-xs text-red-600 dark:text-red-400">{(resolve.error as Error).message}</p>
          )}
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowResolve(false)} className="min-h-11 rounded-lg px-4 py-2 text-sm text-gray-600 dark:text-gray-300">
              Cancel
            </button>
            <button
              onClick={handleResolve}
              disabled={resolve.isPending}
              className="min-h-11 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
            >
              {resolve.isPending ? 'Resolving…' : 'Confirm decision'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
