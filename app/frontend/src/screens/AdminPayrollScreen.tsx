import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BottomNav } from '../components/BottomNav'
import { CitySwitcher } from '../components/CitySwitcher'
import { usePayrollSummary } from '../hooks/usePayroll'
import { PAY_TYPE_LABELS } from '../types/payroll'
import { ScreenHeader } from '../components/ScreenHeader'

function centsToDisplay(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

function currentWeekBounds(): { date_from: string; date_to: string } {
  const now = new Date()
  const day = now.getDay()
  const diffToMonday = (day === 0 ? -6 : 1 - day)
  const monday = new Date(now)
  monday.setDate(now.getDate() + diffToMonday)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const fmt = (d: Date) => d.toLocaleDateString('en-CA')
  return { date_from: fmt(monday), date_to: fmt(sunday) }
}

export function AdminPayrollScreen() {
  const navigate = useNavigate()
  const defaults = currentWeekBounds()
  const [dateFrom, setDateFrom] = useState(defaults.date_from)
  const [dateTo, setDateTo] = useState(defaults.date_to)
  const [expandedUser, setExpandedUser] = useState<string | null>(null)
  const [dateError, setDateError] = useState('')

  const filters = dateFrom && dateTo && !dateError
    ? { date_from: dateFrom, date_to: dateTo }
    : {}

  const { data: summaries = [], isLoading, isError } = usePayrollSummary(filters)

  const handleDateFromChange = (v: string) => {
    setDateFrom(v)
    setDateError(v > dateTo ? 'Start date must be ≤ end date' : '')
  }

  const handleDateToChange = (v: string) => {
    setDateTo(v)
    setDateError(dateFrom > v ? 'Start date must be ≤ end date' : '')
  }

  const totalOwed = summaries.reduce((s, u) => s + u.total_amount_cents, 0)

  return (
    <div className="min-h-screen bg-bg pb-16">
      {/* Header */}
      <ScreenHeader title="Payroll" onBack={() => navigate('/admin')} right={<CitySwitcher allowAll variant="pill" />} />

      {/* Date range inputs */}
      <div className="px-4 pt-4 pb-2">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-mu mb-1">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => handleDateFromChange(e.target.value)}
              className="wd-input"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-mu mb-1">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => handleDateToChange(e.target.value)}
              className="wd-input"
            />
          </div>
        </div>
        {dateError && (
          <p className="mt-2 text-xs text-danger">{dateError}</p>
        )}
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-2 gap-3 px-4 pb-4">
        <div className="rounded-card border bg-sf p-3">
          <p className="text-xs text-mu">People</p>
          <p className="text-2xl font-bold text-ink">{summaries.length}</p>
        </div>
        <div className="rounded-card border bg-sf p-3">
          <p className="text-xs text-mu">Total owed</p>
          <p className="text-2xl font-bold text-ink">
            {summaries.length === 0 ? '—' : centsToDisplay(totalOwed)}
          </p>
        </div>
      </div>

      {/* List */}
      <div className="p-4 space-y-3">
        {isLoading && (
          <p className="text-center text-sm text-mu py-8">Loading…</p>
        )}
        {isError && (
          <p className="text-center text-sm text-danger py-8">Failed to load payroll data</p>
        )}
        {!isLoading && !isError && summaries.length === 0 && (
          <div className="text-center py-12">
            <p className="text-mu text-sm">No pay records found for this period</p>
            <p className="text-mu text-xs mt-1">Add records from job detail panels</p>
          </div>
        )}
        {summaries.map(summary => (
          <div key={summary.user_id} className="rounded-card border bg-sf overflow-hidden">
            <button
              className="w-full flex items-center justify-between p-4 text-left"
              onClick={() => setExpandedUser(id => id === summary.user_id ? null : summary.user_id)}
            >
              <div>
                <p className="font-semibold text-ink">{summary.username}</p>
                <p className="text-sm text-mu">
                  {summary.record_count} job{summary.record_count !== 1 ? 's' : ''}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <p className="font-bold text-ok">{centsToDisplay(summary.total_amount_cents)}</p>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"
                  className={`w-4 h-4 text-mu transition-transform ${expandedUser === summary.user_id ? 'rotate-180' : ''}`}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                </svg>
              </div>
            </button>
            {expandedUser === summary.user_id && (
              <div className="border-t divide-y">
                {summary.jobs.map(job => (
                  <button
                    key={job.lead_id}
                    onClick={() => navigate(`/leads/${job.lead_id}`)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left transition-colors"
                  >
                    <div>
                      <p className="text-sm text-ink">{job.customer_name ?? 'Unknown customer'}</p>
                      <p className="text-xs text-mu">
                        {job.job_date_requested ?? 'No date'} · {PAY_TYPE_LABELS[job.pay_type]}
                      </p>
                    </div>
                    <p className="text-sm font-medium text-ink">{centsToDisplay(job.amount_cents)}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <BottomNav />
    </div>
  )
}
