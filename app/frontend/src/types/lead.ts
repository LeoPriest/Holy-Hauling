export type LeadStatus =
  | 'new'
  | 'in_review'
  | 'replied'
  | 'waiting_on_customer'
  | 'ready_for_quote'
  | 'ready_for_booking'
  | 'escalated'
  | 'booked'
  | 'released'
  | 'lost'

export type LeadSourceType =
  | 'thumbtack_api'
  | 'thumbtack_screenshot'
  | 'yelp_screenshot'
  | 'google_screenshot'
  | 'website_form'
  | 'manual'

export type ServiceType = 'moving' | 'hauling' | 'both' | 'unknown'

export interface LeadEvent {
  id: string
  lead_id: string
  event_type: string
  from_status: string | null
  to_status: string | null
  actor: string | null
  note: string | null
  created_at: string
}

export interface Screenshot {
  id: string
  lead_id: string
  original_filename: string
  stored_path: string  // prefix with /uploads/ to build URL
  file_size: number
  ocr_status: 'pending' | 'done' | 'failed' | null
  screenshot_type: string  // "intake" | "correspondence" | "before_job" | "after_job"
  created_at: string
}

export interface OcrField {
  field: string
  value: string
  confidence: 'high' | 'medium' | 'low'
}

export interface OcrResult {
  id: string
  screenshot_id: string
  raw_text: string | null
  /** JSON string — parse with JSON.parse() to get OcrField[] */
  extracted_fields: string | null
  model_used: string | null
  created_at: string
}

export interface QuoteModifier {
  amount: number
  note: string
}

export interface AiReviewSections {
  // Action-first
  a_next_message: string
  b_call_plan: string
  c_behavior_class: string
  d_transport_path: string
  e_escalation_note: string
  // Pricing & Control (internal only — never share with customer)
  f_pricing_band: string
  g_band_position: string
  h_friction_points: string
  i_sayability_check: string
  j_quote_style: string
  k_quote_source_label: string
  l_pricing_guidance: string
  // Support & Context
  m_quick_read: string
  n_pattern_anchor: string
  o_branch_replies: string
}

export interface AiReview {
  id: string
  lead_id: string
  model_used: string
  prompt_version: string
  grounding_source: string | null
  sections: AiReviewSections
  input_snapshot: Record<string, unknown>
  created_at: string
  actor: string | null
}

export interface IngestResult {
  lead: Lead
  extraction: OcrResult | null
  auto_applied_fields: string[]
}

export interface WebhookIngestResult {
  lead: Lead | null
  created: boolean
  was_duplicate: boolean
  message: string | null
}

export interface Lead {
  id: string
  city_id: string
  city_name: string | null
  city_slug: string | null
  source_type: LeadSourceType
  source_reference_id: string | null
  raw_payload: string | null
  status: LeadStatus
  urgency_flag: boolean
  // null for ingest stubs not yet confirmed by OCR or the facilitator
  customer_name: string | null
  customer_phone: string | null
  service_type: ServiceType
  job_location: string | null
  job_origin: string | null
  job_destination: string | null
  job_date_requested: string | null
  job_date_end: string | null
  appointment_time_slot: string | null
  estimated_job_duration_minutes: number | null
  scope_notes: string | null
  // Provenance dict: field_name → "ocr" | "edited" (absence = manually entered)
  field_sources: Record<string, 'ocr' | 'edited'> | null
  notes: string | null
  ingested_by: string | null
  assigned_to: string | null
  created_at: string
  acknowledged_at: string | null
  updated_at: string
  dispatched_at: string | null
  started_at: string | null
  // Slice 8
  move_distance_miles: number | null
  load_stairs: number | null
  unload_stairs: number | null
  move_size_label: string | null
  move_type: string | null
  move_date_options: string[] | null
  accept_and_pay: boolean
  contact_status: 'locked' | 'unlocked'
  acknowledgment_sent: boolean
  quote_context: string | null
  quoted_price_total: number | null
  quote_modifiers: QuoteModifier[] | null
  job_address: string | null
  source_category_label: string
  events?: LeadEvent[]
  screenshots?: Screenshot[]
}

export interface LeadCreate {
  city_id?: string
  source_type: LeadSourceType
  source_reference_id?: string
  raw_payload?: string
  customer_name: string
  customer_phone?: string
  service_type: ServiceType
  job_location?: string
  job_date_requested?: string
  appointment_time_slot?: string
  estimated_job_duration_minutes?: number
  notes?: string
  assigned_to?: string
  urgency_flag?: boolean
}

export interface LeadUpdate {
  customer_name?: string
  customer_phone?: string | null
  service_type?: ServiceType
  job_location?: string | null
  job_origin?: string | null
  job_destination?: string | null
  job_date_requested?: string | null
  job_date_end?: string | null
  appointment_time_slot?: string | null
  estimated_job_duration_minutes?: number | null
  scope_notes?: string | null
  urgency_flag?: boolean
  assigned_to?: string | null
  notes?: string | null
  // Slice 8
  move_distance_miles?: number | null
  load_stairs?: number | null
  unload_stairs?: number | null
  move_size_label?: string | null
  move_type?: string | null
  move_date_options?: string[] | null
  acknowledgment_sent?: boolean
  quote_context?: string | null
  job_address?: string | null
}

export interface ChatMessage {
  id: string
  lead_id: string
  ai_review_id: string | null
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export interface ChatResponse {
  messages: ChatMessage[]
  quote_context_update?: string | null
}

export interface Settings {
  t1_minutes: number
  t2_minutes: number
  quiet_hours_start: string
  quiet_hours_end: string
  quiet_hours_enabled: boolean
  primary_sms: string
  primary_email: string
  backup_name: string
  backup_sms: string
  backup_email: string
}

export interface SettingsPatch {
  t1_minutes?: number
  t2_minutes?: number
  quiet_hours_start?: string
  quiet_hours_end?: string
  quiet_hours_enabled?: boolean
  primary_sms?: string
  primary_email?: string
  backup_name?: string
  backup_sms?: string
  backup_email?: string
}

export interface TestAlertRequest {
  channel: 'sms' | 'email'
  recipient: 'primary' | 'backup'
}

export interface TestAlertResult {
  sent: boolean
  reason?: string | null
}
