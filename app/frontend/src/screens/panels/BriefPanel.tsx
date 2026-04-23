import type { AiReview, Lead } from '../../types/lead'

interface Props { lead: Lead; aiReview: AiReview | undefined }

export function BriefPanel({ lead }: Props) {
  return <div className="p-5 text-sm text-gray-400">Brief — {lead.customer_name}</div>
}
