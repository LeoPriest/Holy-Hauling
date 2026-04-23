import { useEffect, useMemo, useState } from 'react'
import type { Lead, Settings } from '../types/lead'

const SNOOZE_KEY = 'hh_banner_snooze_until'
const SNOOZE_MS = 10 * 60 * 1000  // 10 minutes

const ACTIVE_STATUSES = new Set([
  'new', 'in_review', 'waiting_on_customer', 'ready_for_quote', 'ready_for_booking',
])

function getSnoozed(): boolean {
  const val = localStorage.getItem(SNOOZE_KEY)
  return val ? Date.now() < Number(val) : false
}

export function useStaleLeads(leads: Lead[], settings: Settings | undefined) {
  const [now, setNow] = useState(() => Date.now())
  const [isSnoozed, setIsSnoozed] = useState(getSnoozed)

  // Refresh every 60s so stale indicators update without page reload
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now())
      setIsSnoozed(getSnoozed())
    }, 60_000)
    return () => clearInterval(id)
  }, [])

  const snooze = () => {
    const until = Date.now() + SNOOZE_MS
    localStorage.setItem(SNOOZE_KEY, String(until))
    setIsSnoozed(true)
  }

  const { t1Ids, t2Ids, idleMinuteMap } = useMemo(() => {
    if (!settings) return { t1Ids: new Set<string>(), t2Ids: new Set<string>(), idleMinuteMap: new Map<string, number>() }
    const t1Ms = settings.t1_minutes * 60_000
    const t2Ms = settings.t2_minutes * 60_000
    const t1Ids = new Set<string>()
    const t2Ids = new Set<string>()
    const idleMinuteMap = new Map<string, number>()
    for (const lead of leads) {
      if (!ACTIVE_STATUSES.has(lead.status)) continue
      const idleMs = now - new Date(lead.updated_at).getTime()
      const idleMin = Math.floor(idleMs / 60_000)
      if (idleMs >= t2Ms) {
        t2Ids.add(lead.id)
        idleMinuteMap.set(lead.id, idleMin)
      } else if (idleMs >= t1Ms) {
        t1Ids.add(lead.id)
        idleMinuteMap.set(lead.id, idleMin)
      }
    }
    return { t1Ids, t2Ids, idleMinuteMap }
  }, [leads, settings, now])

  return { t1Ids, t2Ids, idleMinuteMap, isSnoozed, snooze }
}
