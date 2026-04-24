import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../services/api'

export interface TeamMember {
  id: string
  username: string
  role: string
  is_active: boolean
  email: string | null
}

export function useUsers() {
  return useQuery<TeamMember[]>({
    queryKey: ['users'],
    queryFn: async () => {
      const r = await apiFetch('/users')
      if (!r.ok) throw new Error('Failed to fetch users')
      return r.json()
    },
  })
}
