import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSettings, usePatchSettings, useTestAlert } from '../hooks/useSettings'
import type { SettingsPatch, TestAlertRequest } from '../types/lead'

type TestKey = `${TestAlertRequest['channel']}_${TestAlertRequest['recipient']}`
type TestState = { sent: boolean; reason?: string | null }

export function SettingsScreen() {
  const navigate = useNavigate()
  const { data: settings, isLoading } = useSettings()
  const patch = usePatchSettings()
  const testAlert = useTestAlert()

  const [form, setForm] = useState<SettingsPatch>({})
  const [saved, setSaved] = useState(false)
  const [testResults, setTestResults] = useState<Partial<Record<TestKey, TestState>>>({})

  useEffect(() => {
    if (settings) {
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
    }
  }, [settings])

  const set = (key: keyof SettingsPatch, value: unknown) =>
    setForm(prev => ({ ...prev, [key]: value }))

  const handleSave = () => {
    patch.mutate(form, {
      onSuccess: () => {
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      },
    })
  }

  const handleTestAlert = (channel: TestAlertRequest['channel'], recipient: TestAlertRequest['recipient']) => {
    const key: TestKey = `${channel}_${recipient}`
    testAlert.mutate({ channel, recipient }, {
      onSuccess: result => setTestResults(prev => ({ ...prev, [key]: result })),
      onError: () => setTestResults(prev => ({ ...prev, [key]: { sent: false, reason: 'Request failed' } })),
    })
  }

  if (isLoading) return <div className="p-6 text-gray-400">Loading…</div>

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate('/')} className="text-gray-500 hover:text-gray-800 text-lg">←</button>
        <h1 className="font-bold text-gray-900 text-lg">Settings</h1>
      </header>

      <div className="p-4 space-y-6 pb-20">

        {/* Alert Thresholds */}
        <section className="bg-white rounded-xl border p-4 space-y-3">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Alert Thresholds</h2>
          <FieldRow label="T1 warning (minutes)">
            <input
              type="number" min={1} max={120}
              className="border rounded-lg px-3 py-1.5 text-sm w-20 text-right"
              value={form.t1_minutes ?? ''}
              onChange={e => set('t1_minutes', Number(e.target.value))}
            />
          </FieldRow>
          <FieldRow label="T2 escalation (minutes)">
            <input
              type="number" min={1} max={240}
              className="border rounded-lg px-3 py-1.5 text-sm w-20 text-right"
              value={form.t2_minutes ?? ''}
              onChange={e => set('t2_minutes', Number(e.target.value))}
            />
          </FieldRow>
        </section>

        {/* Quiet Hours */}
        <section className="bg-white rounded-xl border p-4 space-y-3">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Quiet Hours</h2>
          <FieldRow label="Enable quiet hours">
            <input
              type="checkbox"
              className="w-4 h-4"
              checked={form.quiet_hours_enabled ?? false}
              onChange={e => set('quiet_hours_enabled', e.target.checked)}
            />
          </FieldRow>
          <FieldRow label="Start (HH:MM)">
            <input
              type="time"
              className="border rounded-lg px-3 py-1.5 text-sm"
              value={form.quiet_hours_start ?? '22:00'}
              onChange={e => set('quiet_hours_start', e.target.value)}
            />
          </FieldRow>
          <FieldRow label="End (HH:MM)">
            <input
              type="time"
              className="border rounded-lg px-3 py-1.5 text-sm"
              value={form.quiet_hours_end ?? '07:00'}
              onChange={e => set('quiet_hours_end', e.target.value)}
            />
          </FieldRow>
        </section>

        {/* Primary Facilitator */}
        <section className="bg-white rounded-xl border p-4 space-y-3">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Primary Facilitator</h2>
          <FieldRow label="SMS number">
            <input
              type="tel"
              className="border rounded-lg px-3 py-1.5 text-sm flex-1"
              placeholder="+15551234567"
              value={form.primary_sms ?? ''}
              onChange={e => set('primary_sms', e.target.value)}
            />
          </FieldRow>
          <FieldRow label="Email">
            <input
              type="email"
              className="border rounded-lg px-3 py-1.5 text-sm flex-1"
              placeholder="you@example.com"
              value={form.primary_email ?? ''}
              onChange={e => set('primary_email', e.target.value)}
            />
          </FieldRow>
        </section>

        {/* Backup Handler */}
        <section className="bg-white rounded-xl border p-4 space-y-3">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Backup Handler</h2>
          <FieldRow label="Name">
            <input
              type="text"
              className="border rounded-lg px-3 py-1.5 text-sm flex-1"
              placeholder="Jordan"
              value={form.backup_name ?? ''}
              onChange={e => set('backup_name', e.target.value)}
            />
          </FieldRow>
          <FieldRow label="SMS number">
            <input
              type="tel"
              className="border rounded-lg px-3 py-1.5 text-sm flex-1"
              placeholder="+15559876543"
              value={form.backup_sms ?? ''}
              onChange={e => set('backup_sms', e.target.value)}
            />
          </FieldRow>
          <FieldRow label="Email">
            <input
              type="email"
              className="border rounded-lg px-3 py-1.5 text-sm flex-1"
              placeholder="backup@example.com"
              value={form.backup_email ?? ''}
              onChange={e => set('backup_email', e.target.value)}
            />
          </FieldRow>
        </section>

        {/* Test Alerts */}
        <section className="bg-white rounded-xl border p-4 space-y-3">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Test Alerts</h2>
          {(['sms', 'email'] as const).flatMap(channel =>
            (['primary', 'backup'] as const).map(recipient => {
              const key: TestKey = `${channel}_${recipient}`
              const result = testResults[key]
              return (
                <div key={key} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-gray-600 capitalize">
                    {channel.toUpperCase()} → {recipient}
                  </span>
                  <div className="flex items-center gap-2">
                    {result && (
                      <span className={`text-xs ${result.sent ? 'text-emerald-600' : 'text-red-600'}`}>
                        {result.sent ? '✓ Sent' : `✗ ${result.reason ?? 'Failed'}`}
                      </span>
                    )}
                    <button
                      onClick={() => handleTestAlert(channel, recipient)}
                      disabled={testAlert.isPending}
                      className="text-xs border rounded-lg px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Send test
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </section>

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={patch.isPending}
          className={`w-full py-3 rounded-xl text-sm font-semibold transition-colors ${
            saved
              ? 'bg-emerald-600 text-white'
              : 'bg-gray-900 text-white hover:bg-gray-700'
          } disabled:opacity-50`}
        >
          {patch.isPending ? 'Saving…' : saved ? '✓ Saved' : 'Save Settings'}
        </button>
      </div>
    </div>
  )
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-gray-600 shrink-0">{label}</span>
      {children}
    </div>
  )
}
