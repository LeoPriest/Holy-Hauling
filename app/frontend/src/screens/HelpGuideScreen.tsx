import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BottomNav } from '../components/BottomNav'
import { AccordionSection } from '../components/AccordionSection'
import { guideForRole } from '../content/helpContent'
import { useAuth } from '../context/AuthContext'
import { ScreenHeader } from '../components/ScreenHeader'

export function HelpGuideScreen() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const guide = guideForRole(user?.role)
  const [open, setOpen] = useState<Set<string>>(new Set(guide.sections.length ? [guide.sections[0].id] : []))

  const toggle = (id: string) =>
    setOpen(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  return (
    <div className="min-h-screen bg-bg pb-20">
      <ScreenHeader title={guide.title} onBack={() => navigate('/settings')} />

      <div className="space-y-2.5 p-4">
        <p className="text-xs leading-relaxed text-mu">{guide.intro}</p>

        {guide.sections.map(section => (
          <AccordionSection key={section.id} section={section} isOpen={open.has(section.id)} onToggle={() => toggle(section.id)} />
        ))}

        <div className="flex items-center gap-2 rounded-card border border-dashed border-ln px-4 py-3 text-xs text-mu">
          🛟 Something off or missing in this guide? Tell Ron.
        </div>
      </div>
      <BottomNav />
    </div>
  )
}
