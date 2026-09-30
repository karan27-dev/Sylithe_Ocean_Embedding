import { useState } from 'react'
import { linear, linePath, ticks, useWidth } from './scale'
import { fmt, fmtDate } from '../../lib/ocean'

/**
 * Daily time series with a hover crosshair.
 *  dates    ISO strings, one per point
 *  series   [{ label, values, color, band?: [lo[], hi[]], dashed? }]
 *  marker   ISO date to highlight (the selected day)
 *  threshold { value, label } horizontal reference line
 */
export default function TimeSeries({ dates, series, unit, dp = 2, marker, threshold, height = 170, invert = false }) {
  const [ref, W] = useWidth(300)
  const [hi, setHi] = useState(null)
  const L = 44, R = 8, T = 10, B = 22
  const all = series.flatMap((s) => [...s.values, ...(s.band ? [...s.band[0], ...s.band[1]] : [])]).filter(Number.isFinite)
  if (threshold) all.push(threshold.value)
  if (!all.length || dates.length < 2) {
    return <div ref={ref} className="flex h-[120px] items-center text-[12px] text-faint">No data in this range.</div>
  }
  let lo = Math.min(...all), hiV = Math.max(...all)
  const pad = (hiV - lo || Math.abs(hiV) || 1) * 0.08
  lo -= pad; hiV += pad
  const x = linear(0, dates.length - 1, L, W - R)
  const y = invert ? linear(lo, hiV, T, height - B) : linear(lo, hiV, height - B, T)
  const yt = ticks(lo, hiV, 4)
  const step = Math.max(1, Math.ceil(dates.length / Math.max(2, Math.floor((W - L) / 90))))
  const xt = dates.map((d, i) => i).filter((i) => i % step === 0)
  const mi = marker ? dates.indexOf(marker) : -1

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const i = Math.round(((e.clientX - r.left - L) / (W - R - L)) * (dates.length - 1))
    setHi(i >= 0 && i < dates.length ? i : null)
  }

  return (
    <div ref={ref} className="relative w-full min-w-0 overflow-hidden">
      <svg width={W} height={height} className="block" onMouseMove={onMove} onMouseLeave={() => setHi(null)}>
        {yt.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="rgb(var(--line))" />
            <text x={L - 6} y={y(v) + 3.5} textAnchor="end" className="num fill-faint text-[10px]">{v}</text>
          </g>
        ))}
        {xt.map((i) => (
          <text key={i} x={x(i)} y={height - 6} textAnchor="middle" className="num fill-faint text-[10px]">
            {new Date(dates[i]).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
          </text>
        ))}
        {threshold && (
          <g>
            <line x1={L} x2={W - R} y1={y(threshold.value)} y2={y(threshold.value)} stroke="rgb(var(--heat))" strokeDasharray="4 3" />
            <text x={W - R} y={y(threshold.value) - 4} textAnchor="end" className="fill-heat text-[10px]">{threshold.label}</text>
          </g>
        )}
        {series.map((s) => s.band && (
          <path key={s.label + 'band'} fill={s.color} opacity={0.14} stroke="none"
            d={`${linePath(s.band[1].map((v, i) => [x(i), y(v)]))}L${linePath(s.band[0].map((v, i) => [x(i), y(v)]).reverse()).slice(1)}Z`} />
        ))}
        {series.map((s) => (
          <path key={s.label} d={linePath(s.values.map((v, i) => [x(i), y(v)]))} fill="none" stroke={s.color}
            strokeWidth={1.8} strokeDasharray={s.dashed ? '5 4' : undefined} />
        ))}
        {mi >= 0 && <line x1={x(mi)} x2={x(mi)} y1={T} y2={height - B} stroke="rgb(var(--ink))" strokeWidth={1} opacity={0.5} />}
        {hi != null && <line x1={x(hi)} x2={x(hi)} y1={T} y2={height - B} stroke="rgb(var(--ink))" strokeWidth={1} opacity={0.25} />}
        {hi != null && series.map((s) => Number.isFinite(s.values[hi]) && (
          <circle key={s.label} cx={x(hi)} cy={y(s.values[hi])} r={3.2} fill={s.color} stroke="rgb(var(--paper))" strokeWidth={1.5} />
        ))}
      </svg>
      {hi != null && (
        <div className="pointer-events-none absolute top-0 rounded-[6px] border border-line bg-paper/95 px-2.5 py-1.5 text-[11.5px]"
          style={{ left: Math.min(x(hi) + 10, W - 170) }}>
          <p className="label mb-0.5">{fmtDate(dates[hi])}</p>
          {series.map((s) => (
            <p key={s.label} className="num flex items-center gap-2 text-ink">
              <span className="inline-block h-[2px] w-3" style={{ background: s.color }} />
              {fmt(s.values[hi], dp)} <span className="text-faint">{unit}</span>
              {series.length > 1 && <span className="font-sans text-mute">{s.label}</span>}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
