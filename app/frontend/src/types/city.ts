export interface City {
  id: string
  name: string
  slug: string
  timezone: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export type CityCreate = {
  name: string
  slug: string
  timezone: string
}

export type CityPatch = Partial<CityCreate> & {
  is_active?: boolean
}
