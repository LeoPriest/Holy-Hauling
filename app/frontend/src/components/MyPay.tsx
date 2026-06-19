import { useMyPay } from '../hooks/useMyPay'
import type { MyPayEntry } from '../services/api'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

const PAY_TYPE_LABEL: Record<MyPayEntry['pay_type'], string> = {
  hourly: 'Hourly',
  flat: 'Flat',
  facilitator_pct: 'Percentage',
}

function PayDate({ iso }: { iso: string | null }) {
  if (!iso) {
    return <div className="w-11 text-center text-gray-400 dark:text-gray-500">—</div>
  }
  const [, m, d] = iso.split('-').map(Number)
  return (
    <div className="w-11 text-center">
      <div className="text-lg font-bold leading-none text-gray-900 dark:text-white">{d}</div>
      <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {MONTHS[(m ?? 1) - 1]}
      </div>
    </div>
  )
}

function PayRow({ entry }: { entry: MyPayEntry }) {
  return (
    <div className="flex min-h-11 items-center gap-3 border-t border-gray-100 px-3 py-2 first:border-t-0 dark:border-gray-700">
      <PayDate iso={entry.job_date} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-gray-900 dark:text-white">
          {entry.customer_name ?? 'Unknown customer'}
        </div>
        <div className="mt-0.5">
          <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:bg-gray-700 dark:text-gray-300">
            {PAY_TYPE_LABEL[entry.pay_type]}
          </span>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="font-bold text-gray-900 dark:text-white">{fmtMoney(entry.amount_cents)}</div>
        <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          {entry.hours_worked != null ? `${entry.hours_worked} hrs` : '— no hrs'}
        </div>
      </div>
    </div>
  )
}

export function MyPay() {
  const { data, isLoading, isError } = useMyPay()

  if (isLoading) {
    return <div className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">Loading…</div>
  }
  if (isError || !data) {
    return <div className="py-6 text-center text-sm text-amber-600 dark:text-amber-400">Couldn't load your pay.</div>
  }

  const hours = Number.isInteger(data.total_hours) ? data.total_hours : data.total_hours.toFixed(1)

  return (
    <div>
      <div className="rounded-xl border border-gray-200 bg-gradient-to-br from-emerald-50 to-white p-4 dark:border-gray-700 dark:from-gray-800 dark:to-gray-800">
        <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Total earned</div>
        <div className="mt-1 text-3xl font-extrabold text-emerald-600 dark:text-emerald-400">
          {fmtMoney(data.total_earnings_cents)}
        </div>
        <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          <span className="font-semibold text-gray-700 dark:text-gray-200">{hours}</span> hrs logged
          <span className="px-2 opacity-40">•</span>
          <span className="font-semibold text-gray-700 dark:text-gray-200">{data.job_count}</span>{' '}
          {data.job_count === 1 ? 'job' : 'jobs'}
        </div>
      </div>

      {data.entries.length === 0 ? (
        <div className="mt-3 rounded-xl border border-gray-200 py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          No pay recorded yet.
          <br />
          Completed jobs with pay will show up here.
        </div>
      ) : (
        <div className="mt-3 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
          {data.entries.map((e) => (
            <PayRow key={e.lead_id} entry={e} />
          ))}
        </div>
      )}
    </div>
  )
}
