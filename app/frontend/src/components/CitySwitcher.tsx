import { useCity } from '../context/CityContext'
import { useAuth } from '../context/AuthContext'

export function CitySwitcher({ allowAll = true }: { allowAll?: boolean }) {
  const { user } = useAuth()
  const { cities, selectedCityId, setSelectedCityId, requiredCityId } = useCity()
  if (user?.role !== 'admin' || cities.length === 0) return null

  const value = allowAll ? selectedCityId : (selectedCityId || requiredCityId)

  return (
    <select
      className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs font-medium text-gray-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
      value={value}
      onChange={event => setSelectedCityId(event.target.value)}
      title="City"
    >
      {allowAll && <option value="">All cities</option>}
      {cities.map(city => (
        <option key={city.id} value={city.id}>{city.name}</option>
      ))}
    </select>
  )
}
