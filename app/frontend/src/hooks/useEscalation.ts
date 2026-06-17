import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../services/api'
import { useCity } from '../context/CityContext'
import type { EscalationLevel, EscalationOutcome, LeadEscalation } from '../types/escalation'

export function useLeadEscalation(leadId: string) {
  return useQuery<LeadEscalation | null>({
    queryKey: ['escalation', leadId],
    queryFn: async () => {
      const r = await apiFetch(`/leads/${leadId}/escalation`)
      if (!r.ok) throw new Error('Failed to fetch escalation')
      return r.json()
    },
  })
}

export function useOpenEscalations() {
  const { cityQueryId } = useCity()
  return useQuery<LeadEscalation[]>({
    queryKey: ['escalations', 'open', cityQueryId],
    queryFn: async () => {
      const q = new URLSearchParams({ status: 'open' })
      if (cityQueryId) q.set('city_id', cityQueryId)
      const r = await apiFetch(`/escalations?${q.toString()}`)
      if (!r.ok) throw new Error('Failed to fetch escalations')
      return r.json()
    },
  })
}

export function useSuggestEscalationSummary(leadId: string) {
  return useMutation({
    mutationFn: async () => {
      const r = await apiFetch(`/leads/${leadId}/escalation/suggest`, { method: 'POST' })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        throw new Error((err as { detail?: string }).detail ?? 'Suggestion failed')
      }
      return r.json() as Promise<{ summary: string }>
    },
  })
}

export function useRaiseEscalation(leadId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { level: EscalationLevel; decision_needed: string; summary: string }) => {
      const r = await apiFetch(`/leads/${leadId}/escalation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        throw new Error((err as { detail?: string }).detail ?? 'Failed to escalate')
      }
      return r.json() as Promise<LeadEscalation>
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['escalation', leadId] })
      qc.invalidateQueries({ queryKey: ['escalations', 'open'] })
      qc.invalidateQueries({ queryKey: ['lead', leadId] })
    },
  })
}

export function useResolveEscalation(leadId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { escalationId: string; outcome: EscalationOutcome; resolution_note?: string }) => {
      const r = await apiFetch(`/escalations/${vars.escalationId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome: vars.outcome, resolution_note: vars.resolution_note ?? null }),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        throw new Error((err as { detail?: string }).detail ?? 'Failed to resolve')
      }
      return r.json() as Promise<LeadEscalation>
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['escalation', leadId] })
      qc.invalidateQueries({ queryKey: ['escalations', 'open'] })
      qc.invalidateQueries({ queryKey: ['lead', leadId] })
    },
  })
}
