import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BottomNav } from '../components/BottomNav'
import { CitySwitcher } from '../components/CitySwitcher'
import { usePayrollSummary } from '../hooks/usePayroll'
import { PAY_TYPE_LABELS } from '../types/payroll'

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
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-16">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/admin')}
            aria-label="Back to Admin"
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </button>
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">Payroll</h1>
        </div>
        <CitySwitcher allowAll />
      </header>

      {/* Date range inputs */}
      <div className="px-4 pt-4 pb-2">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => handleDateFromChange(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:focus:ring-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => handleDateToChange(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:focus:ring-white"
            />
          </div>
        </div>
        {dateError && (
          <p className="mt-2 text-xs text-red-500">{dateError}</p>
        )}
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-2 gap-3 px-4 pb-4">
        <div className="rounded-xl border bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
          <p className="text-xs text-gray-500 dark:text-gray-400">People</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{summaries.length}</p>
        </div>
        <div className="rounded-xl border bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
          <p className="text-xs text-gray-500 dark:text-gray-400">Total owed</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            {summaries.length === 0 ? '—' : centsToDisplay(totalOwed)}
          </p>
        </div>
      </div>

      {/* List */}
      <div className="p-4 space-y-3">
        {isLoading && (
          <p className="text-center text-sm text-gray-400 py-8">Loading…</p>
        )}
        {isError && (
          <p className="text-center text-sm text-red-500 py-8">Failed to load payroll data</p>
        )}
        {!isLoading && !isError && summaries.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-400 text-sm">No pay records found for this period</p>
            <p className="text-gray-400 text-xs mt-1">Add records from job detail panels</p>
          </div>
        )}
        {summaries.map(summary => (
          <div key={summary.user_id} className="rounded-xl border bg-white dark:bg-gray-800 dark:border-gray-700 overflow-hidden">
            <button
              className="w-full flex items-center justify-between p-4 text-left"
              onClick={() => setExpandedUser(id => id === summary.user_id ? null : summary.user_id)}
            >
              <div>
                <p className="font-semibold text-gray-900 dark:text-white">{summary.username}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {summary.record_count} job{summary.record_count !== 1 ? 's' : ''}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <p className="font-bold text-green-600 dark:text-green-400">{centsToDisplay(summary.total_amount_cents)}</p>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className={`w-4 h-4 text-gray-400 transition-transform ${expandedUser === summary.user_id ? 'rotate-180' : ''}`}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                </svg>
              </div>
            </button>
            {expandedUser === summary.user_id && (
              <div className="border-t dark:border-gray-700 divide-y dark:divide-gray-700">
                {summary.jobs.map((job, i) => (
                  <button
                    key={i}
                    onClick={() => navigate(`/leads/${job.lead_id}`)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <div>
                      <p className="text-sm text-gray-800 dark:text-gray-200">{job.customer_name ?? 'Unknown customer'}</p>
                      <p className="text-xs text-gray-400">
                        {job.job_date_requested ?? 'No date'} · {PAY_TYPE_LABELS[job.pay_type]}
                      </p>
                    </div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{centsToDisplay(job.amount_cents)}</p>
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
