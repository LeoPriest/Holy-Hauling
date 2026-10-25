import { useEffect, useState } from 'react'
import { usePayRecords, useUpsertPayRecord, useDeletePayRecord } from '../hooks/usePayroll'
import { useUsers } from '../hooks/useUsers'
import type { TeamMember } from '../hooks/useUsers'
import type { Lead } from '../types/lead'
import type { PayRecord, PayType } from '../types/payroll'

interface Props {
  lead: Lead
}

function centsToDisplay(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

function payTypeLabel(payType: string): string {
  return (
    { facilitator_pct: '10% Facilitator', hourly: 'Hourly', flat: 'Flat' }[payType] ?? payType
  )
}

function defaultPayType(user: TeamMember): PayType {
  if (user.role === 'facilitator') return 'facilitator_pct'
  if (user.hourly_rate_cents !== null) return 'hourly'
  return 'flat'
}

function PayTypebadge({ payType }: { payType: PayType }) {
  const colorMap: Record<PayType, string> = {
    facilitator_pct: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
    hourly: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
    flat: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  }
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${colorMap[payType]}`}>
      {payTypeLabel(payType)}
    </span>
  )
}

export function PayrollSection({ lead }: Props) {
  const { data: records = [], isLoading: recordsLoading } = usePayRecords(lead.id)
  const { data: allUsers = [], isLoading: usersLoading } = useUsers()
  const upsert = useUpsertPayRecord(lead.id)
  const deleteMutation = useDeletePayRecord(lead.id)

  const [expanded, setExpanded] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  // When editingRecord is set, we're editing; null means adding
  const [editingRecord, setEditingRecord] = useState<PayRecord | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Form fields
  const [selectedUserId, setSelectedUserId] = useState('')
  const [payType, setPayType] = useState<PayType>('flat')
  const [hoursWorked, setHoursWorked] = useState('')
  const [overrideAmountCents, setOverrideAmountCents] = useState('')
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState('')
  const [deleteError, setDeleteError] = useState('')

  useEffect(() => {
    setFormOpen(false)
    setEditingRecord(null)
    setConfirmDelete(false)
    setSelectedUserId('')
    setPayType('flat')
    setHoursWorked('')
    setOverrideAmountCents('')
    setNote('')
    setFormError('')
    setDeleteError('')
  }, [lead.id])

  const activeUsers = allUsers.filter(u => u.is_active)

  const selectedUser = activeUsers.find(u => u.id === selectedUserId) ?? null

  const hourlyRateError =
    selectedUser !== null && payType === 'hourly' && selectedUser.hourly_rate_cents === null
      ? 'Set an hourly rate for this user in Admin → Users'
      : ''

  const isEditing = formOpen && editingRecord !== null

  function openAddForm() {
    setEditingRecord(null)
    setSelectedUserId('')
    setPayType('flat')
    setHoursWorked('')
    setOverrideAmountCents('')
    setNote('')
    setFormError('')
    setDeleteError('')
    setConfirmDelete(false)
    setFormOpen(true)
    setExpanded(true)
  }

  function openEditForm(record: PayRecord) {
    setEditingRecord(record)
    setSelectedUserId(record.user_id)
    setPayType(record.pay_type)
    setHoursWorked(record.hours_worked !== null ? String(record.hours_worked) : '')
    setOverrideAmountCents(
      record.override_amount_cents !== null
        ? String(record.override_amount_cents / 100)
        : '',
    )
    setNote(record.note ?? '')
    setFormError('')
    setDeleteError('')
    setConfirmDelete(false)
    setFormOpen(true)
    setExpanded(true)
  }

  function closeForm() {
    setFormOpen(false)
    setEditingRecord(null)
    setConfirmDelete(false)
    setFormError('')
    setDeleteError('')
  }

  function handleUserChange(userId: string) {
    setSelectedUserId(userId)
    const user = activeUsers.find(u => u.id === userId)
    if (user) {
      setPayType(defaultPayType(user))
      setHoursWorked('')
      setOverrideAmountCents('')
    }
  }

  function handlePayTypeChange(pt: PayType) {
    setPayType(pt)
    if (pt === 'flat') {
      setHoursWorked('')
    } else if (pt === 'hourly') {
      setOverrideAmountCents('')
    }
  }

  async function handleSave() {
    if (!selectedUserId) {
      setFormError('Please select a crew member.')
      return
    }
    if (hourlyRateError) {
      setFormError(hourlyRateError)
      return
    }
    setFormError('')

    const hoursNum = hoursWorked !== '' ? parseFloat(hoursWorked) : null
    const overrideCents =
      overrideAmountCents !== ''
        ? Math.round(parseFloat(overrideAmountCents.replace(/[^0-9.]/g, '')) * 100)
        : null

    try {
      await upsert.mutateAsync({
        user_id: selectedUserId,
        pay_type: payType,
        hours_worked: payType === 'hourly' ? hoursNum : null,
        override_amount_cents: payType === 'flat' ? overrideCents : null,
        note: note || null,
      })
      closeForm()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Save failed')
    }
  }

  async function handleDelete() {
    if (!editingRecord) return
    setDeleteError('')
    try {
      await deleteMutation.mutateAsync(editingRecord.id)
      closeForm()
    } catch {
      setDeleteError('Delete failed. Please try again.')
    }
  }

  const recordCount = records.length
  const countBadge =
    recordCount > 0 ? (
      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
        {recordCount} {recordCount === 1 ? 'record' : 'records'}
      </span>
    ) : (
      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400">
        No records
      </span>
    )

  const existingRecordForUser = records.find(r => r.user_id === selectedUserId) ?? null
  const formTitle = isEditing ? 'Edit Pay Record' : 'Add Pay Record'
  const saveLabel = isEditing ? 'Save Changes' : 'Add'

  return (
    <div className="border rounded-xl bg-white dark:bg-gray-800 dark:border-gray-700">
      {/* Header */}
      <button
        aria-expanded={expanded}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-2">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-5 h-5 text-gray-500 dark:text-gray-400"
          >
            <path d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" />
          </svg>
          <span className="font-semibold text-sm text-gray-900 dark:text-white">Payroll</span>
          {countBadge}
        </div>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t dark:border-gray-700 pt-3">
          {/* Loading state */}
          {(recordsLoading || usersLoading) && (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v8H4z" />
              </svg>
              Loading payroll...
            </div>
          )}

          {/* Records list */}
          {!recordsLoading && !formOpen && records.length > 0 && (
            <div className="space-y-2">
              {records.map(record => (
                <button
                  key={record.id}
                  onClick={() => openEditForm(record)}
                  className="w-full flex items-center justify-between rounded-lg border px-3 py-2.5 text-left hover:bg-gray-50 active:scale-[0.99] dark:border-gray-700 dark:hover:bg-gray-700"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-semibold text-sm text-gray-900 dark:text-white truncate">
                      {record.user_username}
                    </span>
                    <PayTypebadge payType={record.pay_type} />
                    {record.pay_type === 'hourly' && record.hours_worked !== null && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {record.hours_worked}h
                      </span>
                    )}
                  </div>
                  <span className="text-sm font-semibold text-green-600 dark:text-green-400 ml-2 shrink-0">
                    {centsToDisplay(record.amount_cents)}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!recordsLoading && !formOpen && records.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400">No pay records yet.</p>
          )}

          {/* Add button (shown when list exists or empty, not when form is open) */}
          {!recordsLoading && !formOpen && (
            <button
              onClick={openAddForm}
              className="w-full rounded-lg border border-dashed px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 active:scale-[0.98] dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              + Add Pay Record
            </button>
          )}

          {/* Form */}
          {formOpen && (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">{formTitle}</p>

              {/* User dropdown */}
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">
                  Crew member
                </label>
                {activeUsers.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    No crew found. Add users in admin first.
                  </p>
                ) : (
                  <select
                    value={selectedUserId}
                    onChange={e => handleUserChange(e.target.value)}
                    disabled={isEditing}
                    className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <option value="">Select crew member...</option>
                    {activeUsers.map(u => (
                      <option key={u.id} value={u.id}>
                        {u.username}
                        {u.role === 'facilitator' ? ' (facilitator)' : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Pay type select */}
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">
                  Pay type
                </label>
                <select
                  value={payType}
                  onChange={e => handlePayTypeChange(e.target.value as PayType)}
                  className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                >
                  <option
                    value="facilitator_pct"
                    disabled={lead.quote_cents === null}
                    title={lead.quote_cents === null ? 'Set a job quote first' : undefined}
                  >
                    10% Facilitator
                    {lead.quote_cents === null ? ' (requires quote)' : ''}
                  </option>
                  <option value="hourly">Hourly</option>
                  <option value="flat">Flat</option>
                </select>
                {payType === 'facilitator_pct' && lead.quote_cents === null && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                    Set a job quote first to use the facilitator pay type.
                  </p>
                )}
              </div>

              {/* Hours worked — only for hourly */}
              {payType === 'hourly' && (
                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">
                    Hours worked
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.25"
                    value={hoursWorked}
                    onChange={e => setHoursWorked(e.target.value)}
                    placeholder="0.0"
                    className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  />
                  {hourlyRateError && (
                    <p className="text-sm text-red-500 mt-1">{hourlyRateError}</p>
                  )}
                </div>
              )}

              {/* Override amount — only for flat */}
              {payType === 'flat' && (
                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">
                    Amount ($)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={overrideAmountCents}
                    onChange={e => setOverrideAmountCents(e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  />
                </div>
              )}

              {/* Note */}
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">
                  Note (optional)
                </label>
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  rows={2}
                  placeholder="Any additional details..."
                  className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
              </div>

              {/* Form error */}
              {formError && <p className="text-sm text-red-500">{formError}</p>}

              {/* Save / Cancel */}
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={upsert.isPending || !!hourlyRateError}
                  className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {upsert.isPending ? 'Saving...' : saveLabel}
                </button>
                <button
                  onClick={closeForm}
                  className="rounded-lg border px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
              </div>

              {/* Delete section — only when editing an existing record */}
              {isEditing && (
                <div className="border-t pt-3 dark:border-gray-700">
                  {!confirmDelete ? (
                    <button
                      onClick={() => setConfirmDelete(true)}
                      className="text-sm text-red-500 hover:underline"
                    >
                      Delete
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-sm text-gray-700 dark:text-gray-300">Are you sure?</span>
                        <button
                          onClick={handleDelete}
                          disabled={deleteMutation.isPending}
                          className="text-sm font-semibold text-red-600 hover:underline disabled:opacity-50"
                        >
                          {deleteMutation.isPending ? 'Deleting...' : 'Yes, delete'}
                        </button>
                        <button
                          onClick={() => setConfirmDelete(false)}
                          className="text-sm text-gray-500 hover:underline"
                        >
                          Cancel
                        </button>
                      </div>
                      {deleteError && (
                        <p className="text-sm text-red-500">{deleteError}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
