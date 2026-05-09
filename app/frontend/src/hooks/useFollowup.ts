import { useCallback, useEffect, useState } from 'react'
import { cancelFollowup, fetchFollowup, upsertFollowup } from '../services/api'
import type { FollowupCreate, LeadFollowup } from '../types/lead'

export function useFollowup(leadId: string) {
  const [followup, setFollowup] = useState<LeadFollowup | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setFollowup(await fetchFollowup(leadId))
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [leadId])

  useEffect(() => { load() }, [load])

  const save = useCallback(async (payload: FollowupCreate) => {
    setSaving(true)
    try {
      const updated = await upsertFollowup(leadId, payload)
      setFollowup(updated)
      return updated
    } finally {
      setSaving(false)
    }
  }, [leadId])

  const cancel = useCallback(async () => {
    setSaving(true)
    try {
      await cancelFollowup(leadId)
      setFollowup(null)
    } finally {
      setSaving(false)
    }
  }, [leadId])

  return { followup, loading, saving, save, cancel, reload: load }
}
