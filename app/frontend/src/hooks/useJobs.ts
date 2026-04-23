import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../services/api'

export interface Job {
  id: string
  customer_name: string | null
  service_type: string
  job_location: string | null
  job_date_requested: string | null
  scope_notes: string | null
  crew: string[]
  customer_phone?: string | null
  quote_context?: string | null
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
