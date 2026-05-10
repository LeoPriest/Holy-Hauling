import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BottomNav } from '../components/BottomNav'
import { useCity } from '../context/CityContext'
import { fetchAdminMetrics } from '../services/api'
import type { AdminMetrics } from '../types/metrics'

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt$(n: number) {
  return n >= 1000
    ? `$${(n / 1000).toFixed(1)}k`
    : `$${n.toFixed(0)}`
}

function fmtHours(h: number | null) {
  if (h === null) return '—'
  if (h < 1) return `${Math.round(h * 60)}m`
  return `${h.toFixed(1)}h`
}

// ── Sub-components ─────────────────────────────────────────────────────────

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex-1 bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4 min-w-0">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 leading-tight">{label}</p>
      <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1 leading-none">{value}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-1 mb-2">
      {children}
    </h2>
  )
}

function MiniBar({ value, max, color = 'bg-indigo-500' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="flex items-center gap-2 min-w-0 flex-1">
      <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function PeriodPicker({ value, onChange }: { value: number; onChange: (d: number) => void }) {
  return (
    <div className="flex gap-1.5">
      {[7, 30, 90].map(d => (
        <button
          key={d}
          onClick={() => onChange(d)}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
            value === d
              ? 'bg-indigo-600 text-white'
              : 'bg-white dark:bg-gray-800 border dark:border-gray-700 text-gray-600 dark:text-gray-400'
          }`}
        >
          {d}d
        </button>
      ))}
    </div>
  )
}

// ── Main screen ────────────────────────────────────────────────────────────

export function AdminMetricsScreen() {
  const navigate = useNavigate()
  const { cityQueryId } = useCity()
  const [days, setDays] = useState(30)
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetchAdminMetrics(cityQueryId ?? null, days)
      .then(setMetrics)
      .catch(() => setError('Failed to load metrics'))
      .finally(() => setLoading(false))
  }, [cityQueryId, days])

  const pipelineMax = metrics ? Math.max(...metrics.pipeline.map(s => s.count), 1) : 1
  const sourceMax = metrics ? Math.max(...metrics.sources_30d.map(s => s.count), 1) : 1

  const PIPELINE_COLORS: Record<string, string> = {
    new: 'bg-gray-400',
    in_review: 'bg-blue-400',
    replied: 'bg-teal-500',
    waiting_on_customer: 'bg-amber-400',
    ready_for_quote: 'bg-orange-400',
    ready_for_booking: 'bg-purple-500',
    booked: 'bg-green-500',
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-20">
      <header className="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate('/admin')}
          className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          aria-label="Back"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </button>
        <h1 className="text-lg font-bold text-gray-900 dark:text-white flex-1">Metrics</h1>
        <PeriodPicker value={days} onChange={setDays} />
      </header>

      {loading && (
        <div className="flex items-center justify-center py-24">
          <p className="text-sm text-gray-400">Loading…</p>
        </div>
      )}

      {error && (
        <div className="m-4 rounded-xl bg-red-50 border border-red-200 p-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {metrics && !loading && (
        <div className="p-4 space-y-6">

          {/* ── KPI row ─────────────────────────────────────── */}
          <div>
            <SectionTitle>Overview</SectionTitle>
            <div className="flex gap-3">
              <KpiCard
                label="Active Leads"
                value={String(metrics.total_active)}
                sub={`${metrics.total_released} released`}
              />
              <KpiCard
                label="Conversion"
                value={`${metrics.conversion_rate_30d}%`}
                sub={`${metrics.leads_booked_30d} of ${metrics.leads_created_30d} leads`}
              />
            </div>
            <div className="flex gap-3 mt-3">
              <KpiCard
                label="Booked MTD"
                value={fmt$(metrics.revenue_booked_mtd)}
                sub="this calendar month"
              />
              <KpiCard
                label="Avg Reply"
                value={fmtHours(metrics.avg_reply_hours)}
                sub="lead to first reply"
              />
            </div>
          </div>

          {/* ── Pipeline funnel ──────────────────────────────── */}
          <div>
            <SectionTitle>Pipeline</SectionTitle>
            <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 divide-y dark:divide-gray-700">
              {metrics.pipeline.map(stage => (
                <div key={stage.status} className="flex items-center gap-3 px-4 py-3">
                  <span className="text-sm text-gray-700 dark:text-gray-300 w-36 shrink-0">{stage.label}</span>
                  <MiniBar value={stage.count} max={pipelineMax} color={PIPELINE_COLORS[stage.status] ?? 'bg-indigo-400'} />
                  <span className={`text-sm font-semibold w-8 text-right shrink-0 ${stage.count > 0 ? 'text-gray-900 dark:text-white' : 'text-gray-300 dark:text-gray-600'}`}>
                    {stage.count}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Revenue pipeline ─────────────────────────────── */}
          {metrics.revenue_pipeline > 0 && (
            <div>
              <SectionTitle>Revenue Pipeline</SectionTitle>
              <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4">
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Quoted — in progress</p>
                    <p className="text-3xl font-bold text-gray-900 dark:text-white mt-1">{fmt$(metrics.revenue_pipeline)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500 dark:text-gray-400">Booked this month</p>
                    <p className="text-xl font-bold text-green-600 mt-1">{fmt$(metrics.revenue_booked_mtd)}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Lead sources ─────────────────────────────────── */}
          {metrics.sources_30d.length > 0 && (
            <div>
              <SectionTitle>Sources — last {days} days</SectionTitle>
              <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 divide-y dark:divide-gray-700">
                {metrics.sources_30d.map(s => (
                  <div key={s.source_type} className="flex items-center gap-3 px-4 py-3">
                    <span className="text-sm text-gray-700 dark:text-gray-300 w-40 shrink-0 truncate">{s.label}</span>
                    <MiniBar value={s.count} max={sourceMax} color="bg-blue-400" />
                    <span className="text-sm font-semibold text-gray-900 dark:text-white w-8 text-right shrink-0">{s.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      )}

      <BottomNav />
    </div>
  )
}
