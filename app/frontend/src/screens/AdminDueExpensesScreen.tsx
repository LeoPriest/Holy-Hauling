import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BottomNav } from '../components/BottomNav'
import { CitySwitcher } from '../components/CitySwitcher'
import { useDueRecurringExpenses, useLogRecurringExpense } from '../hooks/useRecurringExpenses'
import { centsToDisplay, isOverdue } from '../types/recurringExpense'

export function AdminDueExpensesScreen() {
  const navigate = useNavigate()
  const { data: expenses = [], isLoading, isError } = useDueRecurringExpenses()
  const logMutation = useLogRecurringExpense()
  const [gcalWarning, setGcalWarning] = useState<string | null>(null)
  const [logError, setLogError] = useState<string | null>(null)

  async function handleLog(id: string) {
    setGcalWarning(null)
    setLogError(null)
    try {
      const result = await logMutation.mutateAsync(id)
      if (result.gcal_warning) setGcalWarning(result.gcal_warning)
    } catch (e: unknown) {
      setLogError(e instanceof Error ? e.message : 'Failed to log expense')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-16">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('/admin')} aria-label="Back" className="text-gray-500 dark:text-gray-400">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </button>
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">Due Expenses</h1>
        </div>
        <CitySwitcher allowAll />
      </header>

      {gcalWarning && (
        <div className="mx-4 mt-3 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 px-4 py-2 text-xs text-amber-700 dark:text-amber-300">
          {gcalWarning} — transaction was still logged.
        </div>
      )}

      {logError && (
        <div className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20 px-4 py-2 text-xs text-red-700 dark:text-red-300">
          {logError}
        </div>
      )}

      <div className="p-4 space-y-3">
        {isLoading && <p className="text-center text-sm text-gray-400 py-8">Loading…</p>}
        {isError && <p className="text-center text-sm text-red-500 py-8">Failed to load due expenses</p>}
        {!isLoading && !isError && expenses.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-400 text-sm">Nothing due in the next 7 days</p>
          </div>
        )}
        {expenses.map(exp => (
          <div key={exp.id} className="rounded-xl border bg-white dark:bg-gray-800 dark:border-gray-700 p-4 flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-semibold text-gray-900 dark:text-white truncate">{exp.name}</p>
                {isOverdue(exp.next_due_date) && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-300 font-medium shrink-0">
                    Overdue
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400">{exp.category}</p>
              <p className="text-sm font-medium text-gray-900 dark:text-white">{centsToDisplay(exp.amount_cents)}</p>
              <p className="text-xs text-gray-400 mt-0.5">Due {exp.next_due_date}</p>
            </div>
            <button
              onClick={() => handleLog(exp.id)}
              disabled={logMutation.isPending}
              className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 hover:bg-indigo-700"
            >
              {logMutation.isPending && logMutation.variables === exp.id ? 'Logging…' : 'Log'}
            </button>
          </div>
        ))}
      </div>

      <BottomNav />
    </div>
  )
}
