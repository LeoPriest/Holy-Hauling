import { useState } from 'react'
import type { Lead } from '../types/lead'

const isThumbtack = (s?: string | null) => !!s && s.startsWith('thumbtack')

function CallText({ phone }: { phone: string }) {
  return (
    <div className="flex shrink-0 gap-1">
      <a href={`tel:${phone}`} className="min-h-11 flex items-center rounded-lg bg-green-600 px-3 text-xs font-medium text-white hover:bg-green-700">Call</a>
      <a href={`sms:${phone}`} className="min-h-11 flex items-center rounded-lg bg-blue-600 px-3 text-xs font-medium text-white hover:bg-blue-700">Text</a>
    </div>
  )
}

function NumberSaver({ label, placeholder, onSave }: { label: string; placeholder: string; onSave: (v: string) => void }) {
  const [v, setV] = useState('')
  return (
    <div className="flex items-center gap-2">
      <input
        value={v}
        onChange={e => setV(e.target.value)}
        inputMode="tel"
        placeholder={placeholder}
        className="min-h-11 flex-1 rounded-lg border border-gray-200 bg-white px-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        aria-label={label}
      />
      <button type="button" onClick={() => { if (v.trim()) onSave(v.trim()) }} disabled={!v.trim()}
        className="min-h-11 rounded-lg bg-emerald-500 px-4 text-sm font-semibold text-white disabled:opacity-40">Save</button>
    </div>
  )
}

export function LeadContact({ lead, save }: { lead: Lead; save: (field: string, value: string) => void }) {
  const tt = isThumbtack(lead.source_type)
  const hasContact = !!lead.contact_phone
  const real = lead.customer_real_phone
  const proxy = lead.customer_phone

  return (
    <div className="space-y-2">
      {tt && !hasContact && (
        <div className="space-y-2">
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
            ⚠ <b>Reply on Thumbtack to get the customer's number</b> — it's hidden until you respond. Once it shows, add it here.
          </div>
          <NumberSaver label="Customer number" placeholder="Customer's number (once revealed)…" onSave={v => save('customer_phone', v)} />
        </div>
      )}

      {real && (
        <div className="rounded-lg border border-gray-200 p-2 dark:border-gray-700">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold tabular-nums">{real}</span>
            <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-950">Primary</span>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">Real #</span>
            <div className="ml-auto"><CallText phone={real} /></div>
          </div>
        </div>
      )}

      {proxy && (
        <div className="rounded-lg border border-gray-200 p-2 dark:border-gray-700">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`tabular-nums ${real ? 'text-sm text-gray-500 dark:text-gray-400' : 'font-semibold'}`}>{proxy}</span>
            {lead.customer_phone_is_proxy && (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-blue-700 dark:bg-blue-900/40 dark:text-blue-200">Thumbtack line</span>
            )}
            {!real && <div className="ml-auto"><CallText phone={proxy} /></div>}
          </div>
          {lead.customer_phone_is_proxy && (
            <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">Routes to the customer through Thumbtack — may stop working after the job.</p>
          )}
        </div>
      )}

      {hasContact && !real && (
        <NumberSaver label="Real number" placeholder="Customer's real number…" onSave={v => save('customer_real_phone', v)} />
      )}
    </div>
  )
}
