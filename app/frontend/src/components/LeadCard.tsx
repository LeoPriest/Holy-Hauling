import type { Lead } from '../types/lead'
import { fmtLocalDateTime } from '../utils/time'
import { AgeIndicator } from './AgeIndicator'
import { SourceBadge } from './SourceBadge'
import { StatusBadge } from './StatusBadge'

interface Props {
  lead: Lead
  onClick: (id: string) => void
  staleness?: 't1' | 't2' | null
  idleMinutes?: number
}

export function LeadCard({ lead, onClick, staleness, idleMinutes }: Props) {
  const staleLeftBorder =
    staleness === 't2' ? 'border-l-4 border-l-red-500' :
      staleness === 't1' ? 'border-l-4 border-l-amber-400' :
        lead.urgency_flag ? 'border-l-4 border-l-orange-500' : 'border-gray-200'

  return (
    <div
      onClick={() => onClick(lead.id)}
      className={[
        'bg-white rounded-xl border p-4 cursor-pointer transition-colors active:bg-gray-50',
        staleLeftBorder,
        !lead.acknowledged_at ? 'ring-1 ring-red-200' : '',
      ].join(' ')}
    >
      {/* Top row: badges + age + followup chip */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          {staleness === 't2' && (
            <span className="text-[10px] font-bold text-red-600 uppercase tracking-wide">Escalated</span>
          )}
          {staleness === 't1' && (
            <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wide">
              {idleMinutes != null ? `${idleMinutes}m idle` : 'No activity'}
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
