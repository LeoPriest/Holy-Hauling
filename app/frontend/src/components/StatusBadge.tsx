import type { LeadStatus } from '../types/lead'

const colors: Record<LeadStatus, string> = {
  new: 'bg-red-100 text-red-800',
  in_review: 'bg-yellow-100 text-yellow-800',
  replied: 'bg-teal-100 text-teal-800',
  waiting_on_customer: 'bg-blue-100 text-blue-800',
  ready_for_quote: 'bg-purple-100 text-purple-800',
  ready_for_booking: 'bg-green-100 text-green-800',
  escalated: 'bg-orange-100 text-orange-800',
  booked: 'bg-green-200 text-green-900',
  released: 'bg-emerald-100 text-emerald-700',
  lost: 'bg-gray-100 text-gray-500',
}

const labels: Record<LeadStatus, string> = {
  new: 'New',
  in_review: 'In Review',
  replied: 'Replied',
  waiting_on_customer: 'Waiting',
  ready_for_quote: 'Ready to Quote',
  ready_for_booking: 'Ready to Book',
  escalated: 'Escalated',
  booked: 'Booked',
  released: 'Completed',
  lost: 'Released',
}

export function StatusBadge({ status }: { status: LeadStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colors[status]}`}>
      {labels[status]}
    </span>
  )
}
