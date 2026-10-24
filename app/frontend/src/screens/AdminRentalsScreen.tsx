import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BottomNav } from '../components/BottomNav'
import { CitySwitcher } from '../components/CitySwitcher'
import { useRentals } from '../hooks/useTruckRental'
import { ScreenHeader } from '../components/ScreenHeader'
import { Working } from '../components/Logo'
import {
  STATUS_COLORS,
  STATUS_LABELS,
  type TruckRentalStatus,
} from '../types/truck_rental'

function centsToDisplay(cents: number | null): string {
  if (cents === null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

const STATUS_TABS: Array<{ label: string; value: TruckRentalStatus | '' }> = [
  { label: 'All', value: '' },
  { label: 'Reserved', value: 'reserved' },
  { label: 'Confirmed', value: 'confirmed' },
  { label: 'Completed', value: 'completed' },
]

export function AdminRentalsScreen() {
  const navigate = useNavigate()
  const [statusFilter, setStatusFilter] = useState<TruckRentalStatus | ''>('')

  const { data: rentals = [], isLoading, isError } = useRentals({
    status: statusFilter || undefined,
  })

  const upcomingCount = rentals.filter(r => r.status === 'reserved' || r.status === 'confirmed').length
  const rentalsWithCost = rentals.filter(
    (r): r is typeof r & { rental_cost_cents: number } => r.rental_cost_cents !== null
  )
  const totalCostCents = rentalsWithCost.reduce((sum, r) => sum + r.rental_cost_cents, 0)

  return (
    <div className="min-h-screen bg-bg pb-16">
      <ScreenHeader title="Truck rentals" onBack={() => navigate('/admin')} right={<CitySwitcher allowAll variant="pill" />} />

      {/* Summary bar */}
      <div className="grid grid-cols-2 gap-3 p-4">
        <div className="rounded-card border bg-sf p-3">
          <p className="text-xs text-mu">Upcoming</p>
          <p className="text-2xl font-bold text-ink">{upcomingCount}</p>
        </div>
        <div className="rounded-card border bg-sf p-3">
          <p className="text-xs text-mu">Total cost</p>
          <p className="text-2xl font-bold text-ink">{centsToDisplay(rentalsWithCost.length === 0 ? null : totalCostCents)}</p>
        </div>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-2 overflow-x-auto px-4 pb-2" style={{ scrollbarWidth: 'none' }}>
        {STATUS_TABS.map(tab => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`min-h-11 min-w-11 shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              statusFilter === tab.value
                ? 'bg-ink text-white'
                : 'bg-sf border text-mu'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="p-4 space-y-3">
        {isLoading && (
          <Working label="Loading rentals…" />
        )}
        {isError && (
          <p className="text-center text-sm text-danger py-8">Failed to load rentals</p>
        )}
        {!isLoading && !isError && rentals.length === 0 && (
          <div className="text-center py-12">
            <p className="text-mu text-sm">No truck rentals yet</p>
            <p className="text-mu text-xs mt-1">Add one from a job detail</p>
          </div>
        )}
        {rentals.map(rental => (
          <button
            key={rental.id}
            onClick={() => navigate(`/leads/${rental.lead_id}`)}
            className="w-full flex items-start justify-between rounded-card border bg-sf p-4 text-left shadow-sm hover:shadow-md active:scale-[0.99] transition-all"
          >
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[rental.status]}`}>
                  {STATUS_LABELS[rental.status]}
                </span>
                {rental.one_way && (
                  <span className="text-xs text-mu">One-way</span>
                )}
              </div>
              <p className="font-semibold text-sm text-ink truncate">
                {rental.lead_customer_name ?? 'Unknown customer'}
              </p>
              <p className="text-xs text-mu">
                {rental.lead_job_date_requested ?? 'No date'}
                {rental.truck_size && ` · ${rental.truck_size}`}
              </p>
              {rental.pickup_location && (
                <p className="text-xs text-mu truncate">{rental.pickup_location}</p>
              )}
              {rental.confirmation_number && (
                <p className="text-xs font-mono text-mu">{rental.confirmation_number}</p>
              )}
            </div>
            <div className="text-right shrink-0 ml-3">
              <p className="font-semibold text-sm text-ink">
                {centsToDisplay(rental.rental_cost_cents)}
              </p>
              {rental.estimated_miles !== null && (
                <p className="text-xs text-mu">{rental.estimated_miles} mi est.</p>
              )}
            </div>
          </button>
        ))}
      </div>

      <BottomNav />
    </div>
  )
}
