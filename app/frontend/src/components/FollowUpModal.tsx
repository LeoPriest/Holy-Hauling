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
  const [error, setError] = useState('')

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
    setError('')
    const iso = `${date}T${time}:00`
    try {
      await onSave(iso, note.trim() || null)
      onClose()
    } catch {
      setError("Couldn't save the follow-up. Try again.")
    }
  }

  const handleCancel = async () => {
    setError('')
    try {
      await onCancel()
      onClose()
    } catch {
      setError("Couldn't remove the follow-up. Try again.")
    }
  }

  const minDate = new Date().toISOString().slice(0, 10)

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(10,12,11,.45)]"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div role="dialog" aria-label="Follow-up" className="w-full max-w-lg rounded-t-sheet bg-bg px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-2.5 text-ink">
        <div className="wd-grab" aria-hidden="true" />
        <div className="flex items-center justify-between">
          <h2 className="wd-disp text-[22px] leading-none">Follow up</h2>
          <button onClick={onClose} className="wd-btn-sm wd-btn-ghost min-w-11 !shadow-none text-xl" aria-label="Close">&times;</button>
        </div>

        <div className="space-y-4 py-3">
          <div>
            <label className="wd-fl !mb-1">Date</label>
            <input
              type="date"
              value={date}
              min={minDate}
              onChange={e => setDate(e.target.value)}
              className="wd-input"
            />
          </div>

          <div>
            <label className="wd-fl !mb-1">Time</label>
            <input
              type="time"
              value={time}
              onChange={e => setTime(e.target.value)}
              className="wd-input"
            />
          </div>

          <div>
            <label className="wd-fl !mb-1">Note (optional)</label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={3}
              placeholder="What do you want to follow up on?"
              className="wd-input"
            />
          </div>
        </div>

        {error && <p className="wd-err pb-2">{error}</p>}
        <div className="flex gap-2">
          {existing && (
            <button
              onClick={handleCancel}
              disabled={saving}
              className="wd-btn wd-btn-ghost flex-1 !text-danger !shadow-[inset_0_0_0_1.5px_var(--red)]"
            >
              Remove
            </button>
          )}
          <button
            onClick={onClose}
            disabled={saving}
            className="wd-btn wd-btn-ghost flex-1"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !date}
            className="wd-btn flex-1"
          >
            {saving ? 'Saving…' : existing ? 'Update' : 'Set reminder'}
          </button>
        </div>
      </div>
    </div>
  )
}
