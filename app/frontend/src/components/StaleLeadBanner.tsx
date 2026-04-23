interface Props {
  t1Count: number
  t2Count: number
  isSnoozed: boolean
  onSnooze: () => void
}

export function StaleLeadBanner({ t1Count, t2Count, isSnoozed, onSnooze }: Props) {
  const total = t1Count + t2Count
  if (total === 0 || isSnoozed) return null

  const isEscalated = t2Count > 0
  const message = isEscalated
    ? `${t2Count} lead${t2Count !== 1 ? 's' : ''} escalated — backup notified`
    : `${t1Count} lead${t1Count !== 1 ? 's' : ''} need${t1Count === 1 ? 's' : ''} attention`

  return (
    <div
      className={`flex items-center justify-between px-4 py-2.5 text-sm font-medium ${
        isEscalated ? 'bg-red-600 text-white' : 'bg-amber-500 text-white'
      }`}
    >
      <span>{isEscalated ? '🔴' : '⚠️'} {message}</span>
      <button
        onClick={onSnooze}
        className="text-xs bg-white/20 rounded px-2.5 py-1 hover:bg-white/30 shrink-0 ml-3"
      >
        Snooze 10m
      </button>
    </div>
  )
}
