// app/frontend/src/hooks/useRecurringExpenses.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../services/api'
import { useCity } from '../context/CityContext'
import type { LogResult, RecurringExpense, RecurringExpenseInput, RecurringExpensePatch } from '../types/recurringExpense'

export function useRecurringExpenses() {
  const { cityQueryId } = useCity()
  return useQuery<RecurringExpense[]>({
    queryKey: ['recurring-expenses', cityQueryId],
    queryFn: async () => {
      const q = cityQueryId ? `?city_id=${encodeURIComponent(cityQueryId)}` : ''
      const r = await apiFetch(`/admin/recurring-expenses${q}`)
      if (!r.ok) throw new Error('Failed to fetch recurring expenses')
      return r.json()
    },
  })
}

export function useDueRecurringExpenses() {
  const { cityQueryId } = useCity()
  return useQuery<RecurringExpense[]>({
    queryKey: ['recurring-expenses-due', cityQueryId],
    queryFn: async () => {
      const q = cityQueryId ? `?city_id=${encodeURIComponent(cityQueryId)}` : ''
      const r = await apiFetch(`/admin/recurring-expenses/due${q}`)
      if (!r.ok) throw new Error('Failed to fetch due expenses')
      return r.json()
    },
  })
}

export function useCreateRecurringExpense() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: RecurringExpenseInput) => {
      const r = await apiFetch('/admin/recurring-expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        throw new Error((err as { detail?: string }).detail ?? 'Failed to create')
      }
      return r.json() as Promise<RecurringExpense>
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recurring-expenses'] })
      qc.invalidateQueries({ queryKey: ['recurring-expenses-due'] })
    },
  })
}

export function usePatchRecurringExpense() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: RecurringExpensePatch }) => {
      const r = await apiFetch(`/admin/recurring-expenses/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error('Failed to update')
      return r.json() as Promise<RecurringExpense>
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recurring-expenses'] })
      qc.invalidateQueries({ queryKey: ['recurring-expenses-due'] })
    },
  })
}

export function useDeleteRecurringExpense() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const r = await apiFetch(`/admin/recurring-expenses/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error('Failed to delete')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recurring-expenses'] })
      qc.invalidateQueries({ queryKey: ['recurring-expenses-due'] })
    },
  })
}

export function useLogRecurringExpense() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const r = await apiFetch(`/admin/recurring-expenses/${id}/log`, { method: 'POST' })
      if (!r.ok) throw new Error('Failed to log expense')
      return r.json() as Promise<LogResult>
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recurring-expenses'] })
      qc.invalidateQueries({ queryKey: ['recurring-expenses-due'] })
      qc.invalidateQueries({ queryKey: ['finances'] })
    },
  })
}
