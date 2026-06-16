import type { Lead } from '../types/lead'
import { fmtLocalDateTime } from '../utils/time'
import { AgeIndicator } from './AgeIndicator'
import { SourceBadge } from './SourceBadge'
import { StatusBadge } from './StatusBadge'

interface Props {
  lead: Lead
  onClick: (id: string) => void
  staleness?: 'aging' | 'overdue' | null
  idleMinutes?: number
  hasTruckRental?: boolean
}

function fmtIdle(minutes?: number) {
  if (minutes == null) return ''
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`
  return `${Math.floor(minutes / 1440)}d`
}

export function LeadCard({ lead, onClick, staleness, idleMinutes, hasTruckRental }: Props) {
  const leftBorder = lead.urgency_flag ? 'border-l-4 border-l-orange-500' : 'border-gray-200'

  return (
    <div
      onClick={() => onClick(lead.id)}
      className={[
        'bg-white rounded-xl border p-4 cursor-pointer transition-colors active:bg-gray-50',
        leftBorder,
        !lead.acknowledged_at ? 'ring-1 ring-red-200' : '',
      ].join(' ')}
    >
      {/* Top row: badges + age + followup chip */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          {staleness && (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold border ${
                staleness === 'overdue'
                  ? 'bg-red-100 text-red-700 border-red-200'
                  : 'bg-amber-100 text-amber-700 border-amber-200'
              }`}
            >
              {staleness === 'overdue' ? 'Overdue' : 'Aging'}
              {idleMinutes != null ? ` · ${fmtIdle(idleMinutes)}` : ''}
            </span>
          )}
          {lead.urgency_flag && (
            <span className="text-[10px] font-bold text-orange-500 uppercase tracking-wide">Urgent</span>
          )}
          {!lead.acknowledged_at && (
            <span className="text-[10px] font-bold text-red-500 uppercase tracking-wide">New</span>
          )}
          <StatusBadge status={lead.status} />
          <SourceBadge source={lead.source_type} />
          {hasTruckRental && (
            <span
              title="Truck rental booked"
              aria-label="Truck rental booked"
              className="inline-flex items-center"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="w-3.5 h-3.5 text-orange-500"
              >
                <path d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 0 0-3.213-9.193 2.056 2.056 0 0 0-1.58-.86H14.25M8.25 18.75H16.5M3.375 18.75H2.25m2.625-9.75H14.25" />
              </svg>
            </span>
          )}
        </div>

        {/* Right column: age + followup chip */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          <AgeIndicator createdAt={lead.created_at} />
          {lead.active_followup && (
            <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 border border-amber-200">
              <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              {new Date(lead.active_followup.scheduled_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>
      </div>

      {/* Name */}
      {lead.customer_name
        ? <p className="font-semibold text-gray-900 truncate">{lead.customer_name}</p>
        : <p className="font-semibold text-gray-400 truncate italic">No name yet</p>
      }

      {/* Contact + location */}
      {lead.customer_phone && (
        <p className="text-sm text-gray-500 mt-0.5">{lead.customer_phone}</p>
      )}
      {lead.job_location && (
        <p className="text-xs text-gray-400 truncate mt-0.5">{lead.job_location}</p>
      )}

      {/* Footer: timestamp + ingested by */}
      <div className="flex items-center justify-between mt-2 gap-2">
        <span className="text-xs text-gray-400">{fmtLocalDateTime(lead.created_at)}</span>
        {lead.ingested_by && (
          <span className="text-xs text-gray-400 truncate">via {lead.ingested_by}</span>
        )}
      </div>
    </div>
  )
}
