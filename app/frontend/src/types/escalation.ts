export type EscalationLevel = 'monitor' | 'pause' | 'owner_takeover'
export type EscalationOutcome =
  | 'approved' | 'adjusted' | 'owner_takeover' | 'release' | 'need_more_info'

export interface LeadEscalation {
  id: string
  lead_id: string
  level: EscalationLevel
  source: 'manual' | 'auto_idle'
  decision_needed: string
  summary: string
  raised_by: string | null
  raised_at: string
  status: 'open' | 'resolved'
  outcome: EscalationOutcome | null
  resolution_note: string | null
  resolved_by: string | null
  resolved_at: string | null
  lead_customer_name: string | null
  lead_status: string | null
}

export const LEVEL_LABELS: Record<EscalationLevel, string> = {
  monitor: 'Monitor',
  pause: 'Pause before quote',
  owner_takeover: 'Owner takeover',
}

export const OUTCOME_LABELS: Record<EscalationOutcome, string> = {
  approved: 'Approved',
  adjusted: 'Adjusted',
  owner_takeover: 'Owner taking over',
  release: 'Release',
  need_more_info: 'Need more info',
}

export const DECISION_OPTIONS = ['price', 'schedule', 'truck', 'release', 'owner takeover'] as const
