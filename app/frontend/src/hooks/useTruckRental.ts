import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../services/api'
import { useCity } from '../context/CityContext'
import type { RentalConfirmationExtract, RentalFilters, TruckRental, TruckRentalInput } from '../types/truck_rental'

// ── Per-lead hooks ─────────────────────────────────────────────────────────

export function useTruckRental(leadId: string) {
  return useQuery<TruckRental | null>({
    queryKey: ['truck-rental', leadId],
    queryFn: async () => {
      const r = await apiFetch(`/leads/${leadId}/rental`)
      if (r.status === 404) { await r.text().catch(() => {}); return null }
      if (!r.ok) throw new Error('Failed to fetch truck rental')
      return r.json()
    },
    retry: false,
  })
}

export function useUpsertTruckRental(leadId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: TruckRentalInput) => {
      const r = await apiFetch(`/leads/${leadId}/rental`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        throw new Error((err as { detail?: string }).detail ?? 'Failed to save rental')
      }
      return r.json() as Promise<TruckRental>
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['truck-rental', leadId] })
      qc.invalidateQueries({ queryKey: ['rentals'] })
    },
  })
}

export function useDeleteTruckRental(leadId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const r = await apiFetch(`/leads/${leadId}/rental`, { method: 'DELETE' })
      if (!r.ok) throw new Error('Failed to delete rental')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['truck-rental', leadId] })
      qc.invalidateQueries({ queryKey: ['rentals'] })
    },
  })
}

export function useUploadReceipt(leadId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData()
      form.append('file', file)
      const r = await apiFetch(`/leads/${leadId}/rental/receipt`, {
        method: 'POST',
        body: form,
      })
      if (!r.ok) throw new Error('Failed to upload receipt')
      return r.json() as Promise<TruckRental>
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['truck-rental', leadId] })
    },
  })
}

export function useDeleteReceipt(leadId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const r = await apiFetch(`/leads/${leadId}/rental/receipt`, { method: 'DELETE' })
      if (!r.ok) throw new Error('Failed to delete receipt')
      return r.json() as Promise<TruckRental>
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['truck-rental', leadId] })
    },
  })
}

export function useUploadConfirmation(leadId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData()
      form.append('file', file)
      const r = await apiFetch(`/leads/${leadId}/rental/confirmation`, { method: 'POST', body: form })
      if (!r.ok) throw new Error('Failed to upload confirmation')
      return r.json() as Promise<TruckRental>
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['truck-rental', leadId] })
    },
  })
}

export function useExtractConfirmation(leadId: string) {
  return useMutation({
    mutationFn: async () => {
      const r = await apiFetch(`/leads/${leadId}/rental/confirmation/extract`, { method: 'POST' })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        throw new Error((err as { detail?: string }).detail ?? 'Extraction failed')
      }
      return r.json() as Promise<RentalConfirmationExtract>
    },
  })
}

export function useDeleteConfirmation(leadId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const r = await apiFetch(`/leads/${leadId}/rental/confirmation`, { method: 'DELETE' })
      if (!r.ok) throw new Error('Failed to delete confirmation')
      return r.json() as Promise<TruckRental>
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['truck-rental', leadId] })
    },
  })
}

// ── Admin list hook ────────────────────────────────────────────────────────

export function useRentals(filters: RentalFilters = {}) {
  const { cityQueryId } = useCity()
  const scoped = { ...filters, city_id: cityQueryId }
  return useQuery<TruckRental[]>({
    queryKey: ['rentals', scoped],
    queryFn: async () => {
      const q = new URLSearchParams()
      if (scoped.status) q.set('status', scoped.status)
      if (scoped.city_id) q.set('city_id', scoped.city_id)
      const qs = q.toString()
      const r = await apiFetch(`/admin/rentals${qs ? '?' + qs : ''}`)
      if (!r.ok) throw new Error('Failed to fetch rentals')
      return r.json()
    },
  })
}
