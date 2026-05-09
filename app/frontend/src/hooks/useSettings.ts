import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchSettings, patchSettings, testAlert } from '../services/api'
import { useCity } from '../context/CityContext'
import type { SettingsPatch, TestAlertRequest } from '../types/lead'

export function useSettings() {
  const { requiredCityId } = useCity()
  return useQuery({
    queryKey: ['settings', requiredCityId],
    queryFn: () => fetchSettings(requiredCityId),
    staleTime: 60_000,
  })
}

export function usePatchSettings() {
  const qc = useQueryClient()
  const { requiredCityId } = useCity()
  return useMutation({
    mutationFn: (data: SettingsPatch) => patchSettings(data, requiredCityId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  })
}

export function useTestAlert() {
  const { requiredCityId } = useCity()
  return useMutation({
    mutationFn: (data: TestAlertRequest) => testAlert(data, requiredCityId),
  })
}
