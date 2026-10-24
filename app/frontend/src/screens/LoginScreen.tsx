import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import type { AuthUser } from '../context/AuthContext'
import { API_BASE } from '../services/api'

const DELETE = 'del'
const PAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', DELETE]

// How long "You're in" shows before the app opens.
const WELCOME_MS = 900

export function LoginScreen() {
  const [username, setUsername] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [welcome, setWelcome] = useState(false)
  const [shake, setShake] = useState(0)
  const { login } = useAuth()
  const navigate = useNavigate()
  const userInput = useRef<HTMLInputElement>(null)

  const ready = Boolean(username.trim()) && pin.length === 4 && !loading && !welcome

  function handleDigit(d: string) {
    if (loading || welcome) return
    setError('')
    if (d === DELETE) { setPin(p => p.slice(0, -1)); return }
    setPin(p => (p.length < 4 ? p + d : p))
  }

  // Digits typed on a keyboard fill the PIN too, unless the username box has focus.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (document.activeElement === userInput.current) return
      if (/^[0-9]$/.test(e.key)) handleDigit(e.key)
      else if (e.key === 'Backspace') handleDigit(DELETE)
      else if (e.key === 'Enter' && ready) void handleSubmit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  async function handleSubmit() {
    if (!ready) return
    setLoading(true)
    setError('')
    try {
      const r = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), pin }),
      })
      if (!r.ok) {
        setError('Invalid username or PIN')
        setPin('')
        setShake(n => n + 1)
        return
      }
      const { token, user } = await r.json() as { token: string; user: AuthUser }
      setWelcome(true)
      // Signing in swaps this route for the app, so the welcome plays first.
      window.setTimeout(() => {
        login(token, user)
        registerPush(token)
        if (user.role === 'admin' || user.role === 'facilitator') navigate('/')
        else navigate('/jobs')
      }, WELCOME_MS)
    } catch (_e) {
      console.error('Login error', _e)
      setError('No connection. Check your signal and try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-bg text-ink">
      <div className="wd-hero">
        <img src="/brand/logo-full-white.png" alt="Holy Hauling" />
      </div>

      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col px-5 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-6">
        <h1 className="wd-disp text-[28px] leading-none">Welcome back</h1>
        <p className="mt-1.5 text-[13px] text-mu">Good to see you. Sign in to get rolling.</p>

        <label className="wd-login-user mt-5">
          <span>Username</span>
          <input
            ref={userInput}
            value={username}
            onChange={e => { setUsername(e.target.value); setError('') }}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="next"
          />
        </label>

        <div
          key={shake}
          className={`wd-pin${shake ? ' wd-shake' : ''}`}
          role="img"
          aria-label={`PIN, ${pin.length} of 4 digits`}
        >
          {[0, 1, 2, 3].map(i => <i key={i} className={pin[i] ? 'on' : ''} />)}
        </div>

        <div className="wd-pad" role="group" aria-label="Keypad">
          {PAD.map((d, i) => d === '' ? <span key={i} /> : (
            <button
              key={i}
              type="button"
              onClick={() => handleDigit(d)}
              aria-label={d === DELETE ? 'Delete digit' : undefined}
            >
              {d === DELETE ? '⌫' : d}
            </button>
          ))}
        </div>

        {error && <p role="alert" className="mt-3 text-center text-sm font-semibold text-danger">{error}</p>}

        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!ready}
          className={`wd-btn wd-login-go mt-auto w-full${loading ? ' busy' : ''}`}
        >
          <span>{loading ? 'Loading up…' : 'Sign in'}</span>
        </button>
      </main>

      {welcome && (
        <div className="wd-ovl" role="status">
          <img src="/brand/logo-full-white.png" alt="" />
          <p className="wd-ovl-t">You're in</p>
          <p className="wd-ovl-s">Loading your day…</p>
        </div>
      )}
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
    const keyResp = await fetch(`${API_BASE}/push/vapid-public-key`)
    const { publicKey } = await keyResp.json()
    if (!publicKey) return
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: publicKey,
    })
    const { endpoint, keys } = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
    await fetch(`${API_BASE}/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ endpoint, p256dh: keys.p256dh, auth: keys.auth }),
    })
  } catch (e) {
    console.warn('Push registration failed', e)
  }
}
