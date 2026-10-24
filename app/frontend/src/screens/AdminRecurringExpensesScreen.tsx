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
import { ScreenHeader } from '../components/ScreenHeader'

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
    <div className="min-h-screen bg-bg pb-16">
      <ScreenHeader title="Recurring expenses" onBack={() => navigate('/admin/finances')} right={<CitySwitcher variant="pill" />} />
      <div className="mx-auto flex max-w-3xl flex-wrap gap-2 px-3.5 pt-3">
        <button type="button" onClick={openCreate} className="wd-btn-sm">Add</button>
      </div>

      <main className="p-4 space-y-3">
        {isLoading && <p className="text-center text-sm text-mu py-8">Loading…</p>}
        {!isLoading && expenses.length === 0 && (
          <div className="text-center py-12">
            <p className="text-mu text-sm">No recurring expenses yet</p>
            <p className="text-mu text-xs mt-1">Tap Add to set one up</p>
          </div>
        )}
        {expenses.map(exp => (
          <div key={exp.id} className={`rounded-card border bg-sf   p-4 ${!exp.is_active ? 'opacity-60' : ''}`}>
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-ink truncate">{exp.name}</p>
                  {!exp.is_active && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-bg text-mu">Paused</span>
                  )}
                </div>
                <p className="text-sm text-mu">{exp.category} · {intervalLabel(exp.interval_value, exp.interval_unit as IntervalUnit)}</p>
                <p className="text-sm font-medium text-ink mt-1">{centsToDisplay(exp.amount_cents)}</p>
                <p className="text-xs text-mu mt-0.5">Next: {exp.next_due_date}</p>
              </div>
              <div className="flex items-center gap-2 ml-2 shrink-0">
                <button
                  onClick={() => patchMutation.mutate({ id: exp.id, body: { is_active: !exp.is_active } })}
                  className="text-xs px-2 py-1.5 rounded text-ok hover:underline"
                >
                  {exp.is_active ? 'Pause' : 'Activate'}
                </button>
                <button
                  onClick={() => openEdit(exp)}
                  className="text-xs px-2 py-1.5 rounded text-mu hover:underline"
                >
                  Edit
                </button>
                <button
                  onClick={() => setConfirmDeleteId(exp.id)}
                  className="text-xs px-2 py-1.5 rounded text-danger hover:underline"
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
          <div className="bg-sf rounded-panel p-6 w-full max-w-sm space-y-3 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-ink">
              {editingId ? 'Edit Recurring Expense' : 'Add Recurring Expense'}
            </h2>

            <div>
              <label className="block text-xs text-mu mb-1">Name *</label>
              <input
                className="w-full border rounded-chip px-3 py-2 text-sm bg-sf text-ink"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Truck insurance"
              />
            </div>

            <div>
              <label className="block text-xs text-mu mb-1">Category *</label>
              <input
                className="w-full border rounded-chip px-3 py-2 text-sm bg-sf text-ink"
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                placeholder="e.g. Insurance"
              />
            </div>

            <div>
              <label className="block text-xs text-mu mb-1">Amount ($) *</label>
              <input
                type="number"
                min="0"
                step="0.01"
                className="w-full border rounded-chip px-3 py-2 text-sm bg-sf text-ink"
                value={form.amountDollars}
                onChange={e => setForm(f => ({ ...f, amountDollars: e.target.value }))}
                placeholder="0.00"
              />
            </div>

            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-xs text-mu mb-1">Every</label>
                <input
                  type="number"
                  min="1"
                  className="w-full border rounded-chip px-3 py-2 text-sm bg-sf text-ink"
                  value={form.interval_value}
                  onChange={e => setForm(f => ({ ...f, interval_value: e.target.value }))}
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-mu mb-1">Unit</label>
                <select
                  className="w-full border rounded-chip px-3 py-2 text-sm bg-sf text-ink"
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
              <label className="block text-xs text-mu mb-1">Next due date *</label>
              <input
                type="date"
                className="w-full border rounded-chip px-3 py-2 text-sm bg-sf text-ink"
                value={form.next_due_date}
                onChange={e => setForm(f => ({ ...f, next_due_date: e.target.value }))}
              />
            </div>

            <div>
              <label className="block text-xs text-mu mb-1">Payment method</label>
              <input
                className="w-full border rounded-chip px-3 py-2 text-sm bg-sf text-ink"
                value={form.payment_method}
                onChange={e => setForm(f => ({ ...f, payment_method: e.target.value }))}
                placeholder="e.g. ACH"
              />
            </div>

            <div>
              <label className="block text-xs text-mu mb-1">Vendor</label>
              <input
                className="w-full border rounded-chip px-3 py-2 text-sm bg-sf text-ink"
                value={form.vendor_customer}
                onChange={e => setForm(f => ({ ...f, vendor_customer: e.target.value }))}
                placeholder="e.g. State Farm"
              />
            </div>

            <div>
              <label className="block text-xs text-mu mb-1">Notes</label>
              <textarea
                rows={2}
                className="w-full border rounded-chip px-3 py-2 text-sm bg-sf text-ink"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>

            {formError && <p className="text-xs text-danger">{formError}</p>}

            <div className="flex gap-3 pt-1">
              <button
                onClick={handleSave}
                disabled={createMutation.isPending || patchMutation.isPending}
                className="flex-1 py-2 rounded-card bg-pr text-white text-sm font-semibold disabled:opacity-40"
              >
                {createMutation.isPending || patchMutation.isPending ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="flex-1 py-2 rounded-card bg-bg text-ink text-sm font-semibold"
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
          <div className="bg-sf rounded-panel p-6 w-full max-w-sm">
            <p className="text-ink font-semibold mb-2">Delete recurring expense?</p>
            <p className="text-sm text-mu mb-4">This will remove the schedule and delete the Google Calendar event. Logged transactions are kept.</p>
            <div className="flex gap-3">
              <button
                onClick={() => handleDelete(confirmDeleteId)}
                disabled={deleteMutation.isPending}
                className="flex-1 py-2 rounded-card bg-danger text-white text-sm font-semibold disabled:opacity-40"
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
              </button>
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="flex-1 py-2 rounded-card bg-bg text-ink text-sm font-semibold"
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
