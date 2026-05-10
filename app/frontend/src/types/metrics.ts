export interface PipelineStage {
  status: string
  label: string
  count: number
}

export interface SourceCount {
  source_type: string
  label: string
  count: number
}

export interface AdminMetrics {
  period_days: number
  pipeline: PipelineStage[]
  total_active: number
  total_released: number
  revenue_booked_mtd: number
  revenue_pipeline: number
  leads_created_30d: number
  leads_booked_30d: number
  conversion_rate_30d: number
  sources_30d: SourceCount[]
  avg_reply_hours: number | null
}
