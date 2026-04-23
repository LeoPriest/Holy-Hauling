export function AgeIndicator({ createdAt }: { createdAt: string }) {
  const minutes = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60_000)
  const display =
    minutes < 60
      ? `${minutes}m ago`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h ago`
        : `${Math.floor(minutes / 1440)}d ago`

  const color =
    minutes < 15 ? 'text-green-600' : minutes < 60 ? 'text-yellow-600' : 'text-red-600'

  return <span className={`text-xs tabular-nums ${color}`}>{display}</span>
}
