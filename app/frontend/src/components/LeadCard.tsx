import type { Lead } from '../types/lead'
import { AgeIndicator } from './AgeIndicator'
import { SourceBadge } from './SourceBadge'
import { StatusBadge } from './StatusBadge'

interface Props {
  lead: Lead
  onClick: (id: string) => void
  staleness?: 't1' | 't2' | null
}

export function LeadCard({ lead, onClick, staleness }: Props) {
  const staleLeftBorder =
    staleness === 't2' ? 'border-l-4 border-l-red-500' :
    staleness === 't1' ? 'border-l-4 border-l-amber-400' :
    lead.urgency_flag ? 'border-l-4 border-l-orange-500' : 'border-gray-200'

  return (
    <div
      onClick={() => onClick(lead.id)}
      className={[
        'bg-white rounded-lg border p-4 cursor-pointer transition-colors hover:border-blue-400',
        staleLeftBorder,
        !lead.acknowledged_at ? 'ring-1 ring-red-200' : '',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            {staleness === 't2' && (
              <span className="text-xs font-bold text-red-600 uppercase tracking-wide">Escalated</span>
            )}
            {staleness === 't1' && (
              <span className="text-xs font-bold text-amber-600 uppercase tracking-wide">⚠ Idle</span>
            )}
            {lead.urgency_flag && (
              <span className="text-xs font-bold text-orange-500 uppercase tracking-wide">Urgent</span>
            )}
            {!lead.acknowledged_at && (
              <span className="text-xs font-bold text-red-500 uppercase tracking-wide">Unacked</span>
            )}
            <StatusBadge status={lead.status} />
            <SourceBadge source={lead.source_type} />
          </div>
          {lead.customer_name
            ? <p className="font-semibold text-gray-900 truncate">{lead.customer_name}</p>
            : <p className="font-semibold text-gray-400 truncate italic">No name yet</p>
          }
          {lead.customer_phone && (
            <p className="text-sm text-gray-500">{lead.customer_phone}</p>
          )}
          {lead.job_location && (
            <p className="text-xs text-gray-400 truncate mt-0.5">{lead.job_location}</p>
          )}
        </div>
        <AgeIndicator createdAt={lead.created_at} />
      </div>
    </div>
  )
}
