import React, { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AgeIndicator } from '../components/AgeIndicator'
import FollowUpModal from '../components/FollowUpModal'
import { GateIndicator } from '../components/GateIndicator'
import { ScheduleDateModal } from '../components/ScheduleDateModal'
import { StatusBadge } from '../components/StatusBadge'
import { useFollowup } from '../hooks/useFollowup'
import { useLead, useLatestAiReview, useUpdateStatus } from '../hooks/useLeads'
import { useAuth } from '../context/AuthContext'
import { BriefPanel } from './panels/BriefPanel'
import { LogPanel } from './panels/LogPanel'
import { QuotePanel } from './panels/QuotePanel'

type Tab = 'brief' | 'quote' | 'log'

export function LeadCommandCenter() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('brief')
  const [triggerBookingModal, setTriggerBookingModal] = useState(false)
  const [showScheduleModal, setShowScheduleModal] = useState(false)
  const [showFollowUpModal, setShowFollowUpModal] = useState(false)

  const { user } = useAuth()
  const { data: lead, isLoading } = useLead(id!)
  const { data: aiReview } = useLatestAiReview(id!)
  const updateStatus = useUpdateStatus()
  const { followup, saving: followupSaving, save: saveFollowup, cancel: cancelFollowup } = useFollowup(id!)

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

      {/* ── Fixed header ─────────────────────────────────── */}
      <header className="bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-4 py-3 flex items-start gap-3 flex-wrap shrink-0 z-20">
        <button
          onClick={() => navigate('/')}
          className="text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 text-xl leading-none shrink-0"
          aria-label="Back to queue"
        >
          ←
        </button>

        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-gray-900 dark:text-white text-base leading-tight whitespace-normal break-words">
            {lead.customer_name ?? <span className="italic text-gray-400 font-normal">No name yet</span>}
          </h1>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <StatusBadge status={lead.status} />
            {lead.urgency_flag && (
              <span className="text-xs font-bold text-orange-500 uppercase">Urgent</span>
            )}
            {lead.ingested_by && (
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                Ingested by {lead.ingested_by}
              </span>
            )}
            <AgeIndicator createdAt={lead.created_at} />
            {followup && (
              <button
                onClick={() => setShowFollowUpModal(true)}
                className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 border border-amber-200"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {new Date(followup.scheduled_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </button>
            )}
          </div>
          <div className="mt-1">
            <GateIndicator status={lead.status} />
          </div>
        </div>

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
            onClick={() => setShowScheduleModal(true)}
            className="text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg px-3 py-2 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:border-indigo-300 hover:text-indigo-600 shrink-0 font-medium transition-colors"
          >
            Schedule
          </button>
        )}
        <button
          onClick={() => setShowFollowUpModal(true)}
          className={`text-xs rounded-lg px-3 py-2 shrink-0 font-medium transition-colors border ${
            followup
              ? 'bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100'
              : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-amber-50 hover:border-amber-300 hover:text-amber-700'
          }`}
        >
          Follow Up
        </button>
        <button
          onClick={() => navigate(lead.job_date_requested ? `/calendar?date=${lead.job_date_requested}` : '/calendar')}
          className="text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg px-3 py-2 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:border-indigo-300 hover:text-indigo-600 shrink-0 font-medium transition-colors"
        >
          Calendar
        </button>
        {(lead.status === 'new' || lead.status === 'in_review') && (
          <button
            onClick={() => updateStatus.mutate({ id: id!, status: 'replied', actor: user?.username })}
            disabled={updateStatus.isPending}
            className="text-xs bg-teal-600 text-white rounded-lg px-3 py-2 hover:bg-teal-700 disabled:opacity-50 shrink-0 font-medium"
          >
            Mark Replied
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
      </header>

      {/* ── Scrollable panel ─────────────────────────────── */}
      <main className="flex-1 overflow-y-auto">
        {tab === 'brief' && (
          <BriefPanel
            lead={lead}
            aiReview={aiReview}
            onBookingDateSet={() => { setTab('log'); setTriggerBookingModal(true) }}
          />
        )}
        {tab === 'quote' && <QuotePanel lead={lead} aiReview={aiReview} leadId={id!} />}
        {tab === 'log' && (
          <LogPanel
            lead={lead}
            leadId={id!}
            triggerBookingModal={triggerBookingModal}
            onBookingModalOpened={() => setTriggerBookingModal(false)}
          />
        )}
      </main>

      {/* ── Bottom tab bar ───────────────────────────────── */}
      <nav className="bg-white dark:bg-gray-800 border-t dark:border-gray-700 flex shrink-0">
        {([
          { id: 'brief', label: 'Brief', icon: (active: boolean) => (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
              <path d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
            </svg>
          )},
          { id: 'quote', label: 'Quote', icon: (active: boolean) => (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
              <path d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          )},
          { id: 'log', label: 'Log', icon: (active: boolean) => (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
              <path d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          )},
        ] as { id: Tab; label: string; icon: (active: boolean) => React.ReactNode }[]).map(({ id, label, icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2 pb-3 transition-colors ${
              tab === id
                ? 'text-indigo-600 dark:text-indigo-400'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {icon(tab === id)}
            <span className="text-[10px] font-medium leading-none">{label}</span>
          </button>
        ))}
      </nav>

      {showScheduleModal && (
        <ScheduleDateModal lead={lead} onClose={() => setShowScheduleModal(false)} />
      )}

      {showFollowUpModal && (
        <FollowUpModal
          leadId={id!}
          existing={followup}
          onSave={(scheduledAt, note) => saveFollowup({ scheduled_at: scheduledAt, note })}
          onCancel={cancelFollowup}
          onClose={() => setShowFollowUpModal(false)}
          saving={followupSaving}
        />
      )}

    </div>
  )
}
