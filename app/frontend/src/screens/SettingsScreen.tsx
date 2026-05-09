import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useSettings, usePatchSettings, useTestAlert } from '../hooks/useSettings'
import { useMyAvailability, useSaveMyAvailability } from '../hooks/useAvailability'
import { usePushNotifications } from '../hooks/usePushNotifications'
import type { SettingsPatch, TestAlertRequest } from '../types/lead'
import { useAuth } from '../context/AuthContext'
import { CitySwitcher } from '../components/CitySwitcher'
import { useCity } from '../context/CityContext'
import { useTheme } from '../context/ThemeContext'
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

function statusTone(configured: boolean) {
  return configured
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-amber-600 dark:text-amber-400'
}

function formatWeekdayLabel(day: WeekdayKey) {
  return day.charAt(0).toUpperCase() + day.slice(1)
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
  const backTarget = canViewOpsSettings ? '/' : '/jobs'

  const [form, setForm] = useState<SettingsPatch>({})
  const [saved, setSaved] = useState(false)
  const [availabilitySaved, setAvailabilitySaved] = useState(false)
  const [testResults, setTestResults] = useState<Partial<Record<TestKey, TestState>>>({})
  const [connectError, setConnectError] = useState('')
  const [weeklyAvailability, setWeeklyAvailability] = useState<WeekdayKey[]>([])

  const { data: calendarStatus, refetch: refetchCalendarStatus } = useQuery<CalendarStatus>({
    queryKey: ['google-calendar-status', requiredCityId],
    queryFn: async () => {
      const response = await apiFetch(`/admin/google/status?city_id=${encodeURIComponent(requiredCityId)}`)
      if (!response.ok) return { configured: false, connected: false, missing: [], detail: null }
      return response.json()
    },
    enabled: isAdmin && Boolean(requiredCityId),
  })

  const { data: notificationStatus, refetch: refetchNotificationStatus } = useQuery<NotificationStatus>({
    queryKey: ['notification-status'],
    queryFn: fetchNotificationStatus,
    enabled: Boolean(user),
  })

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
    })
  }, [settings])

  useEffect(() => {
    setWeeklyAvailability(availability?.weekdays ?? [])
  }, [availability])

  const set = (key: keyof SettingsPatch, value: unknown) =>
    setForm(prev => ({ ...prev, [key]: value }))

  const toggleWeekday = (day: WeekdayKey) => {
    setWeeklyAvailability(prev => {
      const next = prev.includes(day)
        ? prev.filter(item => item !== day)
        : [...prev, day]
      return WEEKDAY_ORDER.map(item => item.key).filter(item => next.includes(item))
    })
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
    saveAvailability.mutate(weeklyAvailability, {
      onSuccess: data => {
        setWeeklyAvailability(data.weekdays)
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
    return <div className="p-6 text-gray-400 dark:text-gray-500">Loading...</div>
  }

  const inputClass =
    'border dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white'

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b px-4 py-3 bg-white dark:bg-gray-800 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(backTarget)}
            className="text-sm font-medium text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
          >
            Back
          </button>
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">Settings</h1>
        </div>
        {isAdmin && <CitySwitcher allowAll={false} />}
      </header>

      <div className="space-y-6 p-4 pb-20">
        <section className="rounded-xl border bg-white p-4 dark:bg-gray-800 dark:border-gray-700">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Account</h2>
          <FieldRow label="Signed in as">
            <span className="text-sm text-gray-700 dark:text-gray-200">{user?.username ?? 'Unknown user'}</span>
          </FieldRow>
          <div className="mt-4">
            <button
              onClick={logout}
              className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-900/20"
            >
              Sign out
            </button>
          </div>
        </section>

        <section className="rounded-xl border bg-white p-4 dark:bg-gray-800 dark:border-gray-700">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Appearance</h2>
          <FieldRow label="Dark mode">
            <button
              onClick={toggleTheme}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                isDark ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-600'
              }`}
              role="switch"
              aria-checked={isDark}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  isDark ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </FieldRow>
        </section>

        <section className="space-y-3 rounded-xl border bg-white p-4 dark:bg-gray-800 dark:border-gray-700">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Availability</h2>
          <div className="flex flex-wrap gap-2">
            {WEEKDAY_ORDER.map(day => {
              const selected = weeklyAvailability.includes(day.key)
              return (
                <button
                  key={day.key}
                  type="button"
                  onClick={() => toggleWeekday(day.key)}
                  aria-pressed={selected}
                  className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                    selected
                      ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200'
                      : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {day.label}
                </button>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleSaveWeeklyAvailability}
              disabled={saveAvailability.isPending}
              className={`rounded-lg px-4 py-2 text-xs font-medium transition-colors disabled:opacity-50 ${
                availabilitySaved
                  ? 'bg-emerald-600 text-white'
                  : 'bg-gray-900 text-white hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200'
              }`}
            >
              {saveAvailability.isPending ? 'Saving...' : availabilitySaved ? 'Saved' : 'Save weekly availability'}
            </button>
            <button
              type="button"
              onClick={() => setWeeklyAvailability([])}
              disabled={saveAvailability.isPending || weeklyAvailability.length === 0}
              className="rounded-lg border px-3 py-2 text-xs hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Clear all
            </button>
          </div>
          {weeklyAvailability.length > 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Currently blocked: {weeklyAvailability.map(formatWeekdayLabel).join(', ')}
            </p>
          )}
          {saveAvailability.isError && (
            <p className="text-xs text-red-600 dark:text-red-400">
              {(saveAvailability.error as Error)?.message ?? 'Failed to save weekly availability.'}
            </p>
          )}
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Selected days are blocked every week and shown as unavailable in confirmed-job assignment lists.
          </p>
        </section>

        <section className="space-y-3 rounded-xl border bg-white p-4 dark:bg-gray-800 dark:border-gray-700">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Browser Push</h2>
          <FieldRow label="Browser support">
            <span className={`text-sm font-medium ${push.supported ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
              {push.supported ? 'Supported' : 'Not supported'}
            </span>
          </FieldRow>
          <FieldRow label="Permission">
            <span className="text-sm capitalize text-gray-600 dark:text-gray-300">{push.permission}</span>
          </FieldRow>
          <FieldRow label="This device">
            <span className={`text-sm font-medium ${push.subscribed ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-gray-500'}`}>
              {push.subscribed ? 'Subscribed' : 'Not subscribed'}
            </span>
          </FieldRow>
          <FieldRow label="Backend web push">
            <span className={`text-sm font-medium ${statusTone(Boolean(notificationStatus?.web_push.configured))}`}>
              {notificationStatus?.web_push.configured ? 'Configured' : 'Not configured'}
            </span>
          </FieldRow>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void push.enable()}
              disabled={push.loading || !push.supported || !notificationStatus?.web_push.configured}
              className="rounded-lg border px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Enable on this device
            </button>
            <button
              onClick={() => void push.disable()}
              disabled={push.loading || !push.subscribed}
              className="rounded-lg border px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Disable on this device
            </button>
            <button
              onClick={() => void push.sendTest()}
              disabled={push.loading || !push.subscribed || !notificationStatus?.web_push.configured}
              className="rounded-lg border px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Send test push
            </button>
            <button
              onClick={() => {
                void push.refresh()
                void refetchNotificationStatus()
              }}
              className="rounded-lg border px-3 py-1.5 text-xs hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Refresh
            </button>
          </div>
          {notificationStatus?.web_push.detail && (
            <p className="text-xs text-amber-600 dark:text-amber-400">{notificationStatus.web_push.detail}</p>
          )}
          {push.error && <p className="text-xs text-red-600 dark:text-red-400">{push.error}</p>}
          {push.testResult?.sent && <p className="text-xs text-emerald-600 dark:text-emerald-400">Test push sent.</p>}
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Each crew or supervisor device must enable browser push once after login.
          </p>
        </section>

        {canViewOpsSettings && notificationStatus && (
          <section className="space-y-3 rounded-xl border bg-white p-4 dark:bg-gray-800 dark:border-gray-700">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Notification Delivery</h2>
            <FieldRow label="SMS / Twilio">
              <span className={`text-sm font-medium ${statusTone(notificationStatus.sms.configured)}`}>
                {notificationStatus.sms.configured ? 'Configured' : 'Not configured'}
              </span>
            </FieldRow>
            {notificationStatus.sms.detail && (
              <p className="text-xs text-amber-600 dark:text-amber-400">{notificationStatus.sms.detail}</p>
            )}
            <FieldRow label="Email / SMTP">
              <span className={`text-sm font-medium ${statusTone(notificationStatus.email.configured)}`}>
                {notificationStatus.email.configured ? 'Configured' : 'Not configured'}
              </span>
            </FieldRow>
            {notificationStatus.email.detail && (
              <p className="text-xs text-amber-600 dark:text-amber-400">{notificationStatus.email.detail}</p>
            )}
            <FieldRow label="Web Push / VAPID">
              <span className={`text-sm font-medium ${statusTone(notificationStatus.web_push.configured)}`}>
                {notificationStatus.web_push.configured ? 'Configured' : 'Not configured'}
              </span>
            </FieldRow>
          </section>
        )}

        {isAdmin && (
          <section className="space-y-3 rounded-xl border bg-white p-4 dark:bg-gray-800 dark:border-gray-700">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Cities</h2>
            <button
              onClick={() => navigate('/admin/cities')}
              className="rounded-lg border px-3 py-1.5 text-xs hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Manage cities
            </button>
          </section>
        )}

        {isAdmin && (
          <section className="space-y-3 rounded-xl border bg-white p-4 dark:bg-gray-800 dark:border-gray-700">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Google Calendar</h2>
            <FieldRow label="Status">
              <span className={`text-sm font-medium ${calendarStatus?.connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-gray-500'}`}>
                {calendarStatus?.connected
                  ? 'Connected'
                  : calendarStatus?.configured
                    ? 'Not connected'
                    : calendarStatus?.detail
                      ? 'Configuration issue'
                      : 'Not configured'}
              </span>
            </FieldRow>
            <div className="flex gap-2">
              <button
                onClick={handleGoogleConnect}
                disabled={calendarStatus?.configured === false}
                className="rounded-lg border px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                {calendarStatus?.connected ? 'Reconnect' : 'Connect Google Calendar'}
              </button>
              <button
                onClick={() => refetchCalendarStatus()}
                className="rounded-lg border px-3 py-1.5 text-xs hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Refresh status
              </button>
            </div>
            {connectError && <p className="text-xs text-red-600 dark:text-red-400">{connectError}</p>}
            {calendarStatus?.detail && <p className="text-xs text-amber-600 dark:text-amber-400">{calendarStatus.detail}</p>}
            {calendarStatus?.redirect_uri && (
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Authorized redirect URI must exactly match: {calendarStatus.redirect_uri}
              </p>
            )}
            <p className="text-xs text-gray-400 dark:text-gray-500">
              If Google shows `org_internal`, the OAuth consent screen in Google Cloud is still set to `Internal`. Switch it to `External` and add the Gmail account as a test user.
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              After connecting, add Google emails to crew profiles so they receive job invites.
            </p>
          </section>
        )}

        {canViewOpsSettings && (
          <>
            <section className="space-y-3 rounded-xl border bg-white p-4 dark:bg-gray-800 dark:border-gray-700">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Alert Thresholds</h2>
              <FieldRow label="T1 warning (minutes)">
                <input
                  type="number"
                  min={1}
                  max={120}
                  className={`${inputClass} w-20 text-right`}
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
                  className={`${inputClass} w-20 text-right`}
                  value={form.t2_minutes ?? ''}
                  onChange={e => set('t2_minutes', Number(e.target.value))}
                  disabled={!canEditOpsSettings}
                />
              </FieldRow>
            </section>

            <section className="space-y-3 rounded-xl border bg-white p-4 dark:bg-gray-800 dark:border-gray-700">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Quiet Hours</h2>
              <FieldRow label="Enable quiet hours">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-indigo-600"
                  checked={form.quiet_hours_enabled ?? false}
                  onChange={e => set('quiet_hours_enabled', e.target.checked)}
                  disabled={!canEditOpsSettings}
                />
              </FieldRow>
              <FieldRow label="Start (HH:MM)">
                <input
                  type="time"
                  className={inputClass}
                  value={form.quiet_hours_start ?? '22:00'}
                  onChange={e => set('quiet_hours_start', e.target.value)}
                  disabled={!canEditOpsSettings}
                />
              </FieldRow>
              <FieldRow label="End (HH:MM)">
                <input
                  type="time"
                  className={inputClass}
                  value={form.quiet_hours_end ?? '07:00'}
                  onChange={e => set('quiet_hours_end', e.target.value)}
                  disabled={!canEditOpsSettings}
                />
              </FieldRow>
            </section>

            <section className="space-y-3 rounded-xl border bg-white p-4 dark:bg-gray-800 dark:border-gray-700">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Primary Facilitator</h2>
              <FieldRow label="SMS number">
                <input
                  type="tel"
                  className={`${inputClass} flex-1`}
                  placeholder="+15551234567"
                  value={form.primary_sms ?? ''}
                  onChange={e => set('primary_sms', e.target.value)}
                  disabled={!canEditOpsSettings}
                />
              </FieldRow>
              <FieldRow label="Email">
                <input
                  type="email"
                  className={`${inputClass} flex-1`}
                  placeholder="you@example.com"
                  value={form.primary_email ?? ''}
                  onChange={e => set('primary_email', e.target.value)}
                  disabled={!canEditOpsSettings}
                />
              </FieldRow>
            </section>

            <section className="space-y-3 rounded-xl border bg-white p-4 dark:bg-gray-800 dark:border-gray-700">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Backup Handler</h2>
              <FieldRow label="Name">
                <input
                  type="text"
                  className={`${inputClass} flex-1`}
                  placeholder="Jordan"
                  value={form.backup_name ?? ''}
                  onChange={e => set('backup_name', e.target.value)}
                  disabled={!canEditOpsSettings}
                />
              </FieldRow>
              <FieldRow label="SMS number">
                <input
                  type="tel"
                  className={`${inputClass} flex-1`}
                  placeholder="+15559876543"
                  value={form.backup_sms ?? ''}
                  onChange={e => set('backup_sms', e.target.value)}
                  disabled={!canEditOpsSettings}
                />
              </FieldRow>
              <FieldRow label="Email">
                <input
                  type="email"
                  className={`${inputClass} flex-1`}
                  placeholder="backup@example.com"
                  value={form.backup_email ?? ''}
                  onChange={e => set('backup_email', e.target.value)}
                  disabled={!canEditOpsSettings}
                />
              </FieldRow>
            </section>
          </>
        )}

        {isAdmin && (
          <section className="space-y-3 rounded-xl border bg-white p-4 dark:bg-gray-800 dark:border-gray-700">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Test Alerts</h2>
            {(['sms', 'email'] as const).flatMap(channel =>
              (['primary', 'backup'] as const).map(recipient => {
                const key: TestKey = `${channel}_${recipient}`
                const result = testResults[key]
                return (
                  <div key={key} className="flex items-center justify-between gap-3">
                    <span className="text-sm capitalize text-gray-600 dark:text-gray-300">
                      {channel.toUpperCase()} {'->'} {recipient}
                    </span>
                    <div className="flex items-center gap-2">
                      {result && (
                        <span className={`text-xs ${result.sent ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                          {result.sent ? 'Sent' : `Failed: ${result.reason ?? 'Unknown error'}`}
                        </span>
                      )}
                      <button
                        onClick={() => handleTestAlert(channel, recipient)}
                        disabled={testAlert.isPending}
                        className="rounded-lg border px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                      >
                        Send test
                      </button>
                    </div>
                  </div>
                )
              }),
            )}
          </section>
        )}

        {canViewOpsSettings && !canEditOpsSettings && (
          <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">
            Operational settings are read-only for your role. Contact an admin to make changes.
          </p>
        )}

        {canViewOpsSettings && (
          <button
            onClick={handleSave}
            disabled={patch.isPending || !canEditOpsSettings}
            className={`w-full rounded-xl py-3 text-sm font-semibold transition-colors disabled:opacity-50 ${
              saved
                ? 'bg-emerald-600 text-white'
                : 'bg-gray-900 text-white hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200'
            }`}
          >
            {patch.isPending ? 'Saving...' : saved ? 'Saved' : 'Save Settings'}
          </button>
        )}
      </div>
    </div>
  )
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="shrink-0 text-sm text-gray-600 dark:text-gray-300">{label}</span>
      {children}
    </div>
  )
}
