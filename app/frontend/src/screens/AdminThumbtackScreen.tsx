import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BottomNav } from '../components/BottomNav'
import { useCities } from '../hooks/useCities'
import {
  useCreateThumbtackConnection,
  useDeleteThumbtackConnection,
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
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-800 dark:bg-gray-900 dark:text-gray-200">
          {value}
        </code>
        <button
          onClick={() => {
            void navigator.clipboard.writeText(value)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          }}
          className={`${TOUCH} shrink-0 rounded-lg bg-gray-200 px-4 text-sm font-medium text-gray-800 dark:bg-gray-700 dark:text-gray-100`}
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
    <div className="min-h-screen bg-gray-50 pb-16 dark:bg-gray-900">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
        <button
          onClick={() => navigate('/admin')}
          className={`${TOUCH} text-sm font-medium text-gray-500 dark:text-gray-400`}
        >
          Back
        </button>
        <h1 className="text-lg font-bold text-gray-900 dark:text-white">Thumbtack</h1>
      </header>

      <main className="space-y-4 p-4 pb-12">
        <section className="rounded-xl border bg-white p-4 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
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

        <section className="rounded-xl border bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
            Add connection
          </h2>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <input
              className={`${TOUCH} rounded-lg border px-3 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white`}
              placeholder="Label, e.g. Holy Hauling — St. Louis"
              value={label}
              onChange={event => setLabel(event.target.value)}
            />
            <select
              className={`${TOUCH} rounded-lg border px-3 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white`}
              value={effectiveCityId}
              onChange={event => setCityId(event.target.value)}
            >
              {cities.map(city => (
                <option key={city.id} value={city.id}>{city.name}</option>
              ))}
            </select>
            <select
              className={`${TOUCH} rounded-lg border px-3 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white`}
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
              className={`${TOUCH} rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white disabled:opacity-40`}
            >
              {createConnection.isPending ? 'Creating…' : 'Create'}
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        </section>

        {created && (
          <section className="space-y-3 rounded-xl border-2 border-amber-400 bg-amber-50 p-4 dark:border-amber-500 dark:bg-amber-900/20">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-amber-900 dark:text-amber-200">
                  Paste these into Thumbtack now
                </h2>
                <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                  The password is shown once and cannot be retrieved. If you lose it,
                  delete this connection and create another.
                </p>
              </div>
              <button
                onClick={() => setCreated(null)}
                className={`${TOUCH} shrink-0 rounded-lg px-3 text-sm font-medium text-amber-900 dark:text-amber-200`}
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
          {isLoading && <p className="py-8 text-center text-sm text-gray-400">Loading…</p>}
          {!isLoading && connections.length === 0 && (
            <p className="py-8 text-center text-sm text-gray-400">
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

  let dot = 'bg-gray-400'
  let notice: string | null = null
  if (conn.is_active) {
    if (failing) {
      dot = 'bg-red-500'
      notice = `Deliveries are arriving but failing — last error ${relativeTime(
        conn.last_error_at,
      )}.`
    } else if (sinceEvent === null) {
      dot = 'bg-amber-400'
      notice = 'Nothing received yet. Check the URL is saved and enabled in Thumbtack.'
    } else if (sinceEvent > STALE_AFTER_MS) {
      dot = 'bg-amber-400'
      notice = `Last received ${relativeTime(conn.last_event_at)} — check Thumbtack.`
    } else {
      dot = 'bg-green-500'
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
      className={`rounded-xl border bg-white p-4 dark:border-gray-700 dark:bg-gray-800 ${
        conn.is_active ? '' : 'opacity-60'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={`h-3 w-3 shrink-0 rounded-full ${dot}`} />
          <div>
            <p className="font-medium text-gray-900 dark:text-white">{conn.label}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
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
            className={`${TOUCH} min-w-[104px] rounded-lg bg-gray-200 px-4 text-sm font-medium text-gray-800 disabled:opacity-40 dark:bg-gray-700 dark:text-gray-100`}
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
                className={`${TOUCH} rounded-lg bg-red-600 px-4 text-sm font-medium text-white disabled:opacity-40`}
              >
                {deleteConnection.isPending ? 'Deleting…' : 'Confirm delete'}
              </button>
              <button
                onClick={() => setConfirmingDelete(false)}
                className={`${TOUCH} rounded-lg px-3 text-sm font-medium text-gray-500 dark:text-gray-400`}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirmingDelete(true)}
              className={`${TOUCH} rounded-lg px-4 text-sm font-medium text-red-600 dark:text-red-400`}
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
              ? 'text-red-600 dark:text-red-400'
              : 'text-amber-700 dark:text-amber-400'
          }`}
        >
          {notice}
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}

function EventsFeed() {
  const { data: events = [] } = useThumbtackEvents()
  const [expanded, setExpanded] = useState<string | null>(null)

  if (events.length === 0) return null

  return (
    <section className="rounded-xl border bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
        Recent deliveries
      </h2>
      <div className="space-y-2">
        {events.map(event => (
          <div key={event.id} className="rounded-lg border p-3 dark:border-gray-700">
            <button
              onClick={() => setExpanded(expanded === event.id ? null : event.id)}
              className={`${TOUCH} flex w-full items-center justify-between gap-3 text-left`}
            >
              <span className="text-sm text-gray-900 dark:text-white">
                {event.kind}
                {event.external_id ? ` · ${event.external_id}` : ''}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {event.status} · {relativeTime(event.received_at)}
              </span>
            </button>
            {event.error && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">{event.error}</p>
            )}
            {expanded === event.id && (
              <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-gray-100 p-3 text-xs text-gray-800 dark:bg-gray-900 dark:text-gray-200">
                {event.raw_body}
              </pre>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
