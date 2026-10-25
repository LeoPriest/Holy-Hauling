import { useState } from 'react'
import type { Lead } from '../types/lead'

const isThumbtack = (s?: string | null) => !!s && s.startsWith('thumbtack')

function CallText({ phone }: { phone: string }) {
  return (
    <div className="flex shrink-0 gap-1">
      <a href={`tel:${phone}`} className="wd-btn-sm">Call</a>
      <a href={`sms:${phone}`} className="wd-btn-sm wd-btn-ghost">Text</a>
    </div>
  )
}

function NumberSaver({ label, placeholder, initial = '', onSave, onCancel }: {
  label: string; placeholder: string; initial?: string; onSave: (v: string) => void; onCancel?: () => void
}) {
  const [v, setV] = useState(initial)
  return (
    <div className="flex items-center gap-2">
      <input
        value={v}
        onChange={e => setV(e.target.value)}
        inputMode="tel"
        placeholder={placeholder}
        className="wd-input min-w-0 flex-1"
        aria-label={label}
      />
      <button type="button" onClick={() => { if (v.trim()) onSave(v.trim()) }} disabled={!v.trim()}
        className="wd-btn-sm shrink-0">Save</button>
      {onCancel && (
        <button type="button" onClick={onCancel}
          className="wd-btn-sm wd-btn-ghost shrink-0">Cancel</button>
      )}
    </div>
  )
}

function EditLink({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="wd-btn-sm wd-btn-ghost min-w-11 !shadow-none !px-2 text-mu">Edit</button>
  )
}

export function LeadContact({ lead, save }: { lead: Lead; save: (field: string, value: string) => void }) {
  const tt = isThumbtack(lead.source_type)
  const hasContact = !!lead.contact_phone
  const real = lead.customer_real_phone
  const proxy = lead.customer_phone
  const [editing, setEditing] = useState<null | 'phone' | 'real'>(null)

  return (
    <div className="space-y-2">
      {/* Needs a number: Thumbtack lead, nothing usable yet */}
      {tt && !hasContact && (
        <div className="space-y-2">
          <div className="rounded-chip bg-bg px-3 py-2 text-xs shadow-[inset_0_0_0_1.5px_var(--ac)]">
            ⚠ <b>Reply on Thumbtack to get the customer's number</b> — it's hidden until you respond. Once it shows, add it here.
          </div>
          <NumberSaver label="Customer number" placeholder="Customer's number (once revealed)…" onSave={v => save('customer_phone', v)} />
        </div>
      )}

      {/* Real number row → Primary */}
      {real && editing !== 'real' && (
        <div className="rounded-chip bg-bg p-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold tabular-nums">{real}</span>
            <span className="wd-flag wd-flag-amber">Primary</span>
            <span className="wd-flag">Real #</span>
            <EditLink onClick={() => setEditing('real')} />
            <div className="ml-auto"><CallText phone={real} /></div>
          </div>
        </div>
      )}
      {editing === 'real' && (
        <NumberSaver label="Real number" placeholder="Customer's real number…" initial={real ?? ''}
          onSave={v => { save('customer_real_phone', v); setEditing(null) }} onCancel={() => setEditing(null)} />
      )}

      {/* customer_phone row (proxy or plain) */}
      {proxy && editing !== 'phone' && (
        <div className="rounded-chip bg-bg p-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`tabular-nums ${real ? 'text-sm text-mu' : 'font-semibold'}`}>{proxy}</span>
            {lead.customer_phone_is_proxy && (
              <span className="wd-flag">Thumbtack line</span>
            )}
            <EditLink onClick={() => setEditing('phone')} />
            {!real && <div className="ml-auto"><CallText phone={proxy} /></div>}
          </div>
          {lead.customer_phone_is_proxy && (
            <p className="wd-hint">Routes to the customer through Thumbtack — may stop working after the job.</p>
          )}
        </div>
      )}
      {editing === 'phone' && (
        <NumberSaver label="Customer number" placeholder="Customer's number…" initial={proxy ?? ''}
          onSave={v => { save('customer_phone', v); setEditing(null) }} onCancel={() => setEditing(null)} />
      )}

      {/* Add the real number once a proxy/number exists */}
      {hasContact && !real && (
        <NumberSaver label="Real number" placeholder="Customer's real number…" onSave={v => save('customer_real_phone', v)} />
      )}
    </div>
  )
}
