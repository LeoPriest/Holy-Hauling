import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useAuth } from './AuthContext'
import { useCities } from '../hooks/useCities'
import type { City } from '../types/city'

const STORAGE_KEY = 'hh_selected_city_id'

interface CityContextValue {
  cities: City[]
  selectedCityId: string
  selectedCity: City | null
  cityQueryId: string | undefined
  requiredCityId: string
  setSelectedCityId: (cityId: string) => void
  isAllCities: boolean
}

const CityContext = createContext<CityContextValue | null>(null)

export function CityProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [selectedCityId, setSelectedCityIdState] = useState(() => localStorage.getItem(STORAGE_KEY) ?? '')
  const { data: adminCities = [] } = useCities(user?.role === 'admin')
  const activeAdminCities = adminCities.length > 0
    ? adminCities.filter(city => city.is_active)
    : (user?.available_cities ?? [])
  const cities = user?.role === 'admin' ? activeAdminCities : (user?.available_cities ?? [])
  const firstCityId = cities[0]?.id ?? user?.city_id ?? ''

  useEffect(() => {
    if (!user) {
      setSelectedCityIdState('')
      return
    }
    if (user.role !== 'admin') {
      setSelectedCityIdState(user.city_id ?? '')
      return
    }
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === '') {
      setSelectedCityIdState('')
      return
    }
    if (stored && cities.some(city => city.id === stored)) {
      setSelectedCityIdState(stored)
      return
    }
    setSelectedCityIdState(firstCityId)
  }, [user, cities, firstCityId])

  const setSelectedCityId = useCallback((cityId: string) => {
    if (user?.role !== 'admin') return
    localStorage.setItem(STORAGE_KEY, cityId)
    setSelectedCityIdState(cityId)
  }, [user?.role])

  const value = useMemo<CityContextValue>(() => {
    const selectedCity = cities.find(city => city.id === selectedCityId) ?? null
    const isAllCities = user?.role === 'admin' && selectedCityId === ''
    return {
      cities,
      selectedCityId,
      selectedCity,
      cityQueryId: user?.role === 'admin' ? (selectedCityId || undefined) : (user?.city_id ?? undefined),
      requiredCityId: selectedCityId || user?.city_id || firstCityId,
      setSelectedCityId,
      isAllCities,
    }
  }, [cities, firstCityId, selectedCityId, setSelectedCityId, user])

  return <CityContext.Provider value={value}>{children}</CityContext.Provider>
}

export function useCity(): CityContextValue {
  const ctx = useContext(CityContext)
  if (!ctx) throw new Error('useCity must be used within CityProvider')
  return ctx
}
