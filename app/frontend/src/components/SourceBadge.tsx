import type { LeadSourceType } from '../types/lead'

const labels: Record<LeadSourceType, string> = {
  thumbtack_api: 'Thumbtack API',
  thumbtack_screenshot: 'Thumbtack OCR',
  yelp_screenshot: 'Yelp OCR',
  google_screenshot: 'Google OCR',
  website_form: 'Website',
  manual: 'Manual',
}

export function SourceBadge({ source }: { source: LeadSourceType }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
      {labels[source]}
    </span>
  )
}
