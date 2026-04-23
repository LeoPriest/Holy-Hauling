import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LeadCard } from '../components/LeadCard'
import { IngestProgressFlow } from '../components/IngestProgressFlow'
import { StaleLeadBanner } from '../components/StaleLeadBanner'
import { useLeads } from '../hooks/useLeads'
import { useSettings } from '../hooks/useSettings'
import { useStaleLeads } from '../hooks/useStaleLeads'
import { useUsers } from '../hooks/useUsers'
import { LeadCreate } from './LeadCreate'
import type { LeadSourceType, LeadStatus } from '../types/lead'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'

export function LeadQueue() {
  const navigate = useNavigate()
  const [view, setView] = useState<'active' | 'released'>('active')
  const [statusFilter, setStatusFilter] = useState<LeadStatus | ''>('')
  const [sourceFilter, setSourceFilter] = useState<LeadSourceType | ''>('')
  const [assignedFilter, setAssignedFilter] = useState('')
  const [showIngest, setShowIngest] = useState(false)
  const [showManual, setShowManual] = useState(false)

  const { data: leads = [], isLoading, error } = useLeads({
    status: statusFilter || undefined,
    source_type: sourceFilter || undefined,
    assigned_to: assignedFilter.trim() || undefined,
  })

  const closedStatuses = new Set(['released', 'lost'])
  const displayLeads = view === 'active'
    ? leads.filter(l => !closedStatuses.has(l.status))
    : leads.filter(l => closedStatuses.has(l.status))

  const { data: settings } = useSettings()
  const { t1Ids, t2Ids, idleMinuteMap, isSnoozed, snooze } = useStaleLeads(leads, settings)
  const { data: teamMembers = [] } = useUsers()
  const { user, logout } = useAuth()
  const { toggleTheme } = useTheme()

  const unackedCount = leads.filter(l => !l.acknowledged_at && !closedStatuses.has(l.status)).length

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">

      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div>
          <h1 className="font-bold text-gray-900 text-lg leading-tight">Lead Queue</h1>
          {unackedCount > 0 && (
            <p className="text-xs text-red-500 font-medium">{unackedCount} unacknowledged</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Dark mode toggle */}
          <button
            onClick={toggleTheme}
            className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-lg px-1"
            title="Toggle dark mode"
          >
            🌓
          </button>

          {/* Jobs board */}
          <button
            onClick={() => navigate('/jobs')}
            className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-lg px-1"
            title="Jobs"
          >
            📋
          </button>

          {/* Users — admin only */}
          {user?.role === 'admin' && (
            <button
              onClick={() => navigate('/admin/users')}
              className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-lg px-1"
              title="Team"
            >
              👥
            </button>
          )}

          {/* Sign out */}
          <button
            onClick={logout}
            className="text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 px-1"
            title="Sign out"
          >
            Sign out
          </button>

          <button
            onClick={() => navigate('/settings')}
            className="text-gray-400 hover:text-gray-700 text-xl px-1"
            title="Settings"
          >
            ⚙
          </button>
          <button
            onClick={() => setShowManual(true)}
            className="text-sm text-gray-500 hover:text-gray-700 font-medium px-2 py-1"
          >
            Manual
          </button>
          <button
            onClick={() => setShowIngest(true)}
            className="bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-indigo-700 active:bg-indigo-800"
          >
            📷 New from Screenshot
          </button>
        </div>
      </header>

      {/* View tabs */}
      <div className="flex border-b bg-white dark:bg-gray-800 dark:border-gray-700 px-4">
        <button
          onClick={() => { setView('active'); setStatusFilter('') }}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            view === 'active'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          Active
        </button>
        <button
          onClick={() => { setView('released'); setStatusFilter('') }}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            view === 'released'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          Closed
        </button>
      </div>

      {/* Stale lead banner — active tab only */}
      {view === 'active' && (
        <StaleLeadBanner
          t1Count={t1Ids.size}
          t2Count={t2Ids.size}
          isSnoozed={isSnoozed}
          onSnooze={snooze}
        />
      )}

      {/* Filters */}
      <div className="px-4 py-3 flex gap-2 flex-wrap border-b bg-white dark:bg-gray-800 dark:border-gray-700">
        {view === 'active' && (
          <select
            className="border rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as LeadStatus | '')}
          >
            <option value="">All Statuses</option>
            <option value="new">New</option>
            <option value="in_review">In Review</option>
            <option value="waiting_on_customer">Waiting</option>
            <option value="ready_for_quote">Ready to Quote</option>
            <option value="ready_for_booking">Ready to Book</option>
            <option value="escalated">Escalated</option>
            <option value="booked">Booked</option>
          </select>
        )}

        <select
          className="border rounded-lg px-3 py-1.5 text-sm bg-white"
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

      {/* Count */}
      <div className="px-4 pt-3 pb-1">
        <p className="text-xs text-gray-400">{displayLeads.length} lead{displayLeads.length !== 1 ? 's' : ''}</p>
      </div>

      {/* List */}
      <main className="px-4 pb-10 space-y-3">
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
        {displayLeads.map(lead => (
          <LeadCard
            key={lead.id}
            lead={lead}
            onClick={id => navigate(`/leads/${id}`)}
            staleness={t2Ids.has(lead.id) ? 't2' : t1Ids.has(lead.id) ? 't1' : null}
            idleMinutes={idleMinuteMap.get(lead.id)}
          />
        ))}
      </main>

      {showIngest && <IngestProgressFlow onClose={() => setShowIngest(false)} />}
      {showManual && <LeadCreate onClose={() => setShowManual(false)} />}
    </div>
  )
}
