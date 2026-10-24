// Workday screen header: dark slab, display title, a muted line under it,
// an optional back arrow on the left and room for a control on the right.

const BACK = 'M15.75 19.5 8.25 12l7.5-7.5'

export function ScreenHeader({ title, subtitle, onBack, backLabel = 'Back', right }: {
  title: string
  subtitle?: React.ReactNode
  onBack?: () => void
  backLabel?: string
  right?: React.ReactNode
}) {
  return (
    <header className={`wd-hdr flex items-center gap-2${onBack ? ' !pl-2' : ''}`}>
      {onBack && (
        <button type="button" onClick={onBack} aria-label={backLabel} className="wd-ib shrink-0">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d={BACK} /></svg>
        </button>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="wd-disp truncate text-[26px] leading-none">{title}</h1>
        {subtitle && <p className="wd-h-s truncate">{subtitle}</p>}
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </header>
  )
}
