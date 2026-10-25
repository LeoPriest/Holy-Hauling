import { useState } from 'react'

interface LeadCostCardProps {
  leadCostCents?: number | null
  leadCostGrossCents?: number | null
  leadCostBonusCents?: number | null
  prosContacted?: number | null
  prosResponded?: number | null
  fieldSources?: string | null
  onSave: (patch: {
    lead_cost_cents: number | null
    lead_cost_gross_cents: number | null
    lead_cost_bonus_cents: number | null
  }) => Promise<unknown>
}

const fmt = (cents?: number | null) =>
  cents == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)

const toCents = (s: string): number | null => {
  const n = parseFloat(s.replace(/[^\d.]/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) : null
}

export function LeadCostCard(props: LeadCostCardProps) {
  const { leadCostCents, leadCostGrossCents, leadCostBonusCents, prosContacted, prosResponded, fieldSources } = props
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const [total, setTotal] = useState('')
  const [gross, setGross] = useState('')
  const [bonus, setBonus] = useState('')

  const hasCost = leadCostCents != null
  let badge: 'ocr' | 'edited' | null = null
  try {
    const src = fieldSources ? JSON.parse(fieldSources) : {}
    badge = src.lead_cost_cents ?? null
  } catch { badge = null }

  const beginEdit = () => {
    setTotal(leadCostCents != null ? (leadCostCents / 100).toFixed(2) : '')
    setGross(leadCostGrossCents != null ? (leadCostGrossCents / 100).toFixed(2) : '')
    setBonus(leadCostBonusCents != null ? (leadCostBonusCents / 100).toFixed(2) : '')
    setError(false)
    setEditing(true)
  }

  const save = async () => {
    setSaving(true); setError(false)
    try {
      await props.onSave({
        lead_cost_cents: toCents(total),
        lead_cost_gross_cents: gross.trim() ? toCents(gross) : null,
        lead_cost_bonus_cents: bonus.trim() ? toCents(bonus) : null,
      })
      setEditing(false)
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="wd-box wd-box-soft space-y-3">
      <div className="flex items-center justify-between">
        <p className="wd-label">Lead cost</p>
        {hasCost && badge && (
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            badge === 'ocr' ? 'bg-tint text-ok'
                            : 'bg-bg text-mu'}`}>
            {badge === 'ocr' ? 'From photo' : 'Manual'}
          </span>
        )}
      </div>

      {!editing && (
        <>
          {hasCost ? (
            <div className="text-sm">
              <div className="flex justify-between py-0.5"><span className="text-mu">Direct lead</span><span>{fmt(leadCostGrossCents)}</span></div>
              <div className="flex justify-between py-0.5"><span className="text-mu">Bonus</span><span className="text-ok">{leadCostBonusCents != null ? `−${fmt(leadCostBonusCents)}` : '—'}</span></div>
              <div className="mt-1 flex justify-between border-t border-ln pt-1"><span className="font-semibold">Total paid</span><span className="text-lg font-extrabold">{fmt(leadCostCents)}</span></div>
            </div>
          ) : (
            <p className="text-sm text-mu">No lead cost captured yet.</p>
          )}
          {(prosContacted != null || prosResponded != null) && (
            <p className="text-xs text-mu">
              Contacted {prosContacted ?? '—'} pros · {prosResponded ?? '—'} responded
            </p>
          )}
          <button type="button" onClick={beginEdit} className="wd-btn-sm wd-btn-ghost">
            {hasCost ? 'Edit cost' : 'Add cost'}
          </button>
        </>
      )}

      {editing && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs text-mu">Direct lead
              <input value={gross} onChange={e => setGross(e.target.value)} inputMode="decimal" className="wd-input" /></label>
            <label className="flex flex-col gap-1 text-xs text-mu">Bonus
              <input value={bonus} onChange={e => setBonus(e.target.value)} inputMode="decimal" className="wd-input" /></label>
          </div>
          <label className="flex flex-col gap-1 text-xs text-mu">Total paid
            <input value={total} onChange={e => setTotal(e.target.value)} inputMode="decimal" className="wd-input" /></label>
          <div className="flex items-center gap-2">
            <button type="button" onClick={save} disabled={saving || !total.trim()} className="wd-btn-sm">{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={() => setEditing(false)} className="wd-btn-sm wd-btn-ghost">Cancel</button>
            {error && <span className="text-xs text-danger">Couldn't save. Try again.</span>}
          </div>
        </div>
      )}
    </div>
  )
}
