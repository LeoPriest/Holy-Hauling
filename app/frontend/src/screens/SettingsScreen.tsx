import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useSettings, usePatchSettings, useTestAlert } from '../hooks/useSettings'
import { useMyAvailability, useSaveMyAvailability } from '../hooks/useAvailability'
import { usePushNotifications } from '../hooks/usePushNotifications'
import type { SettingsPatch, TestAlertRequest } from '../types/lead'
import { useAuth } from '../context/AuthContext'
import { BottomNav } from '../components/BottomNav'
import { CitySwitcher } from '../components/CitySwitcher'
import { ICON, NavRow } from '../components/NavRow'
import { ScreenHeader } from '../components/ScreenHeader'
import { Switch } from '../components/Switch'
import { MyPay } from '../components/MyPay'
import { StandardKitEditor } from '../components/StandardKitEditor'
import { useCity } from '../context/CityContext'
import { useTheme } from '../context/ThemeContext'
import { guideForRole } from '../content/helpContent'
import { apiFetch, fetchNotificationStatus } from '../services/api'

type TestKey = `${TestAlertRequest['channel']}_${TestAlertRequest['recipient']}`
type TestState = { sent: boolean; reason?: string | null }

type CalendarStatus = {
  configured: boolean
  connected: boolean
  missing: string[]
  detail: string | null
  redirect_uri?: string | null
}

type NotificationChannelStatus = {
  configured: boolean
  missing: string[]
  detail: string | null
}

type NotificationStatus = {
  sms: NotificationChannelStatus
  email: NotificationChannelStatus
  web_push: NotificationChannelStatus
}

const WEEKDAY_ORDER = [
  { key: 'monday', label: 'Mon' },
  { key: 'tuesday', label: 'Tue' },
  { key: 'wednesday', label: 'Wed' },
  { key: 'thursday', label: 'Thu' },
  { key: 'friday', label: 'Fri' },
  { key: 'saturday', label: 'Sat' },
  { key: 'sunday', label: 'Sun' },
] as const

type WeekdayKey = typeof WEEKDAY_ORDER[number]['key']

const PERIOD_ORDER = [
  { key: 'morning', label: 'Morning' },
  { key: 'afternoon', label: 'Afternoon' },
  { key: 'evening', label: 'Evening' },
] as const
type PeriodKey = typeof PERIOD_ORDER[number]['key']

function Status({ on, yes = 'Configured', no = 'Not configured' }: { on: boolean; yes?: string; no?: string }) {
  return <span className={on ? 'wd-on' : 'wd-off'}>{on ? yes : no}</span>
}


function AvailabilityRow({
  day, blocked, onToggle,
}: {
  day: { key: WeekdayKey; label: string }
  blocked: Set<string>
  onToggle: (day: WeekdayKey, period: PeriodKey) => void
}) {
  return (
    <>
      <span className="flex items-center text-xs font-semibold text-mu">{day.label}</span>
      {PERIOD_ORDER.map(p => {
        const on = blocked.has(`${day.key}:${p.key}`)
        return (
          <button
            key={p.key}
            type="button"
            aria-pressed={on}
            aria-label={`${day.label} ${p.label}`}
            onClick={() => onToggle(day.key, p.key)}
            className="wd-cell"
          >
            {on ? 'Blocked' : 'Open'}
          </button>
        )
      })}
    </>
  )
}

export function SettingsScreen() {
  const navigate = useNavigate()
  const { data: settings, isLoading } = useSettings()
  const patch = usePatchSettings()
  const testAlert = useTestAlert()
  const { data: availability } = useMyAvailability()
  const saveAvailability = useSaveMyAvailability()
  const push = usePushNotifications()
  const { user, logout } = useAuth()
  const { requiredCityId } = useCity()
  const { isDark, toggleTheme } = useTheme()

  const isAdmin = user?.role === 'admin'
  const canViewOpsSettings = user?.role === 'admin' || user?.role === 'facilitator'
  const canEditOpsSettings = isAdmin

  const [form, setForm] = useState<SettingsPatch>({})
  const [saved, setSaved] = useState(false)
  const [availabilitySaved, setAvailabilitySaved] = useState(false)
  const [testResults, setTestResults] = useState<Partial<Record<TestKey, TestState>>>({})
  const [connectError, setConnectError] = useState('')
  const [blocked, setBlocked] = useState<Set<string>>(new Set())

  const { data: calendarStatus, refetch: refetchCalendarStatus } = useQuery<CalendarStatus>({
    queryKey: ['google-calendar-status', requiredCityId],
    queryFn: async () => {
      const response = await apiFetch(`/admin/google/status?city_id=${encodeURIComponent(requiredCityId)}`)
      if (!response.ok) return { configured: false, connected: false, missing: [], detail: null }
      return response.json()
    },
    enabled: isAdmin && Boolean(requiredCityId),
  })

  const { data: notificationData, refetch: refetchNotificationStatus } = useQuery<NotificationStatus>({
    queryKey: ['notification-status'],
    queryFn: fetchNotificationStatus,
    enabled: Boolean(user),
  })
  // An answer without the three channels (an empty list has been seen) is
  // treated as unknown instead of crashing the page.
  const notificationStatus = notificationData?.sms && notificationData.email && notificationData.web_push
    ? notificationData
    : undefined

  async function handleGoogleConnect() {
    setConnectError('')
    const response = await apiFetch(`/admin/google/connect?city_id=${encodeURIComponent(requiredCityId)}`)
    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      setConnectError((error as { detail?: string }).detail ?? 'Failed to get Google connect URL')
      return
    }
    const { url } = await response.json() as { url: string }
    window.open(url, '_blank')
  }

  useEffect(() => {
    if (!settings) return
    setForm({
      t1_minutes: settings.t1_minutes,
      t2_minutes: settings.t2_minutes,
      quiet_hours_start: settings.quiet_hours_start,
      quiet_hours_end: settings.quiet_hours_end,
      quiet_hours_enabled: settings.quiet_hours_enabled,
      primary_sms: settings.primary_sms,
      primary_email: settings.primary_email,
      backup_name: settings.backup_name,
      backup_sms: settings.backup_sms,
      backup_email: settings.backup_email,
      t1_push: settings.t1_push,
      t1_sms: settings.t1_sms,
      t1_email: settings.t1_email,
      t2_push: settings.t2_push,
      t2_sms: settings.t2_sms,
      t2_email: settings.t2_email,
    })
  }, [settings])

  useEffect(() => {
    const next = new Set<string>()
    const blocks = availability?.blocks ?? {}
    for (const day of WEEKDAY_ORDER) {
      for (const period of (blocks[day.key] ?? [])) next.add(`${day.key}:${period}`)
    }
    setBlocked(next)
  }, [availability])

  const set = (key: keyof SettingsPatch, value: unknown) =>
    setForm(prev => ({ ...prev, [key]: value }))

  const toggleCell = (day: WeekdayKey, period: PeriodKey) => {
    const cell = `${day}:${period}`
    setBlocked(prev => {
      const next = new Set(prev)
      if (next.has(cell)) next.delete(cell)
      else next.add(cell)
      return next
    })
  }

  const blocksFromSet = (cells: Set<string>): Record<string, string[]> => {
    const out: Record<string, string[]> = {}
    for (const day of WEEKDAY_ORDER) {
      const periods = PERIOD_ORDER.filter(p => cells.has(`${day.key}:${p.key}`)).map(p => p.key)
      if (periods.length) out[day.key] = periods
    }
    return out
  }

  const handleSave = () => {
    patch.mutate(form, {
      onSuccess: () => {
        setSaved(true)
        window.setTimeout(() => setSaved(false), 2000)
      },
    })
  }

  const handleSaveWeeklyAvailability = () => {
    saveAvailability.mutate(blocksFromSet(blocked), {
      onSuccess: () => {
        setAvailabilitySaved(true)
        window.setTimeout(() => setAvailabilitySaved(false), 2000)
      },
    })
  }

  const handleTestAlert = (channel: TestAlertRequest['channel'], recipient: TestAlertRequest['recipient']) => {
    const key: TestKey = `${channel}_${recipient}`
    testAlert.mutate(
      { channel, recipient },
      {
        onSuccess: result => setTestResults(prev => ({ ...prev, [key]: result })),
        onError: () => setTestResults(prev => ({ ...prev, [key]: { sent: false, reason: 'Request failed' } })),
      },
    )
  }

  if (isLoading) {
    return <div className="min-h-screen bg-bg p-6 text-mu">Loading…</div>
  }

  const saveLabel = patch.isPending ? 'Saving…' : saved ? 'Saved' : 'Save settings'

  return (
    <div className="min-h-screen bg-bg pb-[calc(var(--dock-h)+16px)] text-ink">
      <ScreenHeader
        title="Settings"
        subtitle={user?.username ? `Signed in as ${user.username}` : undefined}
        right={isAdmin ? <CitySwitcher allowAll={false} variant="pill" /> : undefined}
      />

      <main className="wd-pane mx-auto flex max-w-3xl flex-col gap-3 px-3.5 pt-4">
        {isAdmin && (
          <NavRow
            label="Admin"
            description="Team, cities, finances, payroll, metrics"
            icon={ICON.gear}
            ariaLabel="Open admin"
            onClick={() => navigate('/admin')}
          />
        )}

        {(user?.role === 'admin' || user?.role === 'facilitator' || user?.role === 'supervisor') && (
          <NavRow
            label={guideForRole(user?.role).title}
            description={guideForRole(user?.role).tagline}
            icon={ICON.book}
            onClick={() => navigate('/help')}
          />
        )}

        <Section title="Account">
          <FieldRow label="Signed in as">
            <span className="font-semibold">{user?.username ?? 'Unknown user'}</span>
          </FieldRow>
          <FieldRow label="Dark mode">
            <Switch on={isDark} onChange={toggleTheme} label="Dark mode" />
          </FieldRow>
          <button
            type="button"
            onClick={logout}
            className="wd-btn-sm wd-btn-ghost mt-2 !text-danger !shadow-[inset_0_0_0_1.5px_var(--red)]"
          >
            Sign out
          </button>
        </Section>

        <Section title="My pay">
          <MyPay />
        </Section>

        <Section title="Availability">
          <div className="grid grid-cols-[3rem_repeat(3,minmax(0,1fr))] gap-1.5 text-center">
            <span />
            {PERIOD_ORDER.map(p => (
              <span key={p.key} className="wd-label !text-[11px]">{p.label}</span>
            ))}
            {WEEKDAY_ORDER.map(day => (
              <AvailabilityRow key={day.key} day={day} blocked={blocked} onToggle={toggleCell} />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleSaveWeeklyAvailability}
              disabled={saveAvailability.isPending}
              className="wd-btn-sm"
            >
              {saveAvailability.isPending ? 'Saving…' : availabilitySaved ? 'Saved' : 'Save weekly availability'}
            </button>
            <button
              type="button"
              onClick={() => setBlocked(new Set())}
              disabled={saveAvailability.isPending || blocked.size === 0}
              className="wd-btn-sm wd-btn-ghost"
            >
              Clear all
            </button>
          </div>
          {blocked.size > 0 && (
            <p className="mt-2 text-xs text-mu">
              Currently blocked: {WEEKDAY_ORDER
                .map(day => {
                  const periods = PERIOD_ORDER.filter(p => blocked.has(`${day.key}:${p.key}`))
                  if (!periods.length) return null
                  const label = periods.length === PERIOD_ORDER.length ? 'all day' : periods.map(p => p.label.toLowerCase()).join(', ')
                  return `${day.label} (${label})`
                })
                .filter(Boolean)
                .join('; ')}
            </p>
          )}
          {saveAvailability.isError && (
            <p role="alert" className="mt-2 text-xs font-semibold text-danger">
              {(saveAvailability.error as Error)?.message ?? 'Failed to save weekly availability.'}
            </p>
          )}
          <p className="mt-2 text-xs text-mu">
            Blocked times repeat every week and show as unavailable when crews are assigned.
          </p>
        </Section>

        {(user?.role === 'admin' || user?.role === 'facilitator') && (
          <Section title="Standard kit · items to bring">
            <StandardKitEditor />
          </Section>
        )}

        <Section title="Browser push">
          <FieldRow label="Browser support">
            <Status on={push.supported} yes="Supported" no="Not supported" />
          </FieldRow>
          <FieldRow label="Permission">
            <span className="capitalize">{push.permission}</span>
          </FieldRow>
          <FieldRow label="This device">
            <Status on={push.subscribed} yes="Subscribed" no="Not subscribed" />
          </FieldRow>
          <FieldRow label="Server push">
            <Status on={Boolean(notificationStatus?.web_push.configured)} />
          </FieldRow>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void push.enable()}
              disabled={push.loading || !push.supported || !notificationStatus?.web_push.configured}
              className="wd-btn-sm"
            >
              Turn on here
            </button>
            <button
              type="button"
              onClick={() => void push.disable()}
              disabled={push.loading || !push.subscribed}
              className="wd-btn-sm wd-btn-ghost"
            >
              Turn off here
            </button>
            <button
              type="button"
              onClick={() => void push.sendTest()}
              disabled={push.loading || !push.subscribed || !notificationStatus?.web_push.configured}
              className="wd-btn-sm wd-btn-ghost"
            >
              Send test push
            </button>
            <button
              type="button"
              onClick={() => {
                void push.refresh()
                void refetchNotificationStatus()
              }}
              className="wd-btn-sm wd-btn-ghost"
            >
              Refresh
            </button>
          </div>
          {notificationStatus?.web_push.detail && <p className="mt-2 text-xs wd-off">{notificationStatus.web_push.detail}</p>}
          {push.error && <p role="alert" className="mt-2 text-xs font-semibold text-danger">{push.error}</p>}
          {push.testResult?.sent && <p className="mt-2 text-xs wd-on">Test push sent.</p>}
          <p className="mt-2 text-xs text-mu">Each crew or supervisor phone turns push on once after signing in.</p>
        </Section>

        {canViewOpsSettings && notificationStatus && (
          <Section title="Notification delivery">
            <FieldRow label="SMS / Twilio"><Status on={notificationStatus.sms.configured} /></FieldRow>
            {notificationStatus.sms.detail && <p className="text-xs wd-off">{notificationStatus.sms.detail}</p>}
            <FieldRow label="Email / SMTP"><Status on={notificationStatus.email.configured} /></FieldRow>
            {notificationStatus.email.detail && <p className="text-xs wd-off">{notificationStatus.email.detail}</p>}
            <FieldRow label="Web push / VAPID"><Status on={notificationStatus.web_push.configured} /></FieldRow>
          </Section>
        )}

        {isAdmin && (
          <Section title="Google Calendar">
            <FieldRow label="Status">
              <Status
                on={Boolean(calendarStatus?.connected)}
                yes="Connected"
                no={calendarStatus?.configured ? 'Not connected' : calendarStatus?.detail ? 'Configuration issue' : 'Not configured'}
              />
            </FieldRow>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleGoogleConnect}
                disabled={calendarStatus?.configured === false}
                className="wd-btn-sm"
              >
                {calendarStatus?.connected ? 'Reconnect' : 'Connect Google Calendar'}
              </button>
              <button type="button" onClick={() => refetchCalendarStatus()} className="wd-btn-sm wd-btn-ghost">
                Refresh status
              </button>
            </div>
            {connectError && <p role="alert" className="mt-2 text-xs font-semibold text-danger">{connectError}</p>}
            {calendarStatus?.detail && <p className="mt-2 text-xs wd-off">{calendarStatus.detail}</p>}
            {calendarStatus?.redirect_uri && (
              <p className="mt-2 break-all text-xs text-mu">
                Authorized redirect URI must exactly match: {calendarStatus.redirect_uri}
              </p>
            )}
            <p className="mt-2 text-xs text-mu">
              If Google shows `org_internal`, the OAuth consent screen in Google Cloud is still set to `Internal`. Switch it to `External` and add the Gmail account as a test user.
            </p>
            <p className="mt-2 text-xs text-mu">
              After connecting, add Google emails to crew profiles so they receive job invites.
            </p>
          </Section>
        )}

        {canViewOpsSettings && (
          <>
            <Section title="Alert thresholds">
              <FieldRow label="T1 warning (minutes)">
                <input
                  type="number"
                  min={1}
                  max={120}
                  inputMode="numeric"
                  aria-label="T1 warning (minutes)"
                  className="wd-input !w-24 text-right"
                  value={form.t1_minutes ?? ''}
                  onChange={e => set('t1_minutes', Number(e.target.value))}
                  disabled={!canEditOpsSettings}
                />
              </FieldRow>
              <FieldRow label="T2 escalation (minutes)">
                <input
                  type="number"
                  min={1}
                  max={240}
                  inputMode="numeric"
                  aria-label="T2 escalation (minutes)"
                  className="wd-input !w-24 text-right"
                  value={form.t2_minutes ?? ''}
                  onChange={e => set('t2_minutes', Number(e.target.value))}
                  disabled={!canEditOpsSettings}
                />
              </FieldRow>
            </Section>

            <Section title="Alert channels">
              <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,52px)] items-center gap-x-1 text-sm">
                <span />
                {['Push', 'SMS', 'Email'].map(h => (
                  <span key={h} className="wd-label text-center !text-[11px]">{h}</span>
                ))}
                {([
                  { label: 'T1 warning', keys: ['t1_push', 't1_sms', 't1_email'] },
                  { label: 'T2 escalation', keys: ['t2_push', 't2_sms', 't2_email'] },
                ] as const).map(({ label, keys }) => (
                  <ChannelRow key={label} label={label}>
                    {keys.map((key, i) => (
                      <span key={key} className="flex justify-center">
                        <Switch
                          on={!!form[key]}
                          onChange={on => set(key, on)}
                          disabled={!canEditOpsSettings}
                          label={`${label} by ${['push', 'SMS', 'email'][i]}`}
                        />
                      </span>
                    ))}
                  </ChannelRow>
                ))}
              </div>
              <p className="mt-2 text-xs text-mu">
                Push goes to every subscribed admin and facilitator phone. SMS and email use the contacts below.
              </p>
            </Section>

            <Section title="Quiet hours">
              <FieldRow label="Quiet hours">
                <Switch
                  on={form.quiet_hours_enabled ?? false}
                  onChange={on => set('quiet_hours_enabled', on)}
                  disabled={!canEditOpsSettings}
                  label="Enable quiet hours"
                />
              </FieldRow>
              <FieldRow label="Start">
                <input
                  type="time"
                  aria-label="Quiet hours start"
                  className="wd-input !w-32"
                  value={form.quiet_hours_start ?? '22:00'}
                  onChange={e => set('quiet_hours_start', e.target.value)}
                  disabled={!canEditOpsSettings}
                />
              </FieldRow>
              <FieldRow label="End">
                <input
                  type="time"
                  aria-label="Quiet hours end"
                  className="wd-input !w-32"
                  value={form.quiet_hours_end ?? '07:00'}
                  onChange={e => set('quiet_hours_end', e.target.value)}
                  disabled={!canEditOpsSettings}
                />
              </FieldRow>
            </Section>

            <Section title="Primary facilitator">
              <Field label="SMS number">
                <input
                  type="tel"
                  className="wd-input"
                  placeholder="+15551234567"
                  value={form.primary_sms ?? ''}
                  onChange={e => set('primary_sms', e.target.value)}
                  disabled={!canEditOpsSettings}
                />
              </Field>
              <Field label="Email">
                <input
                  type="email"
                  className="wd-input"
                  placeholder="you@example.com"
                  value={form.primary_email ?? ''}
                  onChange={e => set('primary_email', e.target.value)}
                  disabled={!canEditOpsSettings}
                />
              </Field>
            </Section>

            <Section title="Backup handler">
              <Field label="Name">
                <input
                  type="text"
                  className="wd-input"
                  placeholder="Jordan"
                  value={form.backup_name ?? ''}
                  onChange={e => set('backup_name', e.target.value)}
                  disabled={!canEditOpsSettings}
                />
              </Field>
              <Field label="SMS number">
                <input
                  type="tel"
                  className="wd-input"
                  placeholder="+15559876543"
                  value={form.backup_sms ?? ''}
                  onChange={e => set('backup_sms', e.target.value)}
                  disabled={!canEditOpsSettings}
                />
              </Field>
              <Field label="Email">
                <input
                  type="email"
                  className="wd-input"
                  placeholder="backup@example.com"
                  value={form.backup_email ?? ''}
                  onChange={e => set('backup_email', e.target.value)}
                  disabled={!canEditOpsSettings}
                />
              </Field>
            </Section>
          </>
        )}

        {isAdmin && (
          <Section title="Test alerts">
            {(['sms', 'email'] as const).flatMap(channel =>
              (['primary', 'backup'] as const).map(recipient => {
                const key: TestKey = `${channel}_${recipient}`
                const result = testResults[key]
                const sending = testAlert.isPending && testAlert.variables?.channel === channel && testAlert.variables?.recipient === recipient
                return (
                  <div key={key} className="wd-row">
                    <span>{channel === 'sms' ? 'SMS' : 'Email'} to {recipient}</span>
                    <div className="flex items-center gap-2">
                      {result && (
                        <span className={`text-xs ${result.sent ? 'wd-on' : 'font-semibold text-danger'}`}>
                          {result.sent ? 'Sent' : `Failed: ${result.reason ?? 'Unknown error'}`}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => handleTestAlert(channel, recipient)}
                        disabled={testAlert.isPending}
                        className="wd-btn-sm wd-btn-ghost"
                      >
                        {sending ? 'Sending…' : 'Send test'}
                      </button>
                    </div>
                  </div>
                )
              }),
            )}
          </Section>
        )}

        {canViewOpsSettings && !canEditOpsSettings && (
          <p className="text-xs wd-off">
            Alert settings are read-only for your role. Ask an admin to change them.
          </p>
        )}

        {canViewOpsSettings && (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={patch.isPending || !canEditOpsSettings}
              className="wd-btn w-full"
            >
              {saveLabel}
            </button>
            {patch.isError && (
              <p role="alert" className="text-center text-sm font-semibold text-danger">
                Couldn't save settings. Check your signal and try again.
              </p>
            )}
          </div>
        )}
      </main>
      <BottomNav />
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="wd-box wd-box-soft">
      <h2 className="wd-label mb-1.5">{title}</h2>
      {children}
    </section>
  )
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="wd-row">
      <span>{label}</span>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mt-2 block">
      <span className="wd-fl !mb-1">{label}</span>
      {children}
    </label>
  )
}

function ChannelRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="text-sm text-mu">{label}</span>
      {children}
    </>
  )
}
