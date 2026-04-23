import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ingestScreenshot, triggerAiReview } from '../services/api'

type Step = 'idle' | 'uploading' | 'reviewing' | 'done' | 'error'

const STEP_LABELS: Record<Step, string> = {
  idle:      '',
  uploading: 'Uploading screenshot…',
  reviewing: 'Running AI review…',
  done:      'Done!',
  error:     'Something went wrong.',
}

interface Props {
  onClose: () => void
}

export function IngestProgressFlow({ onClose }: Props) {
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const handleFile = async (file: File) => {
    setErrorMsg(null)
    try {
      setStep('uploading')
      const result = await ingestScreenshot(file, 'thumbtack_screenshot')
      const leadId = result.lead.id

      setStep('reviewing')
      try {
        await triggerAiReview(leadId)
      } catch {
        // AI review failed — navigate anyway; facilitator can re-run from the command center
      }

      setStep('done')
      navigate(`/leads/${leadId}`)
    } catch (err) {
      setErrorMsg((err as Error).message ?? 'Upload failed')
      setStep('error')
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  const steps: Step[] = ['uploading', 'reviewing', 'done']
  const currentIdx = steps.indexOf(step)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-6 space-y-5">

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
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full bg-indigo-600 text-white rounded-xl py-3 text-sm font-medium hover:bg-indigo-700"
            >
              📷 Choose Screenshot
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleChange}
            />
          </>
        )}

        {step !== 'idle' && step !== 'error' && (
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
                    {STEP_LABELS[s]}
                  </span>
                </div>
              )
            })}
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
