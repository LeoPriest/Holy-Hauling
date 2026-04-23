import type { AiReview, Lead } from '../../types/lead'

interface Props { lead: Lead; aiReview: AiReview | undefined; leadId: string }

export function QuotePanel({ lead }: Props) {
  return <div className="p-5 text-sm text-gray-400">Quote — {lead.customer_name}</div>
}
