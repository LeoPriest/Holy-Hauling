import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchSettings, patchSettings, testAlert } from '../services/api'
import type { SettingsPatch, TestAlertRequest } from '../types/lead'

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
    staleTime: 60_000,
  })
}

export function usePatchSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: SettingsPatch) => patchSettings(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  })
}

export function useTestAlert() {
  return useMutation({
    mutationFn: (data: TestAlertRequest) => testAlert(data),
  })
}
