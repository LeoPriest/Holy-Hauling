/**
 * Parse an ISO datetime string from the API as UTC.
 *
 * The backend columns are naive UTC — SQLAlchemy strips timezone info when
 * writing to SQLite, so serialized strings have no Z suffix. Without this
 * helper, `new Date("2024-01-15T18:30:00")` treats the value as local time
 * instead of UTC, making every timestamp wrong by the user's UTC offset.
 */
export function parseUtc(iso: string): Date {
  if (iso.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(iso)) {
    return new Date(iso)
  }
  return new Date(iso + 'Z')
}

export function fmtLocalTime(iso: string): string {
  return parseUtc(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function fmtLocalDateTime(iso: string): string {
  return parseUtc(iso).toLocaleString([], {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

export function fmtTimeSlot(slot: string): string {
  const [hoursRaw, minutesRaw] = slot.split(':')
  const hours = Number(hoursRaw)
  const minutes = Number(minutesRaw)
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return slot

  const ampm = hours >= 12 ? 'PM' : 'AM'
  const normalizedHours = hours % 12 || 12
  return `${normalizedHours}:${String(minutes).padStart(2, '0')} ${ampm}`
}

export function fmtDurationMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return `${minutes}m`
  const rounded = Math.round(minutes)
  const hours = Math.floor(rounded / 60)
  const remainingMinutes = rounded % 60
  if (hours === 0) return `${remainingMinutes}m`
  if (remainingMinutes === 0) return `${hours}h`
  return `${hours}h ${remainingMinutes}m`
}
