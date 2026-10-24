import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BottomNav } from '../components/BottomNav'
import { LeadCard } from '../components/LeadCard'
import { useLeads, useMarkCustomerResponded, useMarkRefunded } from '../hooks/useLeads'
import { isRefundCandidate } from '../utils/refund'
import { useSettings } from '../hooks/useSettings'
import { useStaleLeads } from '../hooks/useStaleLeads'
import { useUsers } from '../hooks/useUsers'
import { useRentals } from '../hooks/useTruckRental'
import { useOpenEscalations } from '../hooks/useEscalation'
import { LEVEL_LABELS } from '../types/escalation'
import type { LeadSourceType, LeadStatus } from '../types/lead'
import { useAuth } from '../context/AuthContext'
import { CitySwitcher } from '../components/CitySwitcher'
import { useCity } from '../context/CityContext'
import { leadTitle, leadTown, sourceShort } from '../utils/leadCard'
import { Working } from '../components/Logo'

const ACTIVE_STAGES: { status: LeadStatus; label: string }[] = [
  { status: 'new', label: 'New' },
  { status: 'in_review', label: 'In Review' },
  { status: 'replied', label: 'Replied' },
  { status: 'waiting_on_customer', label: 'Waiting' },
  { status: 'ready_for_quote', label: 'Ready to Quote' },
  { status: 'ready_for_booking', label: 'Ready to Book' },
  { status: 'booked', label: 'Booked' },
]

const CLOSED_STAGES: { status: LeadStatus; label: string }[] = [
  { status: 'released', label: 'Released' },
  { status: 'lost', label: 'Lost' },
]

const CLOSED_STATUSES = new Set<LeadStatus>(['released', 'lost'])

type Chip = 'all' | 'new' | 'review' | 'quote' | 'closed'

// Which active statuses each filter chip shows. "All" shows every active stage.
const CHIP_STATUSES: Record<Exclude<Chip, 'all' | 'closed'>, Set<LeadStatus>> = {
  new: new Set(['new']),
  review: new Set(['in_review', 'replied']),
  quote: new Set(['ready_for_quote', 'ready_for_booking']),
}

function greeting(now = new Date()) {
  const h = now.getHours()
  return h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening'
}

function waitingLine(n: number) {
  if (n === 0) return 'Nobody is waiting on us right now.'
  return `${n} ${n === 1 ? 'person is' : 'people are'} waiting on us.`
}

function fmtMoney(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount)
}

/** A lead that just landed opens its row from nothing, pushing the rest down. */
function DropSlot({ entering, children }: { entering: boolean; children: React.ReactNode }) {
  const [closed, setClosed] = useState(entering)
  useEffect(() => {
    if (!closed) return
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setClosed(false)))
    return () => cancelAnimationFrame(frame)
  }, [closed])
  return (
    <div className={`wd-slot ${closed ? 'enter' : ''}`}>
      <div>{children}</div>
    </div>
  )
}

export function LeadQueue() {
  const navigate = useNavigate()
  const [chip, setChip] = useState<Chip>('all')
  const view: 'active' | 'released' = chip === 'closed' ? 'released' : 'active'
  const [sourceFilter, setSourceFilter] = useState<LeadSourceType | ''>('')
  const [assignedFilter, setAssignedFilter] = useState('')
  const [collapsed, setCollapsed] = useState<Set<LeadStatus>>(new Set())

  const { data: leads = [], isLoading, error } = useLeads({
    source_type: sourceFilter || undefined,
    assigned_to: assignedFilter.trim() || undefined,
  })

  const { data: settings } = useSettings()
  const { agingIds, overdueIds, idleMinuteMap } = useStaleLeads(leads, settings)
  const { data: teamMembers = [] } = useUsers()
  const { user } = useAuth()
  const { isAllCities, selectedCity } = useCity()
  const { data: rentals = [] } = useRentals()
  const rentalLeadIds = useMemo(() => new Set(rentals.map(r => r.lead_id)), [rentals])

  const { data: openEscalations = [] } = useOpenEscalations()
  const escalatedLeadIds = useMemo(() => new Set(openEscalations.map(e => e.lead_id)), [openEscalations])
  const [escBandOpen, setEscBandOpen] = useState(true)

  const respondMut = useMarkCustomerResponded()
  const refundMut = useMarkRefunded()
  const [refundBandOpen, setRefundBandOpen] = useState(true)

  const showQuote = user?.role === 'admin' || user?.role === 'facilitator'

  const activeLeads = leads.filter(l => !CLOSED_STATUSES.has(l.status))
  const displayLeads = chip === 'closed'
    ? leads.filter(l => CLOSED_STATUSES.has(l.status))
    : chip === 'all'
      ? activeLeads
      : activeLeads.filter(l => CHIP_STATUSES[chip].has(l.status))
  const newCount = activeLeads.filter(l => l.status === 'new').length

  // New leads that land while the queue is open drop in at the top with an
  // amber toast. The first load only records what is already there.
  const seenIds = useRef<Set<string> | null>(null)
  const [droppedIds, setDroppedIds] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<string | null>(null)
  const [bumpKey, setBumpKey] = useState(0)
  useEffect(() => {
    if (isLoading || error) return
    const ids = new Set(leads.map(l => l.id))
    if (seenIds.current) {
      const arrived = leads.filter(l => !seenIds.current!.has(l.id) && l.status === 'new')
      if (arrived.length > 0) {
        const l = arrived[0]
        const town = leadTown(l)
        setToast([leadTitle(l), town, sourceShort(l.source_type)].filter(Boolean).join(' · '))
        setDroppedIds(new Set(arrived.map(a => a.id)))
        setBumpKey(k => k + 1)
      }
    }
    seenIds.current = ids
  }, [leads, isLoading, error])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2200)
    return () => clearTimeout(t)
  }, [toast])

  const refundCandidates = useMemo(() => displayLeads.filter(l => isRefundCandidate(l)), [displayLeads])

  // Green pill slides under the selected chip.
  const chipsRef = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null)
  useLayoutEffect(() => {
    let live = true
    const place = () => {
      const on = chipsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')
      if (live && on) setPill({ left: on.offsetLeft, width: on.offsetWidth })
    }
    place()
    // Chip widths change once the condensed display font arrives.
    document.fonts?.ready.then(place)
    return () => { live = false }
  }, [chip, newCount])

  const groups = useMemo(() => {
    const stages = view === 'active' ? ACTIVE_STAGES : CLOSED_STAGES
    const rank = (id: string) => (overdueIds.has(id) ? 0 : agingIds.has(id) ? 1 : 2)
    return stages
      .map(stage => {
        const groupLeads = displayLeads
          .filter(l => l.status === stage.status)
          .sort((a, b) => {
            const r = rank(a.id) - rank(b.id)
            if (r !== 0) return r
            return b.created_at.localeCompare(a.created_at)
          })
        return {
          ...stage,
          leads: groupLeads,
          aging: groupLeads.filter(l => agingIds.has(l.id)).length,
          overdue: groupLeads.filter(l => overdueIds.has(l.id)).length,
          value: groupLeads.reduce((sum, l) => sum + (l.quoted_price_total ?? 0), 0),
        }
      })
      .filter(g => g.leads.length > 0)
  }, [view, displayLeads, agingIds, overdueIds])

  function toggle(status: LeadStatus) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return next
    })
  }

  const cityName = selectedCity?.name ?? user?.city_name ?? null
  const chips: { key: Chip; label: string; count?: number }[] = [
    { key: 'all', label: 'All' },
    { key: 'new', label: 'New', count: newCount },
    { key: 'review', label: 'Review' },
    { key: 'quote', label: 'Quote' },
    { key: 'closed', label: 'Closed' },
  ]
  let cardIndex = 0

  return (
    <div className="min-h-screen bg-bg text-ink">
      <div className={`wd-toast ${toast ? 'show' : ''}`} role="status" aria-live="polite">
        {toast && <>New lead<br /><span className="text-[13px] font-semibold normal-case tracking-normal">{toast}</span></>}
      </div>

      <header className="wd-hdr flex items-center justify-between gap-3">
        <img src="/brand/logo-mark-white.png" alt="Holy Hauling" className="h-auto w-11" />
        {user?.role === 'admin'
          ? <CitySwitcher variant="pill" />
          : cityName && <span className="wd-city">{cityName}</span>}
      </header>

      <div className="mx-auto max-w-3xl">
        <div className="flex items-baseline justify-between gap-3 px-5 pt-4">
          <h1 className="wd-disp text-[30px] leading-none">Lead queue</h1>
          <span key={bumpKey} className={`inline-block text-[13px] text-mu ${bumpKey ? 'wd-bump' : ''}`}>
            {activeLeads.length} open
          </span>
        </div>
        <p className="px-5 pb-3 pt-1.5 text-[13px] text-mu">
          {greeting()}{user?.username ? `, ${user.username}` : ''}. {waitingLine(activeLeads.length)}
        </p>

        <div ref={chipsRef} role="tablist" aria-label="Filter leads" className="wd-chips mx-3.5 px-1.5 pb-3">
          {pill && <div className="wd-chip-pill" style={{ left: pill.left, width: pill.width }} aria-hidden="true" />}
          {chips.map(c => (
            <button
              key={c.key}
              type="button"
              role="tab"
              aria-selected={chip === c.key}
              onClick={() => setChip(c.key)}
              className="wd-chip"
            >
              {c.label}
              {c.count != null && c.count > 0 && <span>{c.count}</span>}
            </button>
          ))}
        </div>

        <div className="flex gap-2 px-3.5 pb-3">
          <select
            aria-label="Source"
            className="wd-ghost min-w-0 flex-1"
            value={sourceFilter}
            onChange={e => setSourceFilter(e.target.value as LeadSourceType | '')}
          >
            <option value="">All Sources</option>
            <option value="thumbtack_api">Thumbtack API</option>
            <option value="thumbtack_screenshot">Thumbtack OCR</option>
            <option value="yelp_screenshot">Yelp OCR</option>
            <option value="google_screenshot">Google OCR</option>
            <option value="website_form">Website</option>
            <option value="manual">Manual</option>
          </select>

          <select
            aria-label="Handler"
            className="wd-ghost min-w-0 flex-1"
            value={assignedFilter}
            onChange={e => setAssignedFilter(e.target.value)}
          >
            <option value="">All handlers</option>
            {(['admin', 'facilitator', 'supervisor', 'crew'] as const).map(role => {
              const members = teamMembers.filter(m => m.role === role)
              if (members.length === 0) return null
              return (
                <optgroup key={role} label={role.charAt(0).toUpperCase() + role.slice(1)}>
                  {members.map(m => (
                    <option key={m.id} value={m.username}>{m.username}</option>
                  ))}
                </optgroup>
              )
            })}
          </select>
        </div>

        <main className="space-y-3 px-3.5 pb-6">
          {view === 'active' && openEscalations.length > 0 && (
            <section className="wd-panel">
              <div className="haz h-1.5" aria-hidden="true" />
              <button
                onClick={() => setEscBandOpen(o => !o)}
                className="flex w-full min-h-12 items-center justify-between px-3.5 py-2 text-left"
                aria-expanded={escBandOpen}
              >
                <span className="wd-disp text-[17px]">
                  Escalations <span className="text-mu">{openEscalations.length}</span>
                </span>
                <span className={`text-mu transition-transform ${escBandOpen ? 'rotate-90' : ''}`} aria-hidden="true">›</span>
              </button>
              {escBandOpen && (
                <div className="space-y-1 px-2 pb-2">
                  {openEscalations.map(e => (
                    <button
                      key={e.id}
                      onClick={() => navigate(`/leads/${e.lead_id}`)}
                      className="flex w-full min-h-11 items-center justify-between gap-2 rounded-chip bg-bg px-3 py-2 text-left active:bg-tint"
                    >
                      <span className="min-w-0 truncate text-sm font-medium">
                        {e.lead_customer_name ?? 'Unknown'}
                      </span>
                      <span className="shrink-0 text-xs text-mu">
                        {LEVEL_LABELS[e.level]} · {e.decision_needed}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
          {view === 'active' && refundCandidates.length > 0 && (
            <section className="wd-panel">
              <div className="haz h-1.5" aria-hidden="true" />
              <button
                type="button"
                onClick={() => setRefundBandOpen(o => !o)}
                className="flex w-full min-h-12 items-center justify-between px-3.5 py-2 text-left"
                aria-expanded={refundBandOpen}
              >
                <span className="wd-disp text-[17px]">
                  Refund-eligible <span className="text-mu">{refundCandidates.length}</span>
                </span>
                <span className={`text-mu transition-transform ${refundBandOpen ? 'rotate-90' : ''}`} aria-hidden="true">›</span>
              </button>
              {refundBandOpen && (
                <div className="space-y-1 px-2 pb-2">
                  {refundCandidates.map(l => (
                    <div
                      key={l.id}
                      className="flex items-center gap-2 rounded-chip bg-bg px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{l.customer_name ?? 'Unknown'}</div>
                        <div className="text-xs text-mu">Thumbtack · no response 72h+</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => respondMut.mutate({ leadId: l.id, on: true })}
                        className="wd-btn-sm wd-btn-ghost"
                      >
                        Responded
                      </button>
                      <button
                        type="button"
                        onClick={() => refundMut.mutate({ leadId: l.id, on: true })}
                        className="wd-btn-sm"
                      >
                        Refunded
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
          {isLoading && (
            <Working label="Loading leads…" />
          )}
          {!isLoading && error && (
            <p className="py-10 text-center text-sm text-danger">Could not load leads. Is the backend running?</p>
          )}
          {!isLoading && !error && displayLeads.length === 0 && (
            <p className="py-10 text-center text-sm text-mu">
              {chip === 'closed'
                ? 'No closed leads yet.'
                : chip === 'all'
                  ? 'No active leads. Tap + to add one.'
                  : 'No leads here right now.'}
            </p>
          )}

          {groups.map(group => {
            const isCollapsed = collapsed.has(group.status)
            return (
              <section key={group.status}>
                <button
                  onClick={() => toggle(group.status)}
                  className="flex w-full min-h-11 items-center justify-between gap-3 px-0.5 py-1 text-left"
                  aria-expanded={!isCollapsed}
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="wd-label">{group.label}</span>
                    <span className="text-xs text-mu">{group.leads.length}</span>
                    {group.overdue > 0 && (
                      <span className="wd-flag wd-flag-red">{group.overdue} overdue</span>
                    )}
                    {group.aging > 0 && (
                      <span className="wd-flag wd-flag-amber">{group.aging} aging</span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {showQuote && group.value > 0 && (
                      <span className="text-sm tabular-nums text-mu">{fmtMoney(group.value)}</span>
                    )}
                    <span className={`text-mu transition-transform ${isCollapsed ? '' : 'rotate-90'}`} aria-hidden="true">›</span>
                  </div>
                </button>

                {!isCollapsed && (
                  <div className="mt-1 space-y-3">
                    {group.leads.map(lead => (
                      <DropSlot key={lead.id} entering={droppedIds.has(lead.id)}>
                        {isAllCities && lead.city_name && (
                          <p className="wd-label px-1 pb-1 text-ok">{lead.city_name}</p>
                        )}
                        <LeadCard
                          lead={lead}
                          index={cardIndex++}
                          dropped={droppedIds.has(lead.id)}
                          onClick={id => navigate(`/leads/${id}`)}
                          staleness={overdueIds.has(lead.id) ? 'overdue' : agingIds.has(lead.id) ? 'aging' : null}
                          idleMinutes={idleMinuteMap.get(lead.id)}
                          hasTruckRental={rentalLeadIds.has(lead.id)}
                          isEscalated={escalatedLeadIds.has(lead.id)}
                        />
                      </DropSlot>
                    ))}
                  </div>
                )}
              </section>
            )
          })}
        </main>
      </div>

      <BottomNav />
    </div>
  )
}
