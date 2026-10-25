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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(10,12,11,.45)]" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Escalate to owner"
        className="max-h-[92dvh] overflow-y-auto w-full max-w-lg rounded-t-sheet bg-bg px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-2.5 text-ink"
        onClick={e => e.stopPropagation()}
      >
        <div className="wd-grab" aria-hidden="true" />
        <h3 className="wd-disp mb-3 text-[22px] leading-none">Escalate to owner</h3>

        <label className="wd-fl !mb-1">Level</label>
        <div className="mb-3 flex flex-wrap gap-2">
          {LEVELS.map(l => (
            <button
              key={l}
              onClick={() => setLevel(l)}
              aria-pressed={level === l}
              className={`wd-btn-sm ${level === l ? 'wd-btn-amber' : 'wd-btn-ghost !shadow-[inset_0_0_0_1.5px_var(--ln)]'}`}
            >
              {LEVEL_LABELS[l]}
            </button>
          ))}
        </div>

        <label className="wd-fl !mb-1">Decision needed</label>
        <select
          value={decision}
          onChange={e => setDecision(e.target.value)}
          className="wd-input mb-3"
        >
          {DECISION_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>

        <div className="mb-1 flex items-center justify-between">
          <label className="wd-fl !mb-0">Summary</label>
          <button
            onClick={handleSuggest}
            disabled={suggest.isPending}
            className="wd-btn-sm wd-btn-ghost -mr-2 !shadow-none !text-ok"
          >
            {suggest.isPending ? 'Drafting…' : '✨ Suggest with AI'}
          </button>
        </div>
        {suggest.isError && (
          <p className="wd-err mb-1">{(suggest.error as Error).message}</p>
        )}
        <textarea
          rows={6}
          value={summary}
          onChange={e => setSummary(e.target.value)}
          placeholder="What changed / why this needs the owner. Tap to draft from the lead."
          className="wd-input mb-3"
        />

        {raise.isError && (
          <p className="wd-err mb-2">{(raise.error as Error).message}</p>
        )}
        <div className="flex gap-2">
          <button onClick={onClose} className="wd-btn wd-btn-ghost flex-1">
            Cancel
          </button>
          <button
            onClick={handleEscalate}
            disabled={raise.isPending || !summary.trim()}
            className="wd-btn wd-btn-amber flex-1"
          >
            {raise.isPending ? 'Escalating…' : 'Escalate'}
          </button>
        </div>
      </div>
    </div>
  )
}
