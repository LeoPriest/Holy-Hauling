import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../services/api'
import type { City, CityCreate, CityPatch } from '../types/city'

export function useCities(enabled = true) {
  return useQuery<City[]>({
    queryKey: ['cities'],
    enabled,
    queryFn: async () => {
      const r = await apiFetch('/admin/cities')
      if (!r.ok) throw new Error('Failed to fetch cities')
      return r.json()
    },
  })
}

export function useCreateCity() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: CityCreate) => {
      const r = await apiFetch('/admin/cities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        throw new Error((err as { detail?: string }).detail ?? 'Failed to create city')
      }
      return r.json() as Promise<City>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cities'] }),
  })
}

export function usePatchCity() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: CityPatch }) => {
      const r = await apiFetch(`/admin/cities/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error('Failed to update city')
      return r.json() as Promise<City>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cities'] }),
  })
}
