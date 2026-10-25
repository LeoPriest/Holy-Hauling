import type { Lead } from '../types/lead'
import { isRefundCandidate } from '../utils/refund'
import { useMarkCustomerResponded, useMarkRefunded } from '../hooks/useLeads'

const isThumbtack = (s?: string | null) => !!s && s.startsWith('thumbtack')

export function RefundBanner({ lead }: { lead: Lead }) {
  const responded = useMarkCustomerResponded()
  const refunded = useMarkRefunded()
  const busy = responded.isPending || refunded.isPending

  if (lead.lead_refunded_at) {
    return (
      <div className="wd-box wd-box-soft flex items-center gap-2 text-sm">
        <span aria-hidden="true">💸</span>
        <div>
          <div className="font-semibold text-ok">Refunded — lead cost zeroed</div>
          <div className="text-xs text-mu">ROI updated: this lead now cost $0.</div>
        </div>
        <button type="button" disabled={busy} onClick={() => refunded.mutate({ leadId: lead.id, on: false })}
          className="wd-btn-sm wd-btn-ghost ml-auto">Undo</button>
      </div>
    )
  }
  if (lead.customer_responded_at) {
    return (
      <div className="wd-box wd-box-soft flex items-center gap-2 text-sm">
        <span aria-hidden="true">✓</span>
        <div>
          <div className="font-semibold">Customer responded</div>
          <div className="text-xs text-mu">Won't be flagged for refund.</div>
        </div>
        <button type="button" disabled={busy} onClick={() => responded.mutate({ leadId: lead.id, on: false })}
          className="wd-btn-sm wd-btn-ghost ml-auto">Undo</button>
      </div>
    )
  }
  if (isRefundCandidate(lead)) {
    return (
      <div className="wd-box overflow-hidden !p-0">
        <div className="haz h-1.5" aria-hidden="true" />
        <div className="px-3.5 py-3">
        <div className="wd-fl !mb-1 !text-[#b86e00] dark:!text-ac">Possible refund</div>
        <div className="font-semibold">Customer hasn't responded in 3+ days</div>
        <p className="mt-0.5 text-xs text-mu">
          This Thumbtack lead arrived 72h+ ago and never moved forward. If the customer truly didn't respond it's likely refund-eligible — only you know for sure.
        </p>
        <div className="mt-2 flex gap-2">
          <button type="button" disabled={busy} onClick={() => responded.mutate({ leadId: lead.id, on: true })}
            className="wd-btn-sm wd-btn-ghost flex-1">✓ Customer responded</button>
          <button type="button" disabled={busy} onClick={() => refunded.mutate({ leadId: lead.id, on: true })}
            className="wd-btn-sm flex-1">💸 Mark refunded</button>
        </div>
        {(responded.isError || refunded.isError) && <p className="wd-err mt-1">Couldn't update. Try again.</p>}
        </div>
      </div>
    )
  }
  if (isThumbtack(lead.source_type)) {
    return (
      <div className="flex items-center gap-2 rounded-card border border-dashed p-2.5 text-xs text-mu">
        <span aria-hidden="true">📞</span>
        <span>Customer already replied? Mark it so this lead is never flagged.</span>
        <button type="button" disabled={busy} onClick={() => responded.mutate({ leadId: lead.id, on: true })}
          className="wd-btn-sm wd-btn-ghost ml-auto shrink-0">✓ Responded</button>
      </div>
    )
  }
  return null
}
