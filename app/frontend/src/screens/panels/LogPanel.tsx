import type { Lead } from '../../types/lead'

interface Props { lead: Lead; leadId: string }

export function LogPanel({ lead }: Props) {
  return <div className="p-5 text-sm text-gray-400">Log — {lead.customer_name}</div>
}
