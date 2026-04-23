import type { AiReview, ChatMessage, ChatResponse, IngestResult, Lead, LeadCreate, LeadEvent, LeadStatus, LeadUpdate, OcrResult, Screenshot, Settings, SettingsPatch, TestAlertRequest, TestAlertResult } from '../types/lead'

const BASE = '/leads'

export async function fetchLeads(params?: {
  status?: LeadStatus
  source_type?: string
  assigned_to?: string
}): Promise<Lead[]> {
  const q = new URLSearchParams()
  if (params?.status) q.set('status', params.status)
  if (params?.source_type) q.set('source_type', params.source_type)
  if (params?.assigned_to) q.set('assigned_to', params.assigned_to)
  const r = await fetch(`${BASE}?${q}`)
  if (!r.ok) throw new Error('Failed to fetch leads')
  return r.json()
}

export async function fetchLead(id: string): Promise<Lead> {
  const r = await fetch(`${BASE}/${id}`)
  if (!r.ok) throw new Error('Lead not found')
  return r.json()
}

export async function createLead(data: LeadCreate): Promise<Lead> {
  const r = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!r.ok) throw new Error('Failed to create lead')
  return r.json()
}

export async function patchLead(id: string, data: LeadUpdate, actor?: string): Promise<Lead> {
  const q = actor ? `?actor=${encodeURIComponent(actor)}` : ''
  const r = await fetch(`${BASE}/${id}${q}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!r.ok) throw new Error('Failed to update lead')
  return r.json()
}

export async function updateLeadStatus(
  id: string,
  status: LeadStatus,
  actor?: string,
  note?: string,
): Promise<Lead> {
  const r = await fetch(`${BASE}/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, actor, note }),
  })
  if (!r.ok) throw new Error('Failed to update status')
  return r.json()
}

export async function acknowledgeLead(id: string, actor?: string): Promise<Lead> {
  const q = actor ? `?actor=${encodeURIComponent(actor)}` : ''
  const r = await fetch(`${BASE}/${id}/acknowledge${q}`, { method: 'POST' })
  if (!r.ok && r.status !== 409) throw new Error('Failed to acknowledge')
  return r.json()
}

export async function addNote(leadId: string, body: string, actor?: string): Promise<LeadEvent> {
  const r = await fetch(`${BASE}/${leadId}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, actor }),
  })
  if (!r.ok) throw new Error('Failed to add note')
  return r.json()
}

export async function uploadScreenshot(leadId: string, file: File): Promise<Screenshot> {
  const form = new FormData()
  form.append('file', file)
  const r = await fetch(`${BASE}/${leadId}/screenshots`, { method: 'POST', body: form })
  if (!r.ok) throw new Error('Failed to upload screenshot')
  return r.json()
}

export async function fetchLeadEvents(id: string): Promise<LeadEvent[]> {
  const r = await fetch(`${BASE}/${id}/events`)
  if (!r.ok) throw new Error('Failed to fetch events')
  return r.json()
}

export async function triggerExtraction(leadId: string, screenshotId: string): Promise<OcrResult> {
  const r = await fetch(`${BASE}/${leadId}/screenshots/${screenshotId}/extract`, { method: 'POST' })
  if (!r.ok) {
    const body = await r.json().catch(() => null)
    throw new Error(body?.detail ?? `Extraction failed: ${r.status}`)
  }
  return r.json()
}

export async function getExtractionResult(leadId: string, screenshotId: string): Promise<OcrResult> {
  const r = await fetch(`${BASE}/${leadId}/screenshots/${screenshotId}/extract`)
  if (!r.ok) throw new Error('No extraction result')
  return r.json()
}

export async function ingestScreenshot(
  file: File,
  sourceType: string,
): Promise<IngestResult> {
  const form = new FormData()
  form.append('file', file)
  form.append('source_type', sourceType)
  const r = await fetch('/ingest/screenshot', { method: 'POST', body: form })
  if (!r.ok) throw new Error(`Ingest failed: ${r.status}`)
  return r.json()
}

export async function triggerAiReview(leadId: string, actor?: string): Promise<AiReview> {
  const q = actor ? `?actor=${encodeURIComponent(actor)}` : ''
  const r = await fetch(`${BASE}/${leadId}/ai-review${q}`, { method: 'POST' })
  if (!r.ok) {
    const body = await r.json().catch(() => null)
    throw new Error(body?.detail ?? `AI review failed: ${r.status}`)
  }
  return r.json()
}

export async function getLatestAiReview(leadId: string): Promise<AiReview> {
  const r = await fetch(`${BASE}/${leadId}/ai-review`)
  if (!r.ok) throw new Error('No AI review found')
  return r.json()
}

export async function deleteLead(id: string): Promise<void> {
  const r = await fetch(`${BASE}/${id}`, { method: 'DELETE' })
  if (!r.ok) {
    const body = await r.json().catch(() => null)
    throw new Error(body?.detail ?? `Delete failed: ${r.status}`)
  }
}

export async function applyExtractionFields(
  leadId: string,
  screenshotId: string,
  fields: Record<string, string>,
): Promise<Lead> {
  const r = await fetch(`${BASE}/${leadId}/screenshots/${screenshotId}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  })
  if (!r.ok) throw new Error('Apply failed')
  return r.json()
}

export async function fetchChatMessages(leadId: string): Promise<ChatMessage[]> {
  const r = await fetch(`/leads/${leadId}/chat`)
  if (!r.ok) throw new Error('Failed to fetch chat')
  return r.json()
}

export async function sendChatMessage(
  leadId: string,
  message: string,
  aiReviewId?: string,
): Promise<ChatResponse> {
  const r = await fetch(`/leads/${leadId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, ai_review_id: aiReviewId ?? null }),
  })
  if (!r.ok) {
    const body = await r.json().catch(() => null)
    throw new Error(body?.detail ?? `Chat failed: ${r.status}`)
  }
  return r.json()
}

export async function fetchSettings(): Promise<Settings> {
  const r = await fetch('/settings')
  if (!r.ok) throw new Error('Failed to fetch settings')
  return r.json()
}

export async function patchSettings(data: SettingsPatch): Promise<Settings> {
  const r = await fetch('/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!r.ok) throw new Error('Failed to save settings')
  return r.json()
}

export async function testAlert(data: TestAlertRequest): Promise<TestAlertResult> {
  const r = await fetch('/settings/test-alert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!r.ok) throw new Error('Test alert request failed')
  return r.json()
}
