import { useEffect, useState } from 'react'

const MAPS_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY ||
  import.meta.env.VITE_GOOGLE_MAPS_KEY) as string | undefined

// Module-level state prevents double-loading across renders/remounts
let _loaded = false
let _loading = false
const _listeners: Array<() => void> = []

export function useGooglePlaces() {
  const [isLoaded, setIsLoaded] = useState(_loaded)

  useEffect(() => {
    if (!MAPS_KEY || _loaded) {
      if (_loaded) setIsLoaded(true)
      return
    }

    _listeners.push(() => setIsLoaded(true))
    if (_loading) return

    _loading = true
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}&libraries=places`
    script.async = true
    script.onload = () => {
      _loaded = true
      _listeners.forEach(fn => fn())
      _listeners.length = 0
    }
    document.head.appendChild(script)
  }, [])

  return { isLoaded: isLoaded && !!MAPS_KEY, hasKey: !!MAPS_KEY }
}
