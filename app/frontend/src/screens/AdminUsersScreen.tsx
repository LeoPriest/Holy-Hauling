import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { apiFetch } from '../services/api'
import type { TeamMember } from '../hooks/useUsers'

const ROLES = ['admin', 'facilitator', 'supervisor', 'crew'] as const
type Role = (typeof ROLES)[number]

const ROLE_COLORS: Record<Role, string> = {
  admin: 'bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200',
  facilitator: 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200',
  supervisor: 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200',
  crew: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300',
}

export function AdminUsersScreen() {
  const { user: me } = useAuth()
  const { toggleTheme } = useTheme()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: users = [], isLoading } = useQuery<TeamMember[]>({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const r = await apiFetch('/admin/users')
      if (!r.ok) throw new Error('Failed to fetch users')
      return r.json()
    },
  })

  const createMutation = useMutation({
    mutationFn: async (body: { username: string; pin: string; role: string }) => {
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
  const [createError, setCreateError] = useState('')

  const [editUser, setEditUser] = useState<TeamMember | null>(null)
  const [editRole, setEditRole] = useState<Role>('crew')
  const [editPin, setEditPin] = useState('')
  const [editActive, setEditActive] = useState(true)
  const [editError, setEditError] = useState('')

  async function handleCreate() {
    setCreateError('')
    try {
      await createMutation.mutateAsync({ username: newUsername.trim(), pin: newPin, role: newRole })
      setShowAdd(false)
      setNewUsername('')
      setNewPin('')
      setNewRole('crew')
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : 'Error')
    }
  }

  async function handlePatch() {
    if (!editUser) return
    setEditError('')
    try {
      const body: Record<string, unknown> = { role: editRole, is_active: editActive }
      if (editPin) body.pin = editPin
      await patchMutation.mutateAsync({ id: editUser.id, body })
      setEditUser(null)
    } catch (e: unknown) {
      setEditError(e instanceof Error ? e.message : 'Error')
    }
  }

  if (isLoading) return <div className="p-8 text-gray-400 dark:text-gray-500">Loading…</div>

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-lg">←</button>
          <h1 className="font-bold text-gray-900 dark:text-white text-lg">Team</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowAdd(true)}
            className="bg-indigo-600 text-white rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-indigo-700"
          >
            Add User
          </button>
        </div>
      </header>

      <main className="p-4 space-y-3 pb-10">
        {users.map(u => (
          <div key={u.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 flex justify-between items-center">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <p className="font-semibold text-gray-900 dark:text-white">{u.username}</p>
                {u.id === me?.id && <span className="text-xs text-gray-400">(you)</span>}
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${ROLE_COLORS[u.role as Role] ?? ''}`}>
                  {u.role}
                </span>
                {!u.is_active && <span className="text-xs text-red-500 dark:text-red-400 font-medium">Inactive</span>}
              </div>
            </div>
            <button
              onClick={() => { setEditUser(u); setEditRole(u.role as Role); setEditActive(u.is_active); setEditPin('') }}
              className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Edit
            </button>
          </div>
        ))}
      </main>

      {showAdd && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-sm">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Add User</h2>
            <input
              className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 mb-3 text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Username"
              value={newUsername}
              onChange={e => setNewUsername(e.target.value)}
            />
            <input
              className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 mb-3 text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="PIN (4 digits)"
              value={newPin}
              onChange={e => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              type="password"
              inputMode="numeric"
            />
            <select
              className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 mb-4 text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={newRole}
              onChange={e => setNewRole(e.target.value as Role)}
            >
              {ROLES.map(r => <option key={r} value={r} className="capitalize">{r}</option>)}
            </select>
            {createError && <p className="text-red-600 dark:text-red-400 text-sm mb-3">{createError}</p>}
            <div className="flex gap-3">
              <button
                onClick={handleCreate}
                disabled={!newUsername.trim() || newPin.length !== 4 || createMutation.isPending}
                className="flex-1 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40"
              >
                Create
              </button>
              <button
                onClick={() => { setShowAdd(false); setCreateError('') }}
                className="flex-1 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-xl text-sm font-semibold"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {editUser && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-sm">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Edit {editUser.username}</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">Changes apply immediately.</p>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Role</label>
            <select
              className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 mb-3 text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={editRole}
              onChange={e => setEditRole(e.target.value as Role)}
            >
              {ROLES.map(r => <option key={r} value={r} className="capitalize">{r}</option>)}
            </select>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">New PIN (leave blank to keep current)</label>
            <input
              className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 mb-3 text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="New PIN"
              value={editPin}
              onChange={e => setEditPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              type="password"
              inputMode="numeric"
            />
            <label className="flex items-center gap-2 mb-5 cursor-pointer">
              <input
                type="checkbox"
                className="rounded"
                checked={editActive}
                onChange={e => setEditActive(e.target.checked)}
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">Active</span>
            </label>
            {editError && <p className="text-red-600 dark:text-red-400 text-sm mb-3">{editError}</p>}
            <div className="flex gap-3">
              <button
                onClick={handlePatch}
                disabled={patchMutation.isPending}
                className="flex-1 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40"
              >
                Save
              </button>
              <button
                onClick={() => { setEditUser(null); setEditError('') }}
                className="flex-1 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-xl text-sm font-semibold"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
