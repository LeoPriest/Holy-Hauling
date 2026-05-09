import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BottomNav } from '../components/BottomNav'
import { useCities, useCreateCity, usePatchCity } from '../hooks/useCities'
import type { City } from '../types/city'

const DEFAULT_TZ = 'America/Chicago'

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function AdminCitiesScreen() {
  const navigate = useNavigate()
  const { data: cities = [], isLoading } = useCities()
  const createCity = useCreateCity()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [timezone, setTimezone] = useState(DEFAULT_TZ)
  const [error, setError] = useState('')

  async function handleCreate() {
    setError('')
    try {
      await createCity.mutateAsync({
        name: name.trim(),
        slug: (slug || slugify(name)).trim(),
        timezone: timezone.trim() || DEFAULT_TZ,
      })
      setName('')
      setSlug('')
      setTimezone(DEFAULT_TZ)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create city')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-16">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/admin')} className="text-sm font-medium text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200">
            Back
          </button>
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">Cities</h1>
        </div>
      </header>

      <main className="space-y-4 p-4 pb-12">
        <section className="rounded-xl border bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Add City</h2>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <input
              className="rounded-lg border px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              placeholder="City name"
              value={name}
              onChange={event => {
                setName(event.target.value)
                if (!slug) setSlug(slugify(event.target.value))
              }}
            />
            <input
              className="rounded-lg border px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              placeholder="slug"
              value={slug}
              onChange={event => setSlug(slugify(event.target.value))}
            />
            <input
              className="rounded-lg border px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              placeholder="Timezone"
              value={timezone}
              onChange={event => setTimezone(event.target.value)}
            />
            <button
              onClick={() => void handleCreate()}
              disabled={!name.trim() || createCity.isPending}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
            >
              Create
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        </section>

        <section className="space-y-3">
          {isLoading && <p className="py-8 text-center text-sm text-gray-400">Loading...</p>}
          {!isLoading && cities.map(city => <CityRow key={city.id} city={city} />)}
        </section>
      </main>
      <BottomNav />
    </div>
  )
}

function CityRow({ city }: { city: City }) {
  const patchCity = usePatchCity()
  const [name, setName] = useState(city.name)
  const [slug, setSlug] = useState(city.slug)
  const [timezone, setTimezone] = useState(city.timezone)
  const [error, setError] = useState('')

  useEffect(() => {
    setName(city.name)
    setSlug(city.slug)
    setTimezone(city.timezone)
  }, [city])

  const dirty = name !== city.name || slug !== city.slug || timezone !== city.timezone

  async function save() {
    setError('')
    try {
      await patchCity.mutateAsync({
        id: city.id,
        body: {
          name: name.trim(),
          slug: slugify(slug),
          timezone: timezone.trim() || DEFAULT_TZ,
        },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update city')
    }
  }

  async function toggleActive() {
    setError('')
    try {
      await patchCity.mutateAsync({ id: city.id, body: { is_active: !city.is_active } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update city')
    }
  }

  return (
    <article className="rounded-xl border bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${city.is_active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300'}`}>
            {city.is_active ? 'Active' : 'Inactive'}
          </span>
          <span className="text-xs text-gray-400">{city.id}</span>
        </div>
        <button
          onClick={() => void toggleActive()}
          disabled={patchCity.isPending}
          className="rounded-lg border px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          {city.is_active ? 'Deactivate' : 'Activate'}
        </button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
        <input className="rounded-lg border px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white" value={name} onChange={event => setName(event.target.value)} />
        <input className="rounded-lg border px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white" value={slug} onChange={event => setSlug(slugify(event.target.value))} />
        <input className="rounded-lg border px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white" value={timezone} onChange={event => setTimezone(event.target.value)} />
        <button
          onClick={() => void save()}
          disabled={!dirty || patchCity.isPending}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
        >
          Save
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </article>
  )
}
