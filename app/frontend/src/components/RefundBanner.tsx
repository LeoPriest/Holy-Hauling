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
      <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-3 text-sm dark:border-gray-700 dark:bg-gray-800">
        <span>💸</span>
        <div>
          <div className="font-medium text-emerald-600 dark:text-emerald-400">Refunded — lead cost zeroed</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">ROI updated: this lead now cost $0.</div>
        </div>
        <button type="button" disabled={busy} onClick={() => refunded.mutate({ leadId: lead.id, on: false })}
          className="ml-auto text-xs text-gray-400 underline disabled:opacity-40">Undo</button>
      </div>
    )
  }
  if (lead.customer_responded_at) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-3 text-sm dark:border-gray-700 dark:bg-gray-800">
        <span>✓</span>
        <div>
          <div className="font-medium">Customer responded</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Won't be flagged for refund.</div>
        </div>
        <button type="button" disabled={busy} onClick={() => responded.mutate({ leadId: lead.id, on: false })}
          className="ml-auto text-xs text-gray-400 underline disabled:opacity-40">Undo</button>
      </div>
    )
  }
  if (isRefundCandidate(lead)) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-900/20">
        <div className="text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">Possible refund</div>
        <div className="mt-1 font-semibold text-gray-900 dark:text-white">Customer hasn't responded in 3+ days</div>
        <p className="mt-0.5 text-xs text-amber-800/80 dark:text-amber-200/80">
          This Thumbtack lead arrived 72h+ ago and never moved forward. If the customer truly didn't respond it's likely refund-eligible — only you know for sure.
        </p>
        <div className="mt-2 flex gap-2">
          <button type="button" disabled={busy} onClick={() => responded.mutate({ leadId: lead.id, on: true })}
            className="min-h-11 flex-1 rounded-lg border border-gray-300 bg-white text-sm font-semibold dark:border-gray-600 dark:bg-gray-700 dark:text-white disabled:opacity-40">✓ Customer responded</button>
          <button type="button" disabled={busy} onClick={() => refunded.mutate({ leadId: lead.id, on: true })}
            className="min-h-11 flex-1 rounded-lg bg-emerald-500 text-sm font-semibold text-white disabled:opacity-40">💸 Mark refunded</button>
        </div>
        {(responded.isError || refunded.isError) && <p className="mt-1 text-xs text-red-500">Couldn't update. Try again.</p>}
      </div>
    )
  }
  if (isThumbtack(lead.source_type)) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-dashed border-gray-300 p-2.5 text-xs text-gray-500 dark:border-gray-600 dark:text-gray-400">
        <span>📞</span>
        <span>Customer already replied? Mark it so this lead is never flagged.</span>
        <button type="button" disabled={busy} onClick={() => responded.mutate({ leadId: lead.id, on: true })}
          className="ml-auto min-h-9 rounded-lg border border-gray-300 px-3 text-xs font-semibold dark:border-gray-600 dark:text-white disabled:opacity-40">✓ Responded</button>
      </div>
    )
  }
  return null
}
