import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCity } from '../context/CityContext'
import { ingestScreenshot, triggerAiReview } from '../services/api'

type Step = 'idle' | 'uploading' | 'reviewing' | 'done' | 'conflicts' | 'error'

const STEP_LABELS: Record<Step, string> = {
  idle:      '',
  uploading: 'Uploading screenshot…',
  reviewing: 'Running AI review…',
  done:      'Done!',
  conflicts: 'Read them, but some fields disagreed.',
  error:     'Something went wrong.',
}

/** Turn an OCR field key into something worth reading on a phone. */
const FIELD_LABELS: Record<string, string> = {
  customer_name:   'Customer name',
  customer_phone:  'Phone',
  job_location:    'Location',
  service_type:    'Service',
  lead_cost_total: 'Lead cost',
  lead_cost_gross: 'Direct lead cost',
  lead_cost_bonus: 'Bonus',
  pros_contacted:  'Pros contacted',
  pros_responded:  'Pros responded',
}

interface Props {
  onClose: () => void
}

export function IngestProgressFlow({ onClose }: Props) {
  const navigate = useNavigate()
  const { cities, requiredCityId } = useCity()
  const fileRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('idle')
  const [selectedCityId, setSelectedCityId] = useState(requiredCityId)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [shotCount, setShotCount] = useState(0)
  const [conflicts, setConflicts] = useState<string[]>([])
  const [conflictLeadId, setConflictLeadId] = useState<string | null>(null)
  const canDismiss = step === 'idle' || step === 'error' || step === 'conflicts'

  useEffect(() => {
    if (!selectedCityId && requiredCityId) setSelectedCityId(requiredCityId)
  }, [requiredCityId, selectedCityId])

  const handleFiles = async (files: File[]) => {
    setErrorMsg(null)
    setConflicts([])
    setShotCount(files.length)
    try {
      setStep('uploading')
      const result = await ingestScreenshot(files, 'thumbtack_screenshot', selectedCityId || requiredCityId)
      const leadId = result.lead.id

      setStep('reviewing')
      try {
        await triggerAiReview(leadId)
      } catch {
        // AI review failed — continue anyway; it can be re-run from the lead window
      }

      // Where the shots disagreed, nothing was written. Stop here and say so —
      // navigating straight through would flash the warning past him. The
      // disagreement is also on the lead's timeline, so it survives this screen.
      if (result.conflicts.length > 0) {
        setConflicts(result.conflicts)
        setConflictLeadId(leadId)
        setStep('conflicts')
        return
      }

      setStep('done')
      navigate(`/leads/${leadId}`)
    } catch (err) {
      setErrorMsg((err as Error).message ?? 'Upload failed')
      setStep('error')
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length) handleFiles(files)
    e.target.value = ''
  }

  const steps: Step[] = ['uploading', 'reviewing', 'done']
  const currentIdx = steps.indexOf(step)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={canDismiss ? onClose : undefined}
      />
      <div className="relative bg-white rounded-2xl w-full max-w-sm sm:max-w-md shadow-xl p-5 sm:p-6 space-y-5 max-h-[calc(100vh-2rem)] overflow-y-auto">

        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">New Lead from Screenshot</h2>
          {(step === 'idle' || step === 'error') && (
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
          )}
        </div>

        {step === 'idle' && (
          <>
            <p className="text-sm text-gray-500">
              Select your Thumbtack screenshot. The app will extract the lead data and run an AI review automatically.
            </p>
            {cities.length > 1 && (
              <select
                className="w-full border rounded-lg px-3 py-2 text-sm"
                value={selectedCityId || requiredCityId}
                onChange={event => setSelectedCityId(event.target.value)}
              >
                {cities.map(city => <option key={city.id} value={city.id}>{city.name}</option>)}
              </select>
            )}
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full bg-indigo-600 text-white rounded-xl py-3 text-sm font-medium hover:bg-indigo-700 flex items-center justify-center gap-2"
            >
              <span aria-hidden="true">📷</span>
              <span>Choose Screenshot(s)</span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleChange}
            />
            <p className="text-xs text-gray-400 text-center mt-2">
              Pick several if the lead spans more than one screenshot — they
              become one lead.
            </p>
          </>
        )}

        {step !== 'idle' && step !== 'error' && step !== 'conflicts' && (
          <div className="space-y-3">
            {steps.map((s, i) => {
              const done = i < currentIdx || step === 'done'
              const active = i === currentIdx && step !== 'done'
              return (
                <div key={s} className="flex items-center gap-3">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                    done   ? 'bg-green-500 text-white' :
                    active ? 'bg-indigo-600 text-white animate-pulse' :
                             'bg-gray-200 text-gray-400'
                  }`}>
                    {done ? '✓' : i + 1}
                  </div>
                  <span className={`text-sm ${active ? 'text-gray-900 font-medium' : done ? 'text-green-700' : 'text-gray-400'}`}>
                    {s === 'uploading' && shotCount > 1
                      ? `Reading ${shotCount} screenshots…`
                      : STEP_LABELS[s]}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {step === 'conflicts' && (
          <div className="space-y-3">
            <div className="rounded-xl border-l-[3px] border-amber-500 bg-amber-50 p-3 dark:bg-amber-900/20">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                The screenshots disagreed on {conflicts.length === 1 ? 'a field' : `${conflicts.length} fields`}.
              </p>
              <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                Nothing was filled in for {conflicts.length === 1 ? 'it' : 'them'} — set{' '}
                {conflicts.length === 1 ? 'it' : 'them'} yourself so a wrong number never lands silently.
              </p>
              <ul className="mt-2 space-y-1">
                {conflicts.map(f => (
                  <li key={f} className="text-sm font-medium text-gray-900 dark:text-white">
                    · {FIELD_LABELS[f] ?? f}
                  </li>
                ))}
              </ul>
            </div>
            <button
              onClick={() => conflictLeadId && navigate(`/leads/${conflictLeadId}`)}
              className="min-h-[44px] w-full rounded-xl bg-indigo-600 px-4 font-medium text-white active:bg-indigo-700"
            >
              Open the lead
            </button>
          </div>
        )}

        {step === 'error' && (
          <>
            <p className="text-sm text-red-600">{errorMsg}</p>
            <div className="flex gap-2">
              <button
                onClick={() => { setStep('idle'); setErrorMsg(null) }}
                className="flex-1 border border-gray-300 text-gray-700 rounded-xl py-2 text-sm hover:bg-gray-50"
              >
                Try again
              </button>
              <button
                onClick={onClose}
                className="flex-1 border border-gray-300 text-gray-700 rounded-xl py-2 text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  )
}
