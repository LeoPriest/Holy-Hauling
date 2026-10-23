import type { LeadStatus } from '../types/lead'

// Workday badges: New = amber, review/replied = outline, quote/book/booked =
// green, waiting and closed = soft, escalated = red.
const tones: Record<LeadStatus, string> = {
  new: 'wd-st-new',
  in_review: 'wd-st-line',
  replied: 'wd-st-line',
  waiting_on_customer: 'wd-st-soft',
  ready_for_quote: 'wd-st-green',
  ready_for_booking: 'wd-st-green',
  escalated: 'wd-st-red',
  booked: 'wd-st-green',
  released: 'wd-st-soft',
  lost: 'wd-st-soft',
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
  return <span className={`wd-st ${tones[status]}`}>{labels[status]}</span>
}
