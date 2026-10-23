import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLeads } from '../hooks/useLeads'
import { IngestProgressFlow } from './IngestProgressFlow'
import { LeadCreate } from '../screens/LeadCreate'

// Workday dock: floating bar, amber block slides under the active tab, green
// + in the middle for anyone who takes leads. Admin lives inside Settings.

// Outline icons (active tab) — Heroicons paths.
const OUTLINE = {
  queue: 'M2.25 13.5h3.86a2.25 2.25 0 0 1 2.012 1.244l.256.512a2.25 2.25 0 0 0 2.013 1.244h3.218a2.25 2.25 0 0 0 2.013-1.244l.256-.512a2.25 2.25 0 0 1 2.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 0 0-2.15-1.588H6.911a2.25 2.25 0 0 0-2.15 1.588L2.35 13.177a2.25 2.25 0 0 0-.1.661Z',
  jobs: 'M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 0 0 .75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 0 0-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0 1 12 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 0 1-.673-.38m0 0A2.18 2.18 0 0 1 3 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 0 1 3.413-.387m7.5 0V5.25A2.25 2.25 0 0 0 13.5 3h-3a2.25 2.25 0 0 0-2.25 2.25v.894m7.5 0a48.667 48.667 0 0 0-7.5 0',
  calendar: 'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5',
  settings: 'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94H9.704c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
}

type TabKey = keyof typeof OUTLINE

// Filled icons (resting tabs), drawn for the Workday design. `cut` strokes
// punch a line through the fill in the dock's own color.
function FilledIcon({ k }: { k: TabKey }) {
  return (
    <svg viewBox="0 0 24 24" className="ico ico-f" aria-hidden="true">
      {k === 'queue' && <path d="M4.6 4h14.8a1.6 1.6 0 0 1 1.5 1.1l2.1 7.2V18a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2v-5.7l2.1-7.2A1.6 1.6 0 0 1 4.6 4ZM3.7 12.4h4.4l1.2 2.3h5.4l1.2-2.3h4.4L18.3 6H5.7Z" />}
      {k === 'jobs' && (
        <>
          <path d="M8.5 7V5.6A1.6 1.6 0 0 1 10.1 4h3.8a1.6 1.6 0 0 1 1.6 1.6V7h-2V6h-3v1ZM2.5 9.2A2.2 2.2 0 0 1 4.7 7h14.6a2.2 2.2 0 0 1 2.2 2.2v9.6a2.2 2.2 0 0 1-2.2 2.2H4.7a2.2 2.2 0 0 1-2.2-2.2Z" />
          <path className="cut" d="M2.5 13.2h19" />
        </>
      )}
      {k === 'calendar' && (
        <>
          <path d="M4 6.6A2.1 2.1 0 0 1 6.1 4.5h11.8A2.1 2.1 0 0 1 20 6.6v12.3a2.1 2.1 0 0 1-2.1 2.1H6.1A2.1 2.1 0 0 1 4 18.9ZM12.8 12.4h3.8v3.8h-3.8Z" />
          <path className="cut" d="M4 9.2h16" />
          <path d="M7.2 2.2a1.1 1.1 0 0 1 2.2 0v4a1.1 1.1 0 0 1-2.2 0ZM14.6 2.2a1.1 1.1 0 0 1 2.2 0v4a1.1 1.1 0 0 1-2.2 0Z" />
        </>
      )}
      {k === 'settings' && <path d={OUTLINE.settings} />}
    </svg>
  )
}

const NAV_ITEMS: { key: TabKey; path: string; label: string; roles: string[]; exact: boolean }[] = [
  { key: 'queue', path: '/', label: 'Queue', roles: ['admin', 'facilitator'], exact: true },
  { key: 'jobs', path: '/jobs', label: 'Jobs', roles: ['admin', 'facilitator', 'supervisor', 'crew'], exact: false },
  { key: 'calendar', path: '/calendar', label: 'Calendar', roles: ['admin', 'facilitator', 'supervisor'], exact: false },
  { key: 'settings', path: '/settings', label: 'Settings', roles: ['admin', 'facilitator', 'supervisor', 'crew'], exact: false },
]

const LEAD_TAKERS = ['admin', 'facilitator']

// Each screen mounts its own dock, so remember where the amber block was and
// which tab was tapped; the new dock starts there and slides/hops across.
let lastInd: { left: number; width: number } | null = null
let pendingHop: TabKey | null = null
const RAY_ANGLES = [-80, -60, -40, -20, 0, 20, 40, 60, 80]

function isActive(pathname: string, path: string, exact: boolean) {
  if (exact) return pathname === path
  // Admin pages sit under Settings now.
  if (path === '/settings' && pathname.startsWith('/admin')) return true
  return pathname.startsWith(path)
}

export function BottomNav() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const canTakeLeads = !!user && LEAD_TAKERS.includes(user.role)
  const { data: leads = [] } = useLeads(undefined, { enabled: canTakeLeads })
  const newCount = leads.filter(l => l.status === 'new').length

  const [sheetOpen, setSheetOpen] = useState(false)
  const [burst, setBurst] = useState(0)
  const [hop, setHop] = useState<TabKey | null>(() => pendingHop)
  useEffect(() => {
    pendingHop = null
  }, [])
  const [flow, setFlow] = useState<'screenshot' | 'manual' | null>(null)

  const visibleItems = NAV_ITEMS.filter(item => !user || item.roles.includes(user.role))
  const half = Math.ceil(visibleItems.length / 2)
  const groups = canTakeLeads ? [visibleItems.slice(0, half), visibleItems.slice(half)] : [visibleItems]

  // Slide the amber block under whichever tab is active.
  const dockRef = useRef<HTMLDivElement>(null)
  const [ind, setInd] = useState<{ left: number; width: number } | null>(lastInd)
  useLayoutEffect(() => {
    const place = () => {
      const on = dockRef.current?.querySelector<HTMLElement>('.wd-dt.on')
      const next = on ? { left: on.offsetLeft + 2, width: on.offsetWidth - 4 } : null
      lastInd = next
      setInd(next)
    }
    // One frame at the old spot first, so the block slides instead of jumping.
    const frame = requestAnimationFrame(place)
    let live = true
    document.fonts?.ready.then(() => live && place())
    window.addEventListener('resize', place)
    return () => {
      live = false
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', place)
    }
  }, [pathname, visibleItems.length])

  function go(item: (typeof NAV_ITEMS)[number]) {
    setSheetOpen(false)
    if (isActive(pathname, item.path, item.exact)) return
    pendingHop = item.key
    setHop(item.key)
    navigate(item.path)
  }

  function toggleSheet() {
    setSheetOpen(open => {
      if (!open) setBurst(b => b + 1)
      return !open
    })
  }

  function start(kind: 'screenshot' | 'manual') {
    setSheetOpen(false)
    setFlow(kind)
  }

  return (
    <>
      <div className="wd-dock-spacer" aria-hidden="true" />
      <div className="wd-dock-wrap">
        <nav ref={dockRef} className="wd-dock" aria-label="Main">
          {ind && <div className="wd-dind" style={{ left: ind.left, width: ind.width }} aria-hidden="true" />}
          {groups.map((group, gi) => (
            <div key={gi} className="contents">
              {gi === 1 && <div className="wd-dock-gap" aria-hidden="true" />}
              <div className="wd-dock-grp">
                {group.map(item => {
                  const active = isActive(pathname, item.path, item.exact)
                  return (
                    <button
                      key={item.key}
                      type="button"
                      aria-label={item.label}
                      aria-current={active ? 'page' : undefined}
                      onClick={() => go(item)}
                      onAnimationEnd={() => setHop(null)}
                      className={`wd-dt ${active ? 'on' : ''} ${active && hop === item.key ? 'hop' : ''}`}
                    >
                      <FilledIcon k={item.key} />
                      <svg viewBox="0 0 24 24" className="ico ico-o" aria-hidden="true"><path d={OUTLINE[item.key]} /></svg>
                      <span className="lbl" aria-hidden="true">{item.label}</span>
                      {item.key === 'queue' && newCount > 0 && <span className="dbdg" aria-hidden="true">{newCount}</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
          {canTakeLeads && (
            <>
              <div key={burst} className={`wd-rays ${burst ? 'go' : ''}`} aria-hidden="true">
                {RAY_ANGLES.map((a, i) => (
                  <i key={a} style={{ '--a': `${a}deg`, animationDelay: `${Math.abs(i - 4) * 30}ms` } as React.CSSProperties} />
                ))}
              </div>
              <button
                type="button"
                aria-label="New lead"
                aria-expanded={sheetOpen}
                onClick={toggleSheet}
                className={`wd-fab ${sheetOpen ? 'open' : ''}`}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5v15m7.5-7.5h-15" /></svg>
              </button>
            </>
          )}
        </nav>
      </div>

      {canTakeLeads && (
        <div role="dialog" aria-label="New lead" aria-hidden={!sheetOpen} className={`wd-dsheet ${sheetOpen ? 'show' : ''}`}>
          <b className="wd-disp text-lg leading-none tracking-wide">New lead</b>
          <div className="flex gap-2">
            <button type="button" tabIndex={sheetOpen ? 0 : -1} onClick={() => start('screenshot')}>Screenshot</button>
            <button type="button" tabIndex={sheetOpen ? 0 : -1} onClick={() => start('manual')}>Type it in</button>
          </div>
        </div>
      )}

      {flow === 'screenshot' && <IngestProgressFlow onClose={() => setFlow(null)} />}
      {flow === 'manual' && <LeadCreate initialMode="manual" onClose={() => setFlow(null)} />}
    </>
  )
}
