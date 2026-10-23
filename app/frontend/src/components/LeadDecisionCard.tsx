import { useTriggerAiReview } from '../hooks/useLeads'
import type { AiReview, Lead, RangeLever } from '../types/lead'

/** 44px minimum — this surface is phone-first (Rule 013). */
const TOUCH = 'min-h-[44px]'

const PHONE_ICON = 'M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z'

/** The strong-bordered box every non-decision state sits in. */
const BOX = 'wd-box mx-3.5 mt-3.5'

function money(value: number): string {
  return `$${value.toLocaleString('en-US')}`
}

function CallRow({ lead }: { lead: Lead }) {
  const phone = lead.contact_phone ?? lead.customer_phone
  const name = lead.customer_name?.split(' ')[0] ?? 'customer'

  if (!phone) {
    return (
      <div className={`${TOUCH} flex items-center justify-center rounded-card bg-bg px-4 text-center text-sm text-mu`}>
        No number yet — reply on Thumbtack to reveal it
      </div>
    )
  }

  return (
    <div className="wd-call">
      <a href={`tel:${phone}`} className="wd-btn">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d={PHONE_ICON} /></svg>
        Call {name}
      </a>
      <a href={`sms:${phone}`} className="wd-btn wd-btn-ghost">
        Text
      </a>
    </div>
  )
}

function Lever({ lever, picked, onPick }: {
  lever: RangeLever
  picked?: number | null
  /** Set the quote to this price. Absent = the prices are read-only. */
  onPick?: (price: number) => void
}) {
  const choices: [string, number][] = [[lever.low_answer, lever.low_price], [lever.high_answer, lever.high_price]]
  return (
    <div className="wd-lev">
      <p className="wd-lev-l">{lever.factor} decides it</p>
      <div className="wd-lev-g">
        {choices.map(([answer, price]) =>
          onPick ? (
            <button
              key={answer}
              type="button"
              className="wd-lev-c"
              aria-label={`${answer} ${money(price)}`}
              aria-pressed={picked === price}
              onClick={() => onPick(price)}
            >
              <span>{answer}</span>
              <b className="tabular-nums">{money(price)}</b>
            </button>
          ) : (
            <div key={answer} className="wd-lev-c">
              <span>{answer}</span>
              <b className="tabular-nums">{money(price)}</b>
            </div>
          ),
        )}
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
  pickedPrice,
  onPickPrice,
}: {
  lead: Lead
  /** `null` means the query resolved and the lead has never been reviewed. */
  aiReview: AiReview | null | undefined
  /** The review GET is in flight. Distinct from "there is no review". */
  reviewLoading?: boolean
  /** The review GET failed. Also distinct from "there is no review". */
  reviewError?: boolean
  /** Refetch the review query. Never triggers a new model call. */
  onRetryLoad?: () => void
  /** The quote currently in the draft, so the matching price button shows as chosen. */
  pickedPrice?: number | null
  /** One tap on a lever price sets the quote to it. */
  onPickPrice?: (price: number) => void
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
      <div className={BOX} aria-busy="true">
        <div className="wd-skel mb-3 h-3 w-32" />
        <div className="wd-skel mb-3 h-9 w-48" />
        <p className="text-sm text-mu">Loading review…</p>
      </div>
    )
  }

  // ── The review failed to load ─────────────────────────────────────────
  // A never-reviewed lead is NOT a fault: the backend answers 404 for it and
  // `getLatestAiReview` resolves that to null, so it never reaches here. Only
  // a real fault does, and this lead may well already have a validated floor.
  // Do not offer to overwrite it — offer to read it again.
  if (reviewError && !aiReview) {
    return (
      <div className={BOX}>
        <p className="wd-fl !text-danger">Review not loaded</p>
        <p className="mb-3 text-sm text-mu">
          Could not reach the server to load this lead's AI review. If one exists it is still
          there — this is a connection fault, not a missing review.
        </p>
        {onRetryLoad && (
          <button onClick={onRetryLoad} className="wd-btn wd-btn-ghost mb-3 w-full">
            Retry
          </button>
        )}
        <CallRow lead={lead} />
      </div>
    )
  }

  // ── The query resolved and there is genuinely no review ───────────────
  // Reached by a never-reviewed lead (resolved null). The trigger lives here.
  if (!aiReview) {
    return (
      <div className={BOX}>
        <p className="wd-fl">AI review</p>
        <p className="mb-3 text-sm text-mu">No AI review yet for this lead.</p>
        {triggerReview.isError && (
          <p className="wd-err mb-2">
            {triggerReview.error instanceof Error ? triggerReview.error.message : 'Could not run the review.'}
          </p>
        )}
        <button
          onClick={() => triggerReview.mutate({ leadId: lead.id })}
          disabled={triggerReview.isPending}
          className="wd-btn wd-btn-amber w-full"
        >
          {triggerReview.isPending ? 'Running…' : 'Run AI review'}
        </button>
      </div>
    )
  }

  // ── Review exists but carries no quotable figures ─────────────────────
  if (!hasMoney && s?.sayability !== 'hold') {
    return (
      <div className={BOX}>
        <p className="wd-fl">No quotable number yet</p>
        <p className="mb-3 text-sm text-mu">
          This review was written before pricing was captured as figures. Re-run it to get a
          target and floor.
        </p>
        {triggerReview.isError && (
          <p className="wd-err mb-2">
            {triggerReview.error instanceof Error ? triggerReview.error.message : 'Could not re-run the review.'}
          </p>
        )}
        <button
          onClick={() => triggerReview.mutate({ leadId: lead.id })}
          disabled={triggerReview.isPending}
          className="wd-btn wd-btn-amber mb-3 w-full"
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
    ? 'bg-mu'
    : isReady
      ? 'bg-pr'
      : 'bg-ac !text-[#161512]'

  const headLabel = isHold
    ? 'Hold — scope not firm'
    : isReady
      ? 'Ready to quote'
      : s?.sayability === 'confirm_first'
        ? 'Confirm first'
        : 'Check before quoting'

  return (
    <div className={`${BOX} wd-dc`}>
      <div className={`wd-dc-h ${headTone}`}>
        <span>{headLabel}</span>
        <span>AI review</span>
      </div>

      <div className="wd-dc-b">
        {/* The range is deliberately suppressed on hold — showing one invites
            quoting it when the model judged the scope too unresolved to price. */}
        {!isHold && hasMoney && (
          <div className="flex flex-wrap items-end justify-between gap-3">
            <p className="wd-dc-n">
              {money(s!.target_low!)}–{money(s!.target_high!)}
            </p>
            <p className="wd-dc-f">
              floor
              <b className="tabular-nums">{money(s!.floor!)}</b>
            </p>
          </div>
        )}

        {s?.band_reason && (
          <p className="wd-dc-why">
            {isHold ? s.band_reason : <><b>{s.band_position ?? 'mid'}-band</b> · {s.band_reason}</>}
          </p>
        )}

        {!isHold && s?.range_levers?.map((lever, i) => <Lever key={`${lever.factor}-${i}`} lever={lever} picked={pickedPrice} onPick={onPickPrice} />)}

        {!isHold && s?.floor_defense && hasMoney && (
          <div className="wd-push">
            <p className="wd-push-l">If they push back</p>
            <p>{s.floor_defense} Floor {money(s.floor!)}.</p>
          </div>
        )}

        <CallRow lead={lead} />
      </div>
    </div>
  )
}
