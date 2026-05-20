import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../services/api'
import { useCity } from '../context/CityContext'
import type { PayRecord, PayRecordInput, PayrollFilters, PayrollUserSummary } from '../types/payroll'

export function usePayRecords(leadId: string) {
  return useQuery<PayRecord[]>({
    queryKey: ['pay-records', leadId],
    queryFn: async () => {
      const r = await apiFetch(`/leads/${leadId}/pay-records`)
      if (!r.ok) throw new Error('Failed to fetch pay records')
      return r.json()
    },
  })
}

export function useUpsertPayRecord(leadId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: PayRecordInput) => {
      const r = await apiFetch(`/leads/${leadId}/pay-records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        throw new Error((err as { detail?: string }).detail ?? 'Failed to save pay record')
      }
      return r.json() as Promise<PayRecord>
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pay-records', leadId] })
      qc.invalidateQueries({ queryKey: ['payroll'] })
    },
  })
}

export function useDeletePayRecord(leadId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (recordId: string) => {
      const r = await apiFetch(`/leads/${leadId}/pay-records/${recordId}`, { method: 'DELETE' })
      if (!r.ok) throw new Error('Failed to delete pay record')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pay-records', leadId] })
      qc.invalidateQueries({ queryKey: ['payroll'] })
    },
  })
}

export function usePayrollSummary(filters: PayrollFilters = {}) {
  const { cityQueryId } = useCity()
  const scoped = { ...filters, city_id: filters.city_id ?? cityQueryId ?? undefined }
  return useQuery<PayrollUserSummary[]>({
    queryKey: ['payroll', scoped],
    queryFn: async () => {
      const q = new URLSearchParams()
      if (scoped.city_id) q.set('city_id', scoped.city_id)
      if (scoped.date_from) q.set('date_from', scoped.date_from)
      if (scoped.date_to) q.set('date_to', scoped.date_to)
      const qs = q.toString()
      const r = await apiFetch(`/admin/payroll${qs ? '?' + qs : ''}`)
      if (!r.ok) throw new Error('Failed to fetch payroll summary')
      return r.json()
    },
  })
}
