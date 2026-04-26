const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function normalizeDateOptions(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const raw of values) {
    const value = String(raw ?? '').trim()
    if (!ISO_DATE_RE.test(value) || seen.has(value)) continue
    seen.add(value)
    normalized.push(value)
  }

  return normalized
}

export function parseDateOptions(value: string | string[] | null | undefined): string[] {
  if (Array.isArray(value)) return normalizeDateOptions(value)
  if (value == null) return []

  const raw = String(value).trim()
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return normalizeDateOptions(parsed.map(item => (typeof item === 'string' ? item : String(item ?? ''))))
    }
  } catch {
    // fall through to delimiter-based parsing
  }

  return normalizeDateOptions(raw.split(/[\n,;]+/))
}

export function mergeDateOptions(...values: Array<string | string[] | null | undefined>): string[] {
  return normalizeDateOptions(values.flatMap(value => parseDateOptions(value)))
}

export function serializeDateOptions(values: string[]): string {
  return JSON.stringify(normalizeDateOptions(values))
}
