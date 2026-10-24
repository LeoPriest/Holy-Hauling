import type { HelpSection } from '../content/helpContent'

export function AccordionSection({ section, isOpen, onToggle }: {
  section: HelpSection
  isOpen: boolean
  onToggle: () => void
}) {
  return (
    <div className="overflow-hidden rounded-card border border-ln bg-sf">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-chip bg-bg text-sm">{section.icon}</span>
        <span className="flex-1">
          <span className="block text-sm font-bold text-ink">{section.title}</span>
          {section.subtitle && <span className="block text-[11px] text-mu">{section.subtitle}</span>}
        </span>
        <span className={`text-mu transition-transform ${isOpen ? 'rotate-90' : ''}`} aria-hidden="true">›</span>
      </button>

      {isOpen && (
        <div className="border-t border-ln px-4 py-3">
          {section.kind === 'steps' && (
            <ol className="space-y-3">
              {section.steps.map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-bg text-[11px] font-bold text-ok">{i + 1}</span>
                  <span className="text-[13px] leading-relaxed text-ink">
                    <b className="text-ink">{s.title}.</b> <span className="text-mu">{s.detail}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
          {section.kind === 'terms' && (
            <dl className="space-y-3">
              {section.terms.map((t, i) => (
                <div key={i}>
                  <dt className="text-[13px] font-bold text-ink">{t.word}</dt>
                  <dd className="mt-0.5 text-[12.5px] leading-relaxed text-mu">{t.def}</dd>
                </div>
              ))}
            </dl>
          )}
          {section.kind === 'text' && (
            <div className="space-y-2.5">
              {section.paragraphs.map((p, i) => (
                <p key={i} className="text-[13px] leading-relaxed text-mu">{p}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
