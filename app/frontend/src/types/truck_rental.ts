export type TruckRentalStatus = 'reserved' | 'confirmed' | 'completed'
export type TruckSize = '10ft' | '15ft' | '20ft' | '26ft'

export interface TruckRental {
  id: string
  lead_id: string
  status: TruckRentalStatus
  confirmation_number: string | null
  truck_size: TruckSize | null
  pickup_location: string | null
  pickup_datetime: string | null
  dropoff_datetime: string | null
  rental_cost_cents: number | null
  one_way: boolean
  estimated_miles: number | null
  actual_miles: number | null
  receipt_url: string | null
  notes: string | null
  lead_customer_name: string | null
  lead_job_date_requested: string | null
  created_at: string
  updated_at: string
}

export interface TruckRentalInput {
  status: TruckRentalStatus
  confirmation_number: string | null
  truck_size: TruckSize | null
  pickup_location: string | null
  pickup_datetime: string | null
  dropoff_datetime: string | null
  rental_cost_cents: number | null
  one_way: boolean
  estimated_miles: number | null
  actual_miles: number | null
  notes: string | null
}

export interface RentalFilters {
  status?: TruckRentalStatus | ''
  city_id?: string
}

export const TRUCK_SIZES: TruckSize[] = ['10ft', '15ft', '20ft', '26ft']

export const STATUS_LABELS: Record<TruckRentalStatus, string> = {
  reserved: 'Reserved',
  confirmed: 'Confirmed',
  completed: 'Completed',
}

export const STATUS_COLORS: Record<TruckRentalStatus, string> = {
  reserved: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  confirmed: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  completed: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
}
