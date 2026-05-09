import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../services/api'
import { useCity } from '../context/CityContext'
import type {
  FinanceFilters,
  FinanceSummary,
  FinanceTransaction,
  FinanceTransactionInput,
  FinanceTransactionPatch,
} from '../types/finance'

function queryString(filters: FinanceFilters = {}, includeType = true) {
  const q = new URLSearchParams()
  if (filters.start_date) q.set('start_date', filters.start_date)
  if (filters.end_date) q.set('end_date', filters.end_date)
  if (includeType && filters.transaction_type) q.set('transaction_type', filters.transaction_type)
  if (filters.city_id) q.set('city_id', filters.city_id)
  const value = q.toString()
  return value ? `?${value}` : ''
}

export function useFinanceTransactions(filters: FinanceFilters) {
  const { cityQueryId } = useCity()
  const scoped = { ...filters, city_id: cityQueryId }
  return useQuery<FinanceTransaction[]>({
    queryKey: ['finance-transactions', scoped],
    queryFn: async () => {
      const r = await apiFetch(`/admin/finances${queryString(scoped)}`)
      if (!r.ok) throw new Error('Failed to fetch finance transactions')
      return r.json()
    },
  })
}

export function useFinanceSummary(filters: FinanceFilters) {
  const { cityQueryId } = useCity()
  const scoped = { ...filters, city_id: cityQueryId }
  return useQuery<FinanceSummary>({
    queryKey: ['finance-summary', scoped.start_date, scoped.end_date, scoped.city_id],
    queryFn: async () => {
      const r = await apiFetch(`/admin/finances/summary${queryString(scoped, false)}`)
      if (!r.ok) throw new Error('Failed to fetch finance summary')
      return r.json()
    },
  })
}

export function useCreateFinanceTransaction() {
  const qc = useQueryClient()
  const { requiredCityId } = useCity()
  return useMutation({
    mutationFn: async (body: FinanceTransactionInput) => {
      const r = await apiFetch('/admin/finances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, city_id: body.city_id ?? requiredCityId }),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        throw new Error((err as { detail?: string }).detail ?? 'Failed to create transaction')
      }
      return r.json() as Promise<FinanceTransaction>
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['finance-transactions'] })
      qc.invalidateQueries({ queryKey: ['finance-summary'] })
    },
  })
}

export function usePatchFinanceTransaction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: FinanceTransactionPatch }) => {
      const r = await apiFetch(`/admin/finances/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error('Failed to update transaction')
      return r.json() as Promise<FinanceTransaction>
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['finance-transactions'] })
      qc.invalidateQueries({ queryKey: ['finance-summary'] })
    },
  })
}

export function useDeleteFinanceTransaction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const r = await apiFetch(`/admin/finances/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error('Failed to delete transaction')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['finance-transactions'] })
      qc.invalidateQueries({ queryKey: ['finance-summary'] })
    },
  })
}
