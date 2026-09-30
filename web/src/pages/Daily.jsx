import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, FileUp, Layers, MousePointer2, Pentagon, Square, Trash2 } from 'lucide-react'
import OceanMap from '../components/map/OceanMap'
import AoiTools from '../components/map/AoiTools'
import Legend from '../components/map/Legend'
import TimeSeries from '../components/charts/TimeSeries'
import ProfileChart from '../components/charts/ProfileChart'
import DepthTimeChart from '../components/charts/DepthTimeChart'
import { SectionHead } from '../components/ui'
import { useDay, useDays, useJSON, useManifest } from '../lib/data'
import { DEPTHS, REGIONS, fmt, fmtDate, fmtLat, fmtLon, layerById, layerGrid, renderGrid, robustRange } from '../lib/ocean'
import { areaKm2, downloadCsv, maskFor, polygon, presetAoi, readAoiFiles, rectangle, summarise } from '../lib/aoi'

const REPLAY = '/data/ops'
// Live feed: the `live-data` branch written by .github/workflows/live.yml (override with VITE_LIVE_BASE)
const LIVE = import.meta.env.VITE_LIVE_BASE || 'https://raw.githubusercontent.com/karan27-dev/Sylithe_Ocean_Embedding/live-data/web'
const ago = (iso) => {
  const h = (Date.now() - Date.parse(iso)) / 36e5
  return h < 1 ? `${Math.round(h * 60)} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`
}
const RANGES = [['week', 'Week', 7], ['month', 'Month', 30], ['quarter', 'Quarter', 91], ['year', 'Year', 365]]
const SEA = 'rgb(var(--sea))', INK = 'rgb(var(--ink))', HEAT = 'rgb(var(--heat))', COLD = 'rgb(var(--cold))'
const addDays = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10)
const MAP_LAYERS = [
  ['Prediction', ['temp', 'sigma']],
  ['Derived', ['tchp', 'd26', 'd20', 'mld']],
  ['Satellite input', ['sst', 'sss', 'sla', 'cur', 'wind']],
]

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

function Kpi({ label, value, prev, unit, dp, alert, note }) {
  const d = Number.isFinite(value) && Number.isFinite(prev) ? value - prev : NaN
  return (
    <div className="min-w-0 rounded-[10px] border border-line bg-paper px-4 py-3">
      <p className="label truncate">{label}</p>
      <p className={`num mt-1.5 text-[24px] leading-none ${alert ? 'text-heat' : 'text-ink'}`}>{fmt(value, dp)}
        <span className="ml-1 text-[11px] text-faint">{unit}</span></p>
      <p className="num mt-1.5 text-[11px] text-mute">{Number.isFinite(d) ? `${d >= 0 ? '▲ +' : '▼ '}${d.toFixed(dp)} vs 7 days before` : note ?? '—'}</p>
    </div>
  )
}

function Card({ title, sub, actions, children, className = '' }) {
  return (
    <section className={`min-w-0 rounded-[12px] border border-line bg-white/40 p-4 sm:p-5 ${className}`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0"><h3 className="text-[14px] text-ink">{title}</h3>{sub && <p className="mt-0.5 text-[11.5px] text-mute">{sub}</p>}</div>
        {actions}
      </div>
      {children}
    </section>
  )
}

const CsvBtn = ({ onClick }) => (
  <button onClick={onClick} className="inline-flex shrink-0 items-center gap-1 text-[11.5px] text-mute hover:text-ink"><Download size={13} />CSV</button>
)

function ToolBtn({ on, onClick, title, children }) {
  return (
    <button onClick={onClick} title={title} aria-pressed={on}
      className={`flex h-9 items-center gap-1.5 rounded-[8px] border px-2.5 text-[12px] backdrop-blur transition-colors ${on ? 'border-[#A3E635] bg-ink text-[#A3E635]' : 'border-white/20 bg-ink/75 text-paper hover:bg-ink'}`}>
      {children}
    </button>
  )
}

export default function Daily() {
  const [mode, setMode] = useState('live')
  const liveM = useManifest(LIVE)
  const liveDown = mode === 'live' && liveM.error
  const OPS = mode === 'live' && !liveDown ? LIVE : REPLAY
  const live = OPS === LIVE
  const { m: ops } = useManifest(OPS)
  const series = useJSON('series.json', OPS)
  const index = useJSON('index.json', OPS)
  const status = useJSON('status.json', LIVE)
  const skill = useJSON('skill.json', LIVE)

  const all = useMemo(() => (series ? Object.keys(series.days).sort() : []), [series])
  const mapped = useMemo(() => ops?.days.map((d) => d.date) ?? [], [ops])
  const [date, setDate] = useState(null)
  const [area, setArea] = useState('BoB')               // NIO | BoB | AS | custom
  const [custom, setCustom] = useState(null)           // { geojson, name, format }
  const [range, setRange] = useState('month')
  const [depthK, setDepthK] = useState(DEPTHS.indexOf(100))
  const [layer, setLayer] = useState('temp')
  const [opacity, setOpacity] = useState(0.85)
  const [basemap, setBasemap] = useState('satellite')
  const [panel, setPanel] = useState(true)
  const [draw, setDraw] = useState(null)
  const [probe, setProbe] = useState(null)
  const [dtMode, setDtMode] = useState('abs')
  const [zmax, setZmax] = useState(500)
  const [err, setErr] = useState(null)
  const fileRef = useRef(null)

  useEffect(() => { if (all.length && (!date || !(date in series.days))) setDate(all[all.length - 1]) }, [all, date, series])

  const isCustom = area === 'custom' && custom
  const aoi = isCustom ? custom.geojson : presetAoi(area === 'custom' ? 'BoB' : area)
  const idx = useMemo(() => (ops && isCustom ? maskFor(ops.grid, custom.geojson) : null), [ops, isCustom, custom])

  // days the charts cover: presets use the pipeline's statistics (every cached day), a custom area the mapped days
  const pool = isCustom ? mapped : all
  const n = RANGES.find((r) => r[0] === range)[2]
  const dates = useMemo(() => (date ? pool.filter((d) => d > addDays(date, -n) && d <= date) : []), [pool, date, n])
  // a custom area needs every day's grid: fetch the selected day and its comparisons first, then the range, newest first
  const want = useMemo(() => {
    if (!isCustom || !date) return null
    const first = [date, addDays(date, -7), addDays(date, -30), ...[...dates].reverse()]
    return [...new Set([...first, ...[...mapped].reverse()])].filter((d) => mapped.includes(d))
  }, [isCustom, date, dates, mapped])
  const loaded = useDays(isCustom ? ops : null, want)
  const loading = isCustom && want ? want.length - loaded.length : 0
  const customRecs = useMemo(() => (isCustom && idx ? Object.fromEntries(loaded.map((d) => [d.date, summarise(ops, d, idx)])) : {}), [isCustom, idx, loaded, ops])
  const rec = (d) => (isCustom ? customRecs[d] : series?.days[d]?.[area])
  const pick = (key) => dates.map((d) => rec(d)?.[key] ?? NaN)
  const pickK = (key, k) => dates.map((d) => rec(d)?.[key]?.[k] ?? NaN)

  const day = useDay(ops && mapped.includes(date) ? ops : null, mapped.includes(date) ? date : null)
  const L_ = layerById[layer]
  const grid = useMemo(() => (ops && day ? layerGrid(ops, day, layer, depthK) : null), [ops, day, layer, depthK])
  const crange = useMemo(() => grid && robustRange(grid, L_.symmetric), [grid, L_.symmetric])
  const url = useMemo(() => grid && renderGrid(ops.grid, grid, L_.ramp, crange), [grid, crange]) // eslint-disable-line react-hooks/exhaustive-deps

  const modeSwitch = (
    <div className="seg" role="group" aria-label="Mode">
      <button aria-pressed={mode === 'live'} onClick={() => { setMode('live'); setDate(null); setProbe(null) }}>
        <span className={`mr-1.5 inline-block h-[7px] w-[7px] rounded-full ${liveDown ? 'bg-line2' : 'bg-heat animate-pulse'} align-middle`} />Live</button>
      <button aria-pressed={mode === 'replay'} onClick={() => { setMode('replay'); setDate(null); setProbe(null) }}>2023 replay</button>
    </div>
  )
  if (!series || !date) {
    return <div className="page pt-16"><SectionHead as="h1" label="Daily forecast" title="Loading the daily pipeline…" /><div className="mt-6">{modeSwitch}</div></div>
  }

  const today = rec(date), before = rec(addDays(date, -7)), month = rec(addDays(date, -30))
  const run = index?.runs?.[date]
  const areaLabel = isCustom ? custom.name : REGIONS[area].label
  const z = DEPTHS[depthK]
  const km2 = areaKm2(aoi)

  const onFiles = async (files) => {
    setErr(null)
    try { const r = await readAoiFiles(files); setCustom(r); setArea('custom'); setDraw(null) } catch (e) { setErr(e.message) }
  }
  const onDrawn = (g) => {
    setCustom({ geojson: g.kind === 'rect' ? rectangle(g.bounds) : polygon(g.points), name: g.kind === 'rect' ? 'Drawn rectangle' : 'Drawn polygon', format: 'drawn' })
    setArea('custom'); setDraw(null)
  }
  const exportAoi = () => {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([JSON.stringify(aoi)], { type: 'application/geo+json' })), download: 'sylithe_ocean_aoi.geojson' })
    a.click(); URL.revokeObjectURL(a.href)
  }
  const seriesCsv = () => downloadCsv(`sylithe_ocean_${area}_${dates[0]}_${dates[dates.length - 1]}.csv`,
    ['date', 'sst', 'sss', 'sla', 'current', 'wind', 'tchp', 'd26', 'd20', 'mld', ...DEPTHS.map((d) => `T_${d}m`), ...DEPTHS.map((d) => `sigma_${d}m`)],
    dates.map((d) => { const r = rec(d) ?? {}; return [d, r.sst, r.sss, r.sla, r.cur, r.wind, r.tchp, r.d26, r.d20, r.mld, ...(r.T ?? DEPTHS.map(() => NaN)), ...(r.sigma ?? DEPTHS.map(() => NaN))] }))
  const profileCsv = () => downloadCsv(`sylithe_ocean_profile_${area}_${date}.csv`, ['depth_m', 'temperature_C', 'sigma_C', 'minus_7d_C', 'minus_30d_C'],
    DEPTHS.map((d, k) => [d, today?.T?.[k], today?.sigma?.[k], before?.T?.[k], month?.T?.[k]]))

  const probeCol = probe && day ? DEPTHS.map((_, k) => day.temp[k * ops.N + probe.i]) : null
  const probeSig = probe && day?.sigma ? DEPTHS.map((_, k) => day.sigma[k * ops.N + probe.i]) : null

  return (
    <div className="page pb-12 pt-10">
      {/* ------------------------------------------------ header */}
      <div className="flex flex-wrap items-start justify-between gap-6">
        <SectionHead as="h1" label={`${live ? 'Live' : '2023 replay'} · ${all.length} days predicted · ${fmtDate(all[0])} – ${fmtDate(all[all.length - 1])}`}
          title="Daily ocean forecast, surface to 1000 m">
          {live
            ? <>Every six hours the pipeline checks the satellite feeds; each new day of surface data is turned into a temperature forecast for 15 depths,
              and recent days are updated when late inputs arrive. {status && <>Updated {ago(status.updated_at)}.</>}</>
            : <>2023 replayed day by day with reprocessed inputs, the setting of every score on the Research page.</>}
        </SectionHead>
        <div className="pt-7">{modeSwitch}</div>
      </div>
      {liveDown && <p className="mt-4 border-l-2 border-heat pl-3 text-[13px] text-heat">The live feed is not reachable yet. Showing the 2023 replay.</p>}
      {live && <LiveStatus status={status} skill={skill} />}

      {/* ------------------------------------------------ controls */}
      <div className="sticky top-[var(--bar)] z-[900] -mx-4 mt-6 flex flex-wrap items-end gap-3 border-y border-line bg-paper/95 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8 lg:-mx-12 lg:px-12">
        <label className="flex flex-col gap-1"><span className="label">Date</span>
          <input type="date" value={date} min={all[0]} max={all[all.length - 1]} onChange={(e) => e.target.value && setDate(e.target.value)}
            className="num h-9 rounded-[7px] border border-line bg-paper px-2.5 text-[13px] text-ink focus:border-sea focus:outline-none" /></label>
        <label className="flex flex-col gap-1"><span className="label">Area</span>
          <select value={area} onChange={(e) => setArea(e.target.value)}
            className="h-9 rounded-[7px] border border-line bg-paper px-2.5 text-[13px] text-ink focus:border-sea focus:outline-none">
            {Object.entries(REGIONS).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}
            <option value="custom" disabled={!custom}>{custom ? `Custom · ${custom.name}` : 'Custom area (import or draw on the map)'}</option>
          </select></label>
        <label className="flex flex-col gap-1"><span className="label">Depth</span>
          <select value={depthK} onChange={(e) => setDepthK(+e.target.value)}
            className="h-9 rounded-[7px] border border-line bg-paper px-2.5 text-[13px] text-ink focus:border-sea focus:outline-none">
            {DEPTHS.map((d, k) => <option key={d} value={k}>{d} m</option>)}</select></label>
        <div className="flex flex-col gap-1"><span className="label">Range</span>
          <div className="seg h-9">{RANGES.map(([k, l]) => <button key={k} aria-pressed={range === k} onClick={() => setRange(k)}>{l}</button>)}</div></div>
        <div className="ml-auto text-right text-[11.5px] text-mute">
          {run && <p className="num">{run.members}-model ensemble · {run.window}-day window · {run.revision ? `update ${run.revision}` : 'first prediction'}</p>}
          {isCustom && <p>Custom area: {dates.length} mapped day(s) in range</p>}
        </div>
      </div>

      {/* ------------------------------------------------ KPIs */}
      <p className="label mt-6">{areaLabel} · {fmtDate(date)} · area mean</p>
      {today ? (
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Sea surface temp." value={today.sst} prev={before?.sst} unit="°C" dp={2} />
          <Kpi label={`Temperature ${z} m`} value={today.T[depthK]} prev={before?.T[depthK]} unit="°C" dp={2} />
          <Kpi label={`Uncertainty ${z} m`} value={today.sigma[depthK]} prev={before?.sigma[depthK]} unit="± °C" dp={2} />
          <Kpi label="26 °C isotherm" value={today.d26} prev={before?.d26} unit="m" dp={0} />
          <Kpi label="Mixed layer" value={today.mld} prev={before?.mld} unit="m" dp={0} />
          <Kpi label="Cyclone heat (TCHP)" value={today.tchp} prev={before?.tchp} unit="kJ cm⁻²" dp={0} alert={today.tchp >= 50}
            note={Number.isFinite(today.tchp_ge50) ? `${Math.round(today.tchp_ge50 * 100)} % of area ≥ 50` : null} />
        </div>
      ) : <p className="mt-2 text-[13px] text-mute">{isCustom ? 'The custom area has maps only for the most recent days: pick one of them, or a preset region.' : 'No data for this day.'}</p>}

      {/* ------------------------------------------------ map workspace */}
      <div className="relative mt-6 h-[640px] overflow-hidden rounded-[14px] border border-line">
        {ops && (
          <OceanMap g={ops.grid} url={url} grid={grid} region="NIO" showRegion={false} basemap={basemap} opacity={opacity} scrollZoom
            onPick={draw ? null : (c) => setProbe(c)} probe={probe} padding={[20, 20]}>
            <AoiTools aoi={aoi} mode={draw} onDone={onDrawn} />
          </OceanMap>
        )}

        {/* layer panel */}
        <div className="absolute left-3 top-3 z-[700] w-[248px]">
          <button onClick={() => setPanel((p) => !p)} className="flex w-full items-center justify-between rounded-t-[10px] border border-line bg-paper/95 px-3 py-2 text-[12.5px] text-ink backdrop-blur">
            <span className="flex items-center gap-2"><Layers size={14} />Layers</span><span className="text-faint">{panel ? '−' : '+'}</span></button>
          {panel && (
            <div className="max-h-[520px] overflow-y-auto rounded-b-[10px] border border-t-0 border-line bg-paper/95 px-3 pb-3 backdrop-blur">
              {MAP_LAYERS.map(([g, ids]) => (
                <div key={g} className="pt-3">
                  <p className="label mb-1">{g}</p>
                  {ids.map((id) => {
                    const l = layerById[id], ok = day && layerGrid(ops, day, id, depthK)
                    return (
                      <label key={id} className={`flex cursor-pointer items-center gap-2 rounded-[6px] px-1.5 py-1 text-[12.5px] ${layer === id ? 'bg-seatint text-ink' : 'text-ink2 hover:bg-wash'} ${ok ? '' : 'opacity-40'}`}>
                        <input type="radio" name="layer" checked={layer === id} disabled={!ok} onChange={() => setLayer(id)} className="accent-[rgb(var(--sea))]" />
                        {l.label}{l.perDepth && <span className="ml-auto num text-[10.5px] text-faint">{z} m</span>}
                      </label>
                    )
                  })}
                </div>
              ))}
              {L_.perDepth && (
                <div className="pt-3"><p className="label mb-1">Depth · {z} m</p>
                  <input type="range" className="slider w-full" min={0} max={DEPTHS.length - 1} value={depthK} onChange={(e) => setDepthK(+e.target.value)} /></div>
              )}
              <div className="pt-2"><p className="label mb-1">Opacity · {Math.round(opacity * 100)} %</p>
                <input type="range" className="slider w-full" min={0.2} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(+e.target.value)} /></div>
              <div className="pt-3"><p className="label mb-1">Basemap</p>
                <div className="seg w-full">{[['satellite', 'Satellite'], ['light', 'Map']].map(([k, l]) =>
                  <button key={k} className="flex-1" aria-pressed={basemap === k} onClick={() => setBasemap(k)}>{l}</button>)}</div></div>
            </div>
          )}
        </div>

        {/* AOI toolbar */}
        <div className="absolute right-14 top-3 z-[700] flex flex-wrap justify-end gap-1.5">
          <ToolBtn onClick={() => fileRef.current?.click()} title="Import KML, KMZ, GeoJSON or a zipped shapefile"><FileUp size={14} />Import AOI</ToolBtn>
          <input ref={fileRef} type="file" multiple accept=".kml,.kmz,.geojson,.json,.zip,.shp,.dbf,.prj,.shx" className="hidden"
            onChange={(e) => { e.target.files?.length && onFiles(e.target.files); e.target.value = '' }} />
          <ToolBtn on={draw === 'rect'} onClick={() => setDraw(draw === 'rect' ? null : 'rect')} title="Drag to draw a rectangle"><Square size={14} />Rectangle</ToolBtn>
          <ToolBtn on={draw === 'poly'} onClick={() => setDraw(draw === 'poly' ? null : 'poly')} title="Click points; double-click to finish"><Pentagon size={14} />Polygon</ToolBtn>
          <ToolBtn on={!draw} onClick={() => setDraw(null)} title="Click the ocean to read a point"><MousePointer2 size={14} />Probe</ToolBtn>
          {custom && <ToolBtn onClick={() => { setCustom(null); setArea('BoB') }} title="Remove the custom area"><Trash2 size={14} /></ToolBtn>}
          <ToolBtn onClick={exportAoi} title="Download the area as GeoJSON"><Download size={14} /></ToolBtn>
        </div>
        {draw && <p className="absolute left-1/2 top-16 z-[700] -translate-x-1/2 rounded-full bg-ink/85 px-3 py-1.5 text-[12px] text-paper">
          {draw === 'rect' ? 'Press and drag to draw a rectangle' : 'Click to add points · double-click or click the first point to finish'}</p>}
        {err && <p className="absolute left-1/2 top-16 z-[700] -translate-x-1/2 rounded-full bg-heat px-3 py-1.5 text-[12px] text-paper">{err}</p>}

        {/* area card + legend */}
        <div className="absolute bottom-3 left-3 z-[700] rounded-[10px] border border-line bg-paper/95 px-3 py-2.5 backdrop-blur">
          {crange && <Legend layer={L_} range={crange} width={230} marks={layer === 'tchp' ? [{ v: 50, label: '50 kJ cm⁻²' }] : []} />}
          <p className="mt-1.5 text-[11px] text-mute">{mapped.includes(date) ? `${L_.label}${L_.perDepth ? ` at ${z} m` : ''} · ${fmtDate(date)}` : `No map for ${fmtDate(date)}: maps cover the last ${mapped.length} days`}</p>
        </div>
        <div className="absolute bottom-3 right-3 z-[700] max-w-[260px] rounded-[10px] border border-line bg-paper/95 px-3 py-2.5 text-[12px] backdrop-blur">
          <p className="label">Area of interest</p>
          <p className="mt-0.5 truncate text-ink">{areaLabel}</p>
          <p className="num text-[11px] text-mute">{Math.round(km2).toLocaleString('en-IN')} km²{isCustom && idx ? ` · ${idx.length} grid cells` : ''}{isCustom ? ` · ${custom.format}` : ' · preset'}</p>
        </div>
        {probe && probeCol && (
          <div className="absolute right-3 top-16 z-[700] w-[270px] rounded-[10px] border border-line bg-paper/95 p-3 backdrop-blur">
            <div className="flex items-baseline justify-between"><p className="label">Point · {fmtLat(probe.lat)} {fmtLon(probe.lon)}</p>
              <button onClick={() => setProbe(null)} className="text-[11px] text-mute hover:text-ink">Close</button></div>
            <ProfileChart main={{ label: 'Prediction', values: probeCol, sigma: probeSig }} height={230} />
          </div>
        )}
      </div>

      {/* ------------------------------------------------ depth-wise prediction */}
      <div className="mt-12 flex flex-wrap items-end justify-between gap-4">
        <SectionHead label="Depth-wise prediction" title={`The water column under ${areaLabel}`}>
          How temperature changes with depth on {fmtDate(date)}, how that column evolved over the selected range, and how sure the model is at each level.
        </SectionHead>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <Card title="Temperature profile" sub="Area mean with ±1σ; the same area 7 and 30 days earlier" actions={<CsvBtn onClick={profileCsv} />}>
          {today?.T ? (
            <>
              <ProfileChart height={380} main={{ label: fmtDate(date), values: today.T, sigma: today.sigma }}
                others={[before?.T && { label: '7 days before', values: before.T, style: 'dashed' }, month?.T && { label: '30 days before', values: month.T, style: 'faint' }].filter(Boolean)}
                mld={today.mld} />
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-mute">
                <span><span className="mr-1.5 inline-block w-4 border-t-[1.5px] border-ink align-middle" />{fmtDate(date)}</span>
                <span><span className="mr-1.5 inline-block h-2 w-4 bg-sea/15 align-middle" />±1σ</span>
                {before?.T && <span><span className="mr-1.5 inline-block w-4 border-t border-dashed border-mute align-middle" />7 days before</span>}
                {month?.T && <span><span className="mr-1.5 inline-block w-4 border-t border-line2 align-middle" />30 days before</span>}
              </div>
            </>
          ) : <p className="text-[12px] text-faint">No profile for this day.</p>}
        </Card>
        <Card title="Depth over time" sub={`${areaLabel}, ${fmtDate(dates[0] ?? date)} – ${fmtDate(date)}`}
          actions={<div className="flex gap-2">
            <div className="seg">{[['abs', 'Temperature'], ['anom', 'Change']].map(([k, l]) => <button key={k} aria-pressed={dtMode === k} onClick={() => setDtMode(k)}>{l}</button>)}</div>
            <div className="seg">{[[300, '300 m'], [500, '500 m'], [1000, '1000 m']].map(([k, l]) => <button key={k} aria-pressed={zmax === k} onClick={() => setZmax(k)}>{l}</button>)}</div>
          </div>}>
          <DepthTimeChart dates={dates} cols={dates.map((d) => rec(d)?.T)} mode={dtMode} zmax={zmax} height={340} />
        </Card>
      </div>

      <Card className="mt-5" title="Depth table" sub={`${areaLabel} · ${fmtDate(date)} · change against 7 and 30 days before${loading ? ` · loading ${loading} more days…` : ''}`}
        actions={<CsvBtn onClick={profileCsv} />}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[12.5px]">
            <thead><tr className="border-b border-line text-left">
              {['Depth', 'Temperature', 'Uncertainty (±1σ)', 'Change 7 days', 'Change 30 days', ''].map((h) => <th key={h} className="label py-2 pr-4 font-normal">{h}</th>)}</tr></thead>
            <tbody>{DEPTHS.map((d, k) => {
              const t = today?.T?.[k], s = today?.sigma?.[k], c7 = t - before?.T?.[k], c30 = t - month?.T?.[k]
              const w = Number.isFinite(s) ? Math.min(100, (s / 1.5) * 100) : 0
              return (
                <tr key={d} className={`border-b border-line ${k === depthK ? 'bg-seatint/50' : ''}`}>
                  <td className="num py-1.5 pr-4 text-ink">{d} m</td>
                  <td className="num py-1.5 pr-4">{fmt(t, 2)} °C</td>
                  <td className="num py-1.5 pr-4 text-mute">± {fmt(s, 2)}</td>
                  <td className={`num py-1.5 pr-4 ${c7 > 0.05 ? 'text-heat' : c7 < -0.05 ? 'text-cold' : 'text-mute'}`}>{Number.isFinite(c7) ? `${c7 >= 0 ? '+' : ''}${c7.toFixed(2)}` : loading ? '…' : '—'}</td>
                  <td className={`num py-1.5 pr-4 ${c30 > 0.05 ? 'text-heat' : c30 < -0.05 ? 'text-cold' : 'text-mute'}`}>{Number.isFinite(c30) ? `${c30 >= 0 ? '+' : ''}${c30.toFixed(2)}` : loading ? '…' : '—'}</td>
                  <td className="w-[160px] py-1.5"><div className="h-1.5 rounded-full bg-line"><div className="h-full rounded-full bg-sea/60" style={{ width: `${w}%` }} /></div></td>
                </tr>)
            })}</tbody>
          </table>
          <p className="mt-2 text-[11px] text-faint">Bar: predicted uncertainty (full bar = 1.5 °C). The thermocline levels (75–150 m) are always the least certain.</p>
        </div>
      </Card>

      {/* ------------------------------------------------ time series */}
      <div className="mt-12 flex flex-wrap items-end justify-between gap-4">
        <SectionHead label={`${RANGES.find((r) => r[0] === range)[1]} · ${dates.length} days`} title="How the forecast has evolved" />
        <CsvBtn onClick={seriesCsv} />
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card title={`Temperature at ${z} m`} sub="Area mean, ±1σ band">
          <TimeSeries dates={dates} unit="°C" marker={date} series={[{ label: `${z} m`, color: SEA, values: pickK('T', depthK),
            band: [dates.map((_, i) => pickK('T', depthK)[i] - pickK('sigma', depthK)[i]), dates.map((_, i) => pickK('T', depthK)[i] + pickK('sigma', depthK)[i])] }]} />
        </Card>
        <Card title="Temperature at several depths" sub="Surface, 50 m, 100 m, 200 m">
          <TimeSeries dates={dates} unit="°C" marker={date} series={[0, 50, 100, 200].map((dd, i) => ({
            label: `${dd} m`, values: pickK('T', DEPTHS.indexOf(dd)), color: ['#b4532a', '#c29a55', SEA, COLD][i] }))} />
          <div className="mt-2 flex flex-wrap gap-x-4 text-[11px] text-mute">{[0, 50, 100, 200].map((dd, i) => (
            <span key={dd}><span className="mr-1.5 inline-block h-[2px] w-4 align-middle" style={{ background: ['#b4532a', '#c29a55', SEA, COLD][i] }} />{dd} m</span>))}</div>
        </Card>
        <Card title="Cyclone heat potential" sub="kJ cm⁻²; above 50 the ocean can support rapid intensification">
          <TimeSeries dates={dates} unit="kJ cm⁻²" dp={0} marker={date} threshold={{ value: 50, label: '≥ 50 rapid intensification' }}
            series={[{ label: 'TCHP', color: HEAT, values: pick('tchp') }]} />
        </Card>
        <Card title="Isotherm and mixed-layer depths" sub="m; deeper is lower">
          <TimeSeries dates={dates} unit="m" dp={0} marker={date} invert series={[
            { label: 'Mixed layer', color: INK, values: pick('mld') }, { label: 'D26', color: HEAT, values: pick('d26') }, { label: 'D20 thermocline', color: COLD, values: pick('d20') }]} />
          <div className="mt-2 flex flex-wrap gap-x-4 text-[11px] text-mute">{[['Mixed layer', INK], ['26 °C isotherm', HEAT], ['20 °C isotherm', COLD]].map(([l, c]) => (
            <span key={l}><span className="mr-1.5 inline-block h-[2px] w-4 align-middle" style={{ background: c }} />{l}</span>))}</div>
        </Card>
      </div>

      {/* ------------------------------------------------ inputs */}
      <SectionHead className="mt-12" label="Satellite inputs" title="What the model read" />
      <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {[['sst', 'Sea surface temperature', '°C', 2, live ? 'OSTIA NRT' : 'OSTIA'], ['sss', 'Sea surface salinity', 'psu', 2, live ? 'SMOS/SMAP NRT' : 'SMOS/SMAP'],
          ['sla', 'Sea level anomaly', 'm', 3, live ? 'DUACS NRT' : 'DUACS'], ['cur', 'Surface current speed', 'm s⁻¹', 2, live ? 'DUACS geostrophic' : 'OSCAR'],
          ['wind', '10 m wind speed', 'm s⁻¹', 1, live ? 'ASCAT blend' : 'CCMP']].map(([k, label, unit, dp, src]) => (
          <Card key={k} title={label} sub={`${unit} · ${src}`}>
            <TimeSeries dates={dates} unit={unit} dp={dp} marker={date} height={150} series={[{ label, color: INK, values: pick(k) }]} />
          </Card>
        ))}
      </div>

      {/* ------------------------------------------------ run log */}
      <SectionHead className="mt-12" label="Pipeline log" title="Recent runs" />
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[760px] text-[12.5px]">
          <thead><tr className="border-b border-line text-left">
            {['Day', 'Computed (UTC)', 'Revision', 'Ensemble', 'Window', 'SST', 'SSS', 'SLA', 'Currents', 'Winds'].map((h) => <th key={h} className="label py-2 pr-4 font-normal">{h}</th>)}</tr></thead>
          <tbody>{all.filter((d) => d <= date).slice(-8).reverse().map((d) => {
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
              </tr>)
          })}</tbody>
        </table>
      </div>
    </div>
  )
}
