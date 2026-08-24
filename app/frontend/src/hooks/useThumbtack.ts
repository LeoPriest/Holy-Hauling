import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../services/api'
import type {
  ThumbtackConnection,
  ThumbtackConnectionCreate,
  ThumbtackConnectionCreated,
  ThumbtackEvent,
} from '../types/thumbtack'

const CONNECTIONS_KEY = ['thumbtack-connections']

async function detail(r: Response, fallback: string): Promise<string> {
  const err = await r.json().catch(() => ({}))
  return (err as { detail?: string }).detail ?? fallback
}

export function useThumbtackConnections() {
  return useQuery<ThumbtackConnection[]>({
    queryKey: CONNECTIONS_KEY,
    queryFn: async () => {
      const r = await apiFetch('/admin/thumbtack/connections')
      if (!r.ok) throw new Error('Failed to load Thumbtack connections')
      return r.json()
    },
  })
}

export function useThumbtackEvents(connectionId?: string) {
  return useQuery<ThumbtackEvent[]>({
    queryKey: ['thumbtack-events', connectionId ?? 'all'],
    // Deliveries arrive while the screen is open; keep it live without a manual refresh.
    refetchInterval: 15000,
    queryFn: async () => {
      const q = connectionId ? `?connection_id=${encodeURIComponent(connectionId)}` : ''
      const r = await apiFetch(`/admin/thumbtack/events${q}`)
      if (!r.ok) throw new Error('Failed to load Thumbtack events')
      return r.json()
    },
  })
}

export function useCreateThumbtackConnection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: ThumbtackConnectionCreate) => {
      const r = await apiFetch('/admin/thumbtack/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error(await detail(r, 'Failed to create connection'))
      return r.json() as Promise<ThumbtackConnectionCreated>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CONNECTIONS_KEY }),
  })
}

export function useSetThumbtackConnectionActive() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const r = await apiFetch(`/admin/thumbtack/connections/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: isActive }),
      })
      if (!r.ok) throw new Error(await detail(r, 'Failed to update connection'))
      return r.json() as Promise<ThumbtackConnection>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CONNECTIONS_KEY }),
  })
}

export function useDeleteThumbtackConnection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const r = await apiFetch(`/admin/thumbtack/connections/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(await detail(r, 'Failed to delete connection'))
      return id
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CONNECTIONS_KEY })
      void qc.invalidateQueries({ queryKey: ['thumbtack-events'] })
    },
  })
}
