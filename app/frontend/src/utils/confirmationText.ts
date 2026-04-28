import type { Lead } from '../types/lead'
import { fmtDurationMinutes, fmtTimeSlot } from './time'

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

function formatBookingDate(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  if (!start) return ''
  const fmt = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    })
  return end ? `${fmt(start)} – ${fmt(end)}` : fmt(start)
}

// ─────────────────────────────────────────────────────────────────────────────
// BOOKING CONFIRMATION TEMPLATE
// Edit the lines inside renderTemplate() to change what is sent to customers.
// All fields are optional — lines whose value is empty are automatically omitted.
// Available fields: name, serviceLabel, dateStr, timeStr, from, to,
//                   moveSize, durationStr, quotedTotal
// ─────────────────────────────────────────────────────────────────────────────
function renderTemplate(f: {
  name: string
  serviceLabel: string
  dateStr: string
  timeStr: string
  from: string
  to: string
  moveSize: string
  durationStr: string
  quotedTotal: string
}): string {
  const lines: string[] = []

  lines.push(`Hi ${f.name}! Your ${f.serviceLabel} is confirmed with Holy Hauling.`)
  lines.push('')
  if (f.dateStr)     lines.push(`Date: ${f.dateStr}`)
  if (f.timeStr)     lines.push(`Time: ${f.timeStr}`)
  if (f.from)        lines.push(`From: ${f.from}`)
  if (f.to)          lines.push(`To: ${f.to}`)
  if (f.moveSize)    lines.push(`Move size: ${f.moveSize}`)
  if (f.durationStr) lines.push(`Est. duration: ${f.durationStr}`)
  lines.push(`Quoted total: ${f.quotedTotal}`)
  lines.push('')
  lines.push('Any questions? Call or text us anytime.')
  lines.push('Looking forward to helping you!')
  lines.push('')
  lines.push('– Holy Hauling')

  return lines.join('\n')
}

export function buildConfirmationText(
  lead: Pick<
    Lead,
    | 'customer_name'
    | 'service_type'
    | 'job_date_requested'
    | 'job_date_end'
    | 'appointment_time_slot'
    | 'job_origin'
    | 'job_address'
    | 'job_location'
    | 'job_destination'
    | 'move_size_label'
    | 'estimated_job_duration_minutes'
  >,
  quotedPrice: number,
): string {
  return renderTemplate({
    name: lead.customer_name ?? 'there',
    serviceLabel:
      lead.service_type === 'moving'  ? 'move'
      : lead.service_type === 'hauling' ? 'hauling job'
      : 'job',
    dateStr:     formatBookingDate(lead.job_date_requested, lead.job_date_end),
    timeStr:     lead.appointment_time_slot ? fmtTimeSlot(lead.appointment_time_slot) : '',
    from:        lead.job_origin ?? lead.job_address ?? lead.job_location ?? '',
    to:          lead.job_destination ?? '',
    moveSize:    lead.move_size_label ?? '',
    durationStr: lead.estimated_job_duration_minutes
                   ? fmtDurationMinutes(lead.estimated_job_duration_minutes)
                   : '',
    quotedTotal: formatCurrency(quotedPrice),
  })
}
