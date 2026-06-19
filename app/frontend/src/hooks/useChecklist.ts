import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../services/api'
import type { ChecklistItem } from '../services/api'

const keyFor = (leadId: string) => ['checklist', leadId]

export function useChecklist(leadId: string | null) {
  return useQuery<ChecklistItem[]>({
    queryKey: ['checklist', leadId],
    enabled: !!leadId,
    queryFn: async () => {
      const r = await apiFetch(`/leads/${leadId}/checklist`)
      if (!r.ok) throw new Error('Failed to load checklist')
      return r.json()
    },
  })
}

export function useToggleChecklistItem(leadId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ itemId, isChecked }: { itemId: string; isChecked: boolean }) => {
      const r = await apiFetch(`/leads/${leadId}/checklist/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_checked: isChecked }),
      })
      if (!r.ok) throw new Error('Failed to update item')
      return r.json() as Promise<ChecklistItem>
    },
    onMutate: async ({ itemId, isChecked }) => {
      await qc.cancelQueries({ queryKey: keyFor(leadId) })
      const prev = qc.getQueryData<ChecklistItem[]>(keyFor(leadId))
      qc.setQueryData<ChecklistItem[]>(keyFor(leadId), old =>
        (old ?? []).map(i => (i.id === itemId ? { ...i, is_checked: isChecked } : i)))
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(keyFor(leadId), ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keyFor(leadId) }),
  })
}

export function useAddChecklistItem(leadId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (label: string) => {
      const r = await apiFetch(`/leads/${leadId}/checklist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      })
      if (!r.ok) throw new Error('Failed to add item')
      return r.json() as Promise<ChecklistItem>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keyFor(leadId) }),
  })
}

export function useDeleteChecklistItem(leadId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (itemId: string) => {
      const r = await apiFetch(`/leads/${leadId}/checklist/${itemId}`, { method: 'DELETE' })
      if (!r.ok) throw new Error('Failed to delete item')
      return r.json()
    },
    onMutate: async (itemId: string) => {
      await qc.cancelQueries({ queryKey: keyFor(leadId) })
      const prev = qc.getQueryData<ChecklistItem[]>(keyFor(leadId))
      qc.setQueryData<ChecklistItem[]>(keyFor(leadId), old => (old ?? []).filter(i => i.id !== itemId))
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(keyFor(leadId), ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keyFor(leadId) }),
  })
}
