import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BottomNav } from '../components/BottomNav'
import { useCities, useCreateCity, usePatchCity } from '../hooks/useCities'
import type { City } from '../types/city'
import { ScreenHeader } from '../components/ScreenHeader'

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
    <div className="min-h-screen bg-bg pb-16">
      <ScreenHeader title="Cities" onBack={() => navigate('/admin')} />

      <main className="space-y-4 p-4 pb-12">
        <section className="rounded-card border bg-sf p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-mu">Add City</h2>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <input
              className="wd-input"
              placeholder="City name"
              value={name}
              onChange={event => {
                setName(event.target.value)
                if (!slug) setSlug(slugify(event.target.value))
              }}
            />
            <input
              className="wd-input"
              placeholder="slug"
              value={slug}
              onChange={event => setSlug(slugify(event.target.value))}
            />
            <input
              className="wd-input"
              placeholder="Timezone"
              value={timezone}
              onChange={event => setTimezone(event.target.value)}
            />
            <button
              onClick={() => void handleCreate()}
              disabled={!name.trim() || createCity.isPending}
              className="wd-btn-sm"
            >
              Create
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        </section>

        <section className="space-y-3">
          {isLoading && <p className="py-8 text-center text-sm text-mu">Loading...</p>}
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
    <article className="rounded-card border bg-sf p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${city.is_active ? 'bg-tint text-ok' : 'bg-bg text-mu'}`}>
            {city.is_active ? 'Active' : 'Inactive'}
          </span>
          <span className="text-xs text-mu">{city.id}</span>
        </div>
        <button
          onClick={() => void toggleActive()}
          disabled={patchCity.isPending}
          className="rounded-chip border px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-40"
        >
          {city.is_active ? 'Deactivate' : 'Activate'}
        </button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
        <input className="wd-input" value={name} onChange={event => setName(event.target.value)} />
        <input className="wd-input" value={slug} onChange={event => setSlug(slugify(event.target.value))} />
        <input className="wd-input" value={timezone} onChange={event => setTimezone(event.target.value)} />
        <button
          onClick={() => void save()}
          disabled={!dirty || patchCity.isPending}
          className="rounded-chip bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Save
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </article>
  )
}
