import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../services/api'

export interface TeamMember {
  id: string
  username: string
  role: string
  is_active: boolean
  email: string | null
  unavailable_dates: string[]
  unavailable_weekdays: Array<'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'>
}

export function useUsers(enabled = true) {
  return useQuery<TeamMember[]>({
    queryKey: ['users'],
    enabled,
    queryFn: async () => {
      const r = await apiFetch('/users')
      if (!r.ok) throw new Error('Failed to fetch users')
      return r.json()
    },
  })
}
