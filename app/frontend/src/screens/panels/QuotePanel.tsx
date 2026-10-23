import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePatchLead, useQuoteBasis, useSuggestQuote, useTriggerAiReview } from '../../hooks/useLeads'
import type { AiReview, Lead } from '../../types/lead'
import type { Comparable } from '../../services/api'
import { AiChatThread } from '../../components/AiChatThread'
import { QuoteBasis } from '../../components/QuoteBasis'
import { QuoteBuilderFields, createLineItem, parseMoney, type DurationSaveState, type QuoteDraft } from '../../components/QuoteBuilder'
import { useTruckRental } from '../../hooks/useTruckRental'

const PRICING_SECTIONS: {
  key:
    | 'f_pricing_band'
    | 'g_band_position'
    | 'h_friction_points'
    | 'i_sayability_check'
    | 'j_quote_style'
    | 'k_quote_source_label'
    | 'l_pricing_guidance'
  label: string
}[] = [
  { key: 'f_pricing_band',       label: 'F. Pricing Band' },
  { key: 'g_band_position',      label: 'G. Band Position' },
  { key: 'h_friction_points',    label: 'H. Main Friction Points' },
  { key: 'i_sayability_check',   label: 'I. Sayability Check' },
  { key: 'j_quote_style',        label: 'J. Quote Style' },
  { key: 'k_quote_source_label', label: 'K. Quote Source Label' },
  { key: 'l_pricing_guidance',   label: 'L. Internal Pricing Guidance' },
]

interface Props {
  lead: Lead
  aiReview: AiReview | null | undefined
  leadId: string
  quoteDraft: QuoteDraft
  onLockAndBook: () => void
  bookError: string
  isBooking: boolean
}

export function QuotePanel({ lead, aiReview, leadId, quoteDraft, onLockAndBook, bookError, isBooking }: Props) {
  const patch = usePatchLead()
  // Separate mutation instance so duration saves don't drive the Save Context
  // button's pending/success label.
  const durationPatch = usePatchLead()
  const [durationSaved, setDurationSaved] = useState(false)
  const triggerReview = useTriggerAiReview()
  const [context, setContext] = useState(lead.quote_context ?? '')
  const [saved, setSaved] = useState(false)
  const suggest = useSuggestQuote()
  const [liveBasis, setLiveBasis] = useState<{ comparables: Comparable[]; rationale: string } | null>(null)
  const { data: snapshot } = useQuoteBasis(leadId)
  const [suggestError, setSuggestError] = useState('')

  const handleSuggest = () => {
    setSuggestError('')
    suggest.mutate(leadId, {
      onSuccess: s => {
        quoteDraft.setQuotedPriceTotal(String(s.quoted_price_total))
        quoteDraft.setEstimatedDurationMinutes(s.estimated_duration_minutes)
        quoteDraft.setLineItems(
          s.line_items.length
            ? s.line_items.map(li => createLineItem(li.note, String(li.amount)))
            : [createLineItem('Base quote', String(s.quoted_price_total))],
        )
        setLiveBasis({ comparables: s.comparables ?? [], rationale: s.rationale })
      },
      onError: e => setSuggestError((e as Error)?.message ?? 'Suggestion failed'),
    })
  }

  // Sync if lead.quote_context changes from outside (e.g. chat auto-update)
  useEffect(() => {
    setContext(lead.quote_context ?? '')
  }, [lead.quote_context])

  const handleSaveContext = () => {
    patch.mutate(
      { id: leadId, data: { quote_context: context || null } },
      {
        onSuccess: () => {
          setSaved(true)
          setTimeout(() => setSaved(false), 2000)
        },
      },
    )
  }

  const handleContextUpdate = (text: string) => {
    setContext(text)
    patch.mutate(
      { id: leadId, data: { quote_context: text } },
      {
        onSuccess: () => {
          setSaved(true)
          setTimeout(() => setSaved(false), 2000)
        },
      },
    )
  }

  const { data: rental } = useTruckRental(leadId)

  function addRentalLine() {
    if (!rental?.rental_cost_cents) return
    const dollars = rental.rental_cost_cents / 100
    const currentTotal = parseMoney(quoteDraft.quotedPriceTotal) ?? 0
    quoteDraft.setLineItems(prev => [...prev, createLineItem('Truck rental', dollars.toFixed(2))])
    quoteDraft.setQuotedPriceTotal((currentTotal + dollars).toFixed(2))
  }

  // The Brief tab tells the operator duration is "set on the Quote tab", so the
  // Quote control has to persist on change — the draft alone is only written by
  // lockAndBook, which needs a valid price and flips the lead to booked.
  function saveDuration(value: number | null) {
    setDurationSaved(false)
    durationPatch.mutate(
      { id: leadId, data: { estimated_job_duration_minutes: value } },
      {
        onSuccess: () => {
          setDurationSaved(true)
          setTimeout(() => setDurationSaved(false), 2000)
        },
      },
    )
  }

  const durationSaveState: DurationSaveState = durationPatch.isPending
    ? 'saving'
    : durationPatch.isError
      ? 'error'
      : durationSaved
        ? 'saved'
        : 'idle'

  const isBooked = lead.status === 'booked'

  return (
    <div className="wd-pane flex flex-col gap-3 px-3.5 pb-6 pt-3">

      {/* ── Build & lock quote ─────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="wd-fl !mb-0">
            Build &amp; lock quote{isBooked && <span className="ml-2 text-ok">· Booked</span>}
          </h3>
          <button onClick={handleSuggest} disabled={suggest.isPending} className="wd-btn-sm wd-btn-ghost shrink-0">
            {suggest.isPending ? 'Drafting…' : '✨ Suggest with AI'}
          </button>
        </div>

        {(() => {
          const basis = liveBasis ?? (snapshot ? { comparables: snapshot.comparables, rationale: snapshot.rationale } : null)
          return basis ? <QuoteBasis comparables={basis.comparables} rationale={basis.rationale} /> : null
        })()}
        {suggestError && <p className="wd-err">{suggestError}</p>}

        {rental?.rental_cost_cents != null && rental.rental_cost_cents > 0 && (
          <button onClick={addRentalLine} className="wd-btn-sm wd-btn-ghost w-full !shadow-[inset_0_0_0_1.5px_var(--ac)]">
            + Add truck rental (${(rental.rental_cost_cents / 100).toFixed(2)}) as a line
          </button>
        )}

        <QuoteBuilderFields
          draft={quoteDraft}
          /* A hold review's figures are suppressed on the decision card, so the
             floor must not survive here — otherwise the walkaway is the only
             number on the screen, sitting beside the price input. */
          floor={aiReview?.sections.sayability === 'hold' ? null : (aiReview?.sections.floor ?? null)}
          onDurationCommit={saveDuration}
          durationSaveState={durationSaveState}
        />

        {bookError && <p className="wd-err px-1" role="alert">{bookError}</p>}

        {/* Before booking, Lock & book lives in the pinned bar. A booked lead's
            bar says View jobs, so re-confirming a changed quote happens here. */}
        {isBooked && (
          <button onClick={onLockAndBook} disabled={isBooking} className="wd-btn w-full">
            {isBooking ? 'Booking…' : 'Update & re-confirm'}
          </button>
        )}

        <Link to="/admin/quote-grounding" className="flex min-h-11 items-center text-sm font-semibold text-ok underline">
          How grounded quoting is performing →
        </Link>
      </section>

      {/* ── Scope ──────────────────────────────────────────────────── */}
      <section className="wd-box wd-box-soft">
        <h3 className="wd-fl">Scope</h3>
        <dl className="wd-dl !gap-y-0">
          <ScopeRow label="Service" value={lead.service_type} />

          {(lead.job_origin || lead.job_destination) ? (
            <ScopeRow
              label="Route"
              value={`${lead.job_origin || '?'} → ${lead.job_destination || '?'}`}
            />
          ) : (
            <ScopeRow label="Location" value={lead.job_location} />
          )}

          {lead.move_date_options && lead.move_date_options.length > 0 ? (
            <ScopeRow label="Dates" value={lead.move_date_options.join(', ')} />
          ) : (
            <ScopeRow label="Date" value={lead.job_date_requested} />
          )}

          <ScopeRow label="Move size" value={lead.move_size_label} />
          <ScopeRow label="Move type" value={lead.move_type?.replace(/_/g, ' ')} />
          {lead.move_distance_miles != null && (
            <ScopeRow label="Distance" value={`~${Math.round(lead.move_distance_miles)} mi`} />
          )}
          {(lead.load_stairs != null || lead.unload_stairs != null) && (
            <ScopeRow
              label="Stairs"
              value={[
                lead.load_stairs != null ? `Load: ${lead.load_stairs} flight${lead.load_stairs !== 1 ? 's' : ''}` : null,
                lead.unload_stairs != null ? `Unload: ${lead.unload_stairs} flight${lead.unload_stairs !== 1 ? 's' : ''}` : null,
              ].filter(Boolean).join(' · ')}
            />
          )}
        </dl>
        {lead.scope_notes && (
          <p className="mt-3 rounded-card bg-bg p-3 text-sm italic leading-relaxed">"{lead.scope_notes}"</p>
        )}
      </section>

      {/* ── Quote context ──────────────────────────────────────────── */}
      <section className="wd-box wd-box-soft">
        <label htmlFor="quote-context" className="wd-fl">Add context before re-running the review</label>
        <textarea
          id="quote-context"
          rows={3}
          className="wd-input"
          placeholder="e.g. Elevator is passenger-style not freight. Has a piano. Customer confirmed wrapping needed."
          value={context}
          onChange={e => setContext(e.target.value)}
        />
        <div className="mt-2 flex items-center gap-2">
          <button onClick={handleSaveContext} disabled={patch.isPending} className="wd-btn-sm">
            {patch.isPending ? 'Saving…' : saved ? '✓ Saved' : 'Save context'}
          </button>
          {patch.isError && <span className="wd-err">Couldn’t save. Try again.</span>}
        </div>
      </section>

      {/* ── AI Pricing (F–L) ───────────────────────────────────────── */}
      <section className="wd-box wd-box-soft !shadow-[inset_0_0_0_1.5px_var(--ac)]">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="wd-fl !mb-0">
            AI pricing guidance <span className="text-[#b86e00] dark:text-ac">· internal only</span>
          </h3>
          <button
            onClick={() => triggerReview.mutate({ leadId })}
            disabled={triggerReview.isPending}
            className="wd-btn-sm wd-btn-ghost shrink-0"
          >
            {triggerReview.isPending ? 'Running…' : aiReview ? 'Re-run AI' : 'Run AI review'}
          </button>
        </div>
        {triggerReview.isError && (
          <p className="wd-err mb-2">
            {triggerReview.error instanceof Error ? triggerReview.error.message : 'Could not run the review.'}
          </p>
        )}

        {aiReview ? (
          <details className="group">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-chip bg-bg px-3 text-sm font-semibold">
              Full analysis
              <span className="text-mu transition-transform group-open:rotate-180" aria-hidden="true">⌄</span>
            </summary>
            <div className="mt-2 space-y-2">
              {PRICING_SECTIONS.map(({ key, label }) => (
                <div key={key} className="rounded-card bg-bg p-3">
                  <p className="wd-fl !mb-1">{label}</p>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    {aiReview.sections[key] || '—'}
                  </p>
                </div>
              ))}
            </div>
          </details>
        ) : (
          <p className="text-sm text-mu">Run the AI review to see pricing guidance.</p>
        )}
      </section>

      {/* ── AI Pricing Chat ────────────────────────────────────────── */}
      <section className="wd-box wd-box-soft">
        <h3 className="wd-fl">Challenge / refine pricing</h3>
        <AiChatThread
          leadId={leadId}
          aiReviewId={aiReview?.id}
          onContextUpdate={handleContextUpdate}
        />
      </section>

    </div>
  )
}

function ScopeRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <>
      <dt className="!pt-2">{label}</dt>
      <dd className="py-2 font-medium">
        {value || <span className="font-normal italic text-mu">—</span>}
      </dd>
    </>
  )
}
