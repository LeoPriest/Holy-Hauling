import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { CityProvider } from './context/CityContext'
import { ThemeProvider } from './context/ThemeContext'
import type { AuthUser } from './context/AuthContext'
import { LoginScreen } from './screens/LoginScreen'
import { LeadCommandCenter } from './screens/LeadCommandCenter'
import { LeadQueue } from './screens/LeadQueue'
import { SettingsScreen } from './screens/SettingsScreen'
import { JobsScreen } from './screens/JobsScreen'
import { AdminUsersScreen } from './screens/AdminUsersScreen'
import { AdminScreen } from './screens/AdminScreen'
import { CalendarScreen } from './screens/CalendarScreen'
import { AdminFinancesScreen } from './screens/AdminFinancesScreen'
import { AdminCitiesScreen } from './screens/AdminCitiesScreen'
import { AdminMetricsScreen } from './screens/AdminMetricsScreen'

const queryClient = new QueryClient()

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function RoleGuard({ roles, children }: { roles: Array<AuthUser['role']>; children: React.ReactNode }) {
  const { user } = useAuth()
  if (!user || !roles.includes(user.role)) {
    const fallback = user?.role === 'admin' || user?.role === 'facilitator' ? '/' : '/jobs'
    return <Navigate to={fallback} replace />
  }
  return <>{children}</>
}

function AppRoutes() {
  const { user, loading } = useAuth()
  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading…</div>
  const defaultPath = user?.role === 'admin' || user?.role === 'facilitator' ? '/' : '/jobs'
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={defaultPath} replace /> : <LoginScreen />} />
      <Route path="/" element={<AuthGuard><RoleGuard roles={['admin', 'facilitator']}><LeadQueue /></RoleGuard></AuthGuard>} />
      <Route path="/leads/:id" element={<AuthGuard><RoleGuard roles={['admin', 'facilitator']}><LeadCommandCenter /></RoleGuard></AuthGuard>} />
      <Route path="/settings" element={<AuthGuard><RoleGuard roles={['admin', 'facilitator', 'supervisor', 'crew']}><SettingsScreen /></RoleGuard></AuthGuard>} />
      <Route path="/jobs" element={<AuthGuard><RoleGuard roles={['admin', 'facilitator', 'supervisor', 'crew']}><JobsScreen /></RoleGuard></AuthGuard>} />
      <Route path="/calendar" element={<AuthGuard><RoleGuard roles={['admin', 'facilitator', 'supervisor', 'crew']}><CalendarScreen /></RoleGuard></AuthGuard>} />
      <Route path="/admin" element={<AuthGuard><RoleGuard roles={['admin']}><AdminScreen /></RoleGuard></AuthGuard>} />
      <Route path="/admin/users" element={<AuthGuard><RoleGuard roles={['admin']}><AdminUsersScreen /></RoleGuard></AuthGuard>} />
      <Route path="/admin/finances" element={<AuthGuard><RoleGuard roles={['admin']}><AdminFinancesScreen /></RoleGuard></AuthGuard>} />
      <Route path="/admin/cities" element={<AuthGuard><RoleGuard roles={['admin']}><AdminCitiesScreen /></RoleGuard></AuthGuard>} />
      <Route path="/admin/metrics" element={<AuthGuard><RoleGuard roles={['admin']}><AdminMetricsScreen /></RoleGuard></AuthGuard>} />
      <Route path="*" element={<Navigate to={user ? defaultPath : '/login'} replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <CityProvider>
            <AppRoutes />
          </CityProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
