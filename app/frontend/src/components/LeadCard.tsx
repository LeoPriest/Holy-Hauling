import type { Lead } from '../types/lead'
import { parseUtc } from '../utils/time'
import { leadTitle, leadTown, shortAge, sourceShort } from '../utils/leadCard'
import { StatusBadge } from './StatusBadge'

interface Props {
  lead: Lead
  onClick: (id: string) => void
  staleness?: 'aging' | 'overdue' | null
  idleMinutes?: number
  hasTruckRental?: boolean
  isEscalated?: boolean
  /** Stagger index for the arrive animation. */
  index?: number
  /** True when this lead just landed while the queue was open. */
  dropped?: boolean
}

function fmtIdle(minutes?: number) {
  if (minutes == null) return ''
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`
  return `${Math.floor(minutes / 1440)}d`
}

export function LeadCard({ lead, onClick, staleness, idleMinutes, hasTruckRental, isEscalated, index = 0, dropped }: Props) {
  const age = shortAge(parseUtc(lead.created_at))
  const town = leadTown(lead)
  const isNew = lead.status === 'new'
  const hasFlags = staleness || isEscalated || lead.urgency_flag || lead.active_followup || hasTruckRental

  return (
    <button
      type="button"
      onClick={() => onClick(lead.id)}
      className={['wd-card', dropped ? 'wd-drop' : 'wd-rise', lead.urgency_flag ? 'wd-card-urgent' : ''].join(' ')}
      style={{ '--i': index } as React.CSSProperties}
    >
      {isNew && (
        <span className="wd-card-band haz">New lead · {age === 'just now' ? age : `${age} ago`}</span>
      )}

      <span className="flex w-full items-center justify-between gap-2">
        <span className={`min-w-0 truncate text-[13px] font-medium ${lead.customer_name ? 'text-mu' : 'italic text-mu'}`}>
          {lead.customer_name ?? 'No name yet'}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-mu">{age}</span>
      </span>

      <span className="wd-disp block text-[19px] leading-[1.15]">{leadTitle(lead)}</span>

      {hasFlags && (
        <span className="flex flex-wrap items-center gap-1.5 py-0.5">
          {staleness && (
            <span className={`wd-flag ${staleness === 'overdue' ? 'wd-flag-red' : 'wd-flag-amber'}`}>
              {staleness === 'overdue' ? 'Overdue' : 'Aging'}
              {idleMinutes != null ? ` · ${fmtIdle(idleMinutes)}` : ''}
            </span>
          )}
          {isEscalated && <span className="wd-flag wd-flag-amber">Escalated</span>}
          {lead.urgency_flag && <span className="wd-flag wd-flag-amber">Urgent</span>}
          {lead.active_followup && (
            <span className="wd-flag">
              Follow up{' '}
              {new Date(lead.active_followup.scheduled_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          )}
          {hasTruckRental && <span className="wd-flag">Truck</span>}
        </span>
      )}

      <span className="flex w-full items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[13px] text-mu">
          {town ? `${town} · ` : ''}{sourceShort(lead.source_type)}
        </span>
        <StatusBadge status={lead.status} />
      </span>
    </button>
  )
}
