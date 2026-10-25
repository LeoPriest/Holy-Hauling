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

// Workday gates: five bars on the dark header. Done = green, current = moving
// hazard stripe, still to come = faint white.
export function GateIndicator({ status }: Props) {
  const current = STATUS_TO_STEP[status] ?? -1

  if (current === -1) {
    return (
      <p className="wd-label mt-3 text-[#b9b5ac]">
        {status === 'released' ? 'Completed' : status === 'lost' ? 'Released' : 'Escalated'}
      </p>
    )
  }

  return (
    <ol className="wd-gates" aria-label="Gates">
      {STEPS.map((label, i) => {
        const done = i < current
        const cur = i === current
        return (
          <li key={label} className={`wd-gate ${done ? 'done' : cur ? 'cur' : ''}`} aria-current={cur ? 'step' : undefined}>
            <i className={cur && i < STEPS.length - 1 ? 'haz' : cur ? 'wd-gate-end' : ''} aria-hidden="true" />
            <span>{done ? '✓ ' : ''}{label}</span>
          </li>
        )
      })}
    </ol>
  )
}
