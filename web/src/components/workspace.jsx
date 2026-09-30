import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { fmt, fmtLat, fmtLon } from '../lib/ocean'

// Pieces of the map workspace shared by the Daily and Explorer pages: numbered sidebar sections, buttons, map toolbar.

/** Collapsible block of the left sidebar, numbered in the order a user works through it. */
export function Side({ n, title, aside, open: init = true, children }) {
  const [open, setOpen] = useState(init)
  return (
    <section className="border-b border-line">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2.5 px-4 py-3 text-left hover:bg-wash">
        <span className="num flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#EEF0F2] text-[10.5px] text-[#475569]">{n}</span>
        <span className="text-[13px] text-ink">{title}</span>
        <span className="ml-auto truncate text-[11px] text-mute">{aside}</span>
        <ChevronDown size={14} className={`shrink-0 text-faint transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </section>
  )
}

export function SideTool({ on, onClick, title, children, className = '' }) {
  return (
    <button onClick={onClick} title={title} aria-pressed={on}
      className={`flex h-9 items-center justify-center gap-1.5 rounded-[7px] border px-2 text-[12px] transition-colors ${on ? 'border-[#D5DAE0] bg-[#EEF0F2] text-[#334155]' : 'border-line bg-paper text-ink2 hover:border-line2 hover:text-ink'} ${className}`}>
      {children}
    </button>
  )
}

export function MapBtn({ on, onClick, title, children }) {
  return (
    <button onClick={onClick} title={title} aria-pressed={on}
      className={`flex h-9 items-center gap-1.5 rounded-[8px] border px-2.5 text-[12px] shadow-sm backdrop-blur transition-colors ${on ? 'border-[#D5DAE0] bg-[#EEF0F2] text-[#334155]' : 'border-line bg-paper/95 text-ink2 hover:text-ink'}`}>
      {children}
    </button>
  )
}

export const field = 'h-9 w-full rounded-[7px] border border-line bg-paper px-2.5 text-[13px] text-ink focus:border-sea focus:outline-none'

/** Legend and cursor readout for the sidebar; the readout owns its state so mouse moves do not re-render the page. */
export function CursorReadout({ bind, layer, depth }) {
  const [h, set] = useState(null)
  useEffect(() => { bind.current = set }, [bind])
  const ok = h && Number.isFinite(h.v)
  return (
    <div className="mt-2.5 flex items-baseline justify-between gap-2 rounded-[7px] border border-line bg-paper px-2.5 py-2 text-[11.5px]">
      {ok ? <>
        <span className="num text-mute">{fmtLat(h.lat)} {fmtLon(h.lon)}</span>
        <span className="num text-[15px] text-ink">{fmt(h.v, layer.dp)} <span className="text-[11px] text-mute">{layer.unit}</span></span>
      </> : <span className="text-faint">Move the cursor over the ocean to read {layer.label.toLowerCase()}{layer.perDepth ? ` at ${depth} m` : ''}</span>}
    </div>
  )
}

const QUICK = [0, 50, 100, 150, 200, 500, 1000]

/** Depth picker for the legend box: common depths as buttons, every standard depth in the menu. */
export function DepthPicker({ depths, k, onChange }) {
  return (
    <div className="mt-2.5">
      <div className="flex items-center justify-between">
        <span className="label">Depth</span>
        <select value={k} onChange={(e) => onChange(+e.target.value)} className="h-6 border border-line bg-paper px-1 text-[11px] text-ink">
          {depths.map((d, j) => <option key={d} value={j}>{d} m</option>)}</select>
      </div>
      <div className="seg mt-1.5 flex w-full !rounded-none">
        {QUICK.map((d) => { const j = depths.indexOf(d); return (
          <button key={d} className="num flex-1 !h-6 !rounded-none !px-0 text-[10.5px]" aria-pressed={k === j} onClick={() => onChange(j)}>{d}</button>) })}
      </div>
    </div>
  )
}
