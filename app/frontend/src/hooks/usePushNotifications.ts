import { useCallback, useEffect, useState } from 'react'
import { fetchVapidPublicKey, subscribePush, testPush, unsubscribePush } from '../services/api'

type PushPermission = NotificationPermission | 'unsupported'

export interface PushBrowserState {
  supported: boolean
  permission: PushPermission
  subscribed: boolean
  loading: boolean
  error: string | null
  testResult: { sent: boolean; reason?: string | null } | null
  refresh: () => Promise<void>
  enable: () => Promise<void>
  disable: () => Promise<void>
  sendTest: () => Promise<void>
}

function browserSupportsPush(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const normalized = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(normalized)
  const output = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index)
  }
  return output
}

async function getServiceWorkerRegistration() {
  const existing = await navigator.serviceWorker.getRegistration('/service-worker.js')
  if (existing) return existing
  return navigator.serviceWorker.register('/service-worker.js')
}

async function getSubscription() {
  if (!browserSupportsPush()) return null
  const registration = await getServiceWorkerRegistration()
  return registration.pushManager.getSubscription()
}

export function usePushNotifications(): PushBrowserState {
  const [supported, setSupported] = useState(browserSupportsPush())
  const [permission, setPermission] = useState<PushPermission>(
    browserSupportsPush() ? Notification.permission : 'unsupported'
  )
  const [subscribed, setSubscribed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ sent: boolean; reason?: string | null } | null>(null)

  const refresh = useCallback(async () => {
    const isSupported = browserSupportsPush()
    setSupported(isSupported)
    setPermission(isSupported ? Notification.permission : 'unsupported')
    if (!isSupported) {
      setSubscribed(false)
      return
    }
    try {
      const sub = await getSubscription()
      setSubscribed(Boolean(sub))
    } catch {
      setSubscribed(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const enable = useCallback(async () => {
    setLoading(true)
    setError(null)
    setTestResult(null)
    try {
      if (!browserSupportsPush()) {
        throw new Error('This browser does not support push notifications.')
      }

      const registration = await getServiceWorkerRegistration()
      const nextPermission = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission()
      setPermission(nextPermission)
      if (nextPermission !== 'granted') {
        throw new Error('Notification permission was not granted.')
      }

      const publicKey = await fetchVapidPublicKey()
      if (!publicKey) {
        throw new Error('Web push is not configured on the backend yet.')
      }

      const existing = await registration.pushManager.getSubscription()
      const sub = existing ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
      })
      const json = sub.toJSON()
      const p256dh = json.keys?.p256dh
      const auth = json.keys?.auth
      if (!json.endpoint || !p256dh || !auth) {
        throw new Error('The browser returned an incomplete push subscription.')
      }

      await subscribePush({
        endpoint: json.endpoint,
        p256dh,
        auth,
      })
      setSubscribed(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enable push notifications.')
    } finally {
      setLoading(false)
    }
  }, [])

  const disable = useCallback(async () => {
    setLoading(true)
    setError(null)
    setTestResult(null)
    try {
      const sub = await getSubscription()
      if (!sub) {
        setSubscribed(false)
        return
      }
      const endpoint = sub.endpoint
      await sub.unsubscribe()
      await unsubscribePush(endpoint)
      setSubscribed(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disable push notifications.')
    } finally {
      setLoading(false)
    }
  }, [])

  const sendTest = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await testPush()
      setTestResult(result)
      if (!result.sent && result.reason) {
        setError(result.reason)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send test push notification.'
      setError(message)
      setTestResult({ sent: false, reason: message })
    } finally {
      setLoading(false)
    }
  }, [])

  return {
    supported,
    permission,
    subscribed,
    loading,
    error,
    testResult,
    refresh,
    enable,
    disable,
    sendTest,
  }
}
