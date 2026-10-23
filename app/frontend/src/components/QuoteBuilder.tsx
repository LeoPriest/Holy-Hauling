import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { DurationWheelInput } from './DurationWheelInput'
import type { Lead, QuoteModifier } from '../types/lead'

// ── Money helpers ──────────────────────────────────────────────────────────

export type QuoteLineItemDraft = { id: string; amount: string; note: string }

export function createLineItem(note = '', amount = ''): QuoteLineItemDraft {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, amount, note }
}

export function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}

export function parseMoney(value: string): number | null {
  const normalized = value.replace(/[$,\s]/g, '')
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? roundMoney(parsed) : null
}

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

export function buildInitialQuoteDraft(lead: Lead | undefined) {
  if (!lead) {
    return { total: '', lineItems: [createLineItem('Base quote')], estimatedDurationMinutes: null as number | null }
  }
  if (lead.quoted_price_total != null && lead.quote_modifiers?.length) {
    return {
      total: String(lead.quoted_price_total),
      lineItems: lead.quote_modifiers.map(item => createLineItem(item.note, String(item.amount))),
      estimatedDurationMinutes: lead.estimated_job_duration_minutes ?? null,
    }
  }
  if (lead.quoted_price_total != null) {
    return {
      total: String(lead.quoted_price_total),
      lineItems: [createLineItem('Base quote', String(lead.quoted_price_total))],
      estimatedDurationMinutes: lead.estimated_job_duration_minutes ?? null,
    }
  }
  return {
    total: '',
    lineItems: [createLineItem('Base quote')],
    estimatedDurationMinutes: lead.estimated_job_duration_minutes ?? null,
  }
}

// ── Draft state hook ─────────────────────────────────────────────────────────

export interface QuoteDraft {
  quotedPriceTotal: string
  setQuotedPriceTotal: (value: string) => void
  estimatedDurationMinutes: number | null
  setEstimatedDurationMinutes: (value: number | null) => void
  lineItems: QuoteLineItemDraft[]
  setLineItems: Dispatch<SetStateAction<QuoteLineItemDraft[]>>
  reset: () => void
}

export function useQuoteDraft(lead: Lead | undefined): QuoteDraft {
  const initial = buildInitialQuoteDraft(lead)
  const [quotedPriceTotal, setQuotedPriceTotal] = useState(initial.total)
  const [estimatedDurationMinutes, setEstimatedDurationMinutes] = useState<number | null>(initial.estimatedDurationMinutes)
  const [lineItems, setLineItems] = useState<QuoteLineItemDraft[]>(initial.lineItems)

  const reset = () => {
    const draft = buildInitialQuoteDraft(lead)
    setQuotedPriceTotal(draft.total)
    setEstimatedDurationMinutes(draft.estimatedDurationMinutes)
    setLineItems(draft.lineItems)
  }

  // Re-seed from the lead when it first loads or we switch leads (not on every
  // refetch — keyed on id — so in-progress edits aren't clobbered).
  useEffect(() => {
    const draft = buildInitialQuoteDraft(lead)
    setQuotedPriceTotal(draft.total)
    setEstimatedDurationMinutes(draft.estimatedDurationMinutes)
    setLineItems(draft.lineItems)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?.id])

  return {
    quotedPriceTotal,
    setQuotedPriceTotal,
    estimatedDurationMinutes,
    setEstimatedDurationMinutes,
    lineItems,
    setLineItems,
    reset,
  }
}

// ── Validation ───────────────────────────────────────────────────────────────

export type ValidatedQuote =
  | { ok: true; total: number; modifiers: QuoteModifier[]; duration: number }
  | { ok: false; error: string }

export function validateQuote(draft: QuoteDraft): ValidatedQuote {
  const total = parseMoney(draft.quotedPriceTotal)
  if (total == null || total <= 0) return { ok: false, error: 'Enter a valid quoted price greater than 0.' }
  if (draft.estimatedDurationMinutes == null) return { ok: false, error: 'Choose an estimated duration.' }

  const activeRows = draft.lineItems.filter(item => item.amount.trim() || item.note.trim())
  if (activeRows.length === 0) return { ok: false, error: 'Add at least one quote line item.' }

  const modifiers: QuoteModifier[] = []
  for (const item of activeRows) {
    const amount = parseMoney(item.amount)
    if (amount == null) return { ok: false, error: 'Each modifier needs a valid amount.' }
    if (!item.note.trim()) return { ok: false, error: 'Each modifier needs a note.' }
    modifiers.push({ amount, note: item.note.trim() })
  }

  const summed = roundMoney(modifiers.reduce((sum, item) => sum + item.amount, 0))
  if (roundMoney(total - summed) !== 0) {
    return { ok: false, error: 'Modifier amounts must add up exactly to the quoted price.' }
  }
  return { ok: true, total, modifiers, duration: draft.estimatedDurationMinutes }
}

// ── Inline builder fields ────────────────────────────────────────────────────

export type DurationSaveState = 'idle' | 'saving' | 'saved' | 'error'

/** One-tap job lengths; anything else goes through the hours/minutes picker. */
const DURATIONS: [number, string][] = [[60, '1h'], [90, '1.5h'], [120, '2h'], [150, '2.5h'], [180, '3h'], [240, '4h']]

export function QuoteBuilderFields({
  draft,
  floor,
  onDurationCommit,
  durationSaveState = 'idle',
}: {
  draft: QuoteDraft
  floor?: number | null
  onDurationCommit?: (value: number | null) => void
  durationSaveState?: DurationSaveState
}) {
  const quotedTotalValue = parseMoney(draft.quotedPriceTotal)
  // The floor is a validated figure or it is absent — never a placeholder.
  // quotedTotalValue is null while the field is empty or mid-edit, so an
  // untouched field must not read as "below floor".
  const belowFloor =
    floor != null && quotedTotalValue != null && quotedTotalValue < floor
  const summedLineItems = roundMoney(
    draft.lineItems.reduce((sum, item) => sum + (parseMoney(item.amount) ?? 0), 0),
  )
  const difference = quotedTotalValue == null ? null : roundMoney(quotedTotalValue - summedLineItems)

  const duration = draft.estimatedDurationMinutes
  const isPreset = DURATIONS.some(([m]) => m === duration)
  const [showOther, setShowOther] = useState(false)
  const otherOpen = showOther || (duration != null && !isPreset)
  const [freshId, setFreshId] = useState<string | null>(null)

  const setDuration = (value: number | null) => {
    draft.setEstimatedDurationMinutes(value)
    onDurationCommit?.(value)
  }

  const updateLine = (id: string, patch: Partial<QuoteLineItemDraft>) =>
    draft.setLineItems(prev => prev.map(entry => (entry.id === id ? { ...entry, ...patch } : entry)))

  return (
    <div className="flex flex-col gap-3">
      <div className="wd-box">
        <label htmlFor="quoted-price" className="wd-fl">Quoted price</label>
        <div className="wd-money">
          <span aria-hidden="true">$</span>
          <input
            id="quoted-price"
            type="text"
            inputMode="decimal"
            value={draft.quotedPriceTotal}
            onChange={event => draft.setQuotedPriceTotal(event.target.value)}
            placeholder="500.00"
          />
        </div>
        {floor != null && (
          <p className={`wd-money-hint ${belowFloor ? 'bad' : ''}`}>
            {belowFloor
              ? `$${(floor - quotedTotalValue!).toLocaleString('en-US')} below the $${floor.toLocaleString('en-US')} floor`
              : `Floor $${floor.toLocaleString('en-US')} · do not go below`}
          </p>
        )}
      </div>

      <div className="wd-box">
        <p className="wd-fl" id="duration-label">Estimated duration</p>
        <div className="wd-durs" role="group" aria-labelledby="duration-label">
          {DURATIONS.map(([minutes, label]) => (
            <button
              key={minutes}
              type="button"
              aria-pressed={duration === minutes}
              onClick={() => { setShowOther(false); setDuration(minutes) }}
            >
              {label}
            </button>
          ))}
          <button type="button" aria-pressed={otherOpen} onClick={() => setShowOther(open => !open || (duration != null && !isPreset))}>
            Other
          </button>
        </div>
        {otherOpen && (
          <div className="mt-2">
            <DurationWheelInput value={duration} onChange={setDuration} />
          </div>
        )}
        {durationSaveState === 'saving' ? (
          <p className="wd-hint">Saving duration…</p>
        ) : durationSaveState === 'saved' ? (
          <p className="wd-hint !text-ok font-semibold">✓ Duration saved</p>
        ) : durationSaveState === 'error' ? (
          <p className="wd-err mt-1.5">Couldn’t save the duration. Set it again to retry.</p>
        ) : (
          <p className="wd-hint">Google Calendar will use this length when the job has a time slot.</p>
        )}
      </div>

      <div className="wd-box">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="wd-fl !mb-0">Price breakdown</p>
          <button
            type="button"
            onClick={() => {
              const line = createLineItem('', '')
              setFreshId(line.id)
              draft.setLineItems(prev => [...prev, line])
            }}
            className="wd-btn-sm wd-btn-ghost"
          >
            <span aria-hidden="true" className="text-lg leading-none">+</span> Modifier
          </button>
        </div>

        {draft.lineItems.map((item, index) => (
          <div key={item.id} className={`wd-li ${item.id === freshId ? 'new' : ''}`}>
            <input
              className="amt"
              type="text"
              inputMode="decimal"
              aria-label={`Line ${index + 1} amount`}
              value={item.amount}
              onChange={event => updateLine(item.id, { amount: event.target.value })}
              placeholder="0.00"
            />
            <input
              type="text"
              aria-label={`Line ${index + 1} note`}
              value={item.note}
              onChange={event => updateLine(item.id, { note: event.target.value })}
              placeholder={index === 0 ? 'Base quote' : 'Modifier note'}
            />
            <button
              type="button"
              className="rm"
              aria-label={`Remove line ${index + 1}`}
              onClick={() =>
                draft.setLineItems(prev =>
                  prev.length === 1 ? [createLineItem('Base quote')] : prev.filter(entry => entry.id !== item.id),
                )
              }
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18 18 6M6 6l12 12" /></svg>
            </button>
          </div>
        ))}

        <div className="wd-sum">
          <div>
            <span>Modifier sum</span>
            <b>{formatCurrency(summedLineItems)}</b>
          </div>
          <div>
            <span>Difference to quoted price</span>
            <b className={`wd-sum-diff ${difference === 0 ? 'ok' : 'off'}`}>
              {difference == null ? '--' : formatCurrency(difference)}
            </b>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── "Booked": the green screen after Lock & book ─────────────────────────────

export function BookingConfirmation({ text, total, when, onClose }: {
  text: string
  total?: number
  /** The booked date as the customer will read it, or null when not set yet. */
  when?: string | null
  onClose: () => void
}) {
  const [draftText, setDraftText] = useState(text)
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle')

  useEffect(() => {
    if (text) setDraftText(text)
  }, [text])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleCopy = () => {
    const done = (state: 'done' | 'failed') => {
      setCopied(state)
      setTimeout(() => setCopied('idle'), 2500)
    }
    if (!navigator.clipboard) return done('failed')
    navigator.clipboard.writeText(draftText).then(() => done('done'), () => done('failed'))
  }

  return (
    <div className="wd-ovl" role="dialog" aria-label="Booked">
      <img src="/brand/logo-full-white.png" alt="Holy Hauling" />
      <h2 className="wd-ovl-t">Booked</h2>
      <p className="wd-ovl-s">
        {when ?? 'Date not set yet'}{total != null ? ` · ${formatCurrency(total)}` : ''}
      </p>
      <textarea
        aria-label="Confirmation message"
        value={draftText}
        onChange={e => setDraftText(e.target.value)}
      />
      {copied === 'failed' && (
        <p className="wd-ovl-s !opacity-100">Couldn’t copy. Press and hold the message to copy it yourself.</p>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={handleCopy} className="wd-btn wd-btn-amber flex-1">
          {copied === 'done' ? 'Copied' : 'Copy message'}
        </button>
        <button type="button" onClick={onClose} className="wd-btn wd-btn-ghost flex-1">
          Done
        </button>
      </div>
    </div>
  )
}
