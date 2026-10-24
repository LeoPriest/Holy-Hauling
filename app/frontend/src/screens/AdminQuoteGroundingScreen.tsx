import { useNavigate } from 'react-router-dom'
import { BottomNav } from '../components/BottomNav'
import { useCity } from '../context/CityContext'
import { useQuoteGroundingEval } from '../hooks/useLeads'
import type { CohortMetrics } from '../services/api'
import { ScreenHeader } from '../components/ScreenHeader'

const MIN_COHORT_N = 10
const MIN_PRICED_N = 5

const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`)

type Better = 'higher' | 'lower' | 'even'

function winnerSide(better: Better, g: number | null, u: number | null, gOk: boolean, uOk: boolean): 'g' | 'u' | null {
  if (g == null || u == null || !gOk || !uOk) return null
  const gv = better === 'even' ? Math.abs(g) : g
  const uv = better === 'even' ? Math.abs(u) : u
  if (gv === uv) return null
  const gWins = better === 'higher' ? gv > uv : gv < uv
  return gWins ? 'g' : 'u'
}

function Side({ label, value, detail, win }: { label: string; value: string; detail: string; win: boolean }) {
  return (
    <div className={`flex-1 p-3 ${label === 'Grounded' ? 'border-r border-ln ' : ''}`}>
      <div className={`text-[10px] font-bold uppercase tracking-wide ${label === 'Grounded' ? 'text-ok ' : 'text-mu'}`}>{label}</div>
      <div className={`mt-0.5 flex items-center gap-1.5 text-2xl font-extrabold tabular-nums ${win ? 'text-ok ' : 'text-ink '}`}>
        {win && <span className="text-sm">✓</span>}{value}
      </div>
      <div className="mt-0.5 text-[11px] text-mu">{detail}</div>
    </div>
  )
}

function MetricCard({ name, explain, hint, better, gVal, uVal, gOk, uOk, gDetail, uDetail }: {
  name: string; explain: string; hint: string; better: Better
  gVal: number | null; uVal: number | null; gOk: boolean; uOk: boolean
  gDetail: string; uDetail: string
}) {
  const win = winnerSide(better, gVal, uVal, gOk, uOk)
  return (
    <div className="rounded-card border border-ln bg-sf">
      <div className="flex items-baseline gap-2 px-4 pt-3">
        <span className="text-sm font-bold text-ink">{name}</span>
        <span className="ml-auto text-[10.5px] text-mu">{hint}</span>
      </div>
      <p className="px-4 pb-2 pt-0.5 text-xs leading-snug text-mu">{explain}</p>
      <div className="flex border-t border-ln">
        <Side label="Grounded" value={pct(gVal)} detail={gDetail} win={win === 'g'} />
        <Side label="SOP-only" value={pct(uVal)} detail={uDetail} win={win === 'u'} />
      </div>
    </div>
  )
}

function Takeaway({ grounded, ungrounded }: { grounded: CohortMetrics; ungrounded: CohortMetrics }) {
  const enough = grounded.n >= MIN_COHORT_N && ungrounded.n >= MIN_COHORT_N
  if (!enough) {
    return (
      <div className="rounded-card border border-ac bg-bg p-4">
        <div className="text-[10px] font-bold uppercase tracking-wide text-[#b86e00]">⏳ Too early to tell</div>
        <div className="mt-1 font-bold text-ink">Keep quoting — this sharpens as jobs finish.</div>
        <p className="mt-1 text-xs text-[#b86e00]">Need about {MIN_COHORT_N} finished quotes in each group before the comparison means anything. Counts below show it filling in.</p>
      </div>
    )
  }
  const gw = grounded.win_rate ?? 0, uw = ungrounded.win_rate ?? 0
  const helping = gw > uw
  return (
    <div className={`rounded-card border p-4 ${helping ? 'border-ln bg-tint' : 'border-ln bg-sf'}`}>
      <div className={`text-[10px] font-bold uppercase tracking-wide ${helping ? 'text-ok ' : 'text-mu'}`}>◎ Takeaway</div>
      <div className="mt-1 font-bold text-ink">
        {helping ? 'Grounded quotes are landing more.' : 'Grounding isn’t pulling ahead on win rate yet.'}
      </div>
      <p className="mt-1 text-xs text-mu">
        {helping
          ? 'Keep leaning on the “What this quote is based on” comparables when they’re there — they’re outperforming SOP-only quotes.'
          : 'Grounded quotes aren’t winning more than SOP-only so far. Worth watching as more jobs finish.'}
      </p>
    </div>
  )
}

export function AdminQuoteGroundingScreen() {
  const navigate = useNavigate()
  const { cityQueryId } = useCity()
  const { data, isLoading, isError } = useQuoteGroundingEval(cityQueryId ?? null)

  return (
    <div className="min-h-screen bg-bg pb-20">
      <ScreenHeader title="Quote grounding" onBack={() => navigate(-1)} />

      <div className="space-y-3 p-4">
        <p className="text-xs leading-relaxed text-mu">
          When the AI drafts a quote it either anchors on <b className="text-ink">similar past jobs</b> (“grounded”) or falls back to the SOP only. This compares how those two groups actually turn out.
        </p>

        {isLoading && <p className="py-8 text-center text-sm text-mu">Loading…</p>}
        {isError && <p className="py-8 text-center text-sm text-[#b86e00]">Couldn’t load the grounding stats.</p>}

        {data && (data.grounded.n === 0 && data.ungrounded.n === 0) && (
          <p className="rounded-card border border-ln py-8 text-center text-sm text-mu">
            No finished quotes yet — this fills in as jobs are won or lost.
          </p>
        )}

        {data && (data.grounded.n > 0 || data.ungrounded.n > 0) && (() => {
          const g = data.grounded, u = data.ungrounded
          const gWinOk = g.n >= MIN_COHORT_N, uWinOk = u.n >= MIN_COHORT_N
          const gPriceOk = g.priced_n >= MIN_PRICED_N, uPriceOk = u.priced_n >= MIN_PRICED_N
          const biasDetail = (m: CohortMetrics) => m.pricing_bias == null ? `${m.priced_n} jobs` : (m.pricing_bias < 0 ? 'under-quoting' : 'over-quoting')
          return (
            <>
              <Takeaway grounded={g} ungrounded={u} />
              <MetricCard name="Win rate" hint="higher is better" better="higher"
                explain="Of quotes that finished, how many became booked jobs."
                gVal={g.win_rate} uVal={u.win_rate} gOk={gWinOk} uOk={uWinOk}
                gDetail={`won ${g.won} · lost ${g.lost}`} uDetail={`won ${u.won} · lost ${u.lost}`} />
              <MetricCard name="Pricing accuracy" hint="lower error is tighter" better="lower"
                explain="On won jobs, how far the quote was from what the job actually brought in. Lower = closer to reality."
                gVal={g.pricing_accuracy} uVal={u.pricing_accuracy} gOk={gPriceOk} uOk={uPriceOk}
                gDetail={`off, avg · ${g.priced_n} jobs`} uDetail={`off, avg · ${u.priced_n} jobs`} />
              <MetricCard name="Over / under" hint="closer to even is better" better="even"
                explain="Do you tend to quote too low (leaving money on the table) or too high? Near 0 = balanced."
                gVal={g.pricing_bias} uVal={u.pricing_bias} gOk={gPriceOk} uOk={uPriceOk}
                gDetail={biasDetail(g)} uDetail={biasDetail(u)} />
              <p className="text-[11px] leading-relaxed text-mu">
                <b>Grounded</b> = anchored on comparable local jobs · <b>SOP-only</b> = no comparables were available yet. Win rate = won ÷ (won+lost); pricing is measured against realized revenue on won jobs. No “winner” marks until both groups clear the sample threshold.
              </p>
            </>
          )
        })()}
      </div>
      <BottomNav />
    </div>
  )
}
