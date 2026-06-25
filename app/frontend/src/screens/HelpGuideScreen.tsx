import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BottomNav } from '../components/BottomNav'
import { AccordionSection } from '../components/AccordionSection'
import { HELP_SECTIONS } from '../content/helpContent'

export function HelpGuideScreen() {
  const navigate = useNavigate()
  const [open, setOpen] = useState<Set<string>>(new Set(HELP_SECTIONS.length ? [HELP_SECTIONS[0].id] : []))

  const toggle = (id: string) =>
    setOpen(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  return (
    <div className="min-h-screen bg-gray-50 pb-20 dark:bg-gray-900">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
        <button type="button" onClick={() => navigate('/settings')} aria-label="Back" className="text-gray-400">‹</button>
        <h1 className="text-lg font-bold text-gray-900 dark:text-white">Help &amp; guide</h1>
      </header>

      <div className="space-y-2.5 p-4">
        <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          Your day-to-day with leads, start to finish — plus what the less-obvious words mean. Tap a section to open it.
        </p>

        {HELP_SECTIONS.map(section => (
          <AccordionSection key={section.id} section={section} isOpen={open.has(section.id)} onToggle={() => toggle(section.id)} />
        ))}

        <div className="flex items-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-3 text-xs text-gray-500 dark:border-gray-600 dark:text-gray-400">
          🛟 Something off or missing in this guide? Tell Ron.
        </div>
      </div>
      <BottomNav />
    </div>
  )
}
