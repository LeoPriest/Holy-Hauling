// Workday segmented control: equal parts, an ink pill slides to the chosen one.

export function Segmented<K extends string>({ options, value, onChange, label = 'Show' }: {
  options: { key: K; label: string; badge?: number }[]
  value: K
  onChange: (key: K) => void
  label?: string
}) {
  const at = Math.max(0, options.findIndex(o => o.key === value))
  return (
    <div
      className="wd-seg"
      role="group"
      aria-label={label}
      style={{ '--n': options.length, '--at': at } as React.CSSProperties}
    >
      <span className="wd-seg-pill" aria-hidden="true" />
      {options.map(o => (
        <button key={o.key} type="button" aria-pressed={o.key === value} onClick={() => onChange(o.key)}>
          {o.label}
          {o.badge != null && o.badge > 0 && <span className="dbdg">{o.badge}</span>}
        </button>
      ))}
    </div>
  )
}
