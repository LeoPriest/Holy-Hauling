import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

// The Workday dock used for in-screen tabs (the lead screen's Brief / Quote /
// Log). Same look as the main dock: resting tabs show a filled green icon, the
// active one rides an amber block that slides across with the settle ease.

export interface DockTab<K extends string> {
  key: K
  label: string
  /** Outline path shown on the amber block. */
  outline: string
  /** Filled icon paths shown at rest; `cut` strokes punch a line through. */
  filled: ReactNode
}

export function TabDock<K extends string>({ tabs, active, onChange, label }: {
  tabs: DockTab<K>[]
  active: K
  onChange: (key: K) => void
  label: string
}) {
  const dockRef = useRef<HTMLElement>(null)
  const [ind, setInd] = useState<{ left: number; width: number } | null>(null)
  const [hop, setHop] = useState<K | null>(null)

  useLayoutEffect(() => {
    const place = () => {
      const on = dockRef.current?.querySelector<HTMLElement>('.wd-dt.on')
      setInd(on ? { left: on.offsetLeft + 2, width: on.offsetWidth - 4 } : null)
    }
    place()
    let live = true
    document.fonts?.ready.then(() => live && place())
    window.addEventListener('resize', place)
    return () => {
      live = false
      window.removeEventListener('resize', place)
    }
  }, [active, tabs.length])

  return (
    <>
      <div className="wd-dock-spacer" aria-hidden="true" />
      <div className="wd-dock-wrap">
        <nav ref={dockRef} className="wd-dock" aria-label={label}>
          {ind && <div className="wd-dind" style={{ left: ind.left, width: ind.width }} aria-hidden="true" />}
          {tabs.map(tab => {
            const on = tab.key === active
            return (
              <button
                key={tab.key}
                type="button"
                aria-label={tab.label}
                aria-current={on ? 'page' : undefined}
                onClick={() => {
                  if (on) return
                  setHop(tab.key)
                  onChange(tab.key)
                }}
                onAnimationEnd={() => setHop(null)}
                className={`wd-dt ${on ? 'on' : ''} ${on && hop === tab.key ? 'hop' : ''}`}
              >
                <svg viewBox="0 0 24 24" className="ico ico-f" aria-hidden="true">{tab.filled}</svg>
                <svg viewBox="0 0 24 24" className="ico ico-o" aria-hidden="true"><path d={tab.outline} /></svg>
                <span className="lbl" aria-hidden="true">{tab.label}</span>
              </button>
            )
          })}
        </nav>
      </div>
    </>
  )
}
