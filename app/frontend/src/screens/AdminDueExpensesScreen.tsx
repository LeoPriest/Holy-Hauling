import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BottomNav } from '../components/BottomNav'
import { CitySwitcher } from '../components/CitySwitcher'
import { useDueRecurringExpenses, useLogRecurringExpense } from '../hooks/useRecurringExpenses'
import { centsToDisplay, isOverdue } from '../types/recurringExpense'
import { ScreenHeader } from '../components/ScreenHeader'
import { Working } from '../components/Logo'

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
    <div className="min-h-screen bg-bg pb-16">
      <ScreenHeader title="Due expenses" onBack={() => navigate('/admin')} right={<CitySwitcher allowAll variant="pill" />} />

      {gcalWarning && (
        <div className="mx-4 mt-3 rounded-chip border border-ac bg-bg px-4 py-2 text-xs text-[#b86e00]">
          {gcalWarning} — transaction was still logged.
        </div>
      )}

      {logError && (
        <div className="mx-4 mt-3 rounded-chip border border-danger bg-bg px-4 py-2 text-xs text-danger">
          {logError}
        </div>
      )}

      <div className="p-4 space-y-3">
        {isLoading && <Working label="Loading expenses…" />}
        {isError && <p className="text-center text-sm text-danger py-8">Failed to load due expenses</p>}
        {!isLoading && !isError && expenses.length === 0 && (
          <div className="text-center py-12">
            <p className="text-mu text-sm">Nothing due in the next 7 days</p>
          </div>
        )}
        {expenses.map(exp => (
          <div key={exp.id} className="rounded-card border bg-sf p-4 flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-semibold text-ink truncate">{exp.name}</p>
                {isOverdue(exp.next_due_date) && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-bg text-danger font-medium shrink-0">
                    Overdue
                  </span>
                )}
              </div>
              <p className="text-sm text-mu">{exp.category}</p>
              <p className="text-sm font-medium text-ink">{centsToDisplay(exp.amount_cents)}</p>
              <p className="text-xs text-mu mt-0.5">Due {exp.next_due_date}</p>
            </div>
            <button
              onClick={() => handleLog(exp.id)}
              disabled={logMutation.isPending}
              className="wd-btn-sm shrink-0"
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
