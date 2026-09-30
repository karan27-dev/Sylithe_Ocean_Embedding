import { useState } from 'react'
import { DEPTHS, fmt } from '../../lib/ocean'
import { linePath, linear, sqrtDepth, ticks, useWidth } from './scale'

const ZT = [0, 20, 50, 100, 200, 300, 500, 1000]

/**
 * Vertical temperature profile. Depth runs down on a square-root axis.
 *  main     { label, values[15], sigma?[15] }  drawn in ink, with a ±σ band when sigma is given
 *  others   [{ label, values, style: 'faint' | 'dashed' }]   other days, the reference product
 *  points   [{ label, values }]                               observations (Argo), drawn as dots
 *  mld      mixed-layer depth, shaded
 */
export default function ProfileChart({ main, others = [], points = [], mld, mark, height = 360 }) {
  const [ref, W] = useWidth()
  const [hk, setHk] = useState(null)
  const m = { t: 22, r: 12, b: 26, l: 40 }
  const lastValid = Math.max(...[main, ...others, ...points].map((s) => DEPTHS[s.values.findLastIndex(Number.isFinite)] ?? 0))
  const zmax = lastValid > 500 ? 1000 : lastValid > 200 ? 500 : 200
  const zs = DEPTHS.filter((z) => z <= zmax)
  const vals = [main, ...others, ...points].flatMap((s) => s.values.slice(0, zs.length))
    .concat(main.sigma ? main.values.map((v, k) => v + (main.sigma[k] ?? 0)) : []).filter(Number.isFinite)
  const lo = Math.floor(Math.min(...vals, 20) - 0.5), hi = Math.ceil(Math.max(...vals) + 0.5)
  const x = linear(lo, hi, m.l, W - m.r), y = sqrtDepth(zmax, m.t, height - m.b)
  const pts = (v) => zs.map((z, k) => [x(v[k]), y(z)])

  const band = main.sigma && (() => {
    const up = zs.map((z, k) => [x(main.values[k] + main.sigma[k]), y(z)]).filter(([a]) => Number.isFinite(a))
    const dn = zs.map((z, k) => [x(main.values[k] - main.sigma[k]), y(z)]).filter(([a]) => Number.isFinite(a)).reverse()
    return up.length > 1 ? `M${[...up, ...dn].map((p) => p.map((q) => q.toFixed(1)).join(',')).join('L')}Z` : null
  })()

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect(), py = e.clientY - r.top
    setHk(zs.reduce((b, z, k) => (Math.abs(y(z) - py) < Math.abs(y(zs[b]) - py) ? k : b), 0))
  }

  return (
    <div ref={ref} className="relative">
      <svg width={W} height={height} className="draw block overflow-visible" onMouseMove={onMove} onMouseLeave={() => setHk(null)}>
        {/* mixed layer */}
        {Number.isFinite(mld) && mld <= zmax && (
          <g>
            <rect x={m.l} y={y(0)} width={W - m.l - m.r} height={y(mld) - y(0)} fill="rgb(var(--seatint))" opacity=".55" />
            <text x={m.l + 5} y={y(mld) - 4} className="fill-mute text-[10px]">mixed layer</text>
          </g>
        )}
        {Number.isFinite(mark) && mark <= zmax && (
          <g><line x1={m.l} x2={W - m.r} y1={y(mark)} y2={y(mark)} stroke="#C2702E" strokeDasharray="4 3" />
            <text x={W - m.r - 2} y={y(mark) - 4} textAnchor="end" className="num fill-[#9A5424] text-[10px]">{mark} m</text></g>
        )}
        {/* axes */}
        {ZT.filter((z) => z <= zmax).map((z) => (
          <g key={z}>
            <line x1={m.l} x2={W - m.r} y1={y(z)} y2={y(z)} stroke="rgb(var(--line))" />
            <text x={m.l - 8} y={y(z) + 3.5} textAnchor="end" className="num fill-faint text-[10px]">{z}</text>
          </g>
        ))}
        {ticks(lo, hi, W > 340 ? 6 : 4).map((t) => (
          <text key={t} x={x(t)} y={height - 8} textAnchor="middle" className="num fill-faint text-[10px]">{t}°</text>
        ))}
        {[20, 26].filter((t) => t > lo && t < hi).map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={m.t} y2={height - m.b} stroke="rgb(var(--line2))" strokeDasharray="2 3" />
            <text x={x(t)} y={m.t - 8} textAnchor="middle" className="num fill-faint text-[10px]">{t}°</text>
          </g>
        ))}
        <text x={m.l - 8} y={m.t - 8} textAnchor="end" className="fill-faint text-[10px]">m</text>

        {band && <path d={band} fill="rgb(var(--sea))" opacity=".13" />}
        {others.map((s) => (
          <path key={s.label} d={linePath(pts(s.values))} fill="none" pathLength="1"
            stroke={s.style === 'dashed' ? 'rgb(var(--mute))' : 'rgb(var(--line2))'} strokeWidth={s.style === 'dashed' ? 1.25 : 1.5}
            strokeDasharray={s.style === 'dashed' ? '4 3' : undefined} />
        ))}
        <path key={main.values.join()} className="trace" d={linePath(pts(main.values))} fill="none" stroke="rgb(var(--ink))" strokeWidth="1.75" pathLength="1" />
        {zs.map((z, k) => Number.isFinite(main.values[k]) && (
          <circle key={z} cx={x(main.values[k])} cy={y(z)} r={hk === k ? 3.5 : 1.8} fill="rgb(var(--ink))" />
        ))}
        {points.map((s) => zs.map((z, k) => Number.isFinite(s.values[k]) && (
          <circle key={`${s.label}${z}`} cx={x(s.values[k])} cy={y(z)} r="3.2" fill="rgb(var(--paper))" stroke="rgb(var(--heat))" strokeWidth="1.3" />
        )))}
        {hk != null && <line x1={m.l} x2={W - m.r} y1={y(zs[hk])} y2={y(zs[hk])} stroke="rgb(var(--ink))" strokeOpacity=".25" />}
      </svg>

      {hk != null && (
        <div className="pointer-events-none absolute right-3 rounded-[6px] border border-line bg-paper/95 px-2.5 py-1.5 text-[11.5px]"
          style={{ top: Math.min(y(zs[hk]) + 8, height - 90) }}>
          <p className="num text-ink">{zs[hk]} m</p>
          {[main, ...others, ...points].map((s) => (
            <p key={s.label} className="num flex justify-between gap-4 text-mute">
              <span className="font-sans">{s.label}</span>
              <span className="text-ink">{fmt(s.values[hk], 2)}°{s === main && main.sigma ? <span className="text-faint"> ±{fmt(main.sigma[hk], 2)}</span> : ''}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
