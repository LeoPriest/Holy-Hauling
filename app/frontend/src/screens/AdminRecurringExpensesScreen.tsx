// app/frontend/src/screens/AdminRecurringExpensesScreen.tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BottomNav } from '../components/BottomNav'
import { CitySwitcher } from '../components/CitySwitcher'
import { useCity } from '../context/CityContext'
import {
  useCreateRecurringExpense,
  useDeleteRecurringExpense,
  usePatchRecurringExpense,
  useRecurringExpenses,
} from '../hooks/useRecurringExpenses'
import { centsToDisplay, intervalLabel } from '../types/recurringExpense'
import type { IntervalUnit, RecurringExpense } from '../types/recurringExpense'

function dollarsToCents(value: string): number {
  const parsed = parseFloat(value.replace(/[^0-9.]/g, ''))
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0
}

const EMPTY_FORM = {
  name: '',
  category: '',
  amountDollars: '',
  payment_method: '',
  vendor_customer: '',
  description: '',
  interval_value: '1',
  interval_unit: 'months' as IntervalUnit,
  next_due_date: new Date().toLocaleDateString('en-CA'),
}

export function AdminRecurringExpensesScreen() {
  const navigate = useNavigate()
  const { cityQueryId } = useCity()
  const { data: expenses = [], isLoading } = useRecurringExpenses()
  const createMutation = useCreateRecurringExpense()
  const patchMutation = usePatchRecurringExpense()
  const deleteMutation = useDeleteRecurringExpense()

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [formError, setFormError] = useState('')

  function openCreate() {
    setForm(EMPTY_FORM)
    setEditingId(null)
    setFormError('')
    setShowForm(true)
  }

  function openEdit(exp: RecurringExpense) {
    setForm({
      name: exp.name,
      category: exp.category,
      amountDollars: (exp.amount_cents / 100).toFixed(2),
      payment_method: exp.payment_method ?? '',
      vendor_customer: exp.vendor_customer ?? '',
      description: exp.description ?? '',
      interval_value: String(exp.interval_value),
      interval_unit: exp.interval_unit as IntervalUnit,
      next_due_date: exp.next_due_date,
    })
    setEditingId(exp.id)
    setFormError('')
    setShowForm(true)
  }

  async function handleSave() {
    setFormError('')
    const amount_cents = dollarsToCents(form.amountDollars)
    if (!form.name.trim()) { setFormError('Name is required'); return }
    if (!form.category.trim()) { setFormError('Category is required'); return }
    if (amount_cents <= 0) { setFormError('Amount must be greater than 0'); return }
    const interval_value = parseInt(form.interval_value, 10)
    if (!interval_value || interval_value <= 0) { setFormError('Interval must be a positive number'); return }
    if (!form.next_due_date) { setFormError('Next due date is required'); return }

    const body = {
      name: form.name.trim(),
      category: form.category.trim(),
      amount_cents,
      payment_method: form.payment_method.trim() || null,
      vendor_customer: form.vendor_customer.trim() || null,
      description: form.description.trim() || null,
      interval_value,
      interval_unit: form.interval_unit,
      next_due_date: form.next_due_date,
      city_id: cityQueryId || null,
    }

    try {
      if (editingId) {
        await patchMutation.mutateAsync({ id: editingId, body })
      } else {
        await createMutation.mutateAsync(body)
      }
      setShowForm(false)
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : 'Error saving')
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteMutation.mutateAsync(id)
      setConfirmDeleteId(null)
    } catch (e: unknown) {
      setConfirmDeleteId(null)
      setFormError(e instanceof Error ? e.message : 'Failed to delete')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-16">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('/admin/finances')} aria-label="Back" className="text-gray-500 dark:text-gray-400">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </button>
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">Recurring Expenses</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openCreate}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Add
          </button>
          <CitySwitcher />
        </div>
      </header>

      <main className="p-4 space-y-3">
        {isLoading && <p className="text-center text-sm text-gray-400 py-8">Loading…</p>}
        {!isLoading && expenses.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-400 text-sm">No recurring expenses yet</p>
            <p className="text-gray-400 text-xs mt-1">Tap Add to set one up</p>
          </div>
        )}
        {expenses.map(exp => (
          <div key={exp.id} className={`rounded-xl border bg-white dark:bg-gray-800 dark:border-gray-700 p-4 ${!exp.is_active ? 'opacity-60' : ''}`}>
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-gray-900 dark:text-white truncate">{exp.name}</p>
                  {!exp.is_active && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">Paused</span>
                  )}
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400">{exp.category} · {intervalLabel(exp.interval_value, exp.interval_unit as IntervalUnit)}</p>
                <p className="text-sm font-medium text-gray-900 dark:text-white mt-1">{centsToDisplay(exp.amount_cents)}</p>
                <p className="text-xs text-gray-400 mt-0.5">Next: {exp.next_due_date}</p>
              </div>
              <div className="flex items-center gap-2 ml-2 shrink-0">
                <button
                  onClick={() => patchMutation.mutate({ id: exp.id, body: { is_active: !exp.is_active } })}
                  className="text-xs px-2 py-1.5 rounded text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  {exp.is_active ? 'Pause' : 'Activate'}
                </button>
                <button
                  onClick={() => openEdit(exp)}
                  className="text-xs px-2 py-1.5 rounded text-gray-500 dark:text-gray-400 hover:underline"
                >
                  Edit
                </button>
                <button
                  onClick={() => setConfirmDeleteId(exp.id)}
                  className="text-xs px-2 py-1.5 rounded text-red-500 hover:underline"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </main>

      {/* Create / Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-sm space-y-3 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              {editingId ? 'Edit Recurring Expense' : 'Add Recurring Expense'}
            </h2>

            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Name *</label>
              <input
                className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Truck insurance"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Category *</label>
              <input
                className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                placeholder="e.g. Insurance"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Amount ($) *</label>
              <input
                type="number"
                min="0"
                step="0.01"
                className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                value={form.amountDollars}
                onChange={e => setForm(f => ({ ...f, amountDollars: e.target.value }))}
                placeholder="0.00"
              />
            </div>

            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Every</label>
                <input
                  type="number"
                  min="1"
                  className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  value={form.interval_value}
                  onChange={e => setForm(f => ({ ...f, interval_value: e.target.value }))}
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Unit</label>
                <select
                  className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  value={form.interval_unit}
                  onChange={e => setForm(f => ({ ...f, interval_unit: e.target.value as IntervalUnit }))}
                >
                  <option value="days">Days</option>
                  <option value="weeks">Weeks</option>
                  <option value="months">Months</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Next due date *</label>
              <input
                type="date"
                className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                value={form.next_due_date}
                onChange={e => setForm(f => ({ ...f, next_due_date: e.target.value }))}
              />
            </div>

            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Payment method</label>
              <input
                className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                value={form.payment_method}
                onChange={e => setForm(f => ({ ...f, payment_method: e.target.value }))}
                placeholder="e.g. ACH"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Vendor</label>
              <input
                className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                value={form.vendor_customer}
                onChange={e => setForm(f => ({ ...f, vendor_customer: e.target.value }))}
                placeholder="e.g. State Farm"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Notes</label>
              <textarea
                rows={2}
                className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>

            {formError && <p className="text-xs text-red-500">{formError}</p>}

            <div className="flex gap-3 pt-1">
              <button
                onClick={handleSave}
                disabled={createMutation.isPending || patchMutation.isPending}
                className="flex-1 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold disabled:opacity-40"
              >
                {createMutation.isPending || patchMutation.isPending ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="flex-1 py-2 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-semibold"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDeleteId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-sm">
            <p className="text-gray-900 dark:text-white font-semibold mb-2">Delete recurring expense?</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">This will remove the schedule and delete the Google Calendar event. Logged transactions are kept.</p>
            <div className="flex gap-3">
              <button
                onClick={() => handleDelete(confirmDeleteId)}
                disabled={deleteMutation.isPending}
                className="flex-1 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold disabled:opacity-40"
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
              </button>
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="flex-1 py-2 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-semibold"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  )
}
