import { useState } from 'react'
import { useWidth } from './scale'
import { fmt, fmtDate, fmtLat, fmtLon } from '../../lib/ocean'
import { ALERT, catName, catRank } from '../../lib/gdacs'

const day = (iso) => Date.parse(iso.slice(0, 10))
const iso = (t) => new Date(t).toISOString().slice(0, 10)

/**
 * Cyclone timeline: (a) the Ocean Cyclone Potential Index of each basin over the predicted days, and (b) below it, on the
 * same dates, every cyclone GDACS reports in the North Indian Ocean as lollipop poles: height = intensity, solid =
 * observed, hollow = official forecast. The shaded band on the right is upcoming dates.
 */
export default function CycloneTimeline({ dates, lines, cyclones, today, ahead = 7 }) {
  const [ref, W] = useWidth(900)
  const [hov, setHov] = useState(null)
  if (!dates.length) return null
  const pts = cyclones.flatMap((c) => c.track.map((p) => ({ ...p, c })))
  const t0 = day(dates[0])
  const t1 = Math.max(day(dates[dates.length - 1]), day(today)) + ahead * 864e5
  const inWin = pts.filter((p) => Date.parse(p.t) >= t0 && Date.parse(p.t) <= t1 + 864e5)
  const L = 62, R = 14, H1 = 190, GAP = 34, H2 = 110, B = 26, T = 14
  const H = T + H1 + GAP + H2 + B
  const x = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R)
  const allV = lines.flatMap((l) => l.values).filter(Number.isFinite)
  const lo = allV.length ? Math.max(0, Math.floor((Math.min(...allV) - 0.1) * 10) / 10) : 0
  const y1 = (v) => T + ((1 - v) / (1 - lo)) * H1
  const base2 = T + H1 + GAP + H2
  const y2 = (r) => base2 - (r / 3.4) * (H2 - 10)
  const tNow = day(today)
  const ticks = []
  for (let t = t0; t <= t1; t += 864e5) if (new Date(t).getUTCDate() % 7 === 1 || t === t0) ticks.push(t)
  const path = (vals) => vals.map((v, i) => (Number.isFinite(v) ? `${x(day(dates[i]))},${y1(v)}` : null)).filter(Boolean).map((p, i) => `${i ? 'L' : 'M'}${p}`).join('')

  return (
    <div ref={ref} className="relative w-full">
      <svg width={W} height={H} className="block" onMouseLeave={() => setHov(null)}>
        {/* upcoming band */}
        <rect x={x(tNow + 864e5)} y={T} width={Math.max(0, x(t1) - x(tNow + 864e5))} height={H1 + GAP + H2} fill="#F1B888" opacity="0.14" />
        <text x={x(tNow + 864e5) + 6} y={T + 12} className="label fill-[#B45309] text-[9.5px]">Upcoming</text>
        <line x1={x(tNow)} x2={x(tNow)} y1={T} y2={base2} stroke="#0F172A" strokeDasharray="3 3" opacity="0.5" />
        <text x={x(tNow)} y={T - 2} textAnchor="middle" className="num fill-ink text-[9.5px]">today</text>

        {/* (a) OCPI */}
        {[0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].filter((v) => v >= lo).map((v) => (
          <g key={v}><line x1={L} x2={W - R} y1={y1(v)} y2={y1(v)} stroke={v === 0.5 ? '#D9722B' : 'rgb(var(--line))'} strokeDasharray={v === 0.5 ? '4 3' : undefined} />
            <text x={L - 6} y={y1(v) + 3.5} textAnchor="end" className="num fill-faint text-[10px]">{v}</text></g>))}
        <text x={L + 4} y={y1(0.5) - 4} className="fill-[#B45309] text-[9.5px]">High</text>
        {lines.map((l) => <path key={l.label} d={path(l.values)} fill="none" stroke={l.color} strokeWidth="2" strokeDasharray={l.dashed ? '5 4' : undefined} />)}
        <text x={L + 4} y={T + 10} className="label fill-mute text-[9.5px]">(a) Ocean Cyclone Potential Index</text>

        {/* (b) cyclone lane */}
        <line x1={L} x2={W - R} y1={base2} y2={base2} stroke="#0F172A" strokeOpacity="0.5" />
        {[['Depression', 1], ['Storm', 2], ['Cyclone', 3]].map(([l, r]) => (
          <g key={l}><line x1={L} x2={W - R} y1={y2(r)} y2={y2(r)} stroke="rgb(var(--line))" />
            <text x={L - 6} y={y2(r) + 3.5} textAnchor="end" className="fill-faint text-[9.5px]">{l}</text></g>))}
        <text x={L} y={base2 - H2 - 6} className="label fill-mute text-[9.5px]">(b) Cyclones reported by GDACS · height = intensity</text>
        {inWin.map((p, j) => {
          const cx = x(Date.parse(p.t)), cy = y2(catRank(p.cat)), col = ALERT[p.c.alert] ?? '#64748B'
          return (
            <g key={j} onMouseEnter={() => setHov({ p, cx, cy })}>
              <line x1={cx} x2={cx} y1={base2} y2={cy} stroke={col} strokeOpacity="0.45" />
              <circle cx={cx} cy={cy} r={hov?.p === p ? 5.5 : 4} fill={p.forecast ? '#fff' : col} stroke={col} strokeWidth="1.6" />
            </g>)
        })}
        {cyclones.map((c) => {
          const f = c.track.find((p) => Date.parse(p.t) >= t0 && Date.parse(p.t) <= t1)
          return f && <text key={c.id} x={x(Date.parse(f.t))} y={y2(catRank(f.cat)) - 9} className="fill-ink text-[10.5px] font-medium">{c.name}</text>
        })}
        {!inWin.length && <text x={(L + W - R) / 2} y={base2 - H2 / 2} textAnchor="middle" className="fill-mute text-[11.5px]">No cyclone reported in the North Indian Ocean on these dates</text>}

        {ticks.map((t) => <text key={t} x={x(t)} y={H - 8} textAnchor="middle" className="num fill-faint text-[10px]">{fmtDate(iso(t)).slice(0, 6)}</text>)}
      </svg>
      {hov && (
        <div className="pointer-events-none absolute z-10 rounded-[6px] border border-line bg-paper/95 px-2.5 py-1.5 text-[11.5px]"
          style={{ left: Math.min(hov.cx + 10, W - 230), top: hov.cy - 10 }}>
          <p className="text-ink">{hov.p.c.name} · {catName[hov.p.cat] ?? hov.p.cat}</p>
          <p className="num text-mute">{hov.p.t.slice(0, 16).replace('T', ' ')} UTC · {fmtLat(hov.p.lat)} {fmtLon(hov.p.lon)}</p>
          <p className="text-mute">{hov.p.forecast ? 'Official forecast (JTWC via GDACS)' : 'Observed'} · GDACS {hov.p.c.alert}</p>
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-mute">
        {lines.map((l) => <span key={l.label}><span className={`mr-1.5 inline-block w-4 align-middle ${l.dashed ? 'border-t-[1.5px] border-dashed' : 'h-[2px]'}`}
          style={l.dashed ? { borderColor: l.color } : { background: l.color }} />{l.label} OCPI</span>)}
        <span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-[#64748B] align-middle" />observed position</span>
        <span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full border-[1.5px] border-[#64748B] align-middle" />forecast position</span>
        {Object.entries(ALERT).map(([k, c]) => <span key={k}><span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: c }} />GDACS {k}</span>)}
      </div>
      <p className="mt-1 text-[11px] text-faint">{fmt((t1 - t0) / 864e5, 0)} days shown. Ocean potential is predicted up to the newest satellite day; the upcoming band
        can only hold official cyclone forecasts, since the ocean for those days has not been observed yet.</p>
    </div>
  )
}
