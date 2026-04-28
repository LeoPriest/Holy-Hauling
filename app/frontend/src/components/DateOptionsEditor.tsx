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

  const inputClassName =
    'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white'

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
        <p className="text-xs italic text-gray-400 dark:text-gray-500">No requested dates captured yet.</p>
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
              className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-300 whitespace-nowrap"
            >
              Use
            </button>
          )}
          <button
            type="button"
            onClick={() => onChange(values.filter((_, currentIndex) => currentIndex !== index))}
            disabled={disabled}
            className="rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-900/20"
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
          onChange={event => {
            const nextValue = event.target.value
            setPendingValue(nextValue)
            if (!nextValue) return
            onChange(normalizeDateOptions([...values, nextValue]))
            setPendingValue('')
          }}
          className={inputClassName}
        />
        <span className="text-xs text-gray-400 dark:text-gray-500">Add requested date</span>
      </div>
    </div>
  )
}
