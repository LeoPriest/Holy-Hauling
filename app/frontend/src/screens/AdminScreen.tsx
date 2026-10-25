import { useNavigate } from 'react-router-dom'
import { BottomNav } from '../components/BottomNav'
import { CitySwitcher } from '../components/CitySwitcher'
import { ScreenHeader } from '../components/ScreenHeader'
import { useAuth } from '../context/AuthContext'
import { useDueRecurringExpenses } from '../hooks/useRecurringExpenses'
import { ICON, NavRow } from '../components/NavRow'

const ROWS = [
  { path: '/admin/metrics', label: 'Metrics', description: 'Pipeline, conversion, revenue, and response time', icon: ICON.metrics },
  { path: '/admin/quote-grounding', label: 'Quote grounding', description: 'Is AI grounding winning more / pricing tighter?', icon: ICON.metrics },
  { path: '/admin/finances', label: 'Finances', description: 'Revenue, expenses, transaction history', icon: ICON.money },
  { path: '/admin/rentals', label: 'Rentals', description: 'Truck rental bookings and costs', icon: ICON.truck },
  { path: '/admin/payroll', label: 'Payroll', description: "Track crew pay per job and see what's owed", icon: ICON.payroll },
  { path: '/admin/recurring-expenses/due', label: 'Recurring', description: 'Track scheduled expenses and log due payments', icon: ICON.repeat },
  { path: '/admin/users', label: 'Team', description: 'Users, roles, and access control', icon: ICON.team },
  { path: '/admin/cities', label: 'Cities', description: 'Service areas and city configuration', icon: ICON.cities },
  { path: '/admin/thumbtack', label: 'Thumbtack', description: 'Webhook connections and incoming lead deliveries', icon: ICON.link },
]

export function AdminScreen() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { data: dueExpenses = [] } = useDueRecurringExpenses()

  return (
    <div className="min-h-screen bg-bg pb-[calc(var(--dock-h)+16px)] text-ink">
      <ScreenHeader
        title="Admin"
        subtitle={`Settings${user?.username ? ` · ${user.username}` : ''}`}
        onBack={() => navigate('/settings')}
        backLabel="Back to settings"
        right={<CitySwitcher allowAll={false} variant="pill" />}
      />

      <main className="wd-pane mx-auto flex max-w-3xl flex-col gap-2.5 px-3.5 pt-4">
        {ROWS.map(row => (
          <NavRow
            key={row.path}
            label={row.label}
            description={row.description}
            icon={row.icon}
            badge={row.path === '/admin/recurring-expenses/due' ? dueExpenses.length : undefined}
            onClick={() => navigate(row.path)}
          />
        ))}
      </main>

      <BottomNav />
    </div>
  )
}

