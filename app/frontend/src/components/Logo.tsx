// The animated Holy Hauling logo, built from layered pieces so it can move:
// nine rays, the cross, the truck and the wordmark, each a mask tinted with
// `color`. Modes (from the design handoff):
//   arrive - burnout in: the truck skids in, rays pop, the word wipes in
//   leave  - burnout out: the truck shakes, squats and launches off
//   load   - working pulse: the rays breathe left to right (replaces spinners)
//   still  - the plain logo
// Under reduced motion every mode shows the plain logo.

import { useEffect } from 'react'

export type LogoMode = 'arrive' | 'leave' | 'load' | 'still'

// Layer boxes in the 575x560 artwork: [name, x, y, w, h].
const LAYERS: [string, number, number, number, number][] = [
  ['ray0', 0, 265, 75, 101], ['ray1', 40, 172, 73, 110], ['ray2', 100, 36, 86, 232],
  ['ray3', 191, 88, 39, 101], ['ray4', 283, 0, 24, 239], ['ray5', 352, 65, 32, 133],
  ['ray6', 410, 47, 91, 215], ['ray7', 458, 173, 95, 151], ['ray8', 507, 287, 68, 96],
  ['cross', 119, 265, 130, 148], ['truck', 84, 292, 405, 178], ['word', 18, 486, 554, 74],
]
const W = 575
const H = 560
// Rays grow out of this point (just above the wordmark, under the truck).
const FX = 290
const FY = 520
// Spinning overlays sit on each tire's face (the narrow oval left of the tread),
// measured from ll-truck.png: [cx, cy, rx, ry] in artwork pixels.
// The far wheel sits behind the bumper bar and the skid-plate hatching, so its
// spin is cropped to the tire face you can see (polygon in % of its box).
const WHEELS: [number, number, number, number, string?][] = [
  [141, 428, 12, 26],
  [268, 423, 22, 32],
  [400, 428, 19, 27, 'polygon(50% 7.4%, 100% 7.4%, 100% 100%, 21% 100%, 5% 76%, 8% 59%)'],
]
const SMOKE = [[138, 462], [278, 466]]
const SKIDS: [string, number, number, number][] = [
  ['in', 8, 457, 138], ['in', 150, 461, 139], ['out', 146, 457, 429], ['out', 289, 461, 286],
]

/** How long each mode runs before `onDone` fires. */
export const LOGO_MS: Record<LogoMode, number> = { arrive: 1900, leave: 1500, load: 0, still: 0 }

function box(x: number, y: number, w: number, h: number): React.CSSProperties {
  return { left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%`, width: `${(w / W) * 100}%`, height: `${(h / H) * 100}%` }
}

function mask(name: string): React.CSSProperties {
  const url = `url(/brand/ll/ll-${name}.png)`
  return { WebkitMaskImage: url, maskImage: url }
}

export function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

function Puffs({ n }: { n: number }) {
  return <>{Array.from({ length: n }, (_, d) => <b key={d} style={{ '--d': d } as React.CSSProperties} />)}</>
}

export function Logo({ mode = 'still', color = '#fff', bg = 'var(--hd)', label = 'Holy Hauling', className = '', onDone }: {
  mode?: LogoMode
  color?: string
  /** What sits behind the logo; the spinning wheels are drawn in it. */
  bg?: string
  /** Empty string hides it from screen readers (when the text says it already). */
  label?: string
  className?: string
  onDone?: () => void
}) {
  useEffect(() => {
    if (!onDone || !LOGO_MS[mode]) return
    const t = window.setTimeout(onDone, reducedMotion() ? 0 : LOGO_MS[mode])
    return () => window.clearTimeout(t)
  }, [mode, onDone])

  const layer = (i: number, cls = '') => {
    const [name, x, y, w, h] = LAYERS[i]
    return <i className={`wd-lg-l ${cls}`} style={{ ...box(x, y, w, h), ...mask(name) }} />
  }

  return (
    <div
      className={`wd-logo ${mode} ${className}`}
      style={{ '--lc': color, '--wbg': bg } as React.CSSProperties}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {LAYERS.slice(0, 9).map(([name, x, y, w, h], i) => {
        const ox = Math.min(Math.max(FX, x), x + w)
        const oy = Math.min(Math.max(FY, y), y + h)
        return (
          <span
            key={name}
            className="wd-lg-ray"
            style={{
              ...box(x, y, w, h),
              transformOrigin: `${((ox - x) / w) * 100}% ${((oy - y) / h) * 100}%`,
              '--o': Math.abs(i - 4),
              '--n': i,
            } as React.CSSProperties}
          >
            <i className="wd-lg-l" style={{ inset: 0, ...mask(name) }} />
          </span>
        )
      })}
      <div className="wd-lg-veh">
        {layer(10)}
        {layer(9)}
        {WHEELS.map(([cx, cy, rx, ry, crop]) => (
          <span key={cx} className="wd-lg-whl" style={{ ...box(cx - rx, cy - ry, 2 * rx, 2 * ry), clipPath: crop }}><i /></span>
        ))}
        {SMOKE.map(([x, y]) => (
          <span key={x} className="wd-lg-smk" style={box(x, y, 0, 0)}><Puffs n={7} /></span>
        ))}
      </div>
      {SKIDS.map(([kind, x, y, w], i) => (
        <span key={i} className={`wd-lg-skid ${kind}`} style={box(x, y, w, 6)} />
      ))}
      <span className="wd-lg-smk cloud" style={box(150, 462, 0, 0)}><Puffs n={4} /></span>
      {layer(11, 'wd-lg-word')}
    </div>
  )
}

/** A loading state: the working pulse and what's loading. */
export function Working({ label, className = '' }: { label: string; className?: string }) {
  return (
    <div role="status" className={`wd-working ${className}`}>
      <Logo mode="load" color="var(--ink)" bg="var(--bg)" label="" />
      <span>{label}</span>
    </div>
  )
}
