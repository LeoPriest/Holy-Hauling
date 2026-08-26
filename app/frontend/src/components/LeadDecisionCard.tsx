import { useTriggerAiReview } from '../hooks/useLeads'
import type { AiReview, Lead, RangeLever } from '../types/lead'

/** 44px minimum — this surface is phone-first (Rule 013). */
const TOUCH = 'min-h-[44px]'

function money(value: number): string {
  return `$${value.toLocaleString('en-US')}`
}

function CallRow({ lead }: { lead: Lead }) {
  const phone = lead.contact_phone ?? lead.customer_phone
  const name = lead.customer_name?.split(' ')[0] ?? 'customer'

  if (!phone) {
    return (
      <div className={`${TOUCH} flex items-center justify-center rounded-xl bg-gray-100 px-4 text-sm text-gray-500 dark:bg-gray-700 dark:text-gray-300`}>
        No number yet — reply on Thumbtack to reveal it
      </div>
    )
  }

  return (
    <div className="flex gap-2">
      <a
        href={`tel:${phone}`}
        className={`${TOUCH} flex flex-1 items-center justify-center rounded-xl bg-green-600 px-4 font-semibold text-white active:bg-green-700`}
      >
        Call {name}
      </a>
      <a
        href={`sms:${phone}`}
        className={`${TOUCH} flex items-center justify-center rounded-xl border border-gray-300 px-4 text-sm font-medium text-gray-700 active:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:active:bg-gray-700`}
      >
        Text
      </a>
    </div>
  )
}

function Lever({ lever }: { lever: RangeLever }) {
  return (
    <div className="rounded-xl border-l-[3px] border-amber-500 bg-amber-50 p-3 dark:bg-amber-900/20">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
        {lever.factor} decides it
      </p>
      <div className="flex gap-2">
        <div className="flex-1 rounded-lg border border-amber-200 bg-white p-2 dark:border-amber-800 dark:bg-gray-800">
          <p className="text-xs text-gray-500 dark:text-gray-400">{lever.low_answer}</p>
          <p className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">{money(lever.low_price)}</p>
        </div>
        <div className="flex-1 rounded-lg border border-amber-300 bg-white p-2 dark:border-amber-700 dark:bg-gray-800">
          <p className="text-xs text-gray-500 dark:text-gray-400">{lever.high_answer}</p>
          <p className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">{money(lever.high_price)}</p>
        </div>
      </div>
    </div>
  )
}

export function LeadDecisionCard({
  lead,
  aiReview,
  reviewLoading = false,
  reviewError = false,
  onRetryLoad,
}: {
  lead: Lead
  aiReview: AiReview | undefined
  /** The review GET is in flight. Distinct from "there is no review". */
  reviewLoading?: boolean
  /** The review GET failed. Also distinct from "there is no review". */
  reviewError?: boolean
  /** Refetch the review query. Never triggers a new model call. */
  onRetryLoad?: () => void
}) {
  const triggerReview = useTriggerAiReview()
  const s = aiReview?.sections

  const hasMoney =
    s?.target_low != null && s?.target_high != null && s?.floor != null

  // ── The review is still loading ───────────────────────────────────────
  // No Run AI review button here: tapping it mid-read pays for a model call
  // that would replace the review already on its way.
  if (reviewLoading && !aiReview) {
    return (
      <div className="m-3 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-3 h-2.5 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        <div className="mb-3 h-8 w-48 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading review…</p>
      </div>
    )
  }

  // ── The review failed to load ─────────────────────────────────────────
  // This lead may well already have a validated floor. Do not offer to
  // overwrite it — offer to read it again.
  if (reviewError && !aiReview) {
    return (
      <div className="m-3 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-red-700 dark:text-red-400">
          Review not loaded
        </p>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          Could not reach the server to load this lead's AI review. If one exists it is still
          there — this is a connection fault, not a missing review.
        </p>
        {onRetryLoad && (
          <button
            onClick={onRetryLoad}
            className={`${TOUCH} mb-3 w-full rounded-xl border border-gray-300 px-4 font-medium text-gray-700 active:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:active:bg-gray-700`}
          >
            Retry
          </button>
        )}
        <CallRow lead={lead} />
      </div>
    )
  }

  // ── No review at all ──────────────────────────────────────────────────
  if (!aiReview) {
    return (
      <div className="m-3 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          No AI review yet for this lead.
        </p>
        {triggerReview.isError && (
          <p className="mb-2 text-sm text-red-600 dark:text-red-400">
            {triggerReview.error instanceof Error ? triggerReview.error.message : 'Could not run the review.'}
          </p>
        )}
        <button
          onClick={() => triggerReview.mutate({ leadId: lead.id })}
          disabled={triggerReview.isPending}
          className={`${TOUCH} w-full rounded-xl bg-indigo-600 px-4 font-medium text-white disabled:opacity-50`}
        >
          {triggerReview.isPending ? 'Running…' : 'Run AI review'}
        </button>
      </div>
    )
  }

  // ── Review exists but carries no quotable figures ─────────────────────
  if (!hasMoney && s?.sayability !== 'hold') {
    return (
      <div className="m-3 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          No quotable number yet
        </p>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          This review was written before pricing was captured as figures. Re-run it to get a
          target and floor.
        </p>
        {triggerReview.isError && (
          <p className="mb-2 text-sm text-red-600 dark:text-red-400">
            {triggerReview.error instanceof Error ? triggerReview.error.message : 'Could not re-run the review.'}
          </p>
        )}
        <button
          onClick={() => triggerReview.mutate({ leadId: lead.id })}
          disabled={triggerReview.isPending}
          className={`${TOUCH} mb-3 w-full rounded-xl bg-indigo-600 px-4 font-medium text-white disabled:opacity-50`}
        >
          {triggerReview.isPending ? 'Re-running…' : 'Re-run AI review'}
        </button>
        <CallRow lead={lead} />
      </div>
    )
  }

  const isHold = s?.sayability === 'hold'
  // Only an explicit 'ready' earns the green badge. A null sayability is the
  // model declining to judge — the prompt tells it to emit null for anything it
  // cannot state confidently — so an abstention must never be presented as the
  // most confident claim on the card. It falls through to the cautious tone.
  const isReady = s?.sayability === 'ready'

  const headTone = isHold
    ? 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'
    : isReady
      ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
      : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'

  const headLabel = isHold
    ? 'Hold — scope not firm'
    : isReady
      ? 'Ready to quote'
      : s?.sayability === 'confirm_first'
        ? 'Confirm first'
        : 'Check before quoting'

  return (
    <div className="m-3 overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <div className={`px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider ${headTone}`}>
        {headLabel}
      </div>

      {/* The range is deliberately suppressed on hold — showing one invites
          quoting it when the model judged the scope too unresolved to price. */}
      {!isHold && hasMoney && (
        <div className="flex flex-wrap items-baseline justify-between gap-3 px-4 pt-4">
          <p className="text-3xl font-bold tabular-nums tracking-tight text-gray-900 dark:text-white">
            {money(s!.target_low!)}–{money(s!.target_high!)}
          </p>
          <p className="text-right text-xs text-gray-500 dark:text-gray-400">
            floor
            <span className="block text-base font-semibold tabular-nums text-red-600 dark:text-red-400">
              {money(s!.floor!)}
            </span>
          </p>
        </div>
      )}

      {s?.band_reason && (
        <p className="px-4 pb-1 pt-2 text-xs text-gray-500 dark:text-gray-400">
          {isHold ? s.band_reason : <><span className="font-medium">{s.band_position ?? 'mid'}-band</span> · {s.band_reason}</>}
        </p>
      )}

      <div className="space-y-2 p-4 pt-3">
        {!isHold && s?.range_levers?.map((lever, i) => <Lever key={`${lever.factor}-${i}`} lever={lever} />)}

        {!isHold && s?.floor_defense && hasMoney && (
          <div className="rounded-xl border-l-[3px] border-red-500 bg-red-50 p-3 dark:bg-red-900/20">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-red-700 dark:text-red-400">
              If they push back
            </p>
            <p className="text-sm text-gray-700 dark:text-gray-200">
              {s.floor_defense} Floor {money(s.floor!)}.
            </p>
          </div>
        )}

        <CallRow lead={lead} />
      </div>
    </div>
  )
}
