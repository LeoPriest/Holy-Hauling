import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchMyAvailability, saveMyAvailability, type WeeklyAvailability } from '../services/api'

export type UserWeeklyAvailability = WeeklyAvailability

export function useMyAvailability() {
  return useQuery<UserWeeklyAvailability>({
    queryKey: ['my-availability'],
    queryFn: fetchMyAvailability,
  })
}

export function useSaveMyAvailability() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: saveMyAvailability,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-availability'] })
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })
}
