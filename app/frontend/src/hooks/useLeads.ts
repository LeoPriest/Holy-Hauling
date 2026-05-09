import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  acknowledgeLead,
  addNote,
  applyExtractionFields,
  createLead,
  deleteLead,
  fetchChatMessages,
  fetchLead,
  fetchLeads,
  getLatestAiReview,
  ingestScreenshot,
  patchLead,
  sendChatMessage,
  triggerAiReview,
  triggerExtraction,
  updateLeadStatus,
  uploadScreenshot,
} from '../services/api'
import { useCity } from '../context/CityContext'
import type { LeadCreate, LeadSourceType, LeadStatus, LeadUpdate, QuoteModifier } from '../types/lead'

export function useLeads(filters?: { status?: LeadStatus; source_type?: LeadSourceType; assigned_to?: string }) {
  const { cityQueryId } = useCity()
  const scopedFilters = { ...filters, city_id: cityQueryId }
  return useQuery({
    queryKey: ['leads', scopedFilters],
    queryFn: () => fetchLeads(scopedFilters),
    refetchInterval: 30_000,
  })
}

export function useLead(id: string) {
  return useQuery({
    queryKey: ['lead', id],
    queryFn: () => fetchLead(id),
    enabled: !!id,
  })
}

export function useCreateLead() {
  const qc = useQueryClient()
  const { requiredCityId } = useCity()
  return useMutation({
    mutationFn: (data: LeadCreate) => createLead({ ...data, city_id: data.city_id ?? requiredCityId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  })
}

export function usePatchLead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data, actor }: { id: string; data: LeadUpdate; actor?: string }) =>
      patchLead(id, data, actor),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['leads'] })
      qc.invalidateQueries({ queryKey: ['lead', id] })
    },
  })
}

export function useUpdateStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      status,
      actor,
      note,
      quotedPriceTotal,
      quoteModifiers,
      estimatedJobDurationMinutes,
    }: {
      id: string
      status: LeadStatus
      actor?: string
      note?: string
      quotedPriceTotal?: number
      quoteModifiers?: QuoteModifier[]
      estimatedJobDurationMinutes?: number
    }) => updateLeadStatus(id, status, actor, note, quotedPriceTotal, quoteModifiers, estimatedJobDurationMinutes),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['leads'] })
      qc.invalidateQueries({ queryKey: ['lead', id] })
    },
  })
}

export function useAcknowledgeLead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, actor }: { id: string; actor?: string }) => acknowledgeLead(id, actor),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['leads'] })
      qc.invalidateQueries({ queryKey: ['lead', id] })
    },
  })
}

export function useAddNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ leadId, body, actor }: { leadId: string; body: string; actor?: string }) =>
      addNote(leadId, body, actor),
    onSuccess: (_, { leadId }) => {
      qc.invalidateQueries({ queryKey: ['lead', leadId] })
    },
  })
}

export function useUploadScreenshot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      leadId,
      file,
      screenshotType,
    }: {
      leadId: string
      file: File
      screenshotType?: string
    }) => uploadScreenshot(leadId, file, screenshotType),
    onSuccess: (_, { leadId }) => {
      qc.invalidateQueries({ queryKey: ['lead', leadId] })
      qc.invalidateQueries({ queryKey: ['leads'] })
    },
  })
}

export function useTriggerExtraction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ leadId, screenshotId }: { leadId: string; screenshotId: string }) =>
      triggerExtraction(leadId, screenshotId),
    onSuccess: (_, { leadId }) => {
      qc.invalidateQueries({ queryKey: ['lead', leadId] })
    },
    onError: (err) => console.error('[Extract]', err),
  })
}

export function useIngestScreenshot() {
  const qc = useQueryClient()
  const { requiredCityId } = useCity()
  return useMutation({
    mutationFn: ({ file, sourceType, cityId }: { file: File; sourceType: string; cityId?: string }) =>
      ingestScreenshot(file, sourceType, cityId ?? requiredCityId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] })
    },
  })
}

export function useLatestAiReview(leadId: string) {
  return useQuery({
    queryKey: ['ai-review', leadId],
    queryFn: () => getLatestAiReview(leadId),
    enabled: !!leadId,
    retry: false,
  })
}

export function useTriggerAiReview() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ leadId, actor }: { leadId: string; actor?: string }) =>
      triggerAiReview(leadId, actor),
    onSuccess: (_, { leadId }) => {
      qc.invalidateQueries({ queryKey: ['ai-review', leadId] })
    },
    onError: (err) => console.error('[AI Review]', err),
  })
}

export function useDeleteLead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteLead(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['leads'] })
      qc.removeQueries({ queryKey: ['lead', id] })
    },
  })
}

export function useApplyOcrFields() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      leadId,
      screenshotId,
      fields,
    }: {
      leadId: string
      screenshotId: string
      fields: Record<string, string>
    }) => applyExtractionFields(leadId, screenshotId, fields),
    onSuccess: (_, { leadId }) => {
      qc.invalidateQueries({ queryKey: ['lead', leadId] })
      qc.invalidateQueries({ queryKey: ['leads'] })
    },
  })
}

export function useChatMessages(leadId: string) {
  return useQuery({
    queryKey: ['chat', leadId],
    queryFn: () => fetchChatMessages(leadId),
    enabled: !!leadId,
  })
}

export function useSendChatMessage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      leadId,
      message,
      aiReviewId,
    }: {
      leadId: string
      message: string
      aiReviewId?: string
    }) => sendChatMessage(leadId, message, aiReviewId),
    onSuccess: (_, { leadId }) => {
      qc.invalidateQueries({ queryKey: ['chat', leadId] })
    },
  })
}
