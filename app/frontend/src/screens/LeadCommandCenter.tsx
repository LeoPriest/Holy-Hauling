import React, { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AgeIndicator } from '../components/AgeIndicator'
import FollowUpModal from '../components/FollowUpModal'
import { GateIndicator } from '../components/GateIndicator'
import { ScheduleDateModal } from '../components/ScheduleDateModal'
import { StatusBadge } from '../components/StatusBadge'
import { useFollowup } from '../hooks/useFollowup'
import { usePayment } from '../hooks/usePayment'
import { useLead, useLatestAiReview, useUpdateStatus } from '../hooks/useLeads'
import { useAuth } from '../context/AuthContext'
import { BriefPanel } from './panels/BriefPanel'
import { LogPanel } from './panels/LogPanel'
import { QuotePanel } from './panels/QuotePanel'

type Tab = 'brief' | 'quote' | 'log'

// ── Inline SVG icons ───────────────────────────────────────────────────────

function IconCalendar() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
    </svg>
  )
}

function IconClock() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  )
}

function IconMapPin() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
      <path d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
    </svg>
  )
}

function IconCheck() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  )
}

function IconBriefcase() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 0 0 .75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 0 0-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0 1 12 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 0 1-.673-.38m0 0A2.18 2.18 0 0 1 3 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 0 1 3.413-.387m7.5 0V5.25A2.25 2.25 0 0 0 13.5 3h-3a2.25 2.25 0 0 0-2.25 2.25v.894m7.5 0a48.667 48.667 0 0 0-7.5 0" />
    </svg>
  )
}

function IconXMark() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 18 18 6M6 6l12 12" />
    </svg>
  )
}

function IconCreditCard() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
    </svg>
  )
}

// ── Action sheet ───────────────────────────────────────────────────────────

interface ActionItem {
  label: string
  icon: React.ReactNode
  onClick: () => void
  variant?: 'default' | 'primary' | 'destructive'
}

function ActionSheet({ items, onClose }: { items: ActionItem[]; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-t-2xl shadow-2xl pb-8"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full mx-auto mt-3 mb-3" />
        <div className="px-4 space-y-0.5">
          {items.map((item, i) => {
            const colorClass =
              item.variant === 'primary'
                ? 'text-teal-700 dark:text-teal-400'
                : item.variant === 'destructive'
                ? 'text-red-600 dark:text-red-400'
                : 'text-gray-800 dark:text-gray-100'
            const bgClass =
              item.variant === 'destructive'
                ? 'hover:bg-red-50 dark:hover:bg-red-900/20 active:bg-red-100'
                : 'hover:bg-gray-50 dark:hover:bg-gray-700 active:bg-gray-100 dark:active:bg-gray-600'
            return (
              <button
                key={i}
                onClick={() => { item.onClick(); onClose() }}
                className={`flex items-center gap-3 w-full px-3 py-3.5 rounded-xl text-sm font-medium transition-colors ${colorClass} ${bgClass}`}
              >
                {item.icon}
                {item.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export function LeadCommandCenter() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('brief')
  const [triggerBookingModal, setTriggerBookingModal] = useState(false)
  const [showScheduleModal, setShowScheduleModal] = useState(false)
  const [showFollowUpModal, setShowFollowUpModal] = useState(false)
  const [showActionSheet, setShowActionSheet] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)

  const { user } = useAuth()
  const { data: lead, isLoading } = useLead(id!)
  const { data: aiReview } = useLatestAiReview(id!)
  const updateStatus = useUpdateStatus()
  const { followup, saving: followupSaving, save: saveFollowup, cancel: cancelFollowup } = useFollowup(id!)
  const { payment, saving: paymentSaving, error: paymentError, sendRequest: sendPaymentRequest, cancel: cancelPaymentRequest } = usePayment(id!)

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

  const isActive = lead.status !== 'released' && lead.status !== 'lost'
  const canReply = lead.status === 'new' || lead.status === 'in_review'

  // Context-aware primary action shown in the header
  const primaryAction = canReply
    ? { label: 'Mark Replied', color: 'bg-teal-600 hover:bg-teal-700 text-white', action: () => updateStatus.mutate({ id: id!, status: 'replied', actor: user?.username }) }
    : lead.status === 'booked'
    ? { label: 'View Jobs', color: 'bg-green-600 hover:bg-green-700 text-white', action: () => navigate('/jobs') }
    : null

  const canRequestPayment = isActive && !!lead.quoted_price_total && (!payment || payment.status === 'failed' || payment.status === 'cancelled')
  const paymentLabel = payment?.status === 'pending'
    ? `Resend Payment ($${(payment.amount_cents / 100).toFixed(2)})`
    : lead.quoted_price_total
    ? `Request Payment ($${lead.quoted_price_total.toFixed(2)})`
    : 'Request Payment'

  const actionSheetItems: ActionItem[] = [
    ...(isActive ? [{ label: 'Schedule Date', icon: <IconCalendar />, onClick: () => setShowScheduleModal(true) }] : []),
    { label: followup ? 'Edit Follow-Up' : 'Set Follow-Up', icon: <IconClock />, onClick: () => setShowFollowUpModal(true) },
    ...(canRequestPayment || payment?.status === 'pending' ? [{
      label: paymentLabel,
      icon: <IconCreditCard />,
      onClick: () => sendPaymentRequest(),
      variant: (payment?.status === 'paid' ? undefined : 'primary') as ActionItem['variant'],
    }] : []),
    { label: 'View in Calendar', icon: <IconMapPin />, onClick: () => navigate(lead.job_date_requested ? `/calendar?date=${lead.job_date_requested}` : '/calendar') },
    ...(canReply ? [{ label: 'Mark Replied', icon: <IconCheck />, onClick: () => updateStatus.mutate({ id: id!, status: 'replied', actor: user?.username }), variant: 'primary' as const }] : []),
    ...(lead.status === 'booked' ? [{ label: 'View in Jobs', icon: <IconBriefcase />, onClick: () => navigate('/jobs') }] : []),
    ...(isActive ? [{ label: 'Mark Released', icon: <IconXMark />, onClick: () => updateStatus.mutate({ id: id!, status: 'lost', actor: user?.username }), variant: 'destructive' as const }] : []),
  ]

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 overflow-hidden">

      {/* ── Fixed header ─────────────────────────────────── */}
      <header className="bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-4 pt-3 pb-2.5 shrink-0 z-20">
        <div className="flex items-start gap-3">

          {/* Back */}
          <button
            onClick={() => navigate('/')}
            className="mt-0.5 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 shrink-0"
            aria-label="Back to queue"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </button>

          {/* Name + badges */}
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-gray-900 dark:text-white text-base leading-snug">
              {lead.customer_name ?? <span className="italic text-gray-400 font-normal">No name yet</span>}
            </h1>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <StatusBadge status={lead.status} />
              {lead.urgency_flag && (
                <span className="text-[10px] font-bold text-orange-500 uppercase tracking-wide">Urgent</span>
              )}
              <AgeIndicator createdAt={lead.created_at} />
              {followup && (
                <button
                  onClick={() => setShowFollowUpModal(true)}
                  className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 border border-amber-200"
                >
                  <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                  </svg>
                  {new Date(followup.scheduled_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </button>
              )}
              {payment && payment.status !== 'cancelled' && (
                <button
                  onClick={() => {
                    if (payment.payment_link_url && payment.status === 'pending') {
                      navigator.clipboard.writeText(payment.payment_link_url)
                      setLinkCopied(true)
                      setTimeout(() => setLinkCopied(false), 2500)
                    }
                  }}
                  className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border ${
                    payment.status === 'paid'
                      ? 'bg-green-100 text-green-700 border-green-200'
                      : payment.status === 'pending'
                      ? 'bg-blue-100 text-blue-700 border-blue-200 active:bg-blue-200'
                      : 'bg-gray-100 text-gray-500 border-gray-200'
                  }`}
                >
                  <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
                  </svg>
                  {linkCopied ? 'Copied!' : payment.status === 'paid' ? 'Paid' : payment.status === 'pending' ? 'Copy Link' : payment.status}
                </button>
              )}
            </div>
          </div>

          {/* Primary action + overflow menu */}
          <div className="flex items-center gap-2 shrink-0 mt-0.5">
            {primaryAction && (
              <button
                onClick={primaryAction.action}
                disabled={updateStatus.isPending}
                className={`text-xs rounded-lg px-3 py-2 font-semibold disabled:opacity-50 transition-colors ${primaryAction.color}`}
              >
                {primaryAction.label}
              </button>
            )}
            <button
              onClick={() => setShowActionSheet(true)}
              className="flex items-center justify-center w-8 h-8 rounded-full text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              aria-label="More actions"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
              </svg>
            </button>
          </div>
        </div>

        {/* Gate progress — separate row so it never wraps into the button area */}
        <div className="mt-2 pl-8">
          <GateIndicator status={lead.status} />
        </div>
      </header>

      {/* Payment error banner */}
      {paymentError && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2">
          <p className="text-xs text-red-700">{paymentError}</p>
        </div>
      )}

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
                : 'text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {icon(tab === id)}
            <span className="text-[10px] font-medium leading-none">{label}</span>
          </button>
        ))}
      </nav>

      {/* ── Modals & overlays ─────────────────────────────── */}
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

      {showActionSheet && (
        <ActionSheet items={actionSheetItems} onClose={() => setShowActionSheet(false)} />
      )}

    </div>
  )
}
