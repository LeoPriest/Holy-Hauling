import { useNavigate } from 'react-router-dom'
import type { Comparable } from '../services/api'

const fmtUsd = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100)

function MatchDots({ score }: { score: number }) {
  const filled = Math.max(1, Math.min(4, Math.ceil(score / 2)))
  return (
    <div className="flex shrink-0 gap-0.5" aria-label={`match strength ${filled} of 4`}>
      {[0, 1, 2, 3].map(i => (
        <span key={i} className={`h-1.5 w-1.5 rounded-full ${i < filled ? 'bg-pr' : 'bg-ln'}`} />
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
      className="flex min-h-11 w-full items-center gap-3 border-t border-ln px-3 py-2 text-left first:border-t-0">
      <div className="w-[72px] shrink-0">
        <div className="font-bold tabular-nums text-ink">{fmtUsd(c.price_cents)}</div>
        <div className="text-[10px] uppercase tracking-wide text-mu">{c.price_basis}</div>
      </div>
      <div className="min-w-0 flex-1">
        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
          won ? 'bg-tint text-ok'
              : 'bg-bg text-danger'}`}>{c.conversion}</span>
        <div className="mt-0.5 truncate text-xs text-mu">{why || '—'}</div>
      </div>
      <MatchDots score={c.score} />
      <span className="shrink-0 text-mu">›</span>
    </button>
  )
}

export function QuoteBasis({ comparables, rationale }: { comparables: Comparable[]; rationale: string }) {
  const navigate = useNavigate()
  if (!comparables.length && !rationale) return null
  const grounded = comparables.length > 0

  return (
    <div className="mb-3 space-y-3">
      <div className="overflow-hidden rounded-card border border-ln">
        <div className="flex items-center gap-2 border-b border-ln px-3 py-2">
          <span className="text-xs font-bold text-ink">🧭 What this quote is based on</span>
          <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
            grounded ? 'bg-tint text-ok'
                     : 'bg-bg text-mu'}`}>
            {grounded ? `Grounded · ${comparables.length} local jobs` : 'Cold start'}
          </span>
        </div>
        {grounded ? (
          comparables.map(c => <Row key={c.lead_id} c={c} onOpen={() => navigate(`/leads/${c.lead_id}`)} />)
        ) : (
          <p className="px-3 py-4 text-center text-xs text-mu">
            No comparable local jobs yet — priced from the SOP &amp; AI pricing guidance only. As more jobs finalize, comparables appear here.
          </p>
        )}
      </div>
      {rationale && (
        <div className="rounded-card border border-ln bg-tint p-3">
          <p className="text-xs font-semibold text-ok">✨ AI rationale — review before booking</p>
          <p className="mt-1 text-sm leading-relaxed text-ink">{rationale}</p>
        </div>
      )}
    </div>
  )
}
