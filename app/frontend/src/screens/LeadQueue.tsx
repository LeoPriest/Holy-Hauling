import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BottomNav } from '../components/BottomNav'
import { LeadCard } from '../components/LeadCard'
import { IngestProgressFlow } from '../components/IngestProgressFlow'
import { useLeads } from '../hooks/useLeads'
import { useSettings } from '../hooks/useSettings'
import { useStaleLeads } from '../hooks/useStaleLeads'
import { useUsers } from '../hooks/useUsers'
import { useRentals } from '../hooks/useTruckRental'
import { useOpenEscalations } from '../hooks/useEscalation'
import { LEVEL_LABELS } from '../types/escalation'
import { LeadCreate } from './LeadCreate'
import type { LeadSourceType, LeadStatus } from '../types/lead'
import { useAuth } from '../context/AuthContext'
import { CitySwitcher } from '../components/CitySwitcher'
import { useCity } from '../context/CityContext'

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

function fmtMoney(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount)
}

export function LeadQueue() {
  const navigate = useNavigate()
  const [view, setView] = useState<'active' | 'released'>('active')
  const [sourceFilter, setSourceFilter] = useState<LeadSourceType | ''>('')
  const [assignedFilter, setAssignedFilter] = useState('')
  const [showIngest, setShowIngest] = useState(false)
  const [showManual, setShowManual] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<LeadStatus>>(new Set())

  const { data: leads = [], isLoading, error } = useLeads({
    source_type: sourceFilter || undefined,
    assigned_to: assignedFilter.trim() || undefined,
  })

  const { data: settings } = useSettings()
  const { agingIds, overdueIds, idleMinuteMap } = useStaleLeads(leads, settings)
  const { data: teamMembers = [] } = useUsers()
  const { user } = useAuth()
  const { isAllCities } = useCity()
  const { data: rentals = [] } = useRentals()
  const rentalLeadIds = useMemo(() => new Set(rentals.map(r => r.lead_id)), [rentals])

  const { data: openEscalations = [] } = useOpenEscalations()
  const escalatedLeadIds = useMemo(() => new Set(openEscalations.map(e => e.lead_id)), [openEscalations])
  const [escBandOpen, setEscBandOpen] = useState(true)

  const showQuote = user?.role === 'admin' || user?.role === 'facilitator'

  const displayLeads = view === 'active'
    ? leads.filter(l => !CLOSED_STATUSES.has(l.status))
    : leads.filter(l => CLOSED_STATUSES.has(l.status))

  const unackedCount = leads.filter(l => !l.acknowledged_at && !CLOSED_STATUSES.has(l.status)).length

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

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-16">
      <header className="bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div>
          <h1 className="font-bold text-gray-900 dark:text-white text-lg leading-tight">Lead Queue</h1>
          {unackedCount > 0 && (
            <p className="text-xs text-red-500 font-medium">{unackedCount} unacknowledged</p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 flex-wrap">
          {user?.role === 'admin' && <CitySwitcher />}
          <button
            onClick={() => setShowManual(true)}
            className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 font-medium px-2 py-1"
          >
            Manual
          </button>
          <button
            onClick={() => setShowIngest(true)}
            className="bg-indigo-600 text-white rounded-lg px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium hover:bg-indigo-700 active:bg-indigo-800 flex items-center gap-2 whitespace-nowrap"
          >
            <span aria-hidden="true">📷</span>
            <span className="sm:hidden">New Lead</span>
            <span className="hidden sm:inline">New from Screenshot</span>
          </button>
        </div>
      </header>

      <div className="flex border-b bg-white dark:bg-gray-800 dark:border-gray-700 px-4">
        <button
          onClick={() => setView('active')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            view === 'active'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          Active
        </button>
        <button
          onClick={() => setView('released')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            view === 'released'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          Closed
        </button>
      </div>

      <div className="px-4 py-3 flex gap-2 flex-wrap border-b bg-white dark:bg-gray-800 dark:border-gray-700">
        <select
          className="border rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"
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
          className="border rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white w-36"
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

      <div className="px-4 pt-3 pb-1">
        <p className="text-xs text-gray-400">{displayLeads.length} lead{displayLeads.length !== 1 ? 's' : ''}</p>
      </div>

      <main className="px-4 pb-10 space-y-4">
        {view === 'active' && openEscalations.length > 0 && (
          <section className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-900/20">
            <button
              onClick={() => setEscBandOpen(o => !o)}
              className="flex w-full min-h-12 items-center justify-between px-3 py-2 text-left"
              aria-expanded={escBandOpen}
            >
              <span className="font-semibold text-amber-800 dark:text-amber-200">
                ⚠ Escalations <span className="text-amber-600 dark:text-amber-400">{openEscalations.length}</span>
              </span>
              <span className={`text-amber-500 transition-transform ${escBandOpen ? 'rotate-90' : ''}`} aria-hidden="true">›</span>
            </button>
            {escBandOpen && (
              <div className="space-y-1 px-2 pb-2">
                {openEscalations.map(e => (
                  <button
                    key={e.id}
                    onClick={() => navigate(`/leads/${e.lead_id}`)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg bg-white/70 px-3 py-2 text-left dark:bg-gray-800/60"
                  >
                    <span className="min-w-0 truncate text-sm font-medium text-gray-900 dark:text-white">
                      {e.lead_customer_name ?? 'Unknown'}
                    </span>
                    <span className="shrink-0 text-xs text-amber-700 dark:text-amber-300">
                      {LEVEL_LABELS[e.level]} · {e.decision_needed}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
        {isLoading && (
          <p className="text-sm text-gray-400 text-center py-10">Loading…</p>
        )}
        {!isLoading && error && (
          <p className="text-sm text-red-500 text-center py-10">Could not load leads. Is the backend running?</p>
        )}
        {!isLoading && !error && displayLeads.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-10">
            {view === 'active' ? 'No active leads. Tap 📷 New from Screenshot to add one.' : 'No closed leads yet.'}
          </p>
        )}

        {groups.map(group => {
          const isCollapsed = collapsed.has(group.status)
          return (
            <section key={group.status}>
              <button
                onClick={() => toggle(group.status)}
                className="w-full min-h-12 flex items-center justify-between gap-3 px-1 py-2 text-left"
                aria-expanded={!isCollapsed}
              >
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <span className="font-semibold text-gray-900 dark:text-white">{group.label}</span>
                  <span className="text-sm text-gray-400">{group.leads.length}</span>
                  {group.overdue > 0 && (
                    <span className="rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 text-[11px] font-semibold px-1.5 py-0.5">
                      {group.overdue} overdue
                    </span>
                  )}
                  {group.aging > 0 && (
                    <span className="rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-[11px] font-semibold px-1.5 py-0.5">
                      {group.aging} aging
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {showQuote && group.value > 0 && (
                    <span className="text-sm text-gray-500 dark:text-gray-400">{fmtMoney(group.value)}</span>
                  )}
                  <span className={`text-gray-400 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} aria-hidden="true">›</span>
                </div>
              </button>

              {!isCollapsed && (
                <div className="space-y-3 mt-1">
                  {group.leads.map(lead => (
                    <div key={lead.id} className="space-y-1">
                      {isAllCities && lead.city_name && (
                        <p className="px-1 text-xs font-semibold text-indigo-500 dark:text-indigo-300">{lead.city_name}</p>
                      )}
                      <LeadCard
                        lead={lead}
                        onClick={id => navigate(`/leads/${id}`)}
                        staleness={overdueIds.has(lead.id) ? 'overdue' : agingIds.has(lead.id) ? 'aging' : null}
                        idleMinutes={idleMinuteMap.get(lead.id)}
                        hasTruckRental={rentalLeadIds.has(lead.id)}
                        isEscalated={escalatedLeadIds.has(lead.id)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </main>

      {showIngest && <IngestProgressFlow onClose={() => setShowIngest(false)} />}
      {showManual && <LeadCreate onClose={() => setShowManual(false)} />}
      <BottomNav />
    </div>
  )
}
