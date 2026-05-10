import { useCallback, useEffect, useState } from 'react'
import { cancelPayment, fetchPayment, requestPayment } from '../services/api'
import type { LeadPayment, PaymentRequestCreate } from '../types/payment'

export function usePayment(leadId: string) {
  const [payment, setPayment] = useState<LeadPayment | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setPayment(await fetchPayment(leadId))
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [leadId])

  useEffect(() => { load() }, [load])

  const sendRequest = useCallback(async (payload: PaymentRequestCreate = {}) => {
    setSaving(true)
    setError(null)
    try {
      const p = await requestPayment(leadId, payload)
      setPayment(p)
      return p
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to send payment request'
      setError(msg)
      throw e
    } finally {
      setSaving(false)
    }
  }, [leadId])

  const cancel = useCallback(async () => {
    setSaving(true)
    try {
      await cancelPayment(leadId)
      setPayment(prev => prev ? { ...prev, status: 'cancelled' } : null)
    } finally {
      setSaving(false)
    }
  }, [leadId])

  return { payment, loading, saving, error, sendRequest, cancel, reload: load }
}
