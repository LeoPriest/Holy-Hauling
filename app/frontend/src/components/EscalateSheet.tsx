import { useState } from 'react'
import { useRaiseEscalation, useSuggestEscalationSummary } from '../hooks/useEscalation'
import { DECISION_OPTIONS, LEVEL_LABELS, type EscalationLevel } from '../types/escalation'

interface Props {
  leadId: string
  onClose: () => void
}

const LEVELS: EscalationLevel[] = ['monitor', 'pause', 'owner_takeover']

export function EscalateSheet({ leadId, onClose }: Props) {
  const [level, setLevel] = useState<EscalationLevel>('pause')
  const [decision, setDecision] = useState<string>('price')
  const [summary, setSummary] = useState('')
  const suggest = useSuggestEscalationSummary(leadId)
  const raise = useRaiseEscalation(leadId)

  const handleSuggest = () => {
    suggest.mutate(undefined, { onSuccess: r => setSummary(r.summary) })
  }

  const handleEscalate = () => {
    raise.mutate(
      { level, decision_needed: decision, summary: summary.trim() },
      { onSuccess: onClose },
    )
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-t-2xl bg-white p-4 dark:bg-gray-800 sm:rounded-2xl"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="mb-3 text-base font-semibold text-gray-900 dark:text-white">Escalate to owner</h3>

        <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">Level</label>
        <div className="mb-3 flex flex-wrap gap-2">
          {LEVELS.map(l => (
            <button
              key={l}
              onClick={() => setLevel(l)}
              className={`min-h-11 rounded-lg border px-3 py-1.5 text-xs font-medium ${
                level === l
                  ? 'border-amber-600 bg-amber-600 text-white'
                  : 'border-gray-300 bg-white text-gray-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100'
              }`}
            >
              {LEVEL_LABELS[l]}
            </button>
          ))}
        </div>

        <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">Decision needed</label>
        <select
          value={decision}
          onChange={e => setDecision(e.target.value)}
          className="mb-3 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        >
          {DECISION_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>

        <div className="mb-1 flex items-center justify-between">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Summary</label>
          <button
            onClick={handleSuggest}
            disabled={suggest.isPending}
            className="min-h-11 px-2 -mr-2 text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50 dark:text-indigo-400"
          >
            {suggest.isPending ? 'Drafting…' : '✨ Suggest with AI'}
          </button>
        </div>
        {suggest.isError && (
          <p className="mb-1 text-xs text-red-600 dark:text-red-400">{(suggest.error as Error).message}</p>
        )}
        <textarea
          rows={6}
          value={summary}
          onChange={e => setSummary(e.target.value)}
          placeholder="What changed / why this needs the owner. Tap to draft from the lead."
          className="mb-3 w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        />

        {raise.isError && (
          <p className="mb-2 text-xs text-red-600 dark:text-red-400">{(raise.error as Error).message}</p>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="min-h-11 rounded-lg px-4 py-2 text-sm text-gray-600 dark:text-gray-300">
            Cancel
          </button>
          <button
            onClick={handleEscalate}
            disabled={raise.isPending || !summary.trim()}
            className="min-h-11 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {raise.isPending ? 'Escalating…' : 'Escalate'}
          </button>
        </div>
      </div>
    </div>
  )
}
