import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BottomNav } from '../components/BottomNav'
import { useCities } from '../hooks/useCities'
import {
  useCreateThumbtackConnection,
  useDeleteThumbtackConnection,
  useRetryThumbtackEvent,
  useSetThumbtackConnectionActive,
  useThumbtackConnections,
  useThumbtackEvents,
} from '../hooks/useThumbtack'
import type {
  ThumbtackBusiness,
  ThumbtackConnection,
  ThumbtackConnectionCreated,
} from '../types/thumbtack'
import { parseUtc } from '../utils/time'
import { ScreenHeader } from '../components/ScreenHeader'
import { Working } from '../components/Logo'

const BUSINESSES: { value: ThumbtackBusiness; label: string }[] = [
  { value: 'holy_hauling', label: 'Holy Hauling' },
  { value: 'holy_handy', label: 'Holy Handy' },
]

// 44px minimum touch target — tablet is the primary surface.
const TOUCH = 'min-h-[44px]'

// A connection that has gone quiet for this long is worth flagging, not a green dot.
const STALE_AFTER_MS = 48 * 60 * 60 * 1000

/** Milliseconds since an API timestamp, or null if absent or unparseable. */
function msSince(iso: string | null): number | null {
  if (!iso) return null
  // parseUtc, not new Date: the backend serializes naive UTC with no Z, so a raw
  // Date() reads it as local time and every event looks like it arrived in the future.
  const then = parseUtc(iso).getTime()
  if (!Number.isFinite(then)) return null
  return Date.now() - then
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'never'
  const elapsed = msSince(iso)
  if (elapsed === null) return 'unknown'
  const mins = Math.floor(elapsed / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="space-y-1">
      <p className="wd-label">{label}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded-chip bg-bg px-3 py-2 text-xs text-ink">
          {value}
        </code>
        <button
          onClick={() => {
            void navigator.clipboard.writeText(value)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          }}
          className={`${TOUCH} shrink-0 rounded-chip bg-ln px-4 text-sm font-medium text-ink  `}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}

export function AdminThumbtackScreen() {
  const navigate = useNavigate()
  const { data: cities = [] } = useCities()
  const { data: connections = [], isLoading } = useThumbtackConnections()
  const createConnection = useCreateThumbtackConnection()

  const [label, setLabel] = useState('')
  const [cityId, setCityId] = useState('')
  const [business, setBusiness] = useState<ThumbtackBusiness>('holy_hauling')
  const [error, setError] = useState('')
  const [created, setCreated] = useState<ThumbtackConnectionCreated | null>(null)

  const effectiveCityId = cityId || cities[0]?.id || ''

  async function handleCreate() {
    setError('')
    try {
      const result = await createConnection.mutateAsync({
        label: label.trim(),
        city_id: effectiveCityId,
        business,
      })
      setCreated(result)
      setLabel('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create connection')
    }
  }

  return (
    <div className="min-h-screen bg-bg pb-16">
      <ScreenHeader title="Thumbtack" onBack={() => navigate('/admin')} />

      <main className="space-y-4 p-4 pb-12">
        <section className="rounded-card border bg-sf p-4 text-sm text-mu">
          <p>
            Create a connection here, then paste its URL and credentials into{' '}
            <span className="font-medium">thumbtack.com/pro/webhooks/create</span>. Tick
            Lead details and Messages, and choose the matching business profile.
          </p>
          <p className="mt-2">
            One connection per city. Leads from a connection are treated as belonging to
            that city.
          </p>
        </section>

        <section className="rounded-card border bg-sf p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-mu">
            Add connection
          </h2>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <input
              className={`${TOUCH} rounded-chip border px-3 text-sm text-ink   `}
              placeholder="Label, e.g. Holy Hauling — St. Louis"
              value={label}
              onChange={event => setLabel(event.target.value)}
            />
            <select
              className={`${TOUCH} rounded-chip border px-3 text-sm text-ink   `}
              value={effectiveCityId}
              onChange={event => setCityId(event.target.value)}
            >
              {cities.map(city => (
                <option key={city.id} value={city.id}>{city.name}</option>
              ))}
            </select>
            <select
              className={`${TOUCH} rounded-chip border px-3 text-sm text-ink   `}
              value={business}
              onChange={event => setBusiness(event.target.value as ThumbtackBusiness)}
            >
              {BUSINESSES.map(b => (
                <option key={b.value} value={b.value}>{b.label}</option>
              ))}
            </select>
            <button
              onClick={() => void handleCreate()}
              disabled={!label.trim() || !effectiveCityId || createConnection.isPending}
              className={`${TOUCH} rounded-chip bg-pr px-4 text-sm font-medium text-white disabled:opacity-40`}
            >
              {createConnection.isPending ? 'Creating…' : 'Create'}
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        </section>

        {created && (
          <section className="space-y-3 rounded-card border-2 border-ac bg-bg p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-[#b86e00]">
                  Paste these into Thumbtack now
                </h2>
                <p className="mt-1 text-xs text-[#b86e00]">
                  The password is shown once and cannot be retrieved. If you lose it,
                  delete this connection and create another.
                </p>
              </div>
              <button
                onClick={() => setCreated(null)}
                className={`${TOUCH} shrink-0 rounded-chip px-3 text-sm font-medium text-[#b86e00] `}
              >
                Done
              </button>
            </div>
            <CopyRow label="Endpoint URL" value={created.webhook_url} />
            <CopyRow label="Username" value={created.auth_username ?? ''} />
            <CopyRow label="Password" value={created.auth_secret} />
          </section>
        )}

        <section className="space-y-3">
          {isLoading && <Working label="Loading connections…" />}
          {!isLoading && connections.length === 0 && (
            <p className="py-8 text-center text-sm text-mu">
              No connections yet. Create one above to start receiving Thumbtack leads.
            </p>
          )}
          {connections.map(conn => (
            <ConnectionRow key={conn.id} conn={conn} />
          ))}
        </section>

        <EventsFeed />
      </main>
      <BottomNav />
    </div>
  )
}

function ConnectionRow({ conn }: { conn: ThumbtackConnection }) {
  const setActive = useSetThumbtackConnectionActive()
  const deleteConnection = useDeleteThumbtackConnection()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [error, setError] = useState('')

  // Derived from recency, not from "has ever delivered" — a webhook that stopped
  // delivering has to become visible, which a latching green dot never does.
  const sinceEvent = msSince(conn.last_event_at)
  const sinceError = msSince(conn.last_error_at)
  const failing = sinceError !== null && (sinceEvent === null || sinceError < sinceEvent)

  let dot = 'bg-mu'
  let notice: string | null = null
  if (conn.is_active) {
    if (failing) {
      dot = 'bg-danger'
      notice = `Deliveries are arriving but failing — last error ${relativeTime(
        conn.last_error_at,
      )}.`
    } else if (sinceEvent === null) {
      dot = 'bg-ac'
      notice = 'Nothing received yet. Check the URL is saved and enabled in Thumbtack.'
    } else if (sinceEvent > STALE_AFTER_MS) {
      dot = 'bg-ac'
      notice = `Last received ${relativeTime(conn.last_event_at)} — check Thumbtack.`
    } else {
      dot = 'bg-pr'
    }
  }

  async function run(action: () => Promise<unknown>, fallback: string) {
    setError('')
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback)
    }
  }

  return (
    <div
      className={`rounded-card border bg-sf p-4   ${
        conn.is_active ? '' : 'opacity-60'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={`h-3 w-3 shrink-0 rounded-full ${dot}`} />
          <div>
            <p className="font-medium text-ink">{conn.label}</p>
            <p className="text-xs text-mu">
              {conn.business === 'holy_hauling' ? 'Holy Hauling' : 'Holy Handy'} ·{' '}
              {conn.city_id} · last received {relativeTime(conn.last_event_at)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() =>
              void run(
                () => setActive.mutateAsync({ id: conn.id, isActive: !conn.is_active }),
                'Failed to update connection',
              )
            }
            disabled={setActive.isPending}
            // min-w so the row does not reflow mid-action and slide Delete under
            // the finger. Tablet is the primary surface.
            className={`${TOUCH} min-w-[104px] rounded-chip bg-ln px-4 text-sm font-medium text-ink disabled:opacity-40  `}
          >
            {setActive.isPending ? '…' : conn.is_active ? 'Disable' : 'Enable'}
          </button>

          {confirmingDelete ? (
            <>
              <button
                onClick={() =>
                  void run(
                    () => deleteConnection.mutateAsync(conn.id),
                    'Failed to delete connection',
                  )
                }
                disabled={deleteConnection.isPending}
                className={`${TOUCH} rounded-chip bg-danger px-4 text-sm font-medium text-white disabled:opacity-40`}
              >
                {deleteConnection.isPending ? 'Deleting…' : 'Confirm delete'}
              </button>
              <button
                onClick={() => setConfirmingDelete(false)}
                className={`${TOUCH} rounded-chip px-3 text-sm font-medium text-mu `}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirmingDelete(true)}
              className={`${TOUCH} rounded-chip px-4 text-sm font-medium text-danger `}
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {notice && (
        <p
          className={`mt-2 text-xs ${
            failing
              ? 'text-danger '
              : 'text-[#b86e00] '
          }`}
        >
          {notice}
        </p>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  )
}

function EventsFeed() {
  const { data: events = [] } = useThumbtackEvents()
  const [expanded, setExpanded] = useState<string | null>(null)
  const retry = useRetryThumbtackEvent()
  // Keyed by event id, not scalar — a single mutation hook is shared across every
  // row, so any single-value "which row is busy / which row just spoke" state gets
  // clobbered the moment a second row is retried before the first settles. An
  // outage that leaves several failed deliveries listed at once is the normal case
  // this button exists for, so working through them concurrently has to be safe.
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set())
  const [retryErrors, setRetryErrors] = useState<Record<string, string>>({})
  const [retrySuccesses, setRetrySuccesses] = useState<Record<string, string>>({})
  // Synchronous guard against a fast double-tap issuing two POSTs for the same row —
  // state updates are batched and re-render before the disabled prop can stop a
  // second click dispatched in the same tick, so the check itself can't rely on state.
  const inFlight = useRef<Set<string>>(new Set())

  if (events.length === 0) return null

  function handleRetry(eventId: string) {
    if (inFlight.current.has(eventId)) return
    inFlight.current.add(eventId)
    setRetryingIds(prev => new Set(prev).add(eventId))
    setRetryErrors(prev => {
      if (!(eventId in prev)) return prev
      const next = { ...prev }
      delete next[eventId]
      return next
    })
    setRetrySuccesses(prev => {
      if (!(eventId in prev)) return prev
      const next = { ...prev }
      delete next[eventId]
      return next
    })
    retry.mutate(eventId, {
      onSuccess: result => {
        // A 200 response is not the same as a delivery that was actually
        // processed: the backend refuses to touch a truncated oversize-rejection
        // body or a non-lead-kind event, and returns the event unchanged — no
        // lead, and the error that explains the refusal still sitting on the
        // row. Reporting that as "Nothing needed doing." reads as a clean
        // no-op right next to the row's own red error, which is exactly the
        // misleading-success shape this screen keeps getting sent back for.
        // Route it into the failure line instead, pointing at that error.
        if (!result.lead_id && result.event.error) {
          setRetryErrors(prev => ({
            ...prev,
            [eventId]: 'Retry did not process this delivery — see the error above.',
          }))
          return
        }
        // Three distinct outcomes on a genuinely successful call — a flat
        // "Retried" hides which one happened, and the operator needs to know
        // whether a new lead now exists.
        const message = result.created
          ? 'Lead created.'
          : result.lead_id
            ? 'Lead already existed — nothing new created.'
            : 'Nothing needed doing.'
        setRetrySuccesses(prev => ({ ...prev, [eventId]: message }))
      },
      onError: err => {
        const message = err instanceof Error ? err.message : 'Retry failed'
        setRetryErrors(prev => ({ ...prev, [eventId]: message }))
      },
      onSettled: () => {
        inFlight.current.delete(eventId)
        setRetryingIds(prev => {
          if (!prev.has(eventId)) return prev
          const next = new Set(prev)
          next.delete(eventId)
          return next
        })
      },
    })
  }

  return (
    <section className="rounded-card border bg-sf p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-mu">
        Recent deliveries
      </h2>
      <div className="space-y-2">
        {events.map(event => (
          <div key={event.id} className="rounded-chip border p-3">
            <button
              onClick={() => setExpanded(expanded === event.id ? null : event.id)}
              className={`${TOUCH} flex w-full items-center justify-between gap-3 text-left`}
            >
              <span className="text-sm text-ink">
                {event.kind}
                {event.external_id ? ` · ${event.external_id}` : ''}
              </span>
              <span className="text-xs text-mu">
                {event.status} · {relativeTime(event.received_at)}
              </span>
            </button>
            {event.error && (
              <p className="mt-1 text-xs text-danger">{event.error}</p>
            )}
            {(event.status === 'failed' ||
              event.error ||
              (event.kind === 'lead' && !event.lead_id)) && (
              <div className="mt-2">
                <button
                  onClick={() => handleRetry(event.id)}
                  disabled={retryingIds.has(event.id)}
                  className={`${TOUCH} rounded-chip bg-pr px-4 text-sm font-medium text-white disabled:opacity-40`}
                >
                  {retryingIds.has(event.id) ? 'Retrying…' : 'Retry'}
                </button>
              </div>
            )}
            {retryErrors[event.id] && (
              <p className="mt-1 text-xs text-danger">
                {retryErrors[event.id]}
              </p>
            )}
            {retrySuccesses[event.id] && (
              <p className="mt-1 text-xs text-ok">
                {retrySuccesses[event.id]}
              </p>
            )}
            {expanded === event.id && (
              <pre className="mt-2 max-h-64 overflow-auto rounded-chip bg-bg p-3 text-xs text-ink">
                {event.raw_body}
              </pre>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
