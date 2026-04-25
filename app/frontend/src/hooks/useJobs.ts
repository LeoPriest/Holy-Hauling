import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../services/api'
import type { QuoteModifier } from '../types/lead'
import { parseUtc } from '../utils/time'

export interface Job {
  id: string
  customer_name: string | null
  service_type: string
  job_location: string | null
  job_address: string | null
  job_date_requested: string | null
  appointment_time_slot: string | null
  estimated_job_duration_minutes: number | null
  scope_notes: string | null
  crew: string[]
  customer_phone?: string | null
  quote_context?: string | null
  quoted_price_total?: number | null
  quote_modifiers?: QuoteModifier[] | null
  has_google_calendar_event: boolean
  job_phase: 'dispatched' | 'en_route' | 'arrived' | 'started' | null
  dispatched_at: string | null
  en_route_at: string | null
  arrived_at: string | null
  started_at: string | null
}

export function useJobs() {
  return useQuery<Job[]>({
    queryKey: ['jobs'],
    queryFn: async () => {
      const r = await apiFetch('/jobs')
      if (!r.ok) throw new Error('Failed to fetch jobs')
      return r.json()
    },
  })
}

export function usePatchJobStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const r = await apiFetch(`/jobs/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!r.ok) throw new Error('Failed to update job status')
      return r.json() as Promise<Job>
    },
    onSuccess: (_data, { id, status }) => {
      if (status === 'completed') {
        qc.setQueryData<Job[]>(['jobs'], prev => (prev ?? []).filter(j => j.id !== id))
      } else {
        qc.invalidateQueries({ queryKey: ['jobs'] })
      }
    },
  })
}

export function useAddJobAssignment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ jobId, userId }: { jobId: string; userId: string }) => {
      const r = await apiFetch(`/jobs/${jobId}/assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      })
      if (!r.ok) throw new Error('Failed to add assignment')
      return r.json() as Promise<Job>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  })
}

export function useRemoveJobAssignment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ jobId, userId }: { jobId: string; userId: string }) => {
      const r = await apiFetch(`/jobs/${jobId}/assignments/${userId}`, { method: 'DELETE' })
      if (!r.ok) throw new Error('Failed to remove assignment')
      return r.json() as Promise<Job>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  })
}

export function useSyncJobCalendar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (jobId: string) => {
      const r = await apiFetch(`/jobs/${jobId}/sync-google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!r.ok) {
        const body = await r.json().catch(() => null)
        throw new Error(body?.detail ?? 'Failed to sync Google Calendar event')
      }
      return r.json() as Promise<Job>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  })
}

export function useAddJobNote() {
  return useMutation({
    mutationFn: async ({ leadId, note, actor }: { leadId: string; note: string; actor?: string }) => {
      const r = await apiFetch(`/leads/${leadId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: note, actor }),
      })
      if (!r.ok) throw new Error('Failed to add note')
      return r.json()
    },
  })
}

/** Returns a live elapsed string updated every 30 s. Returns null if no timestamp. */
export function useElapsedTime(isoString: string | null): string | null {
  const [elapsed, setElapsed] = useState<string | null>(null)

  useEffect(() => {
    if (!isoString) { setElapsed(null); return }

    const compute = () => {
      const ms = Date.now() - parseUtc(isoString).getTime()
      const h = Math.floor(ms / 3_600_000)
      const m = Math.floor((ms % 3_600_000) / 60_000)
      setElapsed(h > 0 ? `${h}h ${m}m` : `${m}m`)
    }

    compute()
    const id = setInterval(compute, 30_000)
    return () => clearInterval(id)
  }, [isoString])

  return elapsed
}
