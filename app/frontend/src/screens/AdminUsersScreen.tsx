import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { BottomNav } from '../components/BottomNav'
import { CitySwitcher } from '../components/CitySwitcher'
import { useCity } from '../context/CityContext'
import { useTheme } from '../context/ThemeContext'
import { apiFetch } from '../services/api'
import type { TeamMember } from '../hooks/useUsers'
import { ScreenHeader } from '../components/ScreenHeader'
import { Working } from '../components/Logo'

const ROLES = ['admin', 'facilitator', 'supervisor', 'crew'] as const
type Role = (typeof ROLES)[number]

const ROLE_COLORS: Record<Role, string> = {
  admin: 'bg-bg text-[#b86e00]',
  facilitator: 'bg-tint text-ok',
  supervisor: 'bg-tint text-ok',
  crew: 'bg-bg text-ink',
}

export function AdminUsersScreen() {
  const { user: me } = useAuth()
  const { cities, cityQueryId, requiredCityId, isAllCities } = useCity()
  const { toggleTheme } = useTheme()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: users = [], isLoading } = useQuery<TeamMember[]>({
    queryKey: ['admin-users', cityQueryId],
    queryFn: async () => {
      const q = cityQueryId ? `?city_id=${encodeURIComponent(cityQueryId)}` : ''
      const r = await apiFetch(`/admin/users${q}`)
      if (!r.ok) throw new Error('Failed to fetch users')
      return r.json()
    },
  })

  const createMutation = useMutation({
    mutationFn: async (body: { username: string; pin: string; role: string; email: string | null; city_id: string | null; hourly_rate_cents: number | null }) => {
      const r = await apiFetch('/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        throw new Error((err as { detail?: string }).detail ?? 'Failed to create user')
      }
      return r.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      qc.invalidateQueries({ queryKey: ['users'] })
    },
  })

  const patchMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Record<string, unknown> }) => {
      const r = await apiFetch(`/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error('Failed to update user')
      return r.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      qc.invalidateQueries({ queryKey: ['users'] })
    },
  })

  const [showAdd, setShowAdd] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [newPin, setNewPin] = useState('')
  const [newRole, setNewRole] = useState<Role>('crew')
  const [newEmail, setNewEmail] = useState('')
  const [newCityId, setNewCityId] = useState('')
  const [newHourlyRate, setNewHourlyRate] = useState('')
  const [createError, setCreateError] = useState('')

  const [editUser, setEditUser] = useState<TeamMember | null>(null)
  const [editRole, setEditRole] = useState<Role>('crew')
  const [editPin, setEditPin] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editCityId, setEditCityId] = useState('')
  const [editActive, setEditActive] = useState(true)
  const [editHourlyRate, setEditHourlyRate] = useState('')
  const [editError, setEditError] = useState('')

  async function handleCreate() {
    setCreateError('')
    try {
      await createMutation.mutateAsync({
        username: newUsername.trim(),
        pin: newPin,
        role: newRole,
        email: newEmail.trim() || null,
        city_id: newRole === 'admin' && !newCityId ? null : (newCityId || requiredCityId),
        hourly_rate_cents: newHourlyRate ? Math.round(parseFloat(newHourlyRate) * 100) : null,
      })
      setShowAdd(false)
      setNewUsername('')
      setNewPin('')
      setNewRole('crew')
      setNewEmail('')
      setNewCityId(requiredCityId)
      setNewHourlyRate('')
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : 'Error')
    }
  }

  async function handlePatch() {
    if (!editUser) return
    setEditError('')
    try {
      const body: Record<string, unknown> = { role: editRole, is_active: editActive }
      body.city_id = editRole === 'admin' && !editCityId ? null : (editCityId || requiredCityId)
      if (editPin) body.pin = editPin
      if (editEmail !== (editUser.email ?? '')) body.email = editEmail || null
      body.hourly_rate_cents = editHourlyRate ? Math.round(parseFloat(editHourlyRate) * 100) : null
      await patchMutation.mutateAsync({ id: editUser.id, body })
      setEditUser(null)
      setEditEmail('')
      setEditHourlyRate('')
    } catch (e: unknown) {
      setEditError(e instanceof Error ? e.message : 'Error')
    }
  }

  if (isLoading) return <div className="min-h-screen bg-bg"><Working label="Loading team…" /></div>

  return (
    <div className="min-h-screen bg-bg pb-16">
      <ScreenHeader title="Team" onBack={() => navigate('/admin')} right={<CitySwitcher variant="pill" />} />
      <div className="mx-auto flex max-w-3xl flex-wrap gap-2 px-3.5 pt-3">
        <button type="button" onClick={() => { setNewCityId(requiredCityId); setShowAdd(true) }} className="wd-btn-sm">Add user</button>
      </div>

      <main className="p-4 space-y-3 pb-10">
        {users.map(u => (
          <div key={u.id} className="bg-sf rounded-card shadow-sm border border-ln p-4 flex justify-between items-center">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <p className="font-semibold text-ink">{u.username}</p>
                {u.id === me?.id && <span className="text-xs text-mu">(you)</span>}
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${ROLE_COLORS[u.role as Role] ?? ''}`}>
                  {u.role}
                </span>
                {!u.is_active && <span className="text-xs text-danger font-medium">Inactive</span>}
                {isAllCities && u.city_name && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-tint text-ok">
                    {u.city_name}
                  </span>
                )}
              </div>
              {u.email && <span className="text-xs text-mu">{u.email}</span>}
              {u.hourly_rate_cents != null && (
                <span className="text-xs text-mu">
                  ${(u.hourly_rate_cents / 100).toFixed(2)}/hr
                </span>
              )}
            </div>
            <button
              onClick={() => { setEditUser(u); setEditRole(u.role as Role); setEditActive(u.is_active); setEditPin(''); setEditEmail(u.email ?? ''); setEditCityId(u.city_id ?? ''); setEditHourlyRate(u.hourly_rate_cents != null ? (u.hourly_rate_cents / 100).toFixed(2) : '') }}
              className="text-sm text-ok hover:underline"
            >
              Edit
            </button>
          </div>
        ))}
      </main>

      {showAdd && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-sf rounded-panel p-6 w-full max-w-sm">
            <h2 className="text-lg font-bold text-ink mb-4">Add User</h2>
            <input
              className="w-full border rounded-chip px-3 py-2 mb-3 text-ink focus:outline-none focus:ring-2 focus:ring-pr"
              placeholder="Username"
              value={newUsername}
              onChange={e => setNewUsername(e.target.value)}
            />
            <input
              className="w-full border rounded-chip px-3 py-2 mb-3 text-ink focus:outline-none focus:ring-2 focus:ring-pr"
              placeholder="PIN (4 digits)"
              value={newPin}
              onChange={e => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              type="password"
              inputMode="numeric"
            />
            <select
              className="w-full border rounded-chip px-3 py-2 mb-3 text-ink focus:outline-none focus:ring-2 focus:ring-pr"
              value={newRole}
              onChange={e => {
                const role = e.target.value as Role
                setNewRole(role)
                if (role !== 'admin' && !newCityId) setNewCityId(requiredCityId)
              }}
            >
              {ROLES.map(r => <option key={r} value={r} className="capitalize">{r}</option>)}
            </select>
            <label className="block text-xs font-semibold text-mu mb-1">City</label>
            <select
              className="w-full border rounded-chip px-3 py-2 mb-3 text-ink focus:outline-none focus:ring-2 focus:ring-pr"
              value={newCityId}
              onChange={e => setNewCityId(e.target.value)}
            >
              {newRole === 'admin' && <option value="">No default city</option>}
              {cities.map(city => <option key={city.id} value={city.id}>{city.name}</option>)}
            </select>
            <input
              className="w-full border rounded-chip px-3 py-2 mb-3 text-ink focus:outline-none focus:ring-2 focus:ring-pr"
              placeholder="Google email (optional, for calendar invites)"
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              type="email"
              inputMode="email"
            />
            <div className="mb-4">
              <label className="block text-xs text-mu mb-1">
                Hourly rate ($/hr)
                <span className="ml-1 font-normal text-mu">— for crew hourly pay</span>
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={newHourlyRate}
                onChange={e => setNewHourlyRate(e.target.value)}
                placeholder="e.g. 18.00"
                className="w-full border border-ln rounded-chip px-3 py-2 text-sm bg-sf text-ink"
              />
            </div>
            {createError && <p className="text-danger text-sm mb-3">{createError}</p>}
            <div className="flex gap-3">
              <button
                onClick={handleCreate}
                disabled={!newUsername.trim() || newPin.length !== 4 || (newRole !== 'admin' && !(newCityId || requiredCityId)) || createMutation.isPending}
                className="flex-1 py-2 bg-pr text-white rounded-card text-sm font-semibold disabled:opacity-40"
              >
                Create
              </button>
              <button
                onClick={() => { setShowAdd(false); setCreateError('') }}
                className="flex-1 py-2 bg-bg text-ink rounded-card text-sm font-semibold"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {editUser && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-sf rounded-panel p-6 w-full max-w-sm">
            <h2 className="text-lg font-bold text-ink mb-1">Edit {editUser.username}</h2>
            <p className="text-xs text-mu mb-4">Changes apply immediately.</p>
            <label className="block text-xs font-semibold text-mu mb-1">Role</label>
            <select
              className="w-full border rounded-chip px-3 py-2 mb-3 text-ink focus:outline-none focus:ring-2 focus:ring-pr"
              value={editRole}
              onChange={e => {
                const role = e.target.value as Role
                setEditRole(role)
                if (role !== 'admin' && !editCityId) setEditCityId(requiredCityId)
              }}
            >
              {ROLES.map(r => <option key={r} value={r} className="capitalize">{r}</option>)}
            </select>
            <label className="block text-xs font-semibold text-mu mb-1">City</label>
            <select
              className="w-full border rounded-chip px-3 py-2 mb-3 text-ink focus:outline-none focus:ring-2 focus:ring-pr"
              value={editCityId}
              onChange={e => setEditCityId(e.target.value)}
            >
              {editRole === 'admin' && <option value="">No default city</option>}
              {cities.map(city => <option key={city.id} value={city.id}>{city.name}</option>)}
            </select>
            <label className="block text-xs font-semibold text-mu mb-1">New PIN (leave blank to keep current)</label>
            <input
              className="w-full border rounded-chip px-3 py-2 mb-3 text-ink focus:outline-none focus:ring-2 focus:ring-pr"
              placeholder="New PIN"
              value={editPin}
              onChange={e => setEditPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              type="password"
              inputMode="numeric"
            />
            <label className="flex items-center gap-2 mb-3 cursor-pointer">
              <input
                type="checkbox"
                className="rounded"
                checked={editActive}
                onChange={e => setEditActive(e.target.checked)}
              />
              <span className="text-sm text-ink">Active</span>
            </label>
            <label className="block text-xs font-semibold text-mu mb-1">Google email (for calendar invites)</label>
            <input
              className="w-full border rounded-chip px-3 py-2 mb-3 text-ink focus:outline-none focus:ring-2 focus:ring-pr"
              placeholder="name@gmail.com"
              value={editEmail}
              onChange={e => setEditEmail(e.target.value)}
              type="email"
              inputMode="email"
            />
            <div className="mb-4">
              <label className="block text-xs font-semibold text-mu mb-1">
                Hourly rate ($/hr)
                <span className="ml-1 font-normal text-mu">— for crew hourly pay</span>
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={editHourlyRate}
                onChange={e => setEditHourlyRate(e.target.value)}
                placeholder="e.g. 18.00"
                className="w-full border border-ln rounded-chip px-3 py-2 text-sm bg-sf text-ink"
              />
              {!editHourlyRate && editUser?.hourly_rate_cents != null && (
                <p className="text-xs text-[#b86e00] mt-1">
                  Clearing this rate will prevent future hourly pay entries for this user.
                </p>
              )}
            </div>
            {editError && <p className="text-danger text-sm mb-3">{editError}</p>}
            <div className="flex gap-3">
              <button
                onClick={handlePatch}
                disabled={patchMutation.isPending}
                className="flex-1 py-2 bg-pr text-white rounded-card text-sm font-semibold disabled:opacity-40"
              >
                Save
              </button>
              <button
                onClick={() => { setEditUser(null); setEditError(''); setEditHourlyRate('') }}
                className="flex-1 py-2 bg-bg text-ink rounded-card text-sm font-semibold"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      <BottomNav />
    </div>
  )
}
