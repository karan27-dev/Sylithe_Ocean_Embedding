import { useMemo } from 'react'
import { useWidth } from './scale'
import { REGIONS, fmt, inRegion } from '../../lib/ocean'

const COL = { BoB: '#2F6F6A', AS: '#C29A55', other: '#94A3B8' }

/** A surface input against predicted temperature at one depth, cell by cell, coloured by basin, with Pearson r. */
export default function DepthScatter({ g, x, y, unit, depth, dp = 2, tag = 'c', height = 190 }) {
  const [ref, W] = useWidth(320)
  const d = useMemo(() => {
    if (!x || !y) return null
    let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0
    const pts = []
    const N = g.width * g.height, stride = Math.max(1, Math.floor(N / 9000))
    for (let i = 0; i < N; i++) {
      const a = x[i], b = y[i]
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue
      n++; sx += a; sy += b; sxx += a * a; syy += b * b; sxy += a * b
      if (i % stride === 0) {
        const lat = g.lat0 - Math.floor(i / g.width) * g.step, lon = g.lon0 + (i % g.width) * g.step
        pts.push([a, b, inRegion('BoB', lat, lon) ? 'BoB' : inRegion('AS', lat, lon) ? 'AS' : 'other'])
      }
    }
    if (n < 30) return null
    const r = (sxy / n - (sx / n) * (sy / n)) / Math.sqrt((sxx / n - (sx / n) ** 2) * (syy / n - (sy / n) ** 2))
    const q = (arr, p) => arr[Math.floor(p * (arr.length - 1))]
    const xs = pts.map((p) => p[0]).sort((a, b) => a - b), ys = pts.map((p) => p[1]).sort((a, b) => a - b)
    return { pts, r, n, x0: q(xs, 0.01), x1: q(xs, 0.99), y0: q(ys, 0.01), y1: q(ys, 0.99) }
  }, [g, x, y])

  const L = 40, R = 10, T = 8, B = 30
  return (
    <figure ref={ref} className="mt-3 min-w-0">
      <figcaption className="mb-1 text-center font-display text-[14px] text-ink"><span className="mr-1 text-mute">({tag})</span>Against temperature at {depth} m</figcaption>
      {d ? (() => {
        const sx = (v) => L + ((v - d.x0) / (d.x1 - d.x0 || 1)) * (W - L - R), sy = (v) => T + (1 - (v - d.y0) / (d.y1 - d.y0 || 1)) * (height - T - B)
        return (
          <svg width={W} height={height} className="block">
            <rect x={L} y={T} width={W - L - R} height={height - T - B} fill="none" stroke="#0F172A" strokeOpacity="0.35" />
            {d.pts.map(([a, b, rg], i) => a >= d.x0 && a <= d.x1 && b >= d.y0 && b <= d.y1 &&
              <circle key={i} cx={sx(a)} cy={sy(b)} r="1.3" fill={COL[rg]} opacity="0.45" />)}
            {[d.x0, (d.x0 + d.x1) / 2, d.x1].map((v) => <text key={v} x={sx(v)} y={height - 16} textAnchor="middle" className="num fill-faint text-[9.5px]">{fmt(v, dp)}</text>)}
            {[d.y0, (d.y0 + d.y1) / 2, d.y1].map((v) => <text key={v} x={L - 5} y={sy(v) + 3} textAnchor="end" className="num fill-faint text-[9.5px]">{fmt(v, 1)}</text>)}
            <text x={(L + W - R) / 2} y={height - 3} textAnchor="middle" className="fill-mute text-[10px]">input ({unit})</text>
            <text x={L + 6} y={T + 13} className="num fill-ink text-[11px]">r = {d.r.toFixed(2)}</text>
          </svg>)
      })() : <p className="py-10 text-center text-[12px] text-faint">Not enough overlapping cells.</p>}
      <p className="mt-1 text-center text-[10.5px] text-mute">
        {Object.entries(COL).map(([k, c]) => <span key={k} className="mr-3"><span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: c }} />{REGIONS[k]?.label ?? 'elsewhere'}</span>)}
        y: predicted °C at {depth} m</p>
    </figure>
  )
}
