import type { LeadStatus } from '../types/lead'

const STEPS = ['Gate 0', 'Gate 1', 'Gate 2A', 'Gate 2B', 'Booked']

const STATUS_TO_STEP: Partial<Record<LeadStatus, number>> = {
  new: 0,
  in_review: 1,
  replied: 1,
  waiting_on_customer: 1,
  ready_for_quote: 2,
  ready_for_booking: 3,
  booked: 4,
}

interface Props {
  status: LeadStatus
}

export function GateIndicator({ status }: Props) {
  const current = STATUS_TO_STEP[status] ?? -1

  if (current === -1) {
    return (
      <span className="text-xs text-gray-400 italic">
        {status === 'released' ? 'Released' : 'Escalated'}
      </span>
    )
  }

  return (
    <div className="flex items-center gap-1">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center gap-1">
          <div
            className={`flex items-center justify-center rounded-full text-[9px] font-bold w-5 h-5 shrink-0 ${
              i < current
                ? 'bg-green-500 text-white'
                : i === current
                ? 'bg-indigo-600 text-white ring-2 ring-indigo-200'
                : 'bg-gray-200 text-gray-400'
            }`}
          >
            {i < current ? '✓' : i + 1}
          </div>
          {i < STEPS.length - 1 && (
            <div className={`w-3 h-px shrink-0 ${i < current ? 'bg-green-400' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
    </div>
  )
}
