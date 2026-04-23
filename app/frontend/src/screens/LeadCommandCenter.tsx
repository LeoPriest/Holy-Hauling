import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AgeIndicator } from '../components/AgeIndicator'
import { GateIndicator } from '../components/GateIndicator'
import { StatusBadge } from '../components/StatusBadge'
import { useLead, useLatestAiReview, useTriggerAiReview, useUpdateStatus } from '../hooks/useLeads'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { BriefPanel } from './panels/BriefPanel'
import { LogPanel } from './panels/LogPanel'
import { QuotePanel } from './panels/QuotePanel'

type Tab = 'brief' | 'quote' | 'log'

export function LeadCommandCenter() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('brief')

  const { user } = useAuth()
  const { toggleTheme } = useTheme()
  const { data: lead, isLoading } = useLead(id!)
  const { data: aiReview } = useLatestAiReview(id!)
  const triggerReview = useTriggerAiReview()
  const updateStatus = useUpdateStatus()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50 dark:bg-gray-900">
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    )
  }

  if (!lead) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-50 dark:bg-gray-900 gap-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">Lead not found.</p>
        <button onClick={() => navigate('/')} className="text-sm text-blue-600 dark:text-blue-400 underline">
          Back to queue
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 overflow-hidden">

      {/* ── Fixed header ─────────────────────────────────────────────── */}
      <header className="bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-4 py-3 flex items-center gap-3 shrink-0 z-20">
        <button
          onClick={() => navigate('/')}
          className="text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 text-xl leading-none shrink-0"
          aria-label="Back to queue"
        >
          ←
        </button>

        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-gray-900 dark:text-white truncate text-base leading-tight">
            {lead.customer_name ?? <span className="italic text-gray-400 font-normal">No name yet</span>}
          </h1>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <StatusBadge status={lead.status} />
            {lead.urgency_flag && (
              <span className="text-xs font-bold text-orange-500 uppercase">Urgent</span>
            )}
            <AgeIndicator createdAt={lead.created_at} />
          </div>
          <div className="mt-1">
            <GateIndicator status={lead.status} />
          </div>
        </div>

        <button
          onClick={toggleTheme}
          className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-lg shrink-0"
          title="Toggle dark mode"
        >
          🌓
        </button>

        {lead.status === 'booked' && (
          <button
            onClick={() => navigate('/jobs')}
            className="text-xs bg-green-600 text-white rounded-lg px-3 py-2 hover:bg-green-700 shrink-0 font-medium"
          >
            View in Jobs
          </button>
        )}
        {lead.status !== 'released' && lead.status !== 'lost' && (
          <button
            onClick={() => updateStatus.mutate({ id: id!, status: 'lost', actor: user?.username })}
            disabled={updateStatus.isPending}
            className="text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg px-3 py-2 hover:bg-red-50 dark:hover:bg-red-900/20 hover:border-red-300 hover:text-red-600 disabled:opacity-50 shrink-0 font-medium transition-colors"
          >
            Mark Released
          </button>
        )}
        <button
          onClick={() => triggerReview.mutate({ leadId: id! })}
          disabled={triggerReview.isPending}
          className="text-xs bg-indigo-600 text-white rounded-lg px-3 py-2 hover:bg-indigo-700 disabled:opacity-50 shrink-0 font-medium"
        >
          {triggerReview.isPending ? 'Running…' : aiReview ? 'Re-run AI' : 'Run AI Review'}
        </button>
      </header>

      {/* ── Tab bar ──────────────────────────────────────────────────── */}
      <nav className="bg-white dark:bg-gray-800 border-b dark:border-gray-700 flex shrink-0">
        {(['brief', 'quote', 'log'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-3 text-sm font-medium capitalize transition-colors border-b-2 ${
              tab === t
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      {/* ── Scrollable panel ─────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto">
        {tab === 'brief' && <BriefPanel lead={lead} aiReview={aiReview} />}
        {tab === 'quote' && <QuotePanel lead={lead} aiReview={aiReview} leadId={id!} />}
        {tab === 'log'   && <LogPanel lead={lead} leadId={id!} />}
      </main>

    </div>
  )
}
