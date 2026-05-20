export type PayType = 'facilitator_pct' | 'hourly' | 'flat'

export interface PayRecord {
  id: string
  lead_id: string
  user_id: string
  user_username: string
  user_hourly_rate_cents: number | null
  pay_type: PayType
  hours_worked: number | null
  override_amount_cents: number | null
  amount_cents: number
  note: string | null
  created_at: string
  updated_at: string
}

export interface PayRecordInput {
  user_id: string
  pay_type: PayType
  hours_worked?: number | null
  override_amount_cents?: number | null
  note?: string | null
}

export interface PayrollJobEntry {
  lead_id: string
  customer_name: string | null
  job_date_requested: string | null
  amount_cents: number
  pay_type: PayType
}

export interface PayrollUserSummary {
  user_id: string
  username: string
  total_amount_cents: number
  record_count: number
  jobs: PayrollJobEntry[]
}

export interface PayrollFilters {
  city_id?: string
  date_from?: string
  date_to?: string
}

export const PAY_TYPE_LABELS: Record<PayType, string> = {
  facilitator_pct: '10% Facilitator',
  hourly: 'Hourly',
  flat: 'Flat',
}
