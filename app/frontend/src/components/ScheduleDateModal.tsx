import { useEffect, useState } from 'react'
import { DurationWheelInput } from './DurationWheelInput'
import { usePatchLead } from '../hooks/useLeads'
import type { Lead } from '../types/lead'

interface Props {
  lead: Lead
  onClose: () => void
}

export function ScheduleDateModal({ lead, onClose }: Props) {
  const patch = usePatchLead()

  const [jobDate, setJobDate] = useState(lead.job_date_requested ?? '')
  const [jobDateEnd, setJobDateEnd] = useState(lead.job_date_end ?? '')
  const [timeSlot, setTimeSlot] = useState(lead.appointment_time_slot ?? '')
  const [duration, setDuration] = useState<number | null>(lead.estimated_job_duration_minutes ?? null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const handleSave = () => {
    patch.mutate(
      {
        id: lead.id,
        data: {
          job_date_requested: jobDate || null,
          job_date_end: jobDateEnd || null,
          appointment_time_slot: timeSlot || null,
          estimated_job_duration_minutes: duration,
        },
      },
      { onSuccess: onClose },
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-label="Close"
        onClick={onClose}
      />

      <div className="relative z-10 w-full max-w-sm overflow-hidden rounded-2xl border bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4 dark:border-gray-700">
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">Schedule Job</h3>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">Set the date and time for this job.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            Close
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Job Date</span>
            <input
              type="date"
              value={jobDate}
              onChange={e => setJobDate(e.target.value)}
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Time Slot</span>
            <input
              type="time"
              value={timeSlot}
              onChange={e => setTimeSlot(e.target.value)}
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            />
          </label>

          <div className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Estimated Duration</span>
            <DurationWheelInput value={duration} onChange={setDuration} allowClear />
          </div>

          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              End Date{' '}
              <span className="normal-case font-normal text-gray-400">(multi-day only)</span>
            </span>
            <input
              type="date"
              value={jobDateEnd}
              onChange={e => setJobDateEnd(e.target.value)}
              min={jobDate || undefined}
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            />
          </label>
        </div>

        {patch.isError && (
          <p className="px-5 pb-2 text-sm text-red-600 dark:text-red-400">
            {(patch.error as Error)?.message ?? 'Save failed'}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 border-t px-5 py-4 dark:border-gray-700">
          <button
            type="button"
            onClick={onClose}
            disabled={patch.isPending}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={patch.isPending}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {patch.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
