import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getStandardKit, putStandardKit, type StandardKit } from '../services/api'

export function useStandardKit() {
  return useQuery<StandardKit>({
    queryKey: ['standard-kit'],
    queryFn: getStandardKit,
  })
}

export function useSaveStandardKit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (items: string[]) => putStandardKit(items),
    onSuccess: data => qc.setQueryData(['standard-kit'], data),
  })
}
