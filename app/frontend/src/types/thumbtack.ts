export type ThumbtackBusiness = 'holy_hauling' | 'holy_handy'

export interface ThumbtackConnection {
  id: string
  label: string
  city_id: string
  business: ThumbtackBusiness
  business_id: string | null
  url_token: string
  auth_username: string | null
  is_active: boolean
  last_event_at: string | null
  last_error_at: string | null
  created_at: string
}

/** Only ever returned by the create call — the secret is never fetchable again. */
export interface ThumbtackConnectionCreated extends ThumbtackConnection {
  webhook_url: string
  auth_secret: string
}

export interface ThumbtackEvent {
  id: string
  connection_id: string
  kind: 'lead' | 'message' | 'review' | 'unknown'
  external_id: string | null
  raw_body: string
  status: string
  error: string | null
  lead_id: string | null
  received_at: string
  processed_at: string | null
}

export interface ThumbtackConnectionCreate {
  label: string
  city_id: string
  business: ThumbtackBusiness
}

export interface RetryResult {
  event: ThumbtackEvent
  /**
   * True only when this retry inserted a new Lead row.
   * False covers every other outcome that still carries a lead_id: the
   * retry found an existing lead (idempotency lookup), or healed one's
   * missing cost sync. Distinguish "found existing" from "no lead at all"
   * as `lead_id !== null && !created`.
   */
  created: boolean
  lead_id: string | null
}
