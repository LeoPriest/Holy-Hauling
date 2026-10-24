import { useCity } from '../context/CityContext'
import { useAuth } from '../context/AuthContext'

export function CitySwitcher({ allowAll = true, variant = 'default' }: { allowAll?: boolean; variant?: 'default' | 'pill' }) {
  const { user } = useAuth()
  const { cities, selectedCityId, setSelectedCityId, requiredCityId } = useCity()
  if (user?.role !== 'admin' || cities.length === 0) return null

  const value = allowAll ? selectedCityId : (selectedCityId || requiredCityId)

  return (
    <select
      className={variant === 'pill'
        ? 'wd-city appearance-none pr-3'
        : 'rounded-chip border border-ln bg-sf px-2 py-1.5 text-xs font-medium text-ink'}
      value={value}
      onChange={event => setSelectedCityId(event.target.value)}
      aria-label="City"
    >
      {allowAll && <option value="">All cities</option>}
      {cities.map(city => (
        <option key={city.id} value={city.id}>{city.name}</option>
      ))}
    </select>
  )
}
