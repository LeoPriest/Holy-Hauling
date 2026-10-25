// Workday switch: a 46x28 track that turns amber, inside a 44px tap row.
// With no visible label, pass `label` so screen readers still get a name.

export function Switch({ on, onChange, children, label, disabled }: {
  on: boolean
  onChange: (on: boolean) => void
  children?: React.ReactNode
  label?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="wd-sw disabled:opacity-40"
    >
      <span className="wd-sw-t" aria-hidden="true"><i /></span>
      {children}
    </button>
  )
}
