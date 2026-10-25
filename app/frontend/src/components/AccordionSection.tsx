import type { HelpSection } from '../content/helpContent'

export function AccordionSection({ section, isOpen, onToggle }: {
  section: HelpSection
  isOpen: boolean
  onToggle: () => void
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-sm dark:bg-gray-700">{section.icon}</span>
        <span className="flex-1">
          <span className="block text-sm font-bold text-gray-900 dark:text-white">{section.title}</span>
          {section.subtitle && <span className="block text-[11px] text-gray-500 dark:text-gray-400">{section.subtitle}</span>}
        </span>
        <span className={`text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} aria-hidden="true">›</span>
      </button>

      {isOpen && (
        <div className="border-t border-gray-100 px-4 py-3 dark:border-gray-700">
          {section.kind === 'steps' && (
            <ol className="space-y-3">
              {section.steps.map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[11px] font-bold text-emerald-600 dark:bg-gray-700 dark:text-emerald-400">{i + 1}</span>
                  <span className="text-[13px] leading-relaxed text-gray-700 dark:text-gray-200">
                    <b className="text-gray-900 dark:text-white">{s.title}.</b> <span className="text-gray-500 dark:text-gray-400">{s.detail}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
          {section.kind === 'terms' && (
            <dl className="space-y-3">
              {section.terms.map((t, i) => (
                <div key={i}>
                  <dt className="text-[13px] font-bold text-gray-900 dark:text-white">{t.word}</dt>
                  <dd className="mt-0.5 text-[12.5px] leading-relaxed text-gray-500 dark:text-gray-400">{t.def}</dd>
                </div>
              ))}
            </dl>
          )}
          {section.kind === 'text' && (
            <div className="space-y-2.5">
              {section.paragraphs.map((p, i) => (
                <p key={i} className="text-[13px] leading-relaxed text-gray-600 dark:text-gray-300">{p}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
