export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded' | 'cancelled'
export type PaymentType = 'full' | 'deposit' | 'balance'

export interface LeadPayment {
  id: string
  lead_id: string
  amount_cents: number
  payment_type: PaymentType
  status: PaymentStatus
  payment_link_url: string | null
  square_order_id: string | null
  square_payment_id: string | null
  sent_to_phone: string | null
  sent_at: string | null
  paid_at: string | null
  created_by: string | null
  created_at: string
}

export interface PaymentRequestCreate {
  payment_type?: PaymentType
  amount_override_cents?: number
  phone_override?: string
}
