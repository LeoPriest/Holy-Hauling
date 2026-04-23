import { createContext, useCallback, useContext, useEffect, useState } from 'react'

export interface AuthUser {
  id: string
  username: string
  role: 'admin' | 'facilitator' | 'supervisor' | 'crew'
  is_active: boolean
}

interface AuthContextValue {
  user: AuthUser | null
  token: string | null
  loading: boolean
  login: (token: string, user: AuthUser) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('hh_token'))
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) {
      setLoading(false)
      return
    }
    const controller = new AbortController()
    fetch('/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then(r => {
        if (!r.ok) throw new Error('invalid')
        return r.json() as Promise<AuthUser>
      })
      .then(u => {
        setUser(u)
        setLoading(false)
      })
      .catch(err => {
        if (err.name === 'AbortError') return
        localStorage.removeItem('hh_token')
        setToken(null)
        setUser(null)
        setLoading(false)
      })
    return () => controller.abort()
  }, [token])

  const login = useCallback((newToken: string, newUser: AuthUser) => {
    localStorage.setItem('hh_token', newToken)
    setToken(newToken)
    setUser(newUser)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('hh_token')
    setToken(null)
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
