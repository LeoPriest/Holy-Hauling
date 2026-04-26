import { useEffect, useState } from 'react'

const HOUR_OPTIONS = Array.from({ length: 25 }, (_, index) => index)
const MINUTE_OPTIONS = [0, 15, 30, 45]

function toDraft(value: number | null) {
  if (!Number.isFinite(value) || value == null || value <= 0) {
    return { hours: '', minutes: '' }
  }

  const roundedMinutes = Math.min(24 * 60, Math.max(15, Math.round(value / 15) * 15))
  const hours = Math.floor(roundedMinutes / 60)
  const minutes = roundedMinutes % 60
  return {
    hours: String(hours),
    minutes: String(minutes),
  }
}

interface Props {
  value: number | null
  onChange: (value: number | null) => void
  disabled?: boolean
  allowClear?: boolean
}

export function DurationWheelInput({
  value,
  onChange,
  disabled = false,
  allowClear = false,
}: Props) {
  const [hours, setHours] = useState('')
  const [minutes, setMinutes] = useState('')

  useEffect(() => {
    const next = toDraft(value)
    setHours(next.hours)
    setMinutes(next.minutes)
  }, [value])

  const commit = (nextHours: string, nextMinutes: string) => {
    if (!nextHours || !nextMinutes) {
      onChange(null)
      return
    }
    onChange((Number(nextHours) * 60) + Number(nextMinutes))
  }

  const handleHoursChange = (nextHours: string) => {
    const nextMinutes = nextHours === '24' && minutes !== '0' ? '0' : minutes
    setHours(nextHours)
    setMinutes(nextMinutes)
    commit(nextHours, nextMinutes)
  }

  const handleMinutesChange = (nextMinutes: string) => {
    setMinutes(nextMinutes)
    commit(hours, nextMinutes)
  }

  const selectClassName =
    'min-w-0 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white'

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={hours}
        onChange={event => handleHoursChange(event.target.value)}
        disabled={disabled}
        className={selectClassName}
      >
        <option value="">Hours</option>
        {HOUR_OPTIONS.map(option => (
          <option key={option} value={option}>
            {option}h
          </option>
        ))}
      </select>

      <select
        value={minutes}
        onChange={event => handleMinutesChange(event.target.value)}
        disabled={disabled}
        className={selectClassName}
      >
        <option value="">Minutes</option>
        {MINUTE_OPTIONS.map(option => (
          <option key={option} value={option} disabled={hours === '24' && option !== 0}>
            {String(option).padStart(2, '0')}m
          </option>
        ))}
      </select>

      {allowClear && (hours || minutes) && (
        <button
          type="button"
          onClick={() => {
            setHours('')
            setMinutes('')
            onChange(null)
          }}
          disabled={disabled}
          className="rounded-lg border border-gray-300 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          Clear
        </button>
      )}
    </div>
  )
}
