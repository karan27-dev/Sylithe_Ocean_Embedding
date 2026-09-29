import { useMemo, useState } from 'react'
import { DEPTHS, colorAt, column, fmt, fmtDate, isothermDepth } from '../../lib/ocean'
import { linePath, sqrtDepth, useWidth } from './scale'

/** Depth × time at the probed cell across every exported day (a Hovmöller diagram), with D20 and D26 traced. */
export default function DepthTime({ m, days, cell, zmax = 300, height = 150 }) {
  const [wrap, W] = useWidth()
  const [hover, setHover] = useState(null)
  const L = { t: 4, b: 18, l: 34 }
  const levels = DEPTHS.filter((z) => z <= zmax)
  const y = sqrtDepth(zmax, L.t, height - L.b)
  const cols = useMemo(() => days.map((d) => column(m, d.temp, cell.i)), [days, cell.i, m])
  const vals = cols.flatMap((c) => c.slice(0, levels.length)).filter(Number.isFinite)
  if (!vals.length) return null
  const lo = Math.min(...vals), hi = Math.max(...vals)
  const cw = (W - L.l) / days.length
  const iso = (t) => linePath(cols.map((c, j) => { const z = isothermDepth(c, t); return [L.l + (j + 0.5) * cw, z <= zmax ? y(z) : NaN] }))

  return (
    <div ref={wrap}>
      <svg width={W} height={height} className="block overflow-visible"
        onMouseMove={(e) => { const j = Math.floor((e.clientX - e.currentTarget.getBoundingClientRect().left - L.l) / cw); setHover(j >= 0 && j < days.length ? j : null) }}
        onMouseLeave={() => setHover(null)}>
        {cols.map((c, j) => levels.map((z, k) => {
          const top = k === 0 ? 0 : (DEPTHS[k - 1] + z) / 2, bot = k === levels.length - 1 ? zmax : (z + DEPTHS[k + 1]) / 2
          return Number.isFinite(c[k]) && (
            <rect key={`${j}-${k}`} x={L.l + j * cw} y={y(top)} width={cw + 0.4} height={y(bot) - y(top) + 0.4}
              fill={colorAt('thermal', (c[k] - lo) / (hi - lo || 1))} />
          )
        }))}
        <path d={iso(26)} fill="none" stroke="#15181A" strokeWidth="1.1" strokeDasharray="4 3" />
        <path d={iso(20)} fill="none" stroke="#15181A" strokeWidth="1.1" />
        {[0, 50, 100, 200, 300].filter((z) => z <= zmax).map((z) => (
          <text key={z} x={L.l - 6} y={y(z) + 3.5} textAnchor="end" className="num fill-faint text-[10px]">{z}</text>
        ))}
        <text x={L.l} y={height - 4} className="num fill-faint text-[10px]">{fmtDate(days[0].date)}</text>
        <text x={W} y={height - 4} textAnchor="end" className="num fill-faint text-[10px]">{fmtDate(days[days.length - 1].date)}</text>
        {hover != null && <rect x={L.l + hover * cw} y={L.t} width={cw} height={y(zmax) - L.t} fill="none" stroke="#15181A" strokeOpacity=".6" />}
      </svg>
      <p className="num mt-1 h-4 text-right text-[11px] text-ink">
        {hover != null && <>{fmtDate(days[hover].date)} <span className="text-faint">· D20 {fmt(isothermDepth(cols[hover], 20), 0)} m · D26 {fmt(isothermDepth(cols[hover], 26), 0)} m</span></>}
      </p>
    </div>
  )
}
