export type FinanceTransactionType = 'income' | 'expense'

export interface FinanceTransaction {
  id: string
  occurred_on: string
  transaction_type: FinanceTransactionType
  category: string
  amount_cents: number
  payment_method: string | null
  vendor_customer: string | null
  description: string | null
  lead_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type FinanceTransactionInput = {
  occurred_on: string
  transaction_type: FinanceTransactionType
  category: string
  amount_cents: number
  payment_method?: string | null
  vendor_customer?: string | null
  description?: string | null
  lead_id?: string | null
}

export type FinanceTransactionPatch = Partial<FinanceTransactionInput>

export interface FinanceCategorySummary {
  category: string
  income_cents: number
  expense_cents: number
  net_cents: number
}

export interface FinanceSummary {
  income_cents: number
  expense_cents: number
  net_cents: number
  transaction_count: number
  categories: FinanceCategorySummary[]
}

export type FinanceFilters = {
  start_date?: string
  end_date?: string
  transaction_type?: FinanceTransactionType | ''
}
