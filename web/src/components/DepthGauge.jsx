import { useRef } from 'react'
import { DEPTHS } from '../lib/ocean'

// The depth control is drawn like an instrument scale: square-root spacing (the upper ocean, where the mixed
// layer and thermocline live, gets the room), every standard level ticked, a few labelled.
const LABELLED = new Set([0, 50, 100, 200, 500, 1000])
const pos = (z) => Math.sqrt(z / 1000)

export default function DepthGauge({ value, onChange, vertical = true, length = 300, className = '' }) {
  const ref = useRef(null)
  const pick = (e) => {
    const r = ref.current.getBoundingClientRect()
    const t = vertical ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width
    const z = Math.max(0, Math.min(1, t)) ** 2 * 1000
    const k = DEPTHS.reduce((b, d, i) => (Math.abs(pos(d) - pos(z)) < Math.abs(pos(DEPTHS[b]) - pos(z)) ? i : b), 0)
    if (k !== value) onChange(k)
  }
  const onDown = (e) => { e.currentTarget.setPointerCapture(e.pointerId); pick(e) }
  const onMove = (e) => { if (e.buttons) pick(e) }
  const onKey = (e) => {
    const d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key]
    if (d) { e.preventDefault(); onChange(Math.max(0, Math.min(DEPTHS.length - 1, value + d))) }
  }
  const at = (z) => `${pos(z) * 100}%`
  const sel = DEPTHS[value]

  if (!vertical) {
    return (
      <div className={`select-none ${className}`}>
        <div ref={ref} role="slider" tabIndex={0} aria-label="Depth" aria-valuemin={0} aria-valuemax={1000} aria-valuenow={sel}
          aria-valuetext={`${sel} metres`} onPointerDown={onDown} onPointerMove={onMove} onKeyDown={onKey}
          className="relative h-9 cursor-pointer touch-none">
          <div className="absolute inset-x-0 top-3 h-px bg-line2" />
          {DEPTHS.map((d) => (
            <span key={d} className={`absolute top-3 w-px ${d === sel ? 'h-3 bg-ink' : 'h-1.5 bg-line2'}`} style={{ left: at(d) }} />
          ))}
          <span className="absolute top-[7px] h-[11px] w-[11px] -translate-x-1/2 rounded-full border-[1.5px] border-ink bg-paper transition-[left] duration-200 ease-out"
            style={{ left: at(sel) }} />
          {[0, 100, 500, 1000].map((d) => (
            <span key={d} className="num absolute top-6 -translate-x-1/2 text-[10px] text-faint" style={{ left: at(d) }}>{d}</span>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className={`flex select-none items-stretch gap-2 ${className}`} style={{ height: length }}>
      <div ref={ref} role="slider" tabIndex={0} aria-label="Depth" aria-orientation="vertical" aria-valuemin={0} aria-valuemax={1000}
        aria-valuenow={sel} aria-valuetext={`${sel} metres`} onPointerDown={onDown} onPointerMove={onMove} onKeyDown={onKey}
        className="group relative w-12 cursor-ns-resize touch-none">
        <div className="absolute bottom-0 right-3 top-0 w-px bg-line2" />
        {DEPTHS.map((d) => (
          <div key={d} className="absolute right-3 flex -translate-y-1/2 items-center" style={{ top: at(d) }}>
            {LABELLED.has(d) && d !== sel && <span className="num mr-1.5 text-[10px] text-faint">{d}</span>}
            <span className={`h-px ${LABELLED.has(d) ? 'w-2.5 bg-mute' : 'w-1.5 bg-line2'}`} />
          </div>
        ))}
        <div className="absolute right-0 flex -translate-y-1/2 items-center transition-[top] duration-200 ease-out" style={{ top: at(sel) }}>
          <span className="num mr-1 whitespace-nowrap text-[11px] text-ink">{sel}<span className="text-faint"> m</span></span>
          <svg width="12" height="10" viewBox="0 0 12 10" aria-hidden="true"><path d="M0 5L12 0v10z" fill="currentColor" className="text-ink" /></svg>
        </div>
      </div>
    </div>
  )
}
