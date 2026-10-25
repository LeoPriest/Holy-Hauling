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
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-[rgba(10,12,11,.45)]" aria-hidden="true" onClick={onClose} />

      <div role="dialog" aria-label="Schedule job" className="relative z-10 max-h-[92dvh] overflow-y-auto w-full max-w-lg rounded-t-sheet bg-bg px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-2.5 text-ink">
        <div className="wd-grab" aria-hidden="true" />
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="wd-disp text-[22px] leading-none">Schedule job</h3>
            <p className="mt-1 text-sm text-mu">Set the date and time for this job.</p>
          </div>
          <button type="button" onClick={onClose} className="wd-btn-sm wd-btn-ghost !shadow-none">
            Close
          </button>
        </div>

        <div className="space-y-4 py-3">
          <label className="block space-y-1">
            <span className="wd-label">Job date</span>
            <input
              type="date"
              value={jobDate}
              onChange={e => setJobDate(e.target.value)}
              className="wd-input"
            />
          </label>

          <label className="block space-y-1">
            <span className="wd-label">Time slot</span>
            <input
              type="time"
              value={timeSlot}
              onChange={e => setTimeSlot(e.target.value)}
              className="wd-input"
            />
          </label>

          <div className="space-y-1">
            <span className="wd-label">Estimated duration</span>
            <DurationWheelInput value={duration} onChange={setDuration} allowClear />
          </div>

          <label className="block space-y-1">
            <span className="wd-label">
              End date{' '}
              <span className="normal-case font-normal text-mu">(multi-day only)</span>
            </span>
            <input
              type="date"
              value={jobDateEnd}
              onChange={e => setJobDateEnd(e.target.value)}
              min={jobDate || undefined}
              className="wd-input"
            />
          </label>
        </div>

        {patch.isError && (
          <p className="wd-err pb-2">
            {(patch.error as Error)?.message ?? 'Save failed'}
          </p>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={patch.isPending}
            className="wd-btn wd-btn-ghost flex-1"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={patch.isPending}
            className="wd-btn flex-1"
          >
            {patch.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
