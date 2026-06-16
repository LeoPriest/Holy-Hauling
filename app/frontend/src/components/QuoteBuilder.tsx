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

export function QuoteBuilderFields({ draft }: { draft: QuoteDraft }) {
  const quotedTotalValue = parseMoney(draft.quotedPriceTotal)
  const summedLineItems = roundMoney(
    draft.lineItems.reduce((sum, item) => sum + (parseMoney(item.amount) ?? 0), 0),
  )
  const difference = quotedTotalValue == null ? null : roundMoney(quotedTotalValue - summedLineItems)

  return (
    <div className="space-y-4">
      <label className="block space-y-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Quoted price</span>
        <input
          type="text"
          inputMode="decimal"
          value={draft.quotedPriceTotal}
          onChange={event => draft.setQuotedPriceTotal(event.target.value)}
          placeholder="500.00"
          className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Estimated duration</span>
        <DurationWheelInput value={draft.estimatedDurationMinutes} onChange={draft.setEstimatedDurationMinutes} />
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Google Calendar will use this length when the job has a scheduled time slot.
        </p>
      </label>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Price breakdown</span>
          <button
            type="button"
            onClick={() => draft.setLineItems(prev => [...prev, createLineItem('', '')])}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            Add modifier
          </button>
        </div>

        {draft.lineItems.map((item, index) => (
          <div
            key={item.id}
            className="grid grid-cols-1 gap-2 rounded-xl border border-gray-200 p-3 dark:border-gray-700 md:grid-cols-[140px_minmax(0,1fr)_auto]"
          >
            <input
              type="text"
              inputMode="decimal"
              value={item.amount}
              onChange={event =>
                draft.setLineItems(prev =>
                  prev.map(entry => (entry.id === item.id ? { ...entry, amount: event.target.value } : entry)),
                )
              }
              placeholder="0.00"
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            />
            <input
              type="text"
              value={item.note}
              onChange={event =>
                draft.setLineItems(prev =>
                  prev.map(entry => (entry.id === item.id ? { ...entry, note: event.target.value } : entry)),
                )
              }
              placeholder={index === 0 ? 'Base quote' : 'Modifier note'}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            />
            <button
              type="button"
              onClick={() =>
                draft.setLineItems(prev =>
                  prev.length === 1 ? [createLineItem('Base quote')] : prev.filter(entry => entry.id !== item.id),
                )
              }
              className="rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-900/20"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="rounded-xl bg-gray-50 px-4 py-3 text-sm dark:bg-gray-800">
        <div className="flex items-center justify-between gap-3">
          <span className="text-gray-500 dark:text-gray-400">Modifier sum</span>
          <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(summedLineItems)}</span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-gray-500 dark:text-gray-400">Difference to quoted price</span>
          <span
            className={`font-medium ${
              difference === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
            }`}
          >
            {difference == null ? '--' : formatCurrency(difference)}
          </span>
        </div>
      </div>
    </div>
  )
}

// ── Post-booking confirmation overlay (step 2) ───────────────────────────────

export function BookingConfirmation({ text, onClose }: { text: string; onClose: () => void }) {
  const [draftText, setDraftText] = useState(text)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (text) setDraftText(text)
  }, [text])

  const handleCopy = () => {
    navigator.clipboard.writeText(draftText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl border bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
        <div className="border-b px-5 py-4 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">Booking confirmed!</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Edit if needed, then copy and send to your customer.</p>
        </div>
        <div className="px-5 py-4">
          <textarea
            rows={12}
            value={draftText}
            onChange={e => setDraftText(e.target.value)}
            className="w-full resize-y rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm leading-relaxed text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>
        <div className="flex items-center justify-between gap-2 border-t px-5 py-4 dark:border-gray-700">
          <button
            type="button"
            onClick={handleCopy}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            {copied ? 'Copied!' : 'Copy Message'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
