import { useEffect, useState } from 'react'
import { usePatchLead, useTriggerAiReview } from '../../hooks/useLeads'
import type { AiReview, AiReviewSections, Lead } from '../../types/lead'
import { AiChatThread } from '../../components/AiChatThread'

const PRICING_SECTIONS: { key: keyof AiReviewSections; label: string }[] = [
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
  aiReview: AiReview | undefined
  leadId: string
}

export function QuotePanel({ lead, aiReview, leadId }: Props) {
  const patch = usePatchLead()
  const triggerReview = useTriggerAiReview()
  const [context, setContext] = useState(lead.quote_context ?? '')
  const [saved, setSaved] = useState(false)

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

  return (
    <div className="p-4 space-y-5 pb-24">

      {/* ── Scope ──────────────────────────────────────────────────── */}
      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Scope</h3>
        <div className="bg-white rounded-xl border divide-y">

          <ScopeRow label="Service" value={lead.service_type} />

          {(lead.job_origin || lead.job_destination) ? (
            <ScopeRow
              label="Route"
              value={`${lead.job_origin || '?'} → ${lead.job_destination || '?'}`}
            />
          ) : lead.job_location ? (
            <ScopeRow label="Location" value={lead.job_location} />
          ) : (
            <ScopeRow label="Location" value={null} />
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
          {lead.scope_notes && (
            <div className="px-4 py-3">
              <p className="text-xs text-gray-400 mb-1">Scope notes</p>
              <p className="text-sm text-gray-800 leading-relaxed">{lead.scope_notes}</p>
            </div>
          )}
        </div>
      </section>

      {/* ── Quote context ──────────────────────────────────────────── */}
      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
          Add Context Before Re-running Review
        </h3>
        <textarea
          rows={3}
          className="w-full border rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="e.g. Elevator is passenger-style not freight. Has a piano. Customer confirmed wrapping needed."
          value={context}
          onChange={e => setContext(e.target.value)}
        />
        <button
          onClick={handleSaveContext}
          disabled={patch.isPending}
          className={`mt-2 text-xs rounded-lg px-4 py-1.5 disabled:opacity-50 transition-colors ${
            saved
              ? 'bg-emerald-600 text-white'
              : 'bg-gray-800 text-white hover:bg-gray-700'
          }`}
        >
          {patch.isPending ? 'Saving…' : saved ? '✓ Saved' : 'Save Context'}
        </button>
      </section>

      {/* ── AI Pricing (F–L) ───────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold text-orange-600 uppercase tracking-wider">
              AI Pricing Guidance
            </h3>
            <span className="text-xs font-bold text-orange-500 uppercase">— Internal Only</span>
          </div>
          <button
            onClick={() => triggerReview.mutate({ leadId })}
            disabled={triggerReview.isPending}
            className="text-xs bg-indigo-600 text-white rounded-lg px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-50 shrink-0 font-medium"
          >
            {triggerReview.isPending ? 'Running…' : aiReview ? 'Re-run AI' : 'Run AI Review'}
          </button>
        </div>

        {aiReview ? (
          <div className="space-y-2">
            {PRICING_SECTIONS.map(({ key, label }) => (
              <div key={key} className="bg-orange-50 border border-orange-200 rounded-xl p-3">
                <p className="text-xs font-semibold text-orange-700 mb-1">{label}</p>
                <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                  {aiReview.sections[key] || '—'}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-orange-50 border border-orange-100 rounded-xl p-4 text-center">
            <p className="text-sm text-gray-400">
              Run AI Review to see pricing guidance.
            </p>
          </div>
        )}
      </section>

      {/* ── AI Pricing Chat ────────────────────────────────────────── */}
      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Challenge / Refine Pricing
        </h3>
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
    <div className="flex items-start gap-3 px-4 py-2.5">
      <span className="text-xs text-gray-400 w-24 shrink-0 mt-0.5">{label}</span>
      <span className="text-sm text-gray-800 flex-1">
        {value || <span className="italic text-gray-300">—</span>}
      </span>
    </div>
  )
}
