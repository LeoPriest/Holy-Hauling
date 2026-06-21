import type { Lead } from '../types/lead'

export const REFUND_WINDOW_HOURS = 72  // Thumbtack's fixed refund window

const EARLY_STATUSES = new Set(['new', 'in_review', 'replied', 'waiting_on_customer'])
const isThumbtack = (s?: string | null) => !!s && s.startsWith('thumbtack')

/** A Thumbtack lead that's sat 72h+ since arrival with no engagement and isn't resolved.
 *  A CANDIDATE only — never an assertion that the customer didn't respond. */
export function isRefundCandidate(lead: Lead, now: Date = new Date()): boolean {
  if (!isThumbtack(lead.source_type)) return false
  if (!EARLY_STATUSES.has(lead.status)) return false
  if (lead.customer_responded_at) return false
  if (lead.lead_refunded_at) return false
  if (!lead.created_at) return false
  const ageHours = (now.getTime() - new Date(lead.created_at).getTime()) / 3_600_000
  return ageHours >= REFUND_WINDOW_HOURS
}
