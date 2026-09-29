import { useEffect, useMemo, useRef, useState } from 'react'
import { DEPTHS, colorAt, fmt, isothermDepth, robustRange } from '../../lib/ocean'
import { linePath, sqrtDepth, useWidth } from './scale'

/**
 * Vertical section through the probed cell: along latitude (zonal: longitude × depth) or along longitude
 * (meridional: latitude × depth). 20 °C and 26 °C isotherms traced on top; that is where thermocline tilt,
 * upwelling and eddies show up.
 */
export default function SectionView({ m, day, cell, dir = 'zonal', zmax = 500, height = 190 }) {
  const [wrap, W] = useWidth()
  const cv = useRef(null)
  const [hover, setHover] = useState(null)
  const g = m.grid
  const n = dir === 'zonal' ? g.width : g.height
  const idx = (j) => (dir === 'zonal' ? cell.y * g.width + j : j * g.width + cell.x)
  const coord = (j) => (dir === 'zonal' ? g.lon0 + j * g.step : g.lat0 - j * g.step)
  const levels = DEPTHS.filter((z) => z <= zmax)
  const L = { t: 6, b: 20, l: 34 }
  const y = sqrtDepth(zmax, L.t, height - L.b)
  const cw = (W - L.l) / n

  const cols = useMemo(() => Array.from({ length: n }, (_, j) => DEPTHS.map((_, k) => day.temp[k * m.N + idx(j)])),
    [day, cell.x, cell.y, dir]) // eslint-disable-line react-hooks/exhaustive-deps
  const range = useMemo(() => {
    const surf = robustRange(Float32Array.from(cols.map((c) => c[0])))
    const deep = robustRange(Float32Array.from(cols.map((c) => c[levels.length - 1])))
    return [deep[0], surf[1]]
  }, [cols, levels.length])

  useEffect(() => {
    const c = cv.current, dpr = window.devicePixelRatio || 1
    c.width = (W - L.l) * dpr; c.height = height * dpr
    const ctx = c.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.fillStyle = '#DAD6CE'; ctx.fillRect(0, y(0), W - L.l, y(zmax) - y(0))
    const [lo, hi] = range
    cols.forEach((col, j) => levels.forEach((z, k) => {
      const v = col[k]
      if (!Number.isFinite(v)) return
      const top = k === 0 ? 0 : (DEPTHS[k - 1] + z) / 2, bot = k === levels.length - 1 ? zmax : (z + DEPTHS[k + 1]) / 2
      ctx.fillStyle = colorAt('thermal', (v - lo) / (hi - lo))
      ctx.fillRect(j * cw, y(top), cw + 0.5, y(bot) - y(top) + 0.5)
    }))
  }, [cols, range, W, height, zmax]) // eslint-disable-line react-hooks/exhaustive-deps

  const iso = (t) => linePath(cols.map((c, j) => {
    const z = isothermDepth(c, t)
    return [L.l + (j + 0.5) * cw, z <= zmax ? y(z) : NaN]
  }))
  const pj = dir === 'zonal' ? cell.x : cell.y
  const axis = dir === 'zonal' ? [50, 60, 70, 80, 90, 100] : [30, 25, 20, 15, 10, 5]
  const jOf = (v) => (dir === 'zonal' ? (v - g.lon0) / g.step : (g.lat0 - v) / g.step)

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const j = Math.floor((e.clientX - r.left - L.l) / cw), py = e.clientY - r.top
    if (j < 0 || j >= n) return setHover(null)
    const k = levels.reduce((b, z, i) => (Math.abs(y(z) - py) < Math.abs(y(levels[b]) - py) ? i : b), 0)
    setHover({ j, k, v: cols[j][k] })
  }

  return (
    <div ref={wrap} className="relative">
      <div className="relative" style={{ height }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <canvas ref={cv} className="absolute rounded-[2px]" style={{ left: L.l, top: 0, width: W - L.l, height }} />
        <svg width={W} height={height} className="absolute inset-0 overflow-visible">
          {[0, 50, 100, 200, 500, 1000].filter((z) => z <= zmax).map((z) => (
            <text key={z} x={L.l - 6} y={y(z) + 3.5} textAnchor="end" className="num fill-faint text-[10px]">{z}</text>
          ))}
          <path d={iso(26)} fill="none" stroke="#15181A" strokeWidth="1.1" strokeDasharray="4 3" />
          <path d={iso(20)} fill="none" stroke="#15181A" strokeWidth="1.1" />
          <line x1={L.l + (pj + 0.5) * cw} x2={L.l + (pj + 0.5) * cw} y1={y(0)} y2={y(zmax)} stroke="#F5F3EE" strokeWidth="1" strokeDasharray="1 2" />
          {axis.map((v) => (
            <text key={v} x={L.l + (jOf(v) + 0.5) * cw} y={height - 5} textAnchor="middle" className="num fill-faint text-[10px]">
              {v}°{dir === 'zonal' ? 'E' : 'N'}
            </text>
          ))}
          {hover && <rect x={L.l + hover.j * cw - 0.5} y={y(0)} width={Math.max(1, cw)} height={y(zmax) - y(0)} fill="#fff" opacity=".35" />}
        </svg>
      </div>
      <div className="mt-2 flex items-baseline justify-between text-[11px] text-mute">
        <span><span className="mr-1 inline-block w-4 border-t border-ink align-middle" />20 °C <span className="ml-3 mr-1 inline-block w-4 border-t border-dashed border-ink align-middle" />26 °C</span>
        <span className="num text-ink">{hover ? <>{fmt(hover.v, 2)} °C <span className="text-faint">{fmt(coord(hover.j), 2)}°{dir === 'zonal' ? 'E' : 'N'} · {levels[hover.k]} m</span></> : ''}</span>
      </div>
    </div>
  )
}
