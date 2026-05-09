import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../services/api'
import { useCity } from '../context/CityContext'

export interface TeamMember {
  id: string
  username: string
  role: string
  city_id: string | null
  city_name: string | null
  city_slug: string | null
  is_active: boolean
  email: string | null
  unavailable_dates: string[]
  unavailable_weekdays: Array<'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'>
}

export function useUsers(enabled = true) {
  const { cityQueryId } = useCity()
  return useQuery<TeamMember[]>({
    queryKey: ['users', cityQueryId],
    enabled,
    queryFn: async () => {
      const q = cityQueryId ? `?city_id=${encodeURIComponent(cityQueryId)}` : ''
      const r = await apiFetch(`/users${q}`)
      if (!r.ok) throw new Error('Failed to fetch users')
      return r.json()
    },
  })
}
