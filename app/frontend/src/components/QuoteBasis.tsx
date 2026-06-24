import { useNavigate } from 'react-router-dom'
import type { Comparable } from '../services/api'

const fmtUsd = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100)

function MatchDots({ score }: { score: number }) {
  const filled = Math.max(1, Math.min(4, Math.ceil(score / 2)))
  return (
    <div className="flex shrink-0 gap-0.5" title="match strength" aria-label={`match strength ${filled} of 4`}>
      {[0, 1, 2, 3].map(i => (
        <span key={i} className={`h-1.5 w-1.5 rounded-full ${i < filled ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
      ))}
    </div>
  )
}

function Row({ c, onOpen }: { c: Comparable; onOpen: () => void }) {
  const won = c.conversion === 'won'
  const why = [c.move_size_label, c.move_distance_miles != null ? `${c.move_distance_miles} mi` : null, c.move_type]
    .filter(Boolean).join(' · ')
  return (
    <button type="button" onClick={onOpen}
      className="flex min-h-11 w-full items-center gap-3 border-t border-gray-100 px-3 py-2 text-left first:border-t-0 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/40">
      <div className="w-[72px] shrink-0">
        <div className="font-bold tabular-nums text-gray-900 dark:text-white">{fmtUsd(c.price_cents)}</div>
        <div className="text-[10px] uppercase tracking-wide text-gray-400">{c.price_basis}</div>
      </div>
      <div className="min-w-0 flex-1">
        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
          won ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
              : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'}`}>{c.conversion}</span>
        <div className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">{why || '—'}</div>
      </div>
      <MatchDots score={c.score} />
      <span className="shrink-0 text-gray-300 dark:text-gray-600">›</span>
    </button>
  )
}

export function QuoteBasis({ comparables, rationale }: { comparables: Comparable[]; rationale: string }) {
  const navigate = useNavigate()
  if (!comparables.length && !rationale) return null
  const grounded = comparables.length > 0

  return (
    <div className="mb-3 space-y-3">
      <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-700">
          <span className="text-xs font-bold text-gray-700 dark:text-gray-200">🧭 What this quote is based on</span>
          <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
            grounded ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                     : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300'}`}>
            {grounded ? `Grounded · ${comparables.length} local jobs` : 'Cold start'}
          </span>
        </div>
        {grounded ? (
          comparables.map(c => <Row key={c.lead_id} c={c} onOpen={() => navigate(`/leads/${c.lead_id}`)} />)
        ) : (
          <p className="px-3 py-4 text-center text-xs text-gray-500 dark:text-gray-400">
            No comparable local jobs yet — priced from the SOP &amp; AI pricing guidance only. As more jobs finalize, comparables appear here.
          </p>
        )}
      </div>
      {rationale && (
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 dark:border-violet-800 dark:bg-violet-900/20">
          <p className="text-xs font-semibold text-violet-700 dark:text-violet-300">✨ AI rationale — review before booking</p>
          <p className="mt-1 text-sm leading-relaxed text-gray-700 dark:text-gray-200">{rationale}</p>
        </div>
      )}
    </div>
  )
}
