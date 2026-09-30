import { useMemo, useState } from 'react'
import { fmt, fmtLat, fmtLon, gridBounds, rampCss, renderGrid } from '../../lib/ocean'

const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))

/**
 * Journal-style map panel: the gridded field in the same Mercator rows as the web maps, framed by longitude and latitude
 * ticks, a vertical colour bar and optional markers. Hover reads the value.
 *  grid   Float32Array on the manifest grid     ramp, range [lo, hi], unit, dp
 *  marks  [{ lat, lon, label?, kind: 'ring' | 'dot' | 'cross' }]
 */
export default function FigMap({ g, grid, ramp, range, unit, dp = 1, marks = [], tag, title, threshold }) {
  const [hov, setHov] = useState(null)
  const url = useMemo(() => grid && range && renderGrid(g, grid, ramp, range), [g, grid, ramp, range])
  const [[south, west], [north, east]] = gridBounds(g)
  const L = 34, R = 58, T = 20, B = 22, PW = 400
  const PH = Math.round(PW * (merc(north) - merc(south)) / ((east - west) * Math.PI / 180))
  const W = L + PW + R, H = T + PH + B
  const X = (lon) => L + ((lon - west) / (east - west)) * PW
  const Y = (lat) => T + ((merc(north) - merc(lat)) / (merc(north) - merc(south))) * PH
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect(), sx = W / r.width
    const px = (e.clientX - r.left) * sx, py = (e.clientY - r.top) * sx
    if (px < L || px > L + PW || py < T || py > T + PH) return setHov(null)
    const lon = west + ((px - L) / PW) * (east - west)
    const m = merc(north) - ((py - T) / PH) * (merc(north) - merc(south))
    const lat = (Math.atan(Math.sinh(m)) * 180) / Math.PI
    const yi = Math.round((g.lat0 - lat) / g.step), xi = Math.round((lon - g.lon0) / g.step)
    const v = yi >= 0 && yi < g.height && xi >= 0 && xi < g.width ? grid[yi * g.width + xi] : NaN
    setHov({ px, py, lat, lon, v })
  }
  const [lo, hi] = range ?? [0, 1]
  const cy = (v) => T + (1 - (v - lo) / (hi - lo || 1)) * PH

  return (
    <figure className="min-w-0">
      {title && <figcaption className="mb-1 text-center font-display text-[14px] text-ink">{tag && <span className="mr-1 text-mute">({tag})</span>}{title}</figcaption>}
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" onMouseMove={onMove} onMouseLeave={() => setHov(null)} role="img" aria-label={title}>
          <rect x={L} y={T} width={PW} height={PH} fill="rgb(var(--wash))" />
          {url && <image href={url} x={L} y={T} width={PW} height={PH} preserveAspectRatio="none" style={{ imageRendering: 'pixelated' }} />}
          {[5, 10, 15, 20, 25, 30].map((la) => (
            <g key={la}><line x1={L} x2={L + PW} y1={Y(la)} y2={Y(la)} stroke="#0F172A" strokeOpacity="0.08" />
              <line x1={L - 3} x2={L} y1={Y(la)} y2={Y(la)} stroke="#0F172A" strokeOpacity="0.6" />
              <text x={L - 5} y={Y(la) + 3} textAnchor="end" className="num fill-mute text-[9px]">{la}°N</text></g>))}
          {[45, 60, 75, 90, 105].map((lo_) => (
            <g key={lo_}><line x1={X(lo_)} x2={X(lo_)} y1={T} y2={T + PH} stroke="#0F172A" strokeOpacity="0.08" />
              <line x1={X(lo_)} x2={X(lo_)} y1={T + PH} y2={T + PH + 3} stroke="#0F172A" strokeOpacity="0.6" />
              <text x={X(lo_)} y={T + PH + 13} textAnchor="middle" className="num fill-mute text-[9px]">{lo_}°E</text></g>))}
          <rect x={L} y={T} width={PW} height={PH} fill="none" stroke="#0F172A" strokeOpacity="0.55" />
          {marks.map((k, j) => (
            <g key={j} transform={`translate(${X(k.lon)} ${Y(k.lat)})`}>
              {k.kind === 'cross'
                ? <path d="M-4 -4L4 4M-4 4L4 -4" stroke="#0F172A" strokeWidth="2" />
                : k.kind === 'dot'
                  ? <circle r="3.2" fill="#0F172A" stroke="#fff" strokeWidth="1.2" />
                  : <circle r="5" fill="none" stroke="#0F172A" strokeWidth="1.5" />}
              {k.label && <text x="7" y="3" className="num fill-ink text-[9px]" style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 2.5 }}>{k.label}</text>}
            </g>))}
          {/* colour bar */}
          <defs><linearGradient id={`cb-${ramp}`} x1="0" y1="1" x2="0" y2="0">
            {Array.from({ length: 11 }, (_, i) => <stop key={i} offset={i / 10} stopColor={cssStop(ramp, i / 10)} />)}</linearGradient></defs>
          <rect x={L + PW + 10} y={T} width={9} height={PH} fill={`url(#cb-${ramp})`} stroke="#0F172A" strokeOpacity="0.4" />
          {[lo, (lo + hi) / 2, hi].map((v) => <text key={v} x={L + PW + 23} y={cy(v) + 3} className="num fill-mute text-[9px]">{fmt(v, dp)}</text>)}
          {threshold != null && threshold > lo && threshold < hi && <line x1={L + PW + 7} x2={L + PW + 22} y1={cy(threshold)} y2={cy(threshold)} stroke="#0F172A" strokeWidth="1.5" />}
          <text x={L + PW + 14} y={T - 6} textAnchor="middle" className="fill-mute text-[9px]">{unit}</text>
          {hov && <circle cx={hov.px} cy={hov.py} r="3" fill="none" stroke="#0F172A" />}
        </svg>
        {hov && (
          <div className="pointer-events-none absolute z-10 rounded-[6px] border border-line bg-paper/95 px-2 py-1 text-[11px]"
            style={{ left: `${(hov.px / W) * 100}%`, top: `${(hov.py / H) * 100}%`, transform: 'translate(10px, -110%)' }}>
            <span className="num text-ink">{Number.isFinite(hov.v) ? `${fmt(hov.v, dp)} ${unit}` : 'land'}</span>
            <span className="num ml-2 text-faint">{fmtLat(hov.lat)} {fmtLon(hov.lon)}</span>
          </div>
        )}
      </div>
    </figure>
  )
}

// colour of ramp at t, reusing the CSS gradient definition order
function cssStop(ramp, t) {
  const stops = rampCss(ramp).match(/#[0-9a-f]{6}/gi)
  return stops[Math.round(t * (stops.length - 1))]
}
