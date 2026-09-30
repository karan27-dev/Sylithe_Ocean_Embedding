import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight, Check, Copy, ShieldCheck } from 'lucide-react'
import FigMap from '../components/charts/FigMap'
import TimeSeries from '../components/charts/TimeSeries'
import ProfileChart from '../components/charts/ProfileChart'
import DepthTimeChart from '../components/charts/DepthTimeChart'
import Timeline from '../components/Timeline'
import CycloneTimeline from '../components/charts/CycloneTimeline'
import DepthScatter from '../components/charts/DepthScatter'
import { ALERT, catName, useCyclones } from '../lib/gdacs'
import { SectionHead } from '../components/ui'
import { level, useDay, useJSON, useManifest } from '../lib/data'
import { DEPTHS, REGIONS, derived, fmt, fmtDate, fmtLat, fmtLon, layerGrid, robustRange } from '../lib/ocean'
import { CATS, RULES, VORT, WIND, catOf, drivers, features, ocpiOfRecord, peaks, regionSummary, t100, untraced } from '../lib/cyclone'

const LIVE = import.meta.env.VITE_LIVE_BASE || 'https://raw.githubusercontent.com/karan27-dev/Sylithe_Ocean_Embedding/live-data/web'
const REPLAY = '/data/ops'
const RCOL = { BoB: '#2F6F6A', AS: '#C29A55', NIO: '#0F172A' }
const RS = ['BoB', 'AS', 'NIO']
const addDays = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10)
const r2 = (v, d = 2) => (Number.isFinite(v) ? +v.toFixed(d) : null)

// ---------------------------------------------------------------- figure shell
function Fig({ id, n, title, caption, children, cols = 'lg:grid-cols-[1.25fr_1fr]' }) {
  return (
    <section id={id} className="scroll-mt-28 rounded-[12px] border border-line bg-white/70 p-4 sm:p-5">
      <div className={`grid items-start gap-5 ${cols}`}>{children}</div>
      <p className="mt-3 border-t border-line pt-3 text-[12.5px] leading-relaxed text-ink2">
        <span className="font-medium text-ink">Figure {n}. {title}.</span> {caption}</p>
    </section>
  )
}

/** Time-series panel: one line per region, same styling in every figure. */
function Panel({ tag, title, dates, values, unit, dp = 2, marker, threshold, invert }) {
  return (
    <figure className="min-w-0">
      <figcaption className="mb-1 text-center font-display text-[14px] text-ink"><span className="mr-1 text-mute">({tag})</span>{title}</figcaption>
      <TimeSeries dates={dates} unit={unit} dp={dp} marker={marker} threshold={threshold} invert={invert} height={200}
        series={RS.map((r) => ({ label: REGIONS[r].short, color: RCOL[r], values: values(r), dashed: r === 'NIO' }))} />
      <div className="mt-1 flex flex-wrap justify-center gap-x-4 text-[11px] text-mute">
        {RS.map((r) => <span key={r}><span className={`mr-1.5 inline-block w-4 align-middle ${r === 'NIO' ? 'border-t-[1.5px] border-dashed' : 'h-[2px]'}`}
          style={r === 'NIO' ? { borderColor: RCOL[r] } : { background: RCOL[r] }} />{REGIONS[r].label}</span>)}
      </div>
    </figure>
  )
}

function CopyBtn({ text, label = 'Copy' }) {
  const [ok, setOk] = useState(false)
  return (
    <button onClick={() => navigator.clipboard?.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1200) })}
      className="inline-flex items-center gap-1 text-[11.5px] text-mute hover:text-ink">{ok ? <><Check size={12} />Copied</> : <><Copy size={12} />{label}</>}</button>
  )
}

// ---------------------------------------------------------------- LLM hand-off
/** Agent text → paragraphs with **bold** labels (the model writes light markdown). */
function rich(t) {
  return t.split(/\n{2,}|\n(?=\*\*)/).map((para, i) => (
    <p key={i} className={`mb-2.5 whitespace-pre-line ${i ? '' : 'text-[15px] text-ink'}`}>
      {para.split(/(\*\*[^*]+\*\*)/).map((seg, j) => (seg.startsWith('**') ? <b key={j} className="font-medium text-ink">{seg.slice(2, -2)}</b> : seg))}
    </p>))
}
function buildPayload({ date, live, run, sum, recs, prev, hs, watch, dayObj, m }) {
  const region = (r) => {
    const a = recs[r] ?? {}, p = prev[r] ?? {}
    const oc = ocpiOfRecord(a), ocP = ocpiOfRecord(p)
    return {
      sst_c: r2(a.sst), sss_psu: r2(a.sss), sla_m: r2(a.sla, 3), wind_ms: r2(a.wind, 1), current_ms: r2(a.cur),
      tchp_kj_cm2: r2(a.tchp, 0), d26_m: r2(a.d26, 0), d20_m: r2(a.d20, 0), mld_m: r2(a.mld, 0), t100_c: r2(a.T ? t100(a.T) : NaN),
      ocpi_of_mean_conditions: r2(oc), ocpi_mean_of_cells: r2(sum[r].mean), share_ocpi_high: r2(sum[r].share_high), share_ocpi_very_high: r2(sum[r].share_very_high),
      watch_cells: sum[r].watch_cells, change_7d: { ocpi: r2(oc - ocP), tchp_kj_cm2: r2(a.tchp - p.tchp, 0), sst_c: r2(a.sst - p.sst) },
    }
  }
  return {
    product: 'Sylithe Ocean Model · ocean cyclone potential', date, mode: live ? 'live, near-real-time inputs' : '2023 replay, reprocessed inputs',
    model: { members: run?.members ?? 3, window_days: run?.window ?? 15, revision: run?.revision ?? 0, inputs_valid: run?.inputs_valid ?? null, inputs_pending: run?.missing_today ?? [] },
    index: { name: 'OCPI', range: [0, 1], categories: CATS.map((c) => ({ label: c.label, from: c.min })),
      weights: Object.fromEntries(RULES.map((r) => [r.key, r.w])), gate: 'OCPI = 0 where SST < 26 °C' },
    regions: Object.fromEntries(RS.map((r) => [REGIONS[r].label, region(r)])),
    hotspots: hs.map((h, j) => ({ rank: j + 1, lat: r2(h.lat), lon: r2(h.lon), ocpi: r2(h.v), category: catOf(h.v)?.label,
      drivers: drivers(m, dayObj, h.i).slice(0, 3).map((d) => ({ name: d.label, value: r2(d.value, d.dp), unit: d.unit })) })),
    watch_points: watch.map((w) => ({ lat: r2(w.lat), lon: r2(w.lon), ocpi: r2(w.ocpi), surface_vorticity_1e5_s: r2(w.vort * 1e5, 1), wind_ms: r2(w.wind, 1) })),
    caveats: ['Ocean conditions only; atmospheric shear and humidity are not included.',
      'Surface vorticity comes from satellite surface winds, a proxy for low-level circulation.',
      live ? 'Live inputs are near-real-time; the live check against Argo gives about 1.05 °C RMSE.' : 'Replay uses reprocessed inputs (0.757 °C RMSE against Argo in 2023).'],
  }
}

function bulletinText(p) {
  const b = p.regions['Bay of Bengal'], a = p.regions['Arabian Sea']
  const pct = (v) => `${Math.round((v ?? 0) * 100)} %`
  const sg = (v) => `${v >= 0 ? '+' : ''}${v}`
  const lines = [
    `${fmtDate(p.date, true)} · ocean cyclone potential from the Sylithe Ocean Model (${p.mode}).`,
    `Bay of Bengal: ${pct(b.share_ocpi_high)} of the ocean scores High or above on the OCPI (mean ${b.ocpi_mean_of_cells}). Heat potential ${b.tchp_kj_cm2} kJ cm⁻², upper-100 m temperature ${b.t100_c} °C, 26 °C isotherm at ${b.d26_m} m. 7-day change in OCPI ${sg(b.change_7d.ocpi)}.`,
    `Arabian Sea: ${pct(a.share_ocpi_high)} High or above (mean ${a.ocpi_mean_of_cells}); heat potential ${a.tchp_kj_cm2} kJ cm⁻², upper-100 m ${a.t100_c} °C, D26 ${a.d26_m} m; 7-day OCPI change ${sg(a.change_7d.ocpi)}.`,
  ]
  if (p.hotspots.length) lines.push(`Strongest ocean support: ${p.hotspots.slice(0, 3).map((h) => `${fmtLat(h.lat)} ${fmtLon(h.lon)} (OCPI ${h.ocpi}, led by ${h.drivers[0]?.name.toLowerCase()})`).join('; ')}.`)
  lines.push(p.watch_points.length
    ? `Watch: ${p.watch_points.length} point(s) where a cyclonic surface circulation with winds ≥ ${WIND} m s⁻¹ sits over High-potential ocean, strongest near ${fmtLat(p.watch_points[0].lat)} ${fmtLon(p.watch_points[0].lon)}.`
    : 'No cyclonic surface disturbance over High-potential ocean today.')
  lines.push('Ocean conditions only: vertical wind shear and humidity are not assessed. Verify against IMD and INCOIS advisories.')
  return lines
}

// ---------------------------------------------------------------- page
export default function Cyclone() {
  const liveM = useManifest(LIVE)
  const OPS = liveM.error ? REPLAY : LIVE, live = OPS === LIVE
  const { m } = useManifest(OPS)
  const series = useJSON('series.json', OPS)
  const index = useJSON('index.json', OPS)
  const bull = useJSON('bulletin.json', OPS)
  const [date, setDate] = useState(null)
  const [region, setRegion] = useState('BoB')
  const [depthK, setDepthK] = useState(DEPTHS.indexOf(100))
  const [view, setView] = useState(null)
  const [agentText, setAgentText] = useState({})          // date → { state: 'writing' | 'ok' | 'none', text }

  useEffect(() => { if (m && (!date || !m.days.some((d) => d.date === date))) setDate(m.days[m.days.length - 1].date) }, [m, date])
  const day = useDay(m, date)
  // late inputs: show the newest day on or before `date` that has them
  const lastWith = (k) => m?.days.filter((x) => x.date <= (date ?? '') && x.layers.includes(k)).at(-1)?.date ?? null
  const sssDate = lastWith('sss'), windDate = lastWith('uw')
  const sssDay = useDay(m, sssDate !== date ? sssDate : null)
  const windDay = useDay(m, windDate !== date ? windDate : null)

  const dates = useMemo(() => (series ? Object.keys(series.days).sort() : []), [series])
  const today = new Date().toISOString().slice(0, 10)
  const cyc = useCyclones(dates[0] ?? null, addDays(today, 7))
  const rec = (d, r) => series?.days[d]?.[r]
  const vals = (fn) => (r) => dates.map((d) => { const x = rec(d, r); return x ? fn(x) ?? NaN : NaN })

  const f = useMemo(() => (m && day ? features(m, day) : null), [m, day])
  const d = useMemo(() => (m && day ? derived(m, day) : null), [m, day])
  const sum = useMemo(() => (m && day ? regionSummary(m, day) : null), [m, day])
  const hs = useMemo(() => (f ? peaks(m, f.ocpi, { k: 6, sep: 4, min: 0.5 }) : []), [f, m])
  // outlook in the timeline always starts from the newest predicted day
  const lastDate = m?.days.at(-1)?.date ?? null
  const lastDay = useDay(m, date !== lastDate ? lastDate : null)
  const latestHs = useMemo(() => {
    const dd = date === lastDate ? day : lastDay
    return m && dd ? peaks(m, features(m, dd).ocpi, { k: 3, sep: 4, min: 0.5 }) : []
  }, [m, day, lastDay, date, lastDate])
  const wDay = day?.uw ? day : windDay
  const fW = useMemo(() => (m && wDay ? features(m, wDay) : null), [m, wDay])
  const vort5 = useMemo(() => fW && fW.vort.map((v) => v * 1e5), [fW])
  const watch = useMemo(() => (f && fW ? peaks(m, f.ocpi, { k: 5, sep: 3, min: 0.5, keep: (i) => fW.vort[i] > VORT && fW.wind[i] >= WIND })
    .map((p) => ({ ...p, ocpi: p.v, vort: fW.vort[p.i], wind: fW.wind[p.i] })) : []), [f, fW, m])

  // the Sylithe agent words today's bulletin live (DeepSeek via /api/agent); numbers are checked before it is shown
  const payloadKey = m && day && series && f && sum ? date : null
  useEffect(() => {
    if (!payloadKey || agentText[payloadKey]) return
    const recs0 = Object.fromEntries(RS.map((r) => [r, series.days[date]?.[r]]))
    const prev0 = Object.fromEntries(RS.map((r) => [r, series.days[addDays(date, -7)]?.[r]]))
    const p = buildPayload({ date, live, run: index?.runs?.[date], sum, recs: recs0, prev: prev0, hs, watch, dayObj: day, m })
    setAgentText((a) => ({ ...a, [date]: { state: 'writing' } }))
    fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task: 'bulletin', payload: p }) })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((j) => {
        const t = j?.answer
        setAgentText((a) => ({ ...a, [date]: t && !untraced(t, p).length ? { state: 'ok', text: t, model: j.model } : { state: 'none' } }))
      })
  }, [payloadKey]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!m || !day || !series || !f) return <div className="page min-h-[70vh] pt-16"><p className="label">Loading the live ocean state…</p></div>

  const run = index?.runs?.[date]
  const recs = Object.fromEntries(RS.map((r) => [r, rec(date, r)]))
  const prev = Object.fromEntries(RS.map((r) => [r, rec(addDays(date, -7), r)]))
  const payload = buildPayload({ date, live, run, sum, recs, prev, hs, watch, dayObj: day, m })
  const text = bulletinText(payload)
  const json = JSON.stringify(payload, null, 2)
  const live_ = agentText[date]
  const llm = live_?.state === 'ok' ? { text: live_.text, model: live_.model }
    : bull?.llm?.text && bull.llm.checked && bull.date === date ? bull.llm : null
  const bView = view ?? (llm ? 'llm' : 'text')
  const llmState = llm ? 'Sylithe agent (DeepSeek) · numbers verified' : live_?.state === 'writing' ? 'Sylithe agent is writing…' : null
  const z = DEPTHS[depthK]
  const tempZ = level(m, day.temp, depthK)
  const rr = (grid, sym) => grid && robustRange(grid, sym)
  const regionRec = recs[region]
  const hsMarks = hs.map((h, j) => ({ lat: h.lat, lon: h.lon, label: j + 1 }))
  const watchMarks = watch.map((w) => ({ lat: w.lat, lon: w.lon, kind: 'cross' }))
  const trackMarks = cyc.list.flatMap((c) => c.track.filter((p) => Math.abs(Date.parse(p.t) - Date.parse(date)) <= 2 * 864e5)
    .map((p, j) => ({ lat: p.lat, lon: p.lon, kind: 'dot', label: j === 0 ? c.name : undefined })))
  const pending = (k) => (day[k] ? null : <p className="rounded-[8px] bg-wash px-3 py-8 text-center text-[12.5px] text-mute">Not yet published for {fmtDate(date)} (late input); the model ran without it.</p>)

  const INPUTS = [
    { id: 'in-sst', k: 'sst', title: 'Sea surface temperature', grid: day.sst, ramp: 'thermal', unit: '°C', dp: 2, s: (x) => x.sst, src: live ? 'OSTIA NRT' : 'OSTIA L4',
      cap: 'The first condition for a cyclone: 26 °C or warmer. SST alone cannot tell a thin warm skin from a deep warm layer, which is why the model looks beneath it.' },
    { id: 'in-sss', k: 'sss', title: 'Sea surface salinity', grid: (day.sss ? day : sssDay)?.sss, on: day.sss ? date : sssDate, ramp: 'haline', unit: 'psu', dp: 2, s: (x) => x.sss, src: live ? 'SMOS/SMAP multi-obs NRT' : 'SMOS/SMAP multi-obs L4',
      cap: 'River and monsoon freshwater in the Bay of Bengal makes a shallow, stable surface layer (a barrier layer) that limits how much cold water a storm can mix up.' },
    { id: 'in-sla', k: 'sla', title: 'Sea level anomaly', grid: day.sla, ramp: 'balance', sym: true, unit: 'm', dp: 3, s: (x) => x.sla, src: live ? 'DUACS NRT' : 'DUACS DT',
      cap: 'Highs mark warm-core eddies with a deep thermocline, lows cold-core eddies. The strongest subsurface signal among the inputs.' },
    { id: 'in-cur', k: 'uc', title: 'Surface current speed', grid: layerGrid(m, day, 'cur'), ramp: 'speed', unit: 'm s⁻¹', dp: 2, s: (x) => x.cur, src: live ? 'DUACS geostrophic' : 'OSCAR v2',
      cap: 'Currents move warm water around the basin and trace the boundary currents and eddies that shape the thermocline.' },
    { id: 'in-wind', k: 'uw', title: '10 m wind speed', grid: (day.uw ? layerGrid(m, day, 'wind') : windDay && layerGrid(m, windDay, 'wind')), on: day.uw ? date : windDate, ramp: 'speed', unit: 'm s⁻¹', dp: 1, s: (x) => x.wind, src: live ? 'ASCAT-blended L4' : 'CCMP v3.1',
      cap: 'Wind mixes the upper ocean and drives upwelling. Strong winds with a cyclonic swirl also mark an existing disturbance (see the disturbance watch).' },
  ]
  const OUTPUTS = [
    { id: 'out-temp', title: `Temperature at ${z} m`, grid: level(m, day.temp, depthK), ramp: 'thermal', unit: '°C', dp: 2, s: (x) => x.T?.[depthK],
      cap: `The model's reconstruction at ${z} m (change the depth in the bar above). Around 75–150 m the thermocline sits and the prediction is least certain.` },
    ...(day.sigma ? [{ id: 'out-sigma', title: `Uncertainty (±1σ) at ${z} m`, grid: level(m, day.sigma, depthK), ramp: 'tempo', unit: '°C', dp: 2, s: (x) => x.sigma?.[depthK],
      cap: `How sure the model is at ${z} m: the ensemble's predicted standard deviation. Largest in the thermocline and in eddy-rich areas.` }] : []),
    { id: 'out-tchp', title: 'Tropical cyclone heat potential', grid: d.tchp, ramp: 'matter', range: [0, 150], unit: 'kJ cm⁻²', dp: 0, s: (x) => x.tchp, threshold: 50,
      cap: 'Heat stored above the 26 °C isotherm. The bar on the scale and the dashed line mark 50 kJ cm⁻², above which rapid intensification becomes possible.' },
    { id: 'out-t100', title: 'Mean temperature of the upper 100 m', grid: f.t100, ramp: 'thermal', unit: '°C', dp: 2, s: (x) => (x.T ? t100(x.T) : NaN),
      cap: 'What a storm experiences after it has stirred the upper ocean (Price, 2009). Below about 26 °C the mixed water can no longer feed intensification.' },
    { id: 'out-d26', title: 'Depth of the 26 °C isotherm', grid: d.d26, ramp: 'deep', unit: 'm', dp: 0, s: (x) => x.d26, invert: true,
      cap: 'Thickness of the warm layer. The deeper it is, the harder it is for a storm to cool the surface below 26 °C.' },
    { id: 'out-mld', title: 'Mixed-layer depth', grid: d.mld, ramp: 'deep', unit: 'm', dp: 0, s: (x) => x.mld, invert: true,
      cap: 'Depth of the well-mixed surface layer; a shallow mixed layer over a sharp thermocline cools fastest under a storm.' },
  ]
  let n = 0

  return (
    <div className="pb-12">
      {/* ================================================ header */}
      <div className="page pt-12 sm:pt-14">
        <SectionHead as="h1" label={`Cyclone watch · ${live ? 'live' : '2023 replay'} · ${fmtDate(date)}`} title="From satellite input to cyclone potential">
          Five satellite inputs go into the Sylithe Ocean Model, which predicts the temperature from the surface to 1000 m. A transparent logic engine turns
          inputs and prediction into an Ocean Cyclone Potential Index (OCPI), finds hotspots and flags disturbances over warm ocean. Those numbers are
          the only thing a language model receives to word the bulletin.
        </SectionHead>

        {/* alert + timeline */}
        {(() => {
          const now = Date.now()
          const active = cyc.list.filter((c) => c.current || c.track.some((p) => Date.parse(p.t) >= now - 864e5))
          const last = (c) => c.track.filter((p) => !p.forecast).at(-1) ?? c.track.at(-1)
          const end = (c) => c.track.at(-1)
          return (
            <div className="mt-8">
              {active.length ? active.map((c) => (
                <div key={c.id} className="mb-3 flex flex-wrap items-start gap-4 rounded-[12px] border px-5 py-4"
                  style={{ borderColor: ALERT[c.alert], background: `${ALERT[c.alert]}14` }}>
                  <AlertTriangle size={22} style={{ color: ALERT[c.alert] }} className="mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-medium text-ink">Cyclone alert · {c.name} · GDACS {c.alert}</p>
                    <p className="mt-1 text-[13px] text-ink2">{catName[last(c)?.cat] ?? 'Tropical system'} at {fmtLat(last(c).lat)} {fmtLon(last(c).lon)} ({last(c).t.slice(0, 16).replace('T', ' ')} UTC)
                      {end(c)?.forecast && <>, forecast to reach {fmtLat(end(c).lat)} {fmtLon(end(c).lon)} by {end(c).t.slice(0, 16).replace('T', ' ')} UTC</>}. {c.severity}.</p>
                    <p className="mt-1 text-[11.5px] text-mute">Track and forecast: JTWC via GDACS. Official Indian warnings: IMD (mausam.imd.gov.in). {c.report && <a className="link" href={c.report} target="_blank" rel="noreferrer">GDACS report</a>}</p>
                  </div>
                </div>
              )) : (
                <div className="mb-3 flex items-center gap-3 rounded-[12px] border border-line bg-white/70 px-5 py-3.5">
                  <ShieldCheck size={20} className="shrink-0 text-[#4D9F6A]" />
                  <p className="text-[13px] text-ink2">{cyc.loading ? 'Checking GDACS for active cyclones…' : cyc.error ? 'GDACS could not be reached; no cyclone status available.'
                    : <>No active cyclone in the North Indian Ocean (GDACS, checked just now).{cyc.list.length ? ` Recent: ${cyc.list.map((c) => `${c.name} (${fmtDate(c.from.slice(0, 10))}–${fmtDate(c.to.slice(0, 10))})`).join(', ')}.` : ''}</>}</p>
                </div>
              )}
              <section className="rounded-[12px] border border-line bg-white p-4 sm:p-5">
                <CycloneTimeline dates={dates} today={today} cyclones={cyc.list} hotspots={latestHs}
                  lines={RS.map((r) => ({ label: REGIONS[r].label, color: RCOL[r], dashed: r === 'NIO', values: vals(ocpiOfRecord)(r) }))} />
                <p className="mt-3 border-t border-line pt-3 text-[12.5px] leading-relaxed text-ink2"><span className="font-medium text-ink">Figure 0. Cyclone potential and cyclones, day by day.</span> (a) OCPI of each basin's
                  area-mean conditions over every predicted day; dots every third day. Beyond the newest satellite day the ocean has not been observed yet, so the
                  shaded band shows a persistence outlook (the latest value carried forward, since upper-ocean heat changes over weeks) and the coordinates where
                  potential is High today. (b) Cyclones reported by GDACS (JTWC tracks): solid = observed, hollow = official forecast.</p>
              </section>
              {/* ---------------- Sylithe agent bulletin */}
              <section id="bulletin" className="mt-4 scroll-mt-28 rounded-[12px] border border-[#E5E7EB] bg-[#F5F5F4]">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E5E7EB] px-5 py-3">
                  <div className="flex items-center gap-2.5">
                    <img src="/sylithe-logo.png" alt="" className="h-6 w-6" />
                    <div><p className="text-[14.5px] font-medium text-ink">Sylithe agent · ocean bulletin for {fmtDate(bull?.date ?? date)}</p>
                      <p className="text-[11.5px] text-mute">From every satellite input, the predicted ocean column and the cyclone logic; the agent words it, every number is checked.</p></div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="seg">{[...(llm ? [['llm', 'Sylithe agent']] : []), ['text', 'Template'], ['json', 'Data (JSON)']].map(([k, l]) =>
                      <button key={k} aria-pressed={bView === k} onClick={() => setView(k)}>{l}</button>)}</div>
                    {llmState && <span className="hidden items-center gap-1.5 text-[11.5px] text-mute md:inline-flex"><span className={`h-1.5 w-1.5 rounded-full ${llm ? 'bg-[#4D9F6A]' : 'animate-pulse bg-[#E0A526]'}`} />{llmState}</span>}
                    <CopyBtn text={bView === 'llm' && llm ? llm.text : bView === 'json' ? json : text.join('\n\n')} />
                  </div>
                </div>
                {bView === 'llm' && llm && <div className="px-5 py-4 text-[14px] leading-relaxed text-ink2">{rich(llm.text)}</div>}
                {bView === 'text' && <div className="space-y-2.5 px-5 py-4 text-[14px] leading-relaxed text-ink2">{text.map((t, i) => <p key={i} className={i ? '' : 'font-medium text-ink'}>{t}</p>)}</div>}
                {bView === 'json' && <pre className="num max-h-[460px] overflow-auto rounded-b-[12px] bg-[#0F172A] px-5 py-4 text-[11.5px] leading-relaxed text-[#E2E8F0]">{json}</pre>}
                <p className="border-t border-[#E5E7EB] px-5 py-2.5 text-[11px] text-faint">Ocean conditions only, not a cyclone forecast. For operational decisions use IMD and INCOIS advisories.</p>
              </section>
            </div>
          )
        })()}

        <div className="mt-8 grid items-stretch gap-2 md:grid-cols-[1.2fr_auto_1fr_auto_1.2fr_auto_1.2fr_auto_1fr]">
          {[
            ['#inputs', '01 · Satellite input', 'SST · SSS · SLA · currents · winds', ''],
            ['#outputs', '02 · Sylithe Ocean Model', '3-model ensemble, 15-day window', ''],
            ['#outputs', '03 · Ocean state', 'T 0–1000 m · TCHP · T100 · D26 · MLD', ''],
            ['#potential', '04 · Cyclone logic', 'OCPI · hotspots · disturbance watch', ''],
            ['#bulletin', '05 · Sylithe agent', 'bulletin and suggestions, numbers verified', ''],
          ].flatMap(([href, t, s, cls], i) => [
            i > 0 ? <ArrowRight key={`a${i}`} size={16} className="hidden self-center text-mute md:block" /> : null,
            <a key={t} href={href} className={`rounded-[10px] border border-[#EBDCCB] bg-[#FAF0E6] px-3 py-2.5 text-ink transition-colors hover:border-[#D9722B] ${cls}`}>
              <p className="text-[12.5px] font-medium">{t}</p><p className="mt-0.5 text-[11px] opacity-70">{s}</p></a>,
          ]).filter(Boolean)}
        </div>
      </div>

      {/* ================================================ controls */}
      <div className="sticky top-[var(--bar)] z-[900] mt-8 border-y border-line bg-paper/95 backdrop-blur">
        <div className="page flex flex-wrap items-center gap-x-6 gap-y-2 py-2.5">
          <span className="inline-flex h-7 items-center gap-2 rounded-[7px] border border-[#E3C7A8] bg-[#F3E2CF] px-2.5 text-[12px] text-[#7C4A1E]">
            <span className={`h-[7px] w-[7px] rounded-full ${live ? 'animate-pulse bg-[#4D9F6A]' : 'bg-line2'}`} />{live ? 'Live' : 'Offline · 2023 data'}</span>
          <Timeline days={m.days} value={date} onChange={setDate} className="min-w-[240px] max-w-[460px] flex-1" />
          <span className="num text-[12.5px] text-ink">{fmtDate(date)}</span>
          <label className="flex items-center gap-2 text-[12px]"><span className="label">Profile region</span>
            <select value={region} onChange={(e) => setRegion(e.target.value)} className="h-8 rounded-[7px] border border-line bg-paper px-2 text-[12.5px]">
              {RS.map((r) => <option key={r} value={r}>{REGIONS[r].label}</option>)}</select></label>
          <label className="flex items-center gap-2 text-[12px]"><span className="label">Depth · temperature panels</span>
            <select value={depthK} onChange={(e) => setDepthK(+e.target.value)} className="h-8 rounded-[7px] border border-line bg-paper px-2 text-[12.5px]">
              {DEPTHS.map((dd, k) => <option key={dd} value={k}>{dd} m</option>)}</select></label>
        </div>
      </div>

      <div className="page">
        {/* ================================================ inputs */}
        <SectionHead id="inputs" className="scroll-mt-28 pt-12" label="01 · Satellite input" title="What the satellites saw">
          Every figure has the same panels: (a) the field on {fmtDate(date)}, (b) its area mean over every predicted day for the Bay of Bengal,
          the Arabian Sea and the whole North Indian Ocean, and (c) the input against the predicted temperature at {z} m, cell by cell — change the depth
          above to see how much each surface signal tells about that level.
        </SectionHead>
        <div className="mt-6 space-y-6">
          {INPUTS.map((x) => { n++; return (
            <Fig key={x.id} id={x.id} n={n} title={`${x.title} (${x.src})`} caption={x.cap}>
              <div>{x.grid ? <FigMap g={m.grid} grid={x.grid} ramp={x.ramp} range={rr(x.grid, x.sym)} unit={x.unit} dp={x.dp} tag="a" title={`${x.title}, ${fmtDate(x.on ?? date)}`} /> : pending(x.k)}
                {x.on && x.on !== date && <p className="mt-1 text-center text-[11px] text-heat">Newest published: {fmtDate(x.on)}. The {fmtDate(date)} prediction ran without it; it is re-run when it arrives.</p>}</div>
              <div>
                <Panel tag="b" title="Area mean" dates={dates} values={vals(x.s)} unit={x.unit} dp={x.dp} marker={date} />
                <DepthScatter g={m.grid} x={x.grid} y={tempZ} unit={x.unit} dp={x.dp} depth={z} />
              </div>
            </Fig>) })}
        </div>

        {/* ================================================ outputs */}
        <SectionHead id="outputs" className="scroll-mt-28 pt-16" label="02 · Model output" title="What the Sylithe Ocean Model predicts beneath">
          The same two-panel layout for every predicted quantity, each computed from the predicted temperature column in every 0.25° cell.
        </SectionHead>
        <div className="mt-6 space-y-6">
          {OUTPUTS.map((x) => { n++; return (
            <Fig key={x.id} id={x.id} n={n} title={x.title} caption={x.cap}>
              <FigMap g={m.grid} grid={x.grid} ramp={x.ramp} range={x.range ?? rr(x.grid)} unit={x.unit} dp={x.dp} tag="a" title={`${x.title}, ${fmtDate(date)}`} threshold={x.threshold} />
              <Panel tag="b" title="Area mean" dates={dates} values={vals(x.s)} unit={x.unit} dp={x.dp} marker={date} invert={x.invert}
                threshold={x.threshold ? { value: x.threshold, label: `${x.threshold} ${x.unit}` } : undefined} />
            </Fig>) })}
          {(() => { n++; return (
            <Fig id="out-column" n={n} title={`The water column under the ${REGIONS[region].label}`} cols="lg:grid-cols-[1fr_1.5fr]"
              caption="(a) Area-mean predicted profile with its ±1σ uncertainty, against the same area 7 days earlier. (b) The column over every predicted day, with the 26 °C (dashed) and 20 °C (solid) isotherms: a deepening dashed line means the warm layer is thickening.">
              <figure><figcaption className="mb-1 text-center font-display text-[14px] text-ink"><span className="mr-1 text-mute">(a)</span>Profile, {fmtDate(date)}</figcaption>
                {regionRec?.T ? <ProfileChart height={330} mark={z} main={{ label: fmtDate(date), values: regionRec.T, sigma: regionRec.sigma }} mld={regionRec.mld}
                  others={prev[region]?.T ? [{ label: '7 days before', values: prev[region].T, style: 'dashed' }] : []} /> : <p className="text-[12px] text-faint">No profile.</p>}</figure>
              <figure><figcaption className="mb-1 text-center font-display text-[14px] text-ink"><span className="mr-1 text-mute">(b)</span>Depth over time, 0–300 m</figcaption>
                <DepthTimeChart dates={dates} cols={dates.map((dd) => rec(dd, region)?.T)} zmax={z <= 300 ? 300 : z <= 500 ? 500 : 1000} height={300} mark={z} /></figure>
            </Fig>) })()}
        </div>

        {/* ================================================ cyclone potential */}
        <SectionHead id="potential" className="scroll-mt-28 pt-16" label="03 · Cyclone logic" title="Ocean Cyclone Potential Index">
          Seven ocean drivers, each scored 0–1 between published limits and combined with fixed weights (table below). Zero wherever the surface is
          below 26 °C. It measures how strongly the ocean can support a cyclone, not whether one will form: the atmosphere is not in the data.
        </SectionHead>
        <div className="mt-6 space-y-6">
          {(() => { n++; return (
            <Fig id="pot-ocpi" n={n} title="Ocean Cyclone Potential Index" caption={`(a) OCPI on ${fmtDate(date)}; numbered rings are the ${hs.length} strongest hotspots at least 4° apart, crosses are watch points (next figure), black dots are cyclone positions within 2 days (GDACS). (b) OCPI of each area's mean conditions over time; the dashed line marks High (0.5).`}>
              <FigMap g={m.grid} grid={f.ocpi} ramp="matter" range={[0, 1]} unit="OCPI" dp={2} tag="a" title={`OCPI, ${fmtDate(date)}`} marks={[...hsMarks, ...watchMarks, ...trackMarks]} threshold={0.5} />
              <Panel tag="b" title="OCPI of area-mean conditions" dates={dates} values={vals(ocpiOfRecord)} unit="" dp={2} marker={date} threshold={{ value: 0.5, label: 'High' }} />
            </Fig>) })()}
          {(() => { n++; return (
            <Fig id="pot-vort" n={n} title="Disturbance watch"
              caption={`(a) Relative vorticity of the satellite surface wind (red: cyclonic, anticlockwise in the northern hemisphere). A watch point (cross) needs vorticity above ${VORT * 1e5} × 10⁻⁵ s⁻¹, wind of at least ${WIND} m s⁻¹ and OCPI ≥ 0.5. (b) Watch points and the share of each area at High or above.`}>
              <div>{vort5 ? <FigMap g={m.grid} grid={vort5} ramp="balance" range={[-6, 6]} unit="10⁻⁵ s⁻¹" dp={1} tag="a" title={`Surface wind vorticity, ${fmtDate(wDay?.date ?? date)}`} marks={watchMarks} /> : pending('uw')}</div>
              <div>
                <p className="mb-2 text-center font-display text-[14px] text-ink"><span className="mr-1 text-mute">(b)</span>Watch points</p>
                {watch.length ? (
                  <table className="w-full text-[12.5px]"><thead><tr className="border-b border-line text-left">
                    {['Location', 'OCPI', 'Vorticity', 'Wind'].map((h) => <th key={h} className="label py-1.5 pr-3 font-normal">{h}</th>)}</tr></thead>
                    <tbody>{watch.map((w) => <tr key={w.i} className="border-b border-line">
                      <td className="num py-1.5 pr-3 text-ink">{fmtLat(w.lat)} {fmtLon(w.lon)}</td><td className="num pr-3">{fmt(w.ocpi, 2)}</td>
                      <td className="num pr-3">{fmt(w.vort * 1e5, 1)}</td><td className="num">{fmt(w.wind, 1)} m s⁻¹</td></tr>)}</tbody></table>
                ) : <p className="rounded-[8px] bg-wash px-3 py-3 text-[12.5px] text-mute">No cyclonic surface circulation with strong winds over High-potential ocean today.</p>}
                <div className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-[8px] border border-line bg-line text-center">
                  {RS.map((r) => <div key={r} className="bg-paper px-2 py-2"><p className="label">{REGIONS[r].short}</p>
                    <p className="num text-[18px] text-ink">{Math.round((sum[r].share_high || 0) * 100)} %</p><p className="text-[10.5px] text-mute">High or above</p></div>)}
                </div>
              </div>
            </Fig>) })()}
        </div>

        <h3 className="mt-10 text-[15px] text-ink">Hotspots and what drives them</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] text-[12.5px]">
            <thead><tr className="border-b border-line text-left">{['#', 'Location', 'OCPI', 'Category', 'Strongest drivers (score 0–1)'].map((h) => <th key={h} className="label py-2 pr-4 font-normal">{h}</th>)}</tr></thead>
            <tbody>{hs.map((h, j) => { const c = catOf(h.v); return (
              <tr key={h.i} className="border-b border-line align-top">
                <td className="num py-2 pr-4 text-faint">{j + 1}</td>
                <td className="num py-2 pr-4 text-ink">{fmtLat(h.lat)} {fmtLon(h.lon)}</td>
                <td className="num py-2 pr-4">{fmt(h.v, 2)}</td>
                <td className="py-2 pr-4"><span className="rounded-full px-2 py-0.5 text-[11px] text-white" style={{ background: c.color }}>{c.label}</span></td>
                <td className="py-2 pr-4">{drivers(m, day, h.i).slice(0, 3).map((dv) => (
                  <span key={dv.key} className="mr-3 inline-flex items-center gap-1.5"><span className="text-ink2">{dv.label}</span>
                    <span className="num text-ink">{fmt(dv.value, dv.dp)} {dv.unit}</span><span className="num text-[11px] text-mute">({dv.score.toFixed(2)})</span></span>))}</td>
              </tr>) })}</tbody>
          </table>
          {!hs.length && <p className="mt-2 text-[12.5px] text-mute">No cell reaches High (0.5) today.</p>}
        </div>

        <h3 className="mt-10 text-[15px] text-ink">The rules</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[820px] text-[12.5px]">
            <thead><tr className="border-b border-line text-left">{['Driver', 'Scores 0 at', 'Scores 1 at', 'Weight', 'Why', 'Source'].map((h) => <th key={h} className="label py-2 pr-4 font-normal">{h}</th>)}</tr></thead>
            <tbody>{RULES.map((r) => <tr key={r.key} className="border-b border-line align-top">
              <td className="py-2 pr-4 text-ink">{r.label}</td><td className="num py-2 pr-4">{r.lo} {r.unit}</td><td className="num py-2 pr-4">{r.hi} {r.unit}</td>
              <td className="num py-2 pr-4">{r.w.toFixed(2)}</td><td className="py-2 pr-4 text-ink2">{r.why}</td><td className="py-2 pr-4 text-mute">{r.ref}</td></tr>)}</tbody>
          </table>
          <p className="mt-2 text-[11.5px] text-faint">Categories: {CATS.slice().reverse().map((c) => `${c.label} ≥ ${c.min}`).join(' · ')}. A driver missing on a day (e.g. late salinity) is left out and the weights are rescaled.</p>
        </div>

      </div>
    </div>
  )
}
