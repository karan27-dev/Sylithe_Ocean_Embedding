import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../App'
import OceanMap from '../components/map/OceanMap'
import Legend from '../components/map/Legend'
import { SectionHead } from '../components/ui'
import { useDay, useDays } from '../lib/data'
import { useView } from '../lib/store'
import { REGIONS, derived, fmt, fmtDate, fmtLat, fmtLon, inRegion, layerById, renderGrid } from '../lib/ocean'

const THRESH = 50                       // kJ cm⁻²: commonly used rapid-intensification threshold (Mainelli et al., 2008)
const RANGE = [0, 150]
const BOX = 2                           // hotspot box size, degrees

function regionStats(m, day) {
  const d = derived(m, day), g = m.grid, out = {}
  for (const r of Object.keys(REGIONS)) {
    let n = 0, hot = 0, max = -Infinity, d26 = 0, nd = 0, sst = 0, ns = 0, sum = 0
    for (let y = 0; y < g.height; y++) for (let x = 0; x < g.width; x++) {
      const i = y * g.width + x, lat = g.lat0 - y * g.step, lon = g.lon0 + x * g.step
      if (!Number.isFinite(d.tchp[i]) || !inRegion(r, lat, lon)) continue
      n++; sum += d.tchp[i]; if (d.tchp[i] >= THRESH) hot++; max = Math.max(max, d.tchp[i])
      if (Number.isFinite(d.d26[i])) { d26 += d.d26[i]; nd++ }
      const s = day.sst?.[i] ?? day.temp[i]
      if (Number.isFinite(s)) { sst += s; ns++ }
    }
    out[r] = { share: n ? hot / n : NaN, mean: n ? sum / n : NaN, max, d26: nd ? d26 / nd : NaN, sst: ns ? sst / ns : NaN }
  }
  return out
}

/** Highest-TCHP 2° boxes, greedy and non-overlapping. */
function hotspots(m, day, k = 6) {
  const d = derived(m, day), g = m.grid, per = Math.round(BOX / g.step), boxes = []
  for (let by = 0; by < g.height; by += per) for (let bx = 0; bx < g.width; bx += per) {
    let best = null
    for (let y = by; y < Math.min(by + per, g.height); y++) for (let x = bx; x < Math.min(bx + per, g.width); x++) {
      const i = y * g.width + x
      if (Number.isFinite(d.tchp[i]) && (!best || d.tchp[i] > d.tchp[best.i])) best = { i, lat: g.lat0 - y * g.step, lon: g.lon0 + x * g.step }
    }
    if (best && d.tchp[best.i] >= THRESH) boxes.push({ ...best, tchp: d.tchp[best.i], d26: d.d26[best.i], sst: day.sst?.[best.i] ?? day.temp[best.i] })
  }
  boxes.sort((a, b) => b.tchp - a.tchp)
  const out = []
  for (const b of boxes) {
    if (out.every((o) => Math.hypot(o.lat - b.lat, o.lon - b.lon) > 4)) out.push(b)
    if (out.length === k) break
  }
  return out
}

function bulletin(m, day, st, hs) {
  const src = m.source.kind === 'model' ? 'the OceanEmbed reconstruction' : `${m.source.label} (reference field)`
  const b = st.BoB, a = st.AS
  const pct = (v) => `${Math.round(v * 100)} %`
  const lines = [
    `Upper-ocean heat for ${fmtDate(day.date, true)}, from ${src}.`,
    `Bay of Bengal: ${pct(b.share)} of the ocean area exceeds ${THRESH} kJ cm⁻² of tropical cyclone heat potential, with a basin mean of ${fmt(b.mean, 0)} and a maximum of ${fmt(b.max, 0)} kJ cm⁻². The 26 °C isotherm lies at ${fmt(b.d26, 0)} m on average.`,
    `Arabian Sea: ${pct(a.share)} above the threshold, mean ${fmt(a.mean, 0)} and maximum ${fmt(a.max, 0)} kJ cm⁻², mean D26 ${fmt(a.d26, 0)} m.`,
  ]
  if (hs.length) lines.push(`Highest heat content near ${hs.slice(0, 3).map((h) => `${fmtLat(h.lat)} ${fmtLon(h.lon)} (${fmt(h.tchp, 0)})`).join('; ')}.`)
  lines.push(b.share > 0.5 || a.share > 0.5
    ? 'A large share of the basin can sustain rapid intensification should a disturbance develop over it.'
    : 'Heat available to cyclones is limited over most of the basin.')
  return lines
}

export default function Cyclone() {
  const { m } = useData()
  const { date, set } = useView()
  const day = useDay(m, date)
  const [pick, setPick] = useState(null)
  const all = useDays(m, useMemo(() => m?.days.map((d) => d.date), [m]))

  const tchp = useMemo(() => (m && day ? derived(m, day).tchp : null), [m, day])
  const url = useMemo(() => tchp && renderGrid(m.grid, tchp, 'matter', RANGE), [tchp, m])
  const st = useMemo(() => (m && day ? regionStats(m, day) : null), [m, day])
  const hs = useMemo(() => (m && day ? hotspots(m, day) : []), [m, day])
  const series = useMemo(() => (m ? all.map((d) => ({ date: d.date, st: regionStats(m, d) })) : []), [all, m])

  if (!m || !day || !st) return <div className="page min-h-[70vh] pt-16"><p className="label">Loading</p></div>
  const text = bulletin(m, day, st, hs)

  return (
    <div className="pb-8">
      <div className="page pt-12 sm:pt-16 print:pt-4">
        <SectionHead as="h1" label="Cyclone watch · upper-ocean heat" title="Where the ocean can feed a cyclone">
          Tropical cyclones draw their energy from the warm layer above the 26 °C isotherm. Tropical Cyclone Heat Potential
          (TCHP) integrates that heat from the surface to D26; above about {THRESH} kJ cm⁻² the ocean can support rapid
          intensification. Surface temperature alone cannot show it: a thin warm skin and a deep warm layer look the same from space.
        </SectionHead>
        <div className="mt-8 flex flex-wrap items-center gap-4 print:hidden">
          <span className="label">Day</span>
          <div className="seg">
            {m.days.map((d) => <button key={d.date} aria-pressed={d.date === date} onClick={() => set({ date: d.date })}>{fmtDate(d.date)}</button>)}
          </div>
          {m.source.kind !== 'model' && <span className="text-[12px] text-mute">{m.source.label}, reference field</span>}
        </div>
      </div>

      <section className="mx-auto mt-8 grid w-full max-w-[1480px] gap-8 px-4 sm:px-8 lg:grid-cols-[1fr_380px]">
        <div>
          <div className="h-[300px] overflow-hidden rounded-[4px] border border-line sm:h-[540px] print:h-[380px]">
            <OceanMap g={m.grid} url={url} grid={tchp} scrollZoom={false} padding={[12, 12]}
              points={hs.map((h, n) => ({ id: `h${n}`, lat: h.lat, lon: h.lon, color: '#15181A', r: pick === n ? 8 : 6, stroke: '#F5F3EE', weight: 1.5 }))}
              onPoint={(p) => setPick(+p.id.slice(1))} />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <Legend layer={layerById.tchp} range={RANGE} marks={[{ v: THRESH, label: `${THRESH} kJ cm⁻²` }]} width={260} />
            <p className="text-[11.5px] text-mute">Black dots: the six highest-heat {BOX}° boxes. Vertical mark on the scale: {THRESH} kJ cm⁻².</p>
          </div>
        </div>

        <aside>
          <p className="label">By basin</p>
          <table className="mt-3 w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-right">
                <th className="label pb-2 text-left font-normal" />
                <th className="label pb-2 font-normal">≥ {THRESH}</th><th className="label pb-2 font-normal">Mean</th>
                <th className="label pb-2 font-normal">Max</th><th className="label pb-2 font-normal">D26</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(REGIONS).map(([k, r]) => (
                <tr key={k} className="border-b border-line text-right">
                  <td className="py-2.5 text-left text-ink">{r.label}</td>
                  <td className={`num py-2.5 ${st[k].share >= 0.5 ? 'text-heat' : 'text-ink'}`}>{Math.round(st[k].share * 100)} %</td>
                  <td className="num py-2.5 text-ink2">{fmt(st[k].mean, 0)}</td>
                  <td className="num py-2.5 text-ink2">{fmt(st[k].max, 0)}</td>
                  <td className="num py-2.5 text-ink2">{fmt(st[k].d26, 0)} m</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-faint">Share of ocean area above {THRESH} kJ cm⁻²; mean and maximum TCHP in kJ cm⁻².</p>

          <p className="label mt-10">Hotspots</p>
          <ol className="mt-3">
            {hs.map((h, n) => (
              <li key={n} onMouseEnter={() => setPick(n)} onMouseLeave={() => setPick(null)}
                className={`grid grid-cols-[20px_1fr_auto] items-baseline gap-3 border-b border-line py-2.5 transition-colors ${pick === n ? 'bg-wash' : ''}`}>
                <span className="num text-[11px] text-faint">{n + 1}</span>
                <span className="num text-[12.5px] text-ink">{fmtLat(h.lat)} {fmtLon(h.lon)}
                  <span className="ml-2 text-faint">D26 {Number.isFinite(h.d26) ? `${fmt(h.d26, 0)} m` : 'to floor'}</span></span>
                <Link to={`/explorer?date=${day.date}&layer=tchp&probe=${h.lon.toFixed(2)},${h.lat.toFixed(2)}`} className="num text-[12.5px] text-heat hover:underline">
                  {fmt(h.tchp, 0)} →
                </Link>
              </li>
            ))}
            {!hs.length && <li className="py-3 text-[12.5px] text-mute">No cell exceeds {THRESH} kJ cm⁻² on this day.</li>}
          </ol>
        </aside>
      </section>

      {series.length > 1 && (
        <section className="page mt-20 print:hidden">
          <p className="label">Across the exported days</p>
          <table className="mt-4 w-full max-w-[720px] text-[12.5px]">
            <thead><tr className="border-b border-line text-left"><th className="label pb-2 font-normal">Day</th>
              {['BoB', 'AS'].map((r) => <th key={r} className="label pb-2 font-normal">{REGIONS[r].label}, share ≥ {THRESH}</th>)}</tr></thead>
            <tbody>
              {series.map((s) => (
                <tr key={s.date} className={`border-b border-line ${s.date === date ? 'bg-wash' : ''}`}>
                  <td className="num py-2.5 text-ink">{fmtDate(s.date)}</td>
                  {['BoB', 'AS'].map((r) => (
                    <td key={r} className="py-2.5 pr-6">
                      <div className="flex items-center gap-3">
                        <span className="h-[5px] flex-1 bg-line"><span className="block h-full bg-heat" style={{ width: `${s.st[r].share * 100}%` }} /></span>
                        <span className="num w-10 text-right text-ink2">{Math.round(s.st[r].share * 100)} %</span>
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="page mt-20">
        <div className="grid gap-8 border-t border-line pt-8 md:grid-cols-[220px_1fr]">
          <div>
            <p className="label">Daily bulletin · draft</p>
            <div className="mt-4 flex gap-3 print:hidden">
              <button onClick={() => window.print()} className="btn">Print</button>
              <button onClick={() => navigator.clipboard?.writeText(text.join('\n\n'))} className="btn">Copy text</button>
            </div>
          </div>
          <article className="max-w-[64ch]">
            <h2 className="display text-[26px] leading-tight">Ocean heat bulletin, {fmtDate(day.date, true)}</h2>
            {text.map((t, i) => <p key={i} className="mt-4 text-[15px] leading-relaxed text-ink2">{t}</p>)}
            <p className="mt-6 text-[11.5px] text-faint">
              Written by a fixed template from the numbers on this page: every figure is computed, nothing is generated by a language model.
              For operational use, verify against INCOIS and IMD products.
            </p>
          </article>
        </div>
      </section>
    </div>
  )
}
