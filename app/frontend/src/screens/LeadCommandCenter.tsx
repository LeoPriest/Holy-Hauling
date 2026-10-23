import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import FollowUpModal from '../components/FollowUpModal'
import { GateIndicator } from '../components/GateIndicator'
import { ScheduleDateModal } from '../components/ScheduleDateModal'
import { StatusBadge } from '../components/StatusBadge'
import { TabDock, type DockTab } from '../components/TabDock'
import { useFollowup } from '../hooks/useFollowup'
import { usePayment } from '../hooks/usePayment'
import { useLead, useLatestAiReview, useUpdateStatus } from '../hooks/useLeads'
import { useAuth } from '../context/AuthContext'
import { BriefPanel } from './panels/BriefPanel'
import { LogPanel } from './panels/LogPanel'
import { QuotePanel } from './panels/QuotePanel'
import { BookingConfirmation, formatCurrency, parseMoney, useQuoteDraft, validateQuote } from '../components/QuoteBuilder'
import { buildConfirmationText } from '../utils/confirmationText'
import { EscalationCard } from '../components/EscalationCard'
import { RefundBanner } from '../components/RefundBanner'
import { LeadDecisionCard } from '../components/LeadDecisionCard'
import { shortAge } from '../utils/leadCard'
import { parseUtc } from '../utils/time'
import type { LeadStatus } from '../types/lead'

type Tab = 'brief' | 'quote' | 'log'

// ── Icons (Heroicons outline paths) ───────────────────────────────────────

const ICON = {
  back: 'M15.75 19.5 8.25 12l7.5-7.5',
  dots: 'M12 5h.01M12 12h.01M12 19h.01',
  calendar: 'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5',
  clock: 'M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  pin: 'M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z',
  check: 'm4.5 12.75 6 6 9-13.5',
  briefcase: 'M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 0 0 .75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 0 0-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0 1 12 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 0 1-.673-.38m0 0A2.18 2.18 0 0 1 3 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 0 1 3.413-.387m7.5 0V5.25A2.25 2.25 0 0 0 13.5 3h-3a2.25 2.25 0 0 0-2.25 2.25v.894m7.5 0a48.667 48.667 0 0 0-7.5 0',
  x: 'M6 18 18 6M6 6l12 12',
  card: 'M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z',
}

function Icon({ d }: { d: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>
}

const TABS: DockTab<Tab>[] = [
  {
    key: 'brief', label: 'Brief',
    outline: 'M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z',
    filled: <><path d="M6 2.5h6.2a1 1 0 0 1 .7.3l5.8 5.8a1 1 0 0 1 .3.7V20a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 20V4A1.5 1.5 0 0 1 6 2.5Z" /><path className="cut" d="M8.5 13h7M8.5 16.5h4.5" /></>,
  },
  {
    key: 'quote', label: 'Quote',
    outline: 'M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    filled: <><path d="M12 2.75a9.25 9.25 0 1 1 0 18.5 9.25 9.25 0 0 1 0-18.5Z" /><path className="cut" d="M12 6.5v11m-2.6-2.6.8.6c1 .8 2.6.8 3.6 0 1-.8 1-2 0-2.8-.5-.4-1.1-.6-1.8-.6-.6 0-1.3-.2-1.8-.6-.9-.8-.9-2 0-2.8.9-.8 2.5-.8 3.4 0l.4.3" /></>,
  },
  {
    key: 'log', label: 'Log',
    outline: ICON.clock,
    filled: <><path d="M12 2.75a9.25 9.25 0 1 1 0 18.5 9.25 9.25 0 0 1 0-18.5Z" /><path className="cut" d="M12 7v5h4" /></>,
  },
]

// ── More menu: a bottom sheet ─────────────────────────────────────────────

interface ActionItem {
  label: string
  icon: string
  onClick: () => void
  variant?: 'default' | 'primary' | 'destructive'
}

function ActionSheet({ open, items, onClose }: { open: boolean; items: ActionItem[]; onClose: () => void }) {
  return (
    <>
      <div className={`wd-scrim ${open ? 'show' : ''}`} onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-label="More actions" aria-hidden={!open} className={`wd-sheet ${open ? 'show' : ''}`}>
        <div className="wd-grab" aria-hidden="true" />
        {items.map(item => (
          <button
            key={item.label}
            type="button"
            tabIndex={open ? 0 : -1}
            onClick={() => { item.onClick(); onClose() }}
            className={`wd-si ${item.variant === 'primary' ? 'wd-si-pr' : item.variant === 'destructive' ? 'wd-si-red' : ''}`}
          >
            <Icon d={item.icon} />
            {item.label}
          </button>
        ))}
        <button type="button" tabIndex={open ? 0 : -1} onClick={onClose} className="wd-btn wd-btn-ghost mt-2">
          Close
        </button>
      </div>
    </>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export function LeadCommandCenter() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('brief')
  const [showScheduleModal, setShowScheduleModal] = useState(false)
  const [showFollowUpModal, setShowFollowUpModal] = useState(false)
  const [showActionSheet, setShowActionSheet] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [bookError, setBookError] = useState('')
  const [confirmText, setConfirmText] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>()
  const mainRef = useRef<HTMLElement>(null)

  const { user } = useAuth()
  const { data: lead, isLoading } = useLead(id!)
  const {
    data: aiReview,
    isLoading: aiReviewLoading,
    isError: aiReviewError,
    refetch: refetchAiReview,
  } = useLatestAiReview(id!)
  const updateStatus = useUpdateStatus()
  const { followup, saving: followupSaving, save: saveFollowup, cancel: cancelFollowup } = useFollowup(id!)
  const { payment, saving: paymentSaving, error: paymentError, sendRequest: sendPaymentRequest, cancel: cancelPaymentRequest } = usePayment(id!)
  const quoteDraft = useQuoteDraft(lead)

  useEffect(() => () => clearTimeout(toastTimer.current), [])

  function say(text: string) {
    clearTimeout(toastTimer.current)
    setToast(text)
    toastTimer.current = setTimeout(() => setToast(null), 2200)
  }

  function switchTab(next: Tab) {
    setTab(next)
    mainRef.current?.scrollTo?.({ top: 0 })
  }

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg">
        <p className="text-sm text-mu">Loading…</p>
      </div>
    )
  }

  if (!lead) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-bg">
        <p className="text-sm text-mu">Lead not found.</p>
        <button onClick={() => navigate('/')} className="wd-btn wd-btn-ghost">
          Back to queue
        </button>
      </div>
    )
  }

  const isActive = lead.status !== 'released' && lead.status !== 'lost'
  const canReply = lead.status === 'new' || lead.status === 'in_review'

  function setStatus(status: LeadStatus, done: string, failed: string) {
    updateStatus.mutate(
      { id: id!, status, actor: user?.username },
      { onSuccess: () => say(done), onError: () => say(failed) },
    )
  }
  const markReplied = () => setStatus('replied', 'Marked replied', "Couldn't mark replied. Try again.")

  const canRequestPayment = isActive && !!lead.quoted_price_total && (!payment || payment.status === 'failed' || payment.status === 'cancelled')
  const paymentLabel = payment?.status === 'pending'
    ? `Resend payment ($${(payment.amount_cents / 100).toFixed(2)})`
    : lead.quoted_price_total
    ? `Request payment ($${lead.quoted_price_total.toFixed(2)})`
    : 'Request payment'

  const actionSheetItems: ActionItem[] = [
    ...(isActive ? [{ label: 'Schedule date', icon: ICON.calendar, onClick: () => setShowScheduleModal(true) }] : []),
    { label: followup ? 'Edit follow-up' : 'Set follow-up', icon: ICON.clock, onClick: () => setShowFollowUpModal(true) },
    ...(canRequestPayment || payment?.status === 'pending' ? [{
      label: paymentLabel,
      icon: ICON.card,
      onClick: () => sendPaymentRequest(),
      variant: (payment?.status === 'paid' ? undefined : 'primary') as ActionItem['variant'],
    }] : []),
    { label: 'View in calendar', icon: ICON.pin, onClick: () => navigate(lead.job_date_requested ? `/calendar?date=${lead.job_date_requested}` : '/calendar') },
    ...(canReply ? [{ label: 'Mark replied', icon: ICON.check, onClick: markReplied, variant: 'primary' as const }] : []),
    ...(lead.status === 'booked' ? [{ label: 'View in jobs', icon: ICON.briefcase, onClick: () => navigate('/jobs') }] : []),
    ...(isActive ? [{ label: 'Mark released', icon: ICON.x, onClick: () => setStatus('lost', 'Marked released', "Couldn't release it. Try again."), variant: 'destructive' as const }] : []),
  ]

  function lockAndBook() {
    if (!lead) return
    const v = validateQuote(quoteDraft)
    if (!v.ok) {
      setBookError(v.error)
      if (tab !== 'quote') switchTab('quote')
      return
    }
    setBookError('')
    updateStatus.mutate(
      {
        id: id!,
        status: 'booked',
        actor: user?.username,
        quotedPriceTotal: v.total,
        quoteModifiers: v.modifiers,
        estimatedJobDurationMinutes: v.duration,
      },
      {
        onSuccess: () => setConfirmText(buildConfirmationText(lead, v.total)),
        onError: error => setBookError((error as Error)?.message ?? 'Failed to book lead.'),
      },
    )
  }

  const quoted = parseMoney(quoteDraft.quotedPriceTotal)

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-bg text-ink">
      <div className={`wd-toast ${toast ? 'show' : ''}`} role="status" aria-live="polite">{toast}</div>

      {/* ── Header ─────────────────────────────────────────── */}
      <header className="wd-hdr z-20 shrink-0 !pb-5 !pl-2">
        <div className="flex items-center gap-1.5">
          <button onClick={() => navigate('/')} className="wd-ib" aria-label="Back to queue">
            <Icon d={ICON.back} />
          </button>

          <div className="min-w-0 flex-1">
            <h1 className="wd-disp truncate text-[26px] leading-none">
              {lead.customer_name ?? <span className="normal-case italic text-[#b9b5ac]">No name yet</span>}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <StatusBadge status={lead.status} />
              {lead.urgency_flag && <span className="wd-urg">Urgent</span>}
              <span className="wd-age tabular-nums">{shortAge(parseUtc(lead.created_at))}</span>
            </div>
          </div>

          {canReply ? (
            <button onClick={markReplied} disabled={updateStatus.isPending} className="wd-btn-sm wd-btn-amber shrink-0">
              {updateStatus.isPending ? 'Saving…' : 'Mark replied'}
            </button>
          ) : lead.status === 'booked' ? (
            <button onClick={() => navigate('/jobs')} className="wd-btn-sm shrink-0">View jobs</button>
          ) : null}
          <button onClick={() => setShowActionSheet(true)} className="wd-ib" aria-label="More actions">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={ICON.dots} strokeWidth={3} /></svg>
          </button>
        </div>

        {(followup || (payment && payment.status !== 'cancelled')) && (
          <div className="mt-2 flex flex-wrap gap-2 pl-[50px]">
            {followup && (
              <button onClick={() => setShowFollowUpModal(true)} className="wd-hchip">
                Follow up {new Date(followup.scheduled_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
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
                className={`wd-hchip ${payment.status === 'paid' ? 'wd-hchip-ok' : ''}`}
              >
                {linkCopied ? 'Copied' : payment.status === 'paid' ? 'Paid' : payment.status === 'pending' ? 'Copy pay link' : payment.status}
              </button>
            )}
          </div>
        )}

        <div className="pl-2">
          <GateIndicator status={lead.status} />
        </div>
      </header>

      {/* ── Scrollable panel ─────────────────────────────── */}
      <main ref={mainRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl">
        {paymentError && (
          <p className="wd-box mx-3.5 mt-3.5 !shadow-[inset_0_0_0_1.5px_var(--red)] text-sm text-danger">{paymentError}</p>
        )}

        {/* An open escalation is a genuine interrupt — it sits first. */}
        <EscalationCard leadId={lead.id} />

        {/* First thing on open, on every tab; scrolls away once read. */}
        <LeadDecisionCard
          lead={lead}
          aiReview={aiReview}
          reviewLoading={aiReviewLoading}
          reviewError={aiReviewError}
          onRetryLoad={() => { void refetchAiReview() }}
        />
        <div className="px-3.5 pt-3 empty:hidden">
          <RefundBanner lead={lead} />
        </div>
        <div key={tab}>
          {tab === 'brief' && (
            <BriefPanel
              lead={lead}
              aiReview={aiReview}
              onBookingDateSet={() => switchTab('quote')}
            />
          )}
          {tab === 'quote' && (
            <QuotePanel
              lead={lead}
              aiReview={aiReview}
              leadId={id!}
              quoteDraft={quoteDraft}
              onLockAndBook={lockAndBook}
              bookError={bookError}
              isBooking={updateStatus.isPending}
            />
          )}
          {tab === 'log' && (
            <LogPanel
              lead={lead}
              leadId={id!}
              onGoToQuote={() => switchTab('quote')}
            />
          )}
        </div>
        </div>
      </main>

      {/* ── Pinned quote bar ─────────────────────────────── */}
      {isActive && (
        <div className="wd-qbar mx-auto w-full max-w-3xl">
          <div className="min-w-0">
            <p className="wd-qb-l">Quote{lead.status === 'booked' ? ' · Booked' : ''}</p>
            <p className="wd-qb-v truncate">{quoted != null ? formatCurrency(quoted) : 'Not set'}</p>
          </div>
          {lead.status === 'booked' ? (
            <button onClick={() => navigate('/jobs')} className="wd-btn shrink-0">View jobs</button>
          ) : tab === 'quote' ? (
            <button onClick={lockAndBook} disabled={updateStatus.isPending} className="wd-btn shrink-0">
              {updateStatus.isPending ? 'Booking…' : 'Lock & book'}
            </button>
          ) : (
            <button onClick={() => switchTab('quote')} className="wd-btn wd-btn-amber shrink-0">Open quote</button>
          )}
        </div>
      )}

      <TabDock tabs={TABS} active={tab} onChange={switchTab} label="Lead" />

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

      <ActionSheet open={showActionSheet} items={actionSheetItems} onClose={() => setShowActionSheet(false)} />

      {confirmText !== null && (
        <BookingConfirmation text={confirmText} onClose={() => setConfirmText(null)} />
      )}
    </div>
  )
}
