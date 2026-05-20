// app/frontend/src/types/recurringExpense.ts

export type IntervalUnit = 'days' | 'weeks' | 'months'

export interface RecurringExpense {
  id: string
  city_id: string
  name: string
  category: string
  amount_cents: number
  payment_method: string | null
  vendor_customer: string | null
  description: string | null
  interval_value: number
  interval_unit: IntervalUnit
  next_due_date: string  // ISO date string YYYY-MM-DD
  google_calendar_event_id: string | null
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface RecurringExpenseInput {
  city_id?: string | null
  name: string
  category: string
  amount_cents: number
  payment_method?: string | null
  vendor_customer?: string | null
  description?: string | null
  interval_value: number
  interval_unit: IntervalUnit
  next_due_date: string
}

export interface RecurringExpensePatch {
  name?: string
  category?: string
  amount_cents?: number
  payment_method?: string | null
  vendor_customer?: string | null
  description?: string | null
  interval_value?: number
  interval_unit?: IntervalUnit
  next_due_date?: string
  is_active?: boolean
}

export interface LogResult {
  transaction_id: string
  next_due_date: string
  gcal_warning: string | null
}

export function intervalLabel(value: number, unit: IntervalUnit): string {
  if (value === 1) {
    const singular: Record<IntervalUnit, string> = { days: 'day', weeks: 'week', months: 'month' }
    return `Every ${singular[unit]}`
  }
  return `Every ${value} ${unit}`
}

export function centsToDisplay(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

export function isOverdue(nextDueDate: string): boolean {
  return nextDueDate < new Date().toLocaleDateString('en-CA')
}
