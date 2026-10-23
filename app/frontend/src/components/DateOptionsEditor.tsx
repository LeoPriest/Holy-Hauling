import { useState } from 'react'
import { normalizeDateOptions } from '../utils/dateOptions'

interface Props {
  values: string[]
  onChange: (values: string[]) => void
  onSelectDate?: (date: string) => void
  disabled?: boolean
}

export function DateOptionsEditor({ values, onChange, onSelectDate, disabled = false }: Props) {
  const [pendingValue, setPendingValue] = useState('')

  const inputClassName = 'wd-input min-w-0 flex-1 disabled:opacity-50'

  const handleExistingChange = (index: number, nextValue: string) => {
    const nextValues = [...values]
    if (!nextValue) {
      nextValues.splice(index, 1)
      onChange(nextValues)
      return
    }

    nextValues[index] = nextValue
    onChange(normalizeDateOptions(nextValues))
  }

  return (
    <div className="space-y-2">
      {values.length === 0 && (
        <p className="py-2 text-sm italic text-mu">No requested dates captured yet.</p>
      )}

      {values.map((value, index) => (
        <div key={`${value}-${index}`} className="flex items-center gap-2">
          <input
            type="date"
            value={value}
            disabled={disabled}
            onChange={event => handleExistingChange(index, event.target.value)}
            className={inputClassName}
          />
          {onSelectDate && (
            <button
              type="button"
              onClick={() => onSelectDate(value)}
              disabled={disabled}
              className="wd-btn-sm shrink-0"
            >
              Use
            </button>
          )}
          <button
            type="button"
            onClick={() => onChange(values.filter((_, currentIndex) => currentIndex !== index))}
            disabled={disabled}
            className="wd-btn-sm wd-btn-ghost shrink-0 !text-danger"
            aria-label={`Remove ${value}`}
          >
            Remove
          </button>
        </div>
      ))}

      <div className="flex items-center gap-2">
        <input
          type="date"
          value={pendingValue}
          disabled={disabled}
          aria-label="Add requested date"
          onChange={event => {
            const nextValue = event.target.value
            setPendingValue(nextValue)
            if (!nextValue) return
            onChange(normalizeDateOptions([...values, nextValue]))
            setPendingValue('')
          }}
          className={inputClassName}
        />
        <span className="shrink-0 text-xs text-mu">Add a date</span>
      </div>
    </div>
  )
}
