import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useCreateFinanceTransaction,
  useDeleteFinanceTransaction,
  useFinanceSummary,
  useFinanceTransactions,
  usePatchFinanceTransaction,
} from '../hooks/useFinances'
import type { FinanceTransaction, FinanceTransactionInput, FinanceTransactionType } from '../types/finance'

const EMPTY_FORM: FinanceTransactionInput = {
  occurred_on: new Date().toISOString().slice(0, 10),
  transaction_type: 'income',
  category: '',
  amount_cents: 0,
  payment_method: '',
  vendor_customer: '',
  description: '',
  lead_id: null,
}

function centsToCurrency(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

function dollarsToCents(value: string) {
  const parsed = Number(value.replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(parsed)) return 0
  return Math.round(parsed * 100)
}

function centsToDollarsInput(cents: number) {
  return cents ? (cents / 100).toFixed(2) : ''
}

export function AdminFinancesScreen() {
  const navigate = useNavigate()
  const [startDate, setStartDate] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [typeFilter, setTypeFilter] = useState<FinanceTransactionType | ''>('')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<FinanceTransaction | null>(null)
  const [form, setForm] = useState<FinanceTransactionInput>(EMPTY_FORM)
  const [amountInput, setAmountInput] = useState('')
  const [error, setError] = useState('')

  const filters = useMemo(() => ({
    start_date: startDate,
    end_date: endDate,
    transaction_type: typeFilter,
  }), [startDate, endDate, typeFilter])

  const { data: transactions = [], isLoading } = useFinanceTransactions(filters)
  const { data: summary } = useFinanceSummary(filters)
  const createTransaction = useCreateFinanceTransaction()
  const patchTransaction = usePatchFinanceTransaction()
  const deleteTransaction = useDeleteFinanceTransaction()

  const netPositive = (summary?.net_cents ?? 0) >= 0

  function openCreate(type: FinanceTransactionType = 'income') {
    setEditing(null)
    setForm({ ...EMPTY_FORM, occurred_on: new Date().toISOString().slice(0, 10), transaction_type: type })
    setAmountInput('')
    setError('')
    setShowForm(true)
  }

  function openEdit(transaction: FinanceTransaction) {
    setEditing(transaction)
    setForm({
      occurred_on: transaction.occurred_on,
      transaction_type: transaction.transaction_type,
      category: transaction.category,
      amount_cents: transaction.amount_cents,
      payment_method: transaction.payment_method ?? '',
      vendor_customer: transaction.vendor_customer ?? '',
      description: transaction.description ?? '',
      lead_id: transaction.lead_id,
    })
    setAmountInput(centsToDollarsInput(transaction.amount_cents))
    setError('')
    setShowForm(true)
  }

  async function saveTransaction() {
    setError('')
    const body = {
      ...form,
      amount_cents: dollarsToCents(amountInput),
      category: form.category.trim(),
      payment_method: form.payment_method?.trim() || null,
      vendor_customer: form.vendor_customer?.trim() || null,
      description: form.description?.trim() || null,
      lead_id: form.lead_id?.trim() || null,
    }
    if (!body.category || body.amount_cents <= 0) {
      setError('Category and amount are required.')
      return
    }
    try {
      if (editing) {
        await patchTransaction.mutateAsync({ id: editing.id, body })
      } else {
        await createTransaction.mutateAsync(body)
      }
      setShowForm(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unable to save transaction')
    }
  }

  async function removeTransaction(id: string) {
    if (!window.confirm('Delete this transaction?')) return
    await deleteTransaction.mutateAsync(id)
  }

  const inputClass = 'rounded-lg border px-3 py-2 text-sm bg-white text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white'

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="text-sm font-medium text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200">
            Back
          </button>
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">Finances</h1>
        </div>
        <button
          onClick={() => openCreate('income')}
          className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Add
        </button>
      </header>

      <main className="space-y-4 p-4 pb-12">
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SummaryCard label="Income" value={centsToCurrency(summary?.income_cents ?? 0)} tone="text-emerald-600 dark:text-emerald-400" />
          <SummaryCard label="Expenses" value={centsToCurrency(summary?.expense_cents ?? 0)} tone="text-red-600 dark:text-red-400" />
          <SummaryCard label="Net" value={centsToCurrency(summary?.net_cents ?? 0)} tone={netPositive ? 'text-gray-900 dark:text-white' : 'text-red-600 dark:text-red-400'} />
        </section>

        <section className="rounded-xl border bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div className="flex flex-wrap gap-2">
            <input type="date" className={inputClass} value={startDate} onChange={e => setStartDate(e.target.value)} />
            <input type="date" className={inputClass} value={endDate} onChange={e => setEndDate(e.target.value)} />
            <select className={inputClass} value={typeFilter} onChange={e => setTypeFilter(e.target.value as FinanceTransactionType | '')}>
              <option value="">All types</option>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
            </select>
            <button onClick={() => openCreate('expense')} className="rounded-lg border px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700">
              Add Expense
            </button>
          </div>
        </section>

        {summary && summary.categories.length > 0 && (
          <section className="rounded-xl border bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Categories</h2>
            <div className="space-y-2">
              {summary.categories.slice(0, 6).map(category => (
                <div key={category.category} className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium text-gray-700 dark:text-gray-200">{category.category}</span>
                  <span className={category.net_cents >= 0 ? 'text-gray-600 dark:text-gray-300' : 'text-red-600 dark:text-red-400'}>
                    {centsToCurrency(category.net_cents)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">{transactions.length} transaction{transactions.length === 1 ? '' : 's'}</p>
            {summary && <p className="text-xs text-gray-400">{summary.transaction_count} in summary</p>}
          </div>
          {isLoading && <p className="py-8 text-center text-sm text-gray-400">Loading...</p>}
          {!isLoading && transactions.length === 0 && <p className="py-8 text-center text-sm text-gray-400">No transactions in this range.</p>}
          {transactions.map(transaction => (
            <article key={transaction.id} className="rounded-xl border bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${transaction.transaction_type === 'income' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200' : 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200'}`}>
                      {transaction.transaction_type}
                    </span>
                    <span className="text-xs text-gray-400">{transaction.occurred_on}</span>
                  </div>
                  <h2 className="mt-2 font-semibold text-gray-900 dark:text-white">{transaction.category}</h2>
                  {(transaction.vendor_customer || transaction.payment_method) && (
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {[transaction.vendor_customer, transaction.payment_method].filter(Boolean).join(' - ')}
                    </p>
                  )}
                  {transaction.description && <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{transaction.description}</p>}
                </div>
                <div className="text-right">
                  <p className={`font-bold ${transaction.transaction_type === 'income' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                    {transaction.transaction_type === 'income' ? '+' : '-'}{centsToCurrency(transaction.amount_cents)}
                  </p>
                  <div className="mt-2 flex justify-end gap-2">
                    <button onClick={() => openEdit(transaction)} className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">Edit</button>
                    <button onClick={() => void removeTransaction(transaction.id)} className="text-xs font-medium text-red-600 hover:underline dark:text-red-400">Delete</button>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </section>
      </main>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 dark:bg-gray-800">
            <h2 className="mb-4 text-lg font-bold text-gray-900 dark:text-white">{editing ? 'Edit Transaction' : 'Add Transaction'}</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <input type="date" className={inputClass} value={form.occurred_on} onChange={e => setForm(prev => ({ ...prev, occurred_on: e.target.value }))} />
                <select className={inputClass} value={form.transaction_type} onChange={e => setForm(prev => ({ ...prev, transaction_type: e.target.value as FinanceTransactionType }))}>
                  <option value="income">Income</option>
                  <option value="expense">Expense</option>
                </select>
              </div>
              <input className={`${inputClass} w-full`} placeholder="Category" value={form.category} onChange={e => setForm(prev => ({ ...prev, category: e.target.value }))} />
              <input className={`${inputClass} w-full`} placeholder="Amount" inputMode="decimal" value={amountInput} onChange={e => setAmountInput(e.target.value)} />
              <input className={`${inputClass} w-full`} placeholder="Customer or vendor" value={form.vendor_customer ?? ''} onChange={e => setForm(prev => ({ ...prev, vendor_customer: e.target.value }))} />
              <input className={`${inputClass} w-full`} placeholder="Payment method" value={form.payment_method ?? ''} onChange={e => setForm(prev => ({ ...prev, payment_method: e.target.value }))} />
              <textarea className={`${inputClass} min-h-20 w-full`} placeholder="Notes" value={form.description ?? ''} onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))} />
              {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
              <div className="flex gap-3">
                <button
                  onClick={() => void saveTransaction()}
                  disabled={createTransaction.isPending || patchTransaction.isPending}
                  className="flex-1 rounded-xl bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
                >
                  Save
                </button>
                <button onClick={() => setShowForm(false)} className="flex-1 rounded-xl bg-gray-100 py-2 text-sm font-semibold text-gray-700 dark:bg-gray-700 dark:text-gray-200">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-xl border bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${tone}`}>{value}</p>
    </div>
  )
}
