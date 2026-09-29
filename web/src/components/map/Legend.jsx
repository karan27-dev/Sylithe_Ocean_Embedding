import { fmt, rampCss } from '../../lib/ocean'

/** Colour bar: thin, labelled at the ends and middle, with optional threshold marks (e.g. TCHP 50). */
export default function Legend({ layer, range, marks = [], className = '', width = 220 }) {
  const [lo, hi] = range
  const span = hi - lo, dp = span >= 20 ? 0 : span >= 2 ? 1 : 2
  const pos = (v) => `${Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * 100}%`
  return (
    <div className={className} style={{ width }}>
      <div className="relative h-[6px] rounded-[1px]" style={{ background: rampCss(layer.ramp) }}>
        {marks.filter((m) => m.v > lo && m.v < hi).map((m) => (
          <span key={m.v} className="absolute -top-[3px] h-[12px] w-px bg-ink" style={{ left: pos(m.v) }} title={m.label} />
        ))}
      </div>
      <div className="num mt-1.5 flex justify-between text-[10.5px] text-mute">
        <span>{fmt(lo, dp)}</span>
        <span>{fmt((lo + hi) / 2, dp)}</span>
        <span>{fmt(hi, dp)} <span className="text-faint">{layer.unit}</span></span>
      </div>
    </div>
  )
}
