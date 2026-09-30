import { useState } from 'react'
import { useWidth } from './scale'
import { fmtLat, fmtLon } from '../../lib/ocean'
import { ALERT, catName, catRank } from '../../lib/gdacs'

const day = (iso) => Date.parse(iso.slice(0, 10))
const iso = (t) => new Date(t).toISOString().slice(0, 10)
const BAND = '#FAF0E6'
const GRID = { stroke: '#0F172A', strokeOpacity: 0.12, strokeDasharray: '1.5 2.5' }

/** One framed axes box in the style of the paper figures: black frame, outward ticks, dotted grid. */
function Axes({ x0, y0, w, h, title, ylabel, children }) {
  return (
    <g>
      <text x={x0 + w / 2} y={y0 - 9} textAnchor="middle" className="fill-ink text-[12.5px]">{title}</text>
      {children}
      <rect x={x0} y={y0} width={w} height={h} fill="none" stroke="#0F172A" strokeWidth="1" />
      <text x={x0 - 66} y={y0 + h / 2} transform={`rotate(-90 ${x0 - 66} ${y0 + h / 2})`} textAnchor="middle" className="fill-ink text-[11px]">{ylabel}</text>
    </g>
  )
}

/**
 * Journal-style cyclone figure.
 *  (a) Ocean Cyclone Potential Index per basin over the predicted days; in the upcoming band, a persistence outlook
 *      (latest value carried forward: upper-ocean heat changes slowly) and the coordinates of today's High hotspots.
 *  (b) Tropical cyclones reported by GDACS (JTWC tracks) as lollipops: height = intensity, solid = observed,
 *      hollow = official forecast. States explicitly when none was detected.
 */
const WINDOWS = [[60, '60 days'], [182, '6 months'], [366, '1 year']]
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function CycloneTimeline({ dates: allDates, lines: allLines, cyclones, today, hotspots = [], ahead = 7 }) {
  const [ref, W] = useWidth(900)
  const [hov, setHov] = useState(null)
  const [win, setWin] = useState(60)
  if (!allDates.length) return null
  const i0 = Math.max(0, allDates.length - win)
  const dates = allDates.slice(i0)
  const lines = allLines.map((l) => ({ ...l, values: l.values.slice(i0) }))
  const pts = cyclones.flatMap((c) => c.track.map((p) => ({ ...p, c })))
  const t0 = day(dates[0])
  const tLast = day(dates[dates.length - 1])
  const tNow = day(today)
  const t1 = Math.max(tLast, tNow) + ahead * 864e5
  const inWin = pts.filter((p) => Date.parse(p.t) >= t0 && Date.parse(p.t) <= t1 + 864e5)
  const L = 84, R = W > 760 ? 196 : 18, T = 30, H1 = 220, GAP = 62, H2 = 118, B = 44
  const H = T + H1 + GAP + H2 + B
  const PW = W - L - R
  const x = (t) => L + ((t - t0) / (t1 - t0)) * PW
  const allV = lines.flatMap((l) => l.values).filter(Number.isFinite)
  const lo = allV.length ? Math.max(0, Math.floor((Math.min(...allV) - 0.1) * 10) / 10) : 0
  const y1 = (v) => T + ((1 - v) / (1 - lo)) * H1
  const T2 = T + H1 + GAP
  const y2 = (r) => T2 + H2 - (r / 3.6) * H2
  const bandX = x(tLast + 864e5)
  const spanD = (t1 - t0) / 864e5
  const ticks = []
  for (let t = t0; t <= t1; t += 864e5) {
    const dd = new Date(t).getUTCDate()
    if (spanD <= 80 ? dd % 7 === 1 : spanD <= 200 ? dd === 1 || dd === 15 : dd === 1) ticks.push(t)
  }
  const tickLabel = (t) => { const d = new Date(t); return spanD > 200 ? `${MON[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}` : `${d.getUTCDate()} ${MON[d.getUTCMonth()]}` }
  const yrs = [...new Set([t0, t1].map((t) => new Date(t).getUTCFullYear()))].join('–')
  const path = (vals) => vals.map((v, i) => (Number.isFinite(v) ? `${x(day(dates[i]))},${y1(v)}` : null)).filter(Boolean).map((p, i) => `${i ? 'L' : 'M'}${p}`).join('')
  const lastOf = (vals) => { for (let i = vals.length - 1; i >= 0; i--) if (Number.isFinite(vals[i])) return [i, vals[i]]; return null }
  const yticks = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].filter((v) => v >= lo)
  const hs = hotspots.slice(0, 3)
  const boxW = Math.max(150, x(t1) - bandX - 12)

  const xAxis = (yb) => ticks.map((t) => (
    <g key={t}><line x1={x(t)} x2={x(t)} y1={yb} y2={yb + 4} stroke="#0F172A" />
      <text x={x(t)} y={yb + 16} textAnchor="middle" className="num fill-ink text-[10px]">{tickLabel(t)}</text></g>))

  return (
    <div ref={ref} className="relative w-full">
      <div className="mb-1 flex justify-end"><div className="seg">{WINDOWS.map(([d, l]) => (
        <button key={d} aria-pressed={win === d} disabled={d > 60 && allDates.length < d * 0.6} className="disabled:opacity-35" onClick={() => setWin(d)}>{l}</button>))}</div></div>
      <svg width={W} height={H} className="block" onMouseLeave={() => setHov(null)}>
        {/* ---------------- (a) */}
        <Axes x0={L} y0={T} w={PW} h={H1} title="(a) Ocean Cyclone Potential Index by basin" ylabel="OCPI">
          <rect x={bandX} y={T} width={Math.max(0, x(t1) - bandX)} height={H1} fill={BAND} />
          {yticks.map((v) => (
            <g key={v}><line x1={L} x2={L + PW} y1={y1(v)} y2={y1(v)} {...GRID} />
              <line x1={L - 4} x2={L} y1={y1(v)} y2={y1(v)} stroke="#0F172A" />
              <text x={L - 7} y={y1(v) + 3.5} textAnchor="end" className="num fill-ink text-[10px]">{v.toFixed(1)}</text></g>))}
          {ticks.map((t) => <line key={t} x1={x(t)} x2={x(t)} y1={T} y2={T + H1} {...GRID} />)}
          <line x1={L} x2={L + PW} y1={y1(0.5)} y2={y1(0.5)} stroke="#D9722B" strokeDasharray="5 3" />
          <text x={bandX - 6} y={y1(0.5) + 12} textAnchor="end" className="fill-[#B45309] text-[10px]">High ≥ 0.5</text>
          {lines.map((l) => {
            const last = lastOf(l.values)
            return (
              <g key={l.label}>
                <path d={path(l.values)} fill="none" stroke={l.color} strokeWidth="1.8" strokeDasharray={l.dashed ? '5 3' : undefined} />
                {l.values.map((v, i) => Number.isFinite(v) && i % 3 === 0 && <circle key={i} cx={x(day(dates[i]))} cy={y1(v)} r="2.2" fill={l.color} />)}
                {last && <line x1={x(day(dates[last[0]]))} x2={x(t1)} y1={y1(last[1])} y2={y1(last[1])} stroke={l.color} strokeWidth="1.4" strokeDasharray="2 3" opacity="0.8" />}
              </g>)
          })}
          {/* legend */}
          <g transform={`translate(${L + 10} ${T + 10})`}>
            <rect width="190" height={16 * lines.length + 26} fill="#fff" stroke="#0F172A" strokeOpacity="0.35" rx="2" />
            {lines.map((l, i) => (
              <g key={l.label} transform={`translate(8 ${14 + i * 16})`}>
                <line x1="0" x2="20" y1="0" y2="0" stroke={l.color} strokeWidth="1.8" strokeDasharray={l.dashed ? '5 3' : undefined} />
                <text x="26" y="3.5" className="fill-ink text-[10.5px]">{l.label}</text></g>))}
            <g transform={`translate(8 ${14 + lines.length * 16})`}>
              <line x1="0" x2="20" y1="0" y2="0" stroke="#64748B" strokeWidth="1.4" strokeDasharray="2 3" />
              <text x="26" y="3.5" className="fill-ink text-[10.5px]">persistence outlook</text></g>
          </g>
          {/* outlook box */}
          <g transform={`translate(${R > 100 ? L + PW + 14 : bandX + 6} ${T + 8})`}>
            {R > 100 && <rect x="-8" y="-14" width={R - 20} height={hotspots.length ? 96 : 40} fill="#FAF0E6" stroke="#EBDCCB" />}
            <text className="label fill-[#B45309] text-[9.5px]">Upcoming {ahead} days</text>
            {hs.length ? (
              <>
                <text y="16" className="fill-ink text-[10.5px]">High potential persists at</text>
                {hs.map((h, i) => <text key={i} y={32 + i * 14} className="num fill-ink text-[10px]">{i + 1}  {fmtLat(h.lat)} {fmtLon(h.lon)}  ({h.v.toFixed(2)})</text>)}
              </>
            ) : <text y="16" className="fill-ink text-[10.5px]">No High hotspot today</text>}
          </g>
          {tNow >= t0 && tNow <= t1 && <line x1={x(tNow)} x2={x(tNow)} y1={T} y2={T + H1} stroke="#0F172A" strokeDasharray="3 3" opacity="0.55" />}
        </Axes>
        {xAxis(T + H1)}

        {/* ---------------- (b) */}
        <Axes x0={L} y0={T2} w={PW} h={H2} title="(b) Tropical cyclones in the North Indian Ocean (GDACS / JTWC)" ylabel="Intensity">
          <rect x={bandX} y={T2} width={Math.max(0, x(t1) - bandX)} height={H2} fill={BAND} />
          {[['Depression', 1], ['Storm', 2], ['Cyclone', 3]].map(([l, r]) => (
            <g key={l}><line x1={L} x2={L + PW} y1={y2(r)} y2={y2(r)} {...GRID} />
              <line x1={L - 4} x2={L} y1={y2(r)} y2={y2(r)} stroke="#0F172A" />
              <text x={L - 7} y={y2(r) + 3.5} textAnchor="end" className="fill-ink text-[10px]">{l}</text></g>))}
          {ticks.map((t) => <line key={t} x1={x(t)} x2={x(t)} y1={T2} y2={T2 + H2} {...GRID} />)}
          {inWin.map((p, j) => {
            const cx = x(Date.parse(p.t)), cy = y2(catRank(p.cat)), col = ALERT[p.c.alert] ?? '#64748B'
            return (
              <g key={j} onMouseEnter={() => setHov({ p, cx, cy })}>
                <line x1={cx} x2={cx} y1={T2 + H2} y2={cy} stroke={col} strokeOpacity="0.5" />
                <circle cx={cx} cy={cy} r={hov?.p === p ? 5.5 : 4} fill={p.forecast ? '#fff' : col} stroke={col} strokeWidth="1.6" />
              </g>)
          })}
          {(() => {
            // one label per cyclone at its strongest point; labels that would overlap move up a row or are dropped
            const labs = cyclones.map((c) => {
              const inw = c.track.filter((p) => Date.parse(p.t) >= t0 && Date.parse(p.t) <= t1)
              if (!inw.length) return null
              const top = inw.reduce((b, p) => (catRank(p.cat) > catRank(b.cat) ? p : b), inw[0]), lastP = c.track.at(-1)
              return { id: c.id, x: x(Date.parse(top.t)), r: catRank(top.cat), text: spanD > 80 ? c.name.replace(/-\d+$/, '') : `${c.name} · ${fmtLat(lastP.lat)} ${fmtLon(lastP.lon)}` }
            }).filter(Boolean).sort((a, b) => a.x - b.x)
            const rows = []
            return labs.map((l) => {
              const w = l.text.length * 6.2
              let row = 0
              while (row < 3 && rows[row] != null && l.x - w / 2 < rows[row] + 8) row++
              if (row === 3) return null
              rows[row] = l.x + w / 2
              return <text key={l.id} x={l.x} y={y2(Math.min(3.3, l.r)) - 9 - row * 12} textAnchor="middle" className="fill-ink text-[10px]">{l.text}</text>
            })
          })()}
          {!inWin.length && (
            <g>
              <rect x={L + PW / 2 - 190} y={T2 + H2 / 2 - 14} width="380" height="26" fill="#fff" stroke="#0F172A" strokeOpacity="0.25" rx="2" />
              <text x={L + PW / 2} y={T2 + H2 / 2 + 3} textAnchor="middle" className="fill-ink text-[11px]">No cyclone detected in the North Indian Ocean on these dates (GDACS)</text>
            </g>
          )}
          {tNow >= t0 && tNow <= t1 && <line x1={x(tNow)} x2={x(tNow)} y1={T2} y2={T2 + H2} stroke="#0F172A" strokeDasharray="3 3" opacity="0.55" />}
        </Axes>
        {xAxis(T2 + H2)}
        <text x={L + PW / 2} y={H - 4} textAnchor="middle" className="fill-ink text-[11px]">Date ({yrs})</text>
      </svg>
      {hov && (
        <div className="pointer-events-none absolute z-10 rounded-[6px] border border-line bg-paper/95 px-2.5 py-1.5 text-[11.5px]"
          style={{ left: Math.min(hov.cx + 10, W - 240), top: hov.cy - 10 }}>
          <p className="text-ink">{hov.p.c.name} · {catName[hov.p.cat] ?? hov.p.cat}</p>
          <p className="num text-mute">{hov.p.t.slice(0, 16).replace('T', ' ')} UTC · {fmtLat(hov.p.lat)} {fmtLon(hov.p.lon)}</p>
          <p className="text-mute">{hov.p.forecast ? 'Official forecast (JTWC via GDACS)' : 'Observed'} · GDACS {hov.p.c.alert}</p>
        </div>
      )}
      <div className="mt-1 flex flex-wrap justify-center gap-x-5 gap-y-1 text-[11px] text-ink2">
        <span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-[#64748B] align-middle" />observed position</span>
        <span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full border-[1.5px] border-[#64748B] bg-white align-middle" />forecast position</span>
        {Object.entries(ALERT).map(([k, c]) => <span key={k}><span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: c }} />GDACS {k}</span>)}
        <span><span className="mr-1.5 inline-block h-2.5 w-4 align-middle" style={{ background: BAND, border: '1px solid #EBDCCB' }} />upcoming dates</span>
      </div>
    </div>
  )
}
