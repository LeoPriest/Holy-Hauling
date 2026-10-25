import { useEffect, useState } from 'react'
import type { LeadFollowup } from '../types/lead'

interface Props {
  leadId: string
  existing: LeadFollowup | null
  onSave: (scheduledAt: string, note: string | null) => Promise<unknown>
  onCancel: () => Promise<unknown>
  onClose: () => void
  saving: boolean
}

export default function FollowUpModal({ existing, onSave, onCancel, onClose, saving }: Props) {
  const [date, setDate] = useState('')
  const [time, setTime] = useState('09:00')
  const [note, setNote] = useState('')

  useEffect(() => {
    if (existing) {
      const d = new Date(existing.scheduled_at)
      setDate(d.toISOString().slice(0, 10))
      setTime(d.toISOString().slice(11, 16))
      setNote(existing.note ?? '')
    }
  }, [existing])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleSave = async () => {
    if (!date) return
    const iso = `${date}T${time}:00`
    await onSave(iso, note.trim() || null)
    onClose()
  }

  const handleCancel = async () => {
    await onCancel()
    onClose()
  }

  const minDate = new Date().toISOString().slice(0, 10)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-800">Schedule Follow-Up</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
        </div>

        <div className="space-y-4 p-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Date</label>
            <input
              type="date"
              value={date}
              min={minDate}
              onChange={e => setDate(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Time</label>
            <input
              type="time"
              value={time}
              onChange={e => setTime(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Note (optional)</label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={3}
              placeholder="What do you want to follow up on?"
              className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
        </div>

        <div className="flex gap-2 border-t px-4 py-3">
          {existing && (
            <button
              onClick={handleCancel}
              disabled={saving}
              className="flex-1 rounded-lg border border-red-200 py-2 text-sm font-medium text-red-600 active:bg-red-50 disabled:opacity-50"
            >
              Remove
            </button>
          )}
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-600 active:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !date}
            className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white active:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : existing ? 'Update' : 'Set Reminder'}
          </button>
        </div>
      </div>
    </div>
  )
}
