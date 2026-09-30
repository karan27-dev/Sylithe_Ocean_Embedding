import { useEffect, useMemo, useRef, useState } from 'react'
import { DEPTHS, colorAt, fmt, fmtDate, isothermDepth, rampCss } from '../../lib/ocean'
import { useWidth } from './scale'

/**
 * Depth × time section of an area-mean temperature column (the layout of a Hovmöller diagram).
 *  mode 'abs'   temperature, with the 20 °C (thermocline) and 26 °C isotherms traced
 *  mode 'anom'  difference from the range mean at each depth, red warmer / blue cooler
 */
export default function DepthTimeChart({ dates, cols, zmax = 500, mode = 'abs', height = 260, mark }) {
  const [ref, W] = useWidth(600)
  const cv = useRef(null)
  const [hov, setHov] = useState(null)
  const L = 44, R = 64, T = 8, B = 24
  const ks = DEPTHS.map((z, k) => k).filter((k) => DEPTHS[k] <= zmax)
  const y = (z) => T + Math.sqrt(z / zmax) * (height - T - B)
  const pw = Math.max(10, W - L - R)

  const grid = useMemo(() => {
    const mean = ks.map((k) => { const v = cols.map((c) => c?.[k]).filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN })
    const val = cols.map((c) => ks.map((k, j) => (mode === 'anom' ? c?.[k] - mean[j] : c?.[k])))
    const flat = val.flat().filter(Number.isFinite)
    if (!flat.length) return null
    let lo = Math.min(...flat), hi = Math.max(...flat)
    if (mode === 'anom') { const a = Math.max(0.1, Math.abs(lo), Math.abs(hi)); lo = -a; hi = a }
    return { val, lo, hi }
  }, [cols, mode]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const c = cv.current
    if (!c || !grid) return
    const H = height - T - B, ctx = c.getContext('2d')
    c.width = pw * 2; c.height = H * 2; ctx.setTransform(2, 0, 0, 2, 0, 0); ctx.clearRect(0, 0, pw, H)
    const cw = pw / grid.val.length, ramp = mode === 'anom' ? 'balance' : 'thermal'
    grid.val.forEach((col, i) => col.forEach((v, j) => {
      if (!Number.isFinite(v)) return
      const k = ks[j], z0 = j ? (DEPTHS[ks[j - 1]] + DEPTHS[k]) / 2 : 0, z1 = j < ks.length - 1 ? (DEPTHS[k] + DEPTHS[ks[j + 1]]) / 2 : zmax
      ctx.fillStyle = colorAt(ramp, (v - grid.lo) / (grid.hi - grid.lo || 1))
      ctx.fillRect(i * cw, y(z0) - T, cw + 0.7, y(z1) - y(z0) + 0.7)
    }))
  }, [grid, pw, height, mode]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!grid || dates.length < 2) return <div ref={ref} className="flex h-[140px] items-center text-[12px] text-faint">Not enough days in this range.</div>
  const xAt = (i) => L + ((i + 0.5) / dates.length) * pw
  const iso = (t) => cols.map((c, i) => [xAt(i), c ? isothermDepth(c, t) : NaN]).filter(([, z]) => Number.isFinite(z) && z <= zmax)
  const path = (p) => p.map(([x, z], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y(z).toFixed(1)}`).join('')
  const step = Math.max(1, Math.ceil(dates.length / Math.max(2, Math.floor(pw / 80))))
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect(), px = e.clientX - r.left - L, py = e.clientY - r.top
    const i = Math.floor((px / pw) * dates.length)
    const z = ((py - T) / (height - T - B)) ** 2 * zmax
    const j = ks.reduce((b, k, jj) => (Math.abs(DEPTHS[k] - z) < Math.abs(DEPTHS[ks[b]] - z) ? jj : b), 0)
    setHov(i >= 0 && i < dates.length && py >= T && py <= height - B ? { i, j, x: e.clientX - r.left, y: py } : null)
  }
  const unit = mode === 'anom' ? '°C vs range mean' : '°C'

  return (
    <div ref={ref} className="relative w-full min-w-0">
      <div className="relative" style={{ height }} onMouseMove={onMove} onMouseLeave={() => setHov(null)}>
        <canvas ref={cv} className="absolute rounded-[2px]" style={{ left: L, top: T, width: pw, height: height - T - B }} />
        <svg width={W} height={height} className="absolute inset-0">
          {[0, 20, 50, 100, 200, 300, 500, 1000].filter((z) => z <= zmax).map((z) => (
            <text key={z} x={L - 6} y={y(z) + 3.5} textAnchor="end" className="num fill-faint text-[10px]">{z}</text>
          ))}
          <text x={10} y={height / 2} transform={`rotate(-90 10 ${height / 2})`} textAnchor="middle" className="fill-mute text-[10px]">Depth (m)</text>
          {dates.map((d, i) => i % step === 0 && (
            <text key={d} x={xAt(i)} y={height - 7} textAnchor="middle" className="num fill-faint text-[10px]">
              {new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</text>
          ))}
          {mode === 'abs' && [[26, '5 4'], [20, null]].map(([t, dash]) => {
            const p = iso(t)
            return p.length > 1 && (
              <g key={t}>
                <path d={path(p)} fill="none" stroke="#0F172A" strokeWidth={1.4} strokeDasharray={dash ?? undefined} opacity={0.85} />
                <text x={p[p.length - 1][0] + 4} y={y(p[p.length - 1][1]) + 3} className="num fill-ink text-[10px]">{t} °C</text>
              </g>
            )
          })}
          {Number.isFinite(mark) && mark <= zmax && (
            <g><line x1={L} x2={L + pw} y1={y(mark)} y2={y(mark)} stroke="#fff" strokeWidth="1.2" strokeDasharray="4 3" />
              <text x={L + 4} y={y(mark) - 4} className="num fill-white text-[10px]" style={{ paintOrder: 'stroke', stroke: '#0F172A', strokeWidth: 2 }}>{mark} m</text></g>
          )}
          {hov && <line x1={xAt(hov.i)} x2={xAt(hov.i)} y1={T} y2={height - B} stroke="#fff" strokeWidth={1} opacity={0.8} />}
        </svg>
        <div className="absolute rounded-[1px]" style={{ right: 26, top: T, width: 8, height: height - T - B, background: rampCss(mode === 'anom' ? 'balance' : 'thermal', '0deg') }} />
        <div className="num absolute flex flex-col justify-between text-[10px] text-mute" style={{ right: 0, top: T - 5, height: height - T - B + 10 }}>
          <span>{fmt(grid.hi, 1)}</span><span>{fmt((grid.hi + grid.lo) / 2, 1)}</span><span>{fmt(grid.lo, 1)}</span>
        </div>
        {hov && (
          <div className="pointer-events-none absolute z-10 rounded-[6px] border border-line bg-paper/95 px-2.5 py-1.5 text-[11.5px]"
            style={{ left: Math.min(hov.x + 12, W - 170), top: Math.max(0, hov.y - 40) }}>
            <p className="label">{fmtDate(dates[hov.i])} · {DEPTHS[ks[hov.j]]} m</p>
            <p className="num text-ink">{fmt(grid.val[hov.i][hov.j], 2)} <span className="text-faint">{unit}</span></p>
          </div>
        )}
      </div>
      <p className="mt-1 text-[11px] text-faint">{mode === 'abs'
        ? 'Area-mean temperature. Solid line: 20 °C isotherm (thermocline); dashed: 26 °C isotherm (warm layer cyclones draw on).'
        : 'Area-mean temperature minus its average over the range at each depth: red warmer, blue cooler.'}</p>
    </div>
  )
}
