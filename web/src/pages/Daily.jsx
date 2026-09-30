import { useEffect, useMemo, useRef, useState } from 'react'
import OceanMap from '../components/map/OceanMap'
import Legend from '../components/map/Legend'
import TimeSeries from '../components/charts/TimeSeries'
import { SectionHead } from '../components/ui'
import { useDay, useJSON, useManifest } from '../lib/data'
import { DEPTHS, REGIONS, colorAt, fmt, fmtDate, layerById, layerGrid, renderGrid, robustRange } from '../lib/ocean'

const REPLAY = '/data/ops'
// Live feed: the `live-data` branch written by .github/workflows/live.yml (override with VITE_LIVE_BASE)
const LIVE = import.meta.env.VITE_LIVE_BASE || 'https://raw.githubusercontent.com/karan27-dev/Sylithe_Ocean_Embedding/live-data/web'
const ago = (iso) => {
  const h = (Date.now() - Date.parse(iso)) / 36e5
  return h < 1 ? `${Math.round(h * 60)} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`
}

function LiveStatus({ status, skill }) {
  if (!status) return null
  const src = Object.values(status.sources ?? {})
  return (
    <section className="mt-8 grid gap-8 border-b border-line pb-8 lg:grid-cols-[1.4fr_1fr]">
      <div>
        <p className="label mb-2">Satellite feeds · checked {ago(status.updated_at)}</p>
        <table className="w-full text-[12.5px]">
          <thead><tr className="border-b border-line text-left">
            {['Source', 'Variables', 'Newest data', 'Delay', 'Ingested'].map((h) => <th key={h} className="label py-1.5 pr-3 font-normal">{h}</th>)}
          </tr></thead>
          <tbody>{src.map((x) => (
            <tr key={x.label ?? x.error} className="border-b border-line">
              <td className="py-2 pr-3 text-ink">{x.label ?? '—'}</td>
              <td className="num py-2 pr-3 text-mute">{x.variables?.join(' ').toUpperCase()}</td>
              <td className="num py-2 pr-3">{x.latest_available ?? '—'}</td>
              <td className={`num py-2 pr-3 ${x.lag_days > 3 ? 'text-heat' : 'text-ink2'}`}>{x.lag_days != null ? `${x.lag_days} d` : '—'}</td>
              <td className="num py-2 pr-3 text-mute">{x.error ? <span className="text-heat">error</span> : x.new_days ? `+${x.new_days} day(s)` : 'up to date'}</td>
            </tr>))}
          </tbody>
        </table>
        <p className="mt-2 text-[11.5px] text-faint">A day is predicted as soon as SST and sea level are in; it is predicted again when late inputs
          (salinity ~6 days, winds ~1 day) arrive. Currents are geostrophic currents from DUACS and winds the ASCAT-blended product: near-real-time
          substitutes for the reprocessed OSCAR and CCMP used in training.</p>
      </div>
      <div>
        <p className="label mb-2">Live check against Argo floats · last 30 days</p>
        {skill?.rmse != null ? (
          <>
            <p className="display text-[34px] leading-none text-sea">{skill.rmse.toFixed(3)} <span className="text-[16px] text-mute">°C RMSE</span></p>
            <p className="mt-2 text-[12.5px] text-mute">{skill.profiles} float profile{skill.profiles === 1 ? '' : 's'} ({skill.points} measurements),
              {' '}{fmtDate(skill.from)} – {fmtDate(skill.to)} · bias {skill.bias >= 0 ? '+' : ''}{skill.bias.toFixed(3)} °C</p>
            <p className="mt-2 text-[11.5px] text-faint">Real-time quality-controlled floats against the live prediction of the same day and cell.
              For comparison, the 2023 evaluation (reprocessed inputs) scored 0.757 °C.</p>
          </>
        ) : <p className="text-[12.5px] text-mute">No Argo float has surfaced on a predicted day yet; the check fills in as floats report.</p>}
        <p className="mt-4 text-[12.5px] text-ink2">Last run: {status.run_seconds} s · {status.members}-model ensemble ·
          {' '}{status.recomputed?.length ? `${status.recomputed.length} day(s) (re)computed` : 'nothing new to compute'}</p>
      </div>
    </section>
  )
}
const RANGES = [['week', 'Week', 7], ['month', 'Month', 30], ['quarter', 'Quarter', 91], ['year', 'Year', 365]]
const INPUTS = [
  ['sst', 'Sea surface temperature', '°C', 2, 'OSTIA'],
  ['sss', 'Sea surface salinity', 'psu', 2, 'SMOS / SMAP'],
  ['sla', 'Sea level anomaly', 'm', 3, 'DUACS'],
  ['cur', 'Surface current speed', 'm s⁻¹', 2, 'OSCAR'],
  ['wind', '10 m wind speed', 'm s⁻¹', 1, 'CCMP'],
]
const MAP_LAYERS = ['temp', 'sigma', 'sst', 'sss', 'sla']
const SEA = 'rgb(var(--sea))', INK = 'rgb(var(--ink))', HEAT = 'rgb(var(--heat))', COLD = 'rgb(var(--cold))'
const addDays = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10)

function Select({ label, value, onChange, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-[7px] border border-line bg-paper px-2.5 text-[13px] text-ink hover:border-line2 focus:border-sea focus:outline-none">
        {children}
      </select>
    </label>
  )
}

function Kpi({ label, value, prev, unit, dp, alert }) {
  const d = Number.isFinite(value) && Number.isFinite(prev) ? value - prev : NaN
  return (
    <div className="border-line first:border-0 first:pl-0 max-sm:pl-0 sm:border-l sm:pl-4">
      <p className="label">{label}</p>
      <p className={`num mt-1.5 text-[24px] leading-none ${alert ? 'text-heat' : 'text-ink'}`}>{fmt(value, dp)}
        <span className="ml-1 text-[11px] text-faint">{unit}</span></p>
      <p className="num mt-1 text-[11px] text-mute">{Number.isFinite(d) ? `${d >= 0 ? '+' : ''}${d.toFixed(dp)} vs 7 days before` : '—'}</p>
    </div>
  )
}

/** Regional mean temperature anomaly (from the range mean at each depth), depth × time. */
function DepthTimeMean({ dates, cols, height = 190 }) {
  const ref = useRef(null)
  const zmax = 300, ks = DEPTHS.map((z, k) => k).filter((k) => DEPTHS[k] <= zmax)
  useEffect(() => {
    const cv = ref.current
    if (!cv || !cols.length) return
    const W = cv.clientWidth, H = height, ctx = cv.getContext('2d')
    cv.width = W * 2; cv.height = H * 2; ctx.scale(2, 2)
    const mean = DEPTHS.map((_, k) => { const v = cols.map((c) => c[k]).filter(Number.isFinite); return v.reduce((a, b) => a + b, 0) / (v.length || 1) })
    const an = cols.map((c) => c.map((v, k) => v - mean[k]))
    const amax = Math.max(0.1, ...an.flat().filter(Number.isFinite).map(Math.abs))
    const sy = (z) => Math.sqrt(z / zmax) * H
    const cw = W / cols.length
    cols.forEach((c, i) => ks.forEach((k, j) => {
      const v = an[i][k]
      if (!Number.isFinite(v)) return
      const z0 = j ? (DEPTHS[ks[j - 1]] + DEPTHS[k]) / 2 : 0, z1 = j < ks.length - 1 ? (DEPTHS[k] + DEPTHS[ks[j + 1]]) / 2 : zmax
      ctx.fillStyle = colorAt('balance', (v + amax) / (2 * amax))
      ctx.fillRect(i * cw, sy(z0), cw + 0.6, sy(z1) - sy(z0) + 0.6)
    }))
  }, [cols, height]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="flex gap-2">
      <div className="relative w-8 shrink-0 text-right" style={{ height }}>
        {[0, 50, 100, 200, 300].map((z) => (
          <span key={z} className="num absolute right-0 -translate-y-1/2 text-[10px] text-faint" style={{ top: Math.sqrt(z / 300) * height }}>{z}</span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <canvas ref={ref} className="block w-full rounded-[3px]" style={{ height }} />
        <div className="num mt-1 flex justify-between text-[10px] text-faint"><span>{fmtDate(dates[0])}</span><span>{fmtDate(dates[dates.length - 1])}</span></div>
      </div>
    </div>
  )
}

export default function Daily() {
  const [mode, setMode] = useState('live')
  const liveM = useManifest(LIVE)
  const liveDown = mode === 'live' && liveM.error
  const OPS = mode === 'live' && !liveDown ? LIVE : REPLAY
  const { m: ops } = useManifest(OPS)
  const series = useJSON('series.json', OPS)
  const index = useJSON('index.json', OPS)
  const status = useJSON('status.json', LIVE)
  const skill = useJSON('skill.json', LIVE)
  const live = OPS === LIVE
  const all = useMemo(() => (series ? Object.keys(series.days).sort() : []), [series])
  const [date, setDate] = useState(null)
  const [region, setRegion] = useState('BoB')
  const [range, setRange] = useState('quarter')
  const [depthK, setDepthK] = useState(DEPTHS.indexOf(100))
  const [mapLayer, setMapLayer] = useState('temp')

  useEffect(() => { if (all.length && (!date || !(date in series.days))) setDate(all[all.length - 1]) }, [all, date, series])

  const n = RANGES.find((r) => r[0] === range)[2]
  const dates = useMemo(() => (date ? all.filter((d) => d > addDays(date, -n) && d <= date) : []), [all, date, n])
  const rec = (d) => series?.days[d]?.[region]
  const pick = (key) => dates.map((d) => rec(d)?.[key] ?? NaN)
  const pickK = (key, k) => dates.map((d) => rec(d)?.[key]?.[k] ?? NaN)
  const today = date && rec(date), before = date && rec(addDays(date, -7))

  const mapped = date && ops && ops.dayIndex[date] != null
  const day = useDay(mapped ? ops : null, mapped ? date : null)
  const layer = layerById[mapLayer]
  const grid = useMemo(() => (ops && day ? layerGrid(ops, day, mapLayer, depthK) : null), [ops, day, mapLayer, depthK])
  const crange = useMemo(() => grid && robustRange(grid), [grid])
  const url = useMemo(() => grid && renderGrid(ops.grid, grid, layer.ramp, crange), [grid, crange]) // eslint-disable-line react-hooks/exhaustive-deps

  const modeSwitch = (
    <div className="seg" role="group" aria-label="Mode">
      <button aria-pressed={mode === 'live'} onClick={() => { setMode('live'); setDate(null) }}>
        <span className={`mr-1.5 inline-block h-[7px] w-[7px] rounded-full ${liveDown ? 'bg-line2' : 'bg-heat'} align-middle`} />Live</button>
      <button aria-pressed={mode === 'replay'} onClick={() => { setMode('replay'); setDate(null) }}>2023 replay</button>
    </div>
  )
  if (!series || !date) {
    return <div className="page pt-16"><SectionHead as="h1" label="Daily forecast" title="Loading the daily pipeline…" /><div className="mt-6">{modeSwitch}</div></div>
  }
  const run = index?.runs?.[date]
  const minValid = run ? Math.min(...Object.values(run.inputs_valid)) : NaN
  const z = DEPTHS[depthK]

  return (
    <div className="page pb-10 pt-12">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <SectionHead as="h1" label={`${live ? 'Live' : '2023 replay'} · ${all.length} days in the cache · ${fmtDate(all[0])} – ${fmtDate(all[all.length - 1])}`}
          title="Each day's satellite data in, the ocean below out">
          {live
            ? <>Four times a day the pipeline checks every satellite feed. As soon as a new day of surface data is published, the Sylithe Ocean Model
              predicts the ocean beneath it, from the surface to 1000 m, and stores the result; when late inputs arrive, recent days are predicted again.
              {status && <> Last update {ago(status.updated_at)}; newest prediction {fmtDate(status.last_predicted)}.</>}</>
            : <>2023 replayed day by day with the reprocessed inputs, exactly as the pipeline runs; the model never saw this year in training.
              This is the setting of every score on the Research page.</>}
        </SectionHead>
        <div className="pt-7">{modeSwitch}</div>
      </div>
      {liveDown && <p className="mt-4 border-l-2 border-heat pl-3 text-[13px] text-heat">The live feed is not reachable yet (the scheduled job has not
        published). Showing the 2023 replay.</p>}
      {live && <LiveStatus status={status} skill={skill} />}

      {/* controls */}
      <div className="mt-8 flex flex-wrap items-end gap-4 border-y border-line py-4">
        <label className="flex flex-col gap-1">
          <span className="label">Date</span>
          <input type="date" value={date} min={all[0]} max={all[all.length - 1]} onChange={(e) => e.target.value && setDate(e.target.value)}
            className="num h-9 rounded-[7px] border border-line bg-paper px-2.5 text-[13px] text-ink focus:border-sea focus:outline-none" />
        </label>
        <Select label="Region" value={region} onChange={setRegion}>
          {Object.entries(REGIONS).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}
        </Select>
        <Select label="Depth for temperature" value={depthK} onChange={(v) => setDepthK(+v)}>
          {DEPTHS.map((d, k) => <option key={d} value={k}>{d} m</option>)}
        </Select>
        <div className="flex flex-col gap-1">
          <span className="label">Range</span>
          <div className="seg h-9">
            {RANGES.map(([k, l]) => <button key={k} aria-pressed={range === k} onClick={() => setRange(k)}>{l}</button>)}
          </div>
        </div>
        <div className="w-full text-[12px] text-mute sm:ml-auto sm:w-auto sm:text-right">
          {run ? <>
            <p><span className="mr-1.5 inline-block h-[7px] w-[7px] rounded-full bg-sea align-middle" />
              {run.revision ? `Predicted ${run.revision + 1} times as inputs arrived` : 'Computed once, served from cache'}</p>
            <p className="num text-[11px] text-faint">{run.members}-model ensemble · {run.window}-day input window · inputs {Math.round(minValid * 100)}–100 % valid</p>
          </> : <p>Not in the cache</p>}
        </div>
      </div>

      {/* today */}
      {today && (
        <div className="grid grid-cols-2 gap-y-6 border-b border-line py-6 sm:grid-cols-3 lg:grid-cols-6 [&>*]:min-w-0">
          <Kpi label="Sea surface temp." value={today.sst} prev={before?.sst} unit="°C" dp={2} />
          <Kpi label={`Temperature, ${z} m`} value={today.T[depthK]} prev={before?.T[depthK]} unit="°C" dp={2} />
          <Kpi label={`Uncertainty, ${z} m`} value={today.sigma[depthK]} prev={before?.sigma[depthK]} unit="± °C" dp={2} />
          <Kpi label="26 °C isotherm (D26)" value={today.d26} prev={before?.d26} unit="m" dp={0} />
          <Kpi label="Mixed layer depth" value={today.mld} prev={before?.mld} unit="m" dp={0} />
          <Kpi label="Cyclone heat potential" value={today.tchp} prev={before?.tchp} unit="kJ cm⁻²" dp={0} alert={today.tchp >= 50} />
        </div>
      )}

      {/* model output */}
      <section className="pt-10">
        <SectionHead label="Model prediction" title={`${REGIONS[region].label}, regional mean`} />
        <div className="mt-6 grid gap-x-10 gap-y-9 lg:grid-cols-2 [&>*]:min-w-0">
          <div>
            <p className="mb-2 text-[13px] text-ink">Temperature at {z} m <span className="text-faint">· with ±1σ</span></p>
            <TimeSeries dates={dates} unit="°C" marker={date} series={[{
              label: `${z} m`, color: SEA, values: pickK('T', depthK),
              band: [dates.map((d, i) => pickK('T', depthK)[i] - pickK('sigma', depthK)[i]), dates.map((d, i) => pickK('T', depthK)[i] + pickK('sigma', depthK)[i])],
            }]} />
          </div>
          <div>
            <p className="mb-2 text-[13px] text-ink">Cyclone heat potential <span className="text-faint">· kJ cm⁻²</span></p>
            <TimeSeries dates={dates} unit="kJ cm⁻²" dp={0} marker={date} threshold={{ value: 50, label: 'rapid-intensification support ≥ 50' }}
              series={[{ label: 'TCHP', color: HEAT, values: pick('tchp') }]} />
          </div>
          <div>
            <p className="mb-2 text-[13px] text-ink">Isotherm depths <span className="text-faint">· m, deeper is lower</span></p>
            <TimeSeries dates={dates} unit="m" dp={0} marker={date} invert series={[
              { label: 'D26', color: HEAT, values: pick('d26') }, { label: 'D20 thermocline', color: COLD, values: pick('d20') }]} />
          </div>
          <div>
            <p className="mb-2 text-[13px] text-ink">Mixed layer depth <span className="text-faint">· m</span></p>
            <TimeSeries dates={dates} unit="m" dp={0} marker={date} invert series={[{ label: 'MLD', color: INK, values: pick('mld') }]} />
          </div>
          <div className="lg:col-span-2">
            <p className="mb-2 text-[13px] text-ink">Warming and cooling through the upper 300 m <span className="text-faint">· regional mean, difference from the average over the range at each depth (red warmer, blue cooler)</span></p>
            <DepthTimeMean dates={dates} cols={dates.map((d) => rec(d)?.T ?? [])} />
          </div>
        </div>
      </section>

      {/* inputs */}
      <section className="pt-14">
        <SectionHead label="Satellite inputs" title="What the model read" />
        <div className="mt-6 grid gap-x-10 gap-y-9 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
          {INPUTS.map(([k, label, unit, dp, src]) => (src = live ? { sst: 'OSTIA NRT', sss: 'SMOS/SMAP NRT', sla: 'DUACS NRT', cur: 'DUACS geostrophic', wind: 'ASCAT blend' }[k] : src) && (
            <div key={k}>
              <p className="mb-2 text-[13px] text-ink">{label} <span className="text-faint">· {unit} · {src}</span></p>
              <TimeSeries dates={dates} unit={unit} dp={dp} marker={date} height={150} series={[{ label, color: INK, values: pick(k) }]} />
            </div>
          ))}
        </div>
      </section>

      {/* map of the day */}
      <section className="pt-14">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHead label={`Map · ${fmtDate(date)}`} title={layer.perDepth ? `${layer.label} at ${z} m` : layer.label} />
          <div className="seg">
            {MAP_LAYERS.map((l) => <button key={l} aria-pressed={mapLayer === l} onClick={() => setMapLayer(l)}>{layerById[l].short ?? layerById[l].label}</button>)}
          </div>
        </div>
        {mapped ? (
          <div className="mt-4">
            <div className="relative h-[460px] overflow-hidden rounded-[10px] border border-line">
              {ops && <OceanMap g={ops.grid} url={url} grid={grid} region={region} basemap="satellite" scrollZoom={false} padding={[12, 12]} />}
            </div>
            {crange && <Legend layer={layer} range={crange} width={260} className="mt-3" />}
          </div>
        ) : (
          <div className="mt-4 rounded-[10px] border border-line px-5 py-6 text-[13px] text-mute">
            Statistics are kept for every day; full maps are published for the most recent {ops?.days.length ?? 31} days to keep the site light.
            {ops && <button className="link ml-2" onClick={() => setDate(ops.days[ops.days.length - 1].date)}>Show the latest mapped day</button>}
          </div>
        )}
      </section>

      {/* run log */}
      <section className="pt-14">
        <SectionHead label="Pipeline log" title="Recent runs" />
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead><tr className="border-b border-line text-left">
              {['Day', 'Computed (UTC)', 'Revision', 'Ensemble', 'Window', 'SST', 'SSS', 'SLA', 'Currents', 'Winds'].map((h) => <th key={h} className="label py-2 pr-4 font-normal">{h}</th>)}
            </tr></thead>
            <tbody>
              {all.filter((d) => d <= date).slice(-8).reverse().map((d) => {
                const r = index?.runs?.[d]
                const pct = (v) => (r ? (r.missing_today?.includes(v) ? 'pending' : `${Math.round(r.inputs_valid[v] * 100)} %`) : '—')
                return (
                  <tr key={d} className={`border-b border-line ${d === date ? 'bg-seatint/50' : ''}`}>
                    <td className="num py-2 pr-4 text-ink">{d}</td>
                    <td className="num py-2 pr-4 text-mute">{r?.computed_at?.replace('T', ' ').slice(0, 16) ?? '—'}</td>
                    <td className="num py-2 pr-4">{r?.revision != null ? (r.revision ? `${r.revision} (updated)` : 'first') : '—'}</td>
                    <td className="num py-2 pr-4">{r?.members ?? '—'} models</td>
                    <td className="num py-2 pr-4">{r?.window ?? '—'} d</td>
                    {['sst', 'sss', 'sla', 'uc', 'uw'].map((v) => <td key={v} className="num py-2 pr-4 text-mute">{pct(v)}</td>)}
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[11.5px] text-faint">Input columns: share of ocean cells with valid data that day. Missing inputs are handled by the model and widen its uncertainty.</p>
        </div>
      </section>
    </div>
  )
}
