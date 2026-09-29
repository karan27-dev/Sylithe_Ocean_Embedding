import { useMemo, useState } from 'react'
import { useData } from '../App'
import OceanMap from '../components/map/OceanMap'
import Legend from '../components/map/Legend'
import DepthGauge from '../components/DepthGauge'
import Timeline from '../components/Timeline'
import ProbePanel from '../components/ProbePanel'
import { useDay } from '../lib/data'
import { useView } from '../lib/store'
import { DEPTHS, LAYERS, REGIONS, available, cellAt, fmt, fmtDate, fmtLat, fmtLon, layerById, layerGrid, renderGrid, robustRange } from '../lib/ocean'

const GROUPS = ['Subsurface', 'Derived', 'Surface input']
const MARKS = { tchp: [{ v: 50, label: 'Rapid-intensification threshold, 50 kJ cm⁻²' }], d26: [], d20: [] }

/** Round a colour range outward to a readable step so the legend ends on clean numbers. */
function niceRange([lo, hi], symmetric) {
  const span = hi - lo, step = span > 200 ? 50 : span > 40 ? 10 : span > 8 ? 1 : span > 2 ? 0.5 : span > 0.5 ? 0.1 : 0.02
  const r = [Math.floor(lo / step) * step, Math.ceil(hi / step) * step]
  return symmetric ? [-Math.max(-r[0], r[1]), Math.max(-r[0], r[1])] : r
}

export default function Explorer() {
  const { m } = useData()
  const v = useView()
  const day = useDay(m, v.date)
  const [hover, setHover] = useState(null)

  const layer = layerById[v.layer] && m && available(m, layerById[v.layer]) ? layerById[v.layer] : layerById.temp
  const grid = useMemo(() => (m && day ? layerGrid(m, day, layer.id, v.depth) : null), [m, day, layer.id, v.depth])
  const range = useMemo(() => grid && niceRange(robustRange(grid, layer.symmetric), layer.symmetric), [grid, layer.symmetric])
  const url = useMemo(() => grid && renderGrid(m.grid, grid, layer.ramp, range), [grid, range]) // eslint-disable-line react-hooks/exhaustive-deps
  const probeCell = m && v.probe ? cellAt(m.grid, v.probe.lat, v.probe.lon) : null

  if (!m) return <div className="h-[calc(100dvh-var(--bar))]" />

  const title = layer.perDepth ? <>{layer.label} <span className="text-mute">at</span> {DEPTHS[v.depth]} m</> : layer.label
  const pick = (c) => v.set({ probe: { lat: c.lat, lon: c.lon } })

  return (
    <div className="relative flex h-[calc(100dvh-var(--bar))] overflow-hidden">
      {/* depth rail (desktop) */}
      <aside className={`hidden w-[76px] shrink-0 flex-col items-center border-r border-line bg-paper pt-6 transition-opacity lg:flex ${layer.perDepth ? '' : 'opacity-40'}`}>
        <p className="label mb-4">Depth</p>
        <DepthGauge value={v.depth} onChange={(k) => v.set({ depth: k, layer: layer.perDepth ? layer.id : 'temp' })} length={Math.min(420, window.innerHeight - 260)} />
        {!layer.perDepth && <p className="mt-4 px-1.5 text-center text-[10px] leading-tight text-faint">Pick a depth for temperature</p>}
      </aside>

      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1">
          <OceanMap g={m.grid} url={url} grid={grid} probe={probeCell} onPick={pick} onHover={setHover} region={v.region}
            padding={[40, 40]} />

          {/* title plate */}
          <div className="pointer-events-none absolute left-3 top-3 z-[500] max-w-[min(360px,calc(100%-24px))] sm:left-5 sm:top-5">
            <div className="instrument pointer-events-auto px-4 py-3">
              <p className="label">{REGIONS[v.region].label} · {day ? fmtDate(day.date) : '—'}{m.source.kind !== 'model' && <span className="sm:hidden"> · reference</span>}</p>
              <h1 key={`${layer.id}${v.depth}`} className="display fade-in mt-1 text-[22px] leading-tight sm:text-[24px]">{title}</h1>
              <p className="mt-1.5 hidden text-[12px] leading-snug text-mute sm:block">{layer.help}</p>
              {m.source.kind !== 'model' && (
                <p className="mt-2 hidden border-t border-line pt-2 text-[11px] leading-snug text-mute sm:block">
                  Showing {m.source.label}, a reference field, until the reconstruction is exported.
                </p>
              )}
            </div>
          </div>

          {/* region framing */}
          <div className="absolute right-14 top-3 z-[500] hidden sm:right-[56px] sm:top-5 md:block">
            <div className="instrument flex items-center gap-4 px-3.5 py-2">
              {Object.entries(REGIONS).map(([k, r]) => (
                <button key={k} onClick={() => v.set({ region: k })} aria-pressed={v.region === k}
                  className={`text-[12px] transition-colors ${v.region === k ? 'text-ink' : 'text-mute hover:text-ink'}`}>{r.label}</button>
              ))}
            </div>
          </div>

          {/* hover readout follows the cursor */}
          {hover && hover.px && (
            <div className="pointer-events-none absolute z-[600] hidden rounded-[6px] border border-line bg-paper/95 px-2.5 py-1.5 sm:block"
              style={{ left: hover.px.x + 16, top: hover.px.y + 16 }}>
              {Number.isFinite(hover.v)
                ? <p className="num text-[13px] text-ink">{fmt(hover.v, layer.dp)} <span className="text-faint">{layer.unit}</span></p>
                : <p className="text-[12px] text-mute">Land or no data</p>}
              <p className="num text-[10.5px] text-faint">{fmtLat(hover.lat)} {fmtLon(hover.lon)}</p>
            </div>
          )}
        </div>

        {/* bottom dock */}
        <div className="z-[500] border-t border-line bg-paper">
          <div className="no-scrollbar flex items-end gap-6 overflow-x-auto px-4 pt-2.5 [mask-image:linear-gradient(90deg,#000_85%,transparent)] sm:px-5 sm:[mask-image:none]">
            {GROUPS.map((gname) => (
              <div key={gname} className="shrink-0">
                <p className="label mb-0.5 hidden sm:block">{gname}</p>
                <div className="flex gap-4" role="tablist" aria-label={gname}>
                  {LAYERS.filter((l) => l.group === gname).map((l) => {
                    const on = available(m, l)
                    return (
                      <button key={l.id} role="tab" aria-selected={layer.id === l.id} disabled={!on}
                        title={on ? l.help : `${l.label}: not in this export. Arrives with the model output (notebook 03).`}
                        onClick={() => v.set({ layer: l.id })}
                        className={`tab ${on ? '' : 'cursor-not-allowed !text-line2 max-sm:hidden'}`}>
                        {l.short ?? l.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-3 border-t border-line px-4 py-2.5 sm:px-5 md:flex-row md:items-center md:gap-8">
            <div className="lg:hidden">
              {layer.perDepth && <DepthGauge vertical={false} value={v.depth} onChange={(k) => v.set({ depth: k })} className="max-w-[420px]" />}
            </div>
            <Timeline days={m.days} value={v.date} onChange={(d) => v.set({ date: d })} className="min-w-0 flex-1 md:max-w-[520px]" />
            <div className="flex items-center gap-4 md:ml-auto">
              {day?.note && <p className="hidden text-[12px] text-mute xl:block">{day.note}</p>}
              {range && <Legend layer={layer} range={range} marks={MARKS[layer.id] ?? []} width={230} />}
            </div>
          </div>
        </div>
      </div>

      <ProbePanel cell={probeCell} day={day} onClose={() => v.set({ probe: null })} />
    </div>
  )
}
