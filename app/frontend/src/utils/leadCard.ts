import type { Lead, LeadSourceType } from '../types/lead'

const SOURCE_SHORT: Record<LeadSourceType, string> = {
  thumbtack_api: 'Thumbtack',
  thumbtack_screenshot: 'Thumbtack',
  yelp_screenshot: 'Yelp',
  google_screenshot: 'Google',
  website_form: 'Website',
  manual: 'Manual',
}

export function sourceShort(source: LeadSourceType): string {
  return SOURCE_SHORT[source] ?? source
}

/**
 * Card title. Leads store no job title, so build one from the service and
 * the move size: "2 bedroom move", else "Moving" / "Hauling".
 */
export function leadTitle(lead: Lead): string {
  const size = lead.move_size_label?.trim()
  switch (lead.service_type) {
    case 'moving':
      return size ? `${size} move` : 'Moving'
    case 'both':
      return size ? `${size} move + haul` : 'Moving + hauling'
    case 'hauling':
      return 'Hauling'
    default:
      return size ? `${size} move` : 'New job'
  }
}

const NOT_A_TOWN = /^(usa|us|united states|[a-z]{2}(\s+\d{5}(-\d{4})?)?|\d{5}(-\d{4})?)$/i

/** The town from whichever address the lead has: "12 Elm St, Kirkwood, MO 63122" -> "Kirkwood". */
export function leadTown(lead: Lead): string | null {
  const raw = lead.job_address || lead.job_location || lead.job_origin
  if (!raw) return null
  const parts = raw.split(',').map(p => p.trim()).filter(Boolean)
  while (parts.length > 1 && NOT_A_TOWN.test(parts[parts.length - 1])) parts.pop()
  // "Street, Town" -> Town; a lone part is shown as given.
  return parts[parts.length - 1] ?? null
}

/** Short age for the card corner: 4m, 3h, 2d. */
export function shortAge(createdAt: Date, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - createdAt.getTime()) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`
  return `${Math.floor(minutes / 1440)}d`
}
