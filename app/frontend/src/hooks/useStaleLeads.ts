import { useEffect, useMemo, useState } from 'react'
import type { Lead, Settings } from '../types/lead'
import { parseUtc } from '../utils/time'

const ACTIVE_STATUSES = new Set([
  'new', 'in_review', 'waiting_on_customer', 'ready_for_quote', 'ready_for_booking',
])

/**
 * Time-based lead aging. Leads idle past `t1_minutes` are "aging"; past
 * `t2_minutes` they are "overdue". Presentation is ambient (stage-header
 * badges + a quiet per-card chip) — no banner, no snooze.
 */
export function useStaleLeads(leads: Lead[], settings: Settings | undefined) {
  const [now, setNow] = useState(() => Date.now())

  // Refresh every 60s so aging indicators update without a page reload
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  return useMemo(() => {
    if (!settings) {
      return { agingIds: new Set<string>(), overdueIds: new Set<string>(), idleMinuteMap: new Map<string, number>() }
    }
    const agingMs = settings.t1_minutes * 60_000
    const overdueMs = settings.t2_minutes * 60_000
    const agingIds = new Set<string>()
    const overdueIds = new Set<string>()
    const idleMinuteMap = new Map<string, number>()
    for (const lead of leads) {
      if (!ACTIVE_STATUSES.has(lead.status)) continue
      const idleMs = now - parseUtc(lead.updated_at).getTime()
      const idleMin = Math.floor(idleMs / 60_000)
      if (idleMs >= overdueMs) {
        overdueIds.add(lead.id)
        idleMinuteMap.set(lead.id, idleMin)
      } else if (idleMs >= agingMs) {
        agingIds.add(lead.id)
        idleMinuteMap.set(lead.id, idleMin)
      }
    }
    return { agingIds, overdueIds, idleMinuteMap }
  }, [leads, settings, now])
}
