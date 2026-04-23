import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import type { AuthUser } from '../context/AuthContext'

const PAD = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['',  '0', '⌫'],
]

export function LoginScreen() {
  const [username, setUsername] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  function handleDigit(d: string) {
    if (d === '⌫') { setPin(p => p.slice(0, -1)); return }
    if (pin.length < 4) setPin(p => p + d)
  }

  async function handleSubmit() {
    if (!username.trim() || pin.length !== 4) return
    setLoading(true)
    setError('')
    try {
      const r = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), pin }),
      })
      if (!r.ok) {
        setError('Invalid username or PIN')
        setPin('')
        return
      }
      const { token, user } = await r.json() as { token: string; user: AuthUser }
      login(token, user)
      registerPush(token)
      if (user.role === 'admin' || user.role === 'facilitator') navigate('/')
      else navigate('/jobs')
    } catch (_e) {
      console.error('Login error', _e)
      setError('Connection error — is the server running?')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8 w-full max-w-sm">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6 text-center">Holy Hauling</h1>

        <input
          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 mb-5 text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="Username"
          value={username}
          onChange={e => setUsername(e.target.value)}
          autoComplete="username"
        />

        <div className="flex justify-center gap-3 mb-5">
          {[0, 1, 2, 3].map(i => (
            <div
              key={i}
              className={`w-11 h-11 rounded-full border-2 flex items-center justify-center transition-colors ${
                pin[i]
                  ? 'border-indigo-600 dark:border-indigo-400'
                  : 'border-gray-300 dark:border-gray-600'
              }`}
            >
              {pin[i] && <div className="w-3 h-3 rounded-full bg-indigo-600 dark:bg-indigo-400" />}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-2 mb-5">
          {PAD.flat().map((d, i) => (
            <button
              key={i}
              onClick={() => d && handleDigit(d)}
              disabled={!d}
              className={`h-12 rounded-xl text-lg font-semibold transition-colors ${
                d
                  ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-200 dark:hover:bg-gray-600 active:bg-gray-300'
                  : 'opacity-0 pointer-events-none'
              }`}
            >
              {d}
            </button>
          ))}
        </div>

        {error && (
          <p className="text-red-600 dark:text-red-400 text-sm mb-4 text-center">{error}</p>
        )}

        <button
          onClick={handleSubmit}
          disabled={!username.trim() || pin.length !== 4 || loading}
          className="w-full py-2.5 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 disabled:opacity-40 transition-colors"
        >
          {loading ? 'Signing in…' : 'Sign In'}
        </button>
      </div>
    </div>
  )
}

async function registerPush(token: string) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
  if (localStorage.getItem('hh_push_declined') === 'true') return
  try {
    const reg = await navigator.serviceWorker.register('/service-worker.js')
    const permission = await Notification.requestPermission()
    if (permission === 'denied') {
      localStorage.setItem('hh_push_declined', 'true')
      return
    }
    const keyResp = await fetch('/push/vapid-public-key')
    const { publicKey } = await keyResp.json()
    if (!publicKey) return
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: publicKey,
    })
    const { endpoint, keys } = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
    await fetch('/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ endpoint, p256dh: keys.p256dh, auth: keys.auth }),
    })
  } catch (e) {
    console.warn('Push registration failed', e)
  }
}
