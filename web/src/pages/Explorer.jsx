import { useMemo, useRef, useState } from 'react'
import { ArrowDown, Eye, EyeOff } from 'lucide-react'
import { CursorReadout, MapBtn, Side, field } from '../components/workspace'
import { useData } from '../App'
import OceanMap from '../components/map/OceanMap'
import Legend from '../components/map/Legend'
import DepthGauge from '../components/DepthGauge'
import Timeline from '../components/Timeline'
import ProbePanel from '../components/ProbePanel'
import { useDay } from '../lib/data'
import { useView } from '../lib/store'
import { DEPTHS, LAYERS, REGIONS, available, cellAt, fmtDate, layerById, layerGrid, renderGrid, robustRange } from '../lib/ocean'

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
  const hoverRef = useRef(null)
  const [visible, setVisible] = useState(true)
  const [opacity, setOpacity] = useState(0.9)

  const layer = layerById[v.layer] && m && available(m, layerById[v.layer]) ? layerById[v.layer] : layerById.temp
  const grid = useMemo(() => (m && day ? layerGrid(m, day, layer.id, v.depth) : null), [m, day, layer.id, v.depth])
  const range = useMemo(() => grid && niceRange(robustRange(grid, layer.symmetric), layer.symmetric), [grid, layer.symmetric])
  const url = useMemo(() => grid && renderGrid(m.grid, grid, layer.ramp, range), [grid, range]) // eslint-disable-line react-hooks/exhaustive-deps
  const probeCell = m && v.probe ? cellAt(m.grid, v.probe.lat, v.probe.lon) : null

  if (!m) return <div className="h-[70vh]" />

  const z = DEPTHS[v.depth]
  const pick = (c) => v.set({ probe: { lat: c.lat, lon: c.lon } })
  const toAnalysis = () => document.getElementById('point')?.scrollIntoView({ behavior: 'smooth' })

  return (
    <div>
      <section className="flex flex-col border-b border-line lg:h-[calc(100dvh-var(--bar))] lg:flex-row">
        <aside className="flex shrink-0 flex-col border-line bg-paper lg:w-[348px] lg:border-r">
          <div className="border-b border-line px-4 pb-4 pt-4">
            <p className="label">Explorer · {m.source.kind === 'model' ? 'Sylithe Ocean Model' : m.source.label}</p>
            <h1 className="display mt-1 text-[22px] leading-tight text-ink">Any layer, any depth, any day</h1>
            <p className="mt-1.5 text-[12px] leading-relaxed text-mute">Compare the prediction with GLORYS12, the derived ocean-heat layers and the satellite inputs. Click the ocean for the full column.</p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <Side n={1} title="Day" aside={day ? fmtDate(day.date) : '—'}>
              <Timeline days={m.days} value={v.date} onChange={(d) => v.set({ date: d })} />
              {day?.note && <p className="mt-2 text-[11.5px] text-mute">{day.note}</p>}
            </Side>

            <Side n={2} title="Region" aside={REGIONS[v.region].short}>
              <select value={v.region} onChange={(e) => v.set({ region: e.target.value })} className={field}>
                {Object.entries(REGIONS).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}
              </select>
            </Side>

            <Side n={3} title="Layer" aside={layer.short ?? layer.label}>
              {GROUPS.map((g) => (
                <div key={g} className="mb-2">
                  <p className="label mb-1">{g}</p>
                  <div className="grid grid-cols-2 gap-1">{LAYERS.filter((l) => l.group === g).map((l) => {
                    const on = available(m, l)
                    return (
                      <label key={l.id} title={on ? l.help : `${l.label}: not in this export`}
                        className={`flex cursor-pointer items-center gap-1.5 rounded-[6px] border px-2 py-1.5 text-[12px] ${layer.id === l.id ? 'border-sea bg-seatint text-ink' : 'border-line text-ink2 hover:bg-wash'} ${on ? '' : 'pointer-events-none opacity-40'}`}>
                        <input type="radio" name="xlayer" checked={layer.id === l.id} disabled={!on} onChange={() => v.set({ layer: l.id })} className="accent-[rgb(var(--sea))]" />
                        <span className="truncate">{l.short ?? l.label}</span>
                      </label>)
                  })}</div>
                </div>
              ))}
              <p className="mt-1 text-[11.5px] leading-relaxed text-mute">{layer.help}</p>
            </Side>

            <Side n={4} title="Depth" aside={layer.perDepth ? `${z} m` : 'n/a for this layer'}>
              <div className={layer.perDepth ? '' : 'pointer-events-none opacity-40'}>
                <select value={v.depth} onChange={(e) => v.set({ depth: +e.target.value })} className={field}>
                  {DEPTHS.map((d, k) => <option key={d} value={k}>{d} m</option>)}</select>
                <DepthGauge vertical={false} value={v.depth} onChange={(k) => v.set({ depth: k })} className="mt-3" />
              </div>
            </Side>

            <Side n={5} title="Display" aside={v.basemap === 'satellite' ? 'Satellite' : 'Map'}>
              <p className="label mb-1">Opacity · {Math.round(opacity * 100)} %</p>
              <input type="range" className="slider w-full" min={0.2} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(+e.target.value)} />
              <p className="label mb-1 mt-3">Basemap</p>
              <div className="seg w-full">{[['satellite', 'Satellite'], ['light', 'Map']].map(([k, l]) =>
                <button key={k} className="flex-1" aria-pressed={v.basemap === k} onClick={() => v.set({ basemap: k })}>{l}</button>)}</div>
            </Side>
          </div>

          <div className="border-t border-line bg-wash/70 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-[12px] text-ink">{layer.label}{layer.perDepth ? ` at ${z} m` : ''} · <span className="num text-mute">{day ? fmtDate(day.date) : ''}</span></p>
              <button onClick={() => setVisible((x) => !x)} title={visible ? 'Hide the layer' : 'Show the layer'} className="text-mute hover:text-ink">
                {visible ? <Eye size={15} /> : <EyeOff size={15} />}</button>
            </div>
            {range && <Legend className="mt-2" layer={layer} range={range} width="100%" marks={MARKS[layer.id] ?? []} />}
            <CursorReadout bind={hoverRef} layer={layer} depth={z} />
          </div>
          <button onClick={toAnalysis} className="flex items-center justify-center gap-2 border-t border-line bg-ink px-4 py-3 text-[13px] text-paper hover:text-[#A3E635]">
            Point analysis below <ArrowDown size={14} /></button>
        </aside>

        <div className="relative h-[70vh] min-w-0 flex-1 lg:h-auto">
          <OceanMap g={m.grid} url={url} grid={grid} probe={probeCell} onPick={pick} onHover={(c) => hoverRef.current?.(c)} region={v.region}
            basemap={v.basemap} opacity={visible ? opacity : 0} padding={[24, 24]} scrollZoom />
          <div className="absolute right-14 top-3 z-[700] flex gap-1.5">
            <MapBtn on={visible} onClick={() => setVisible((x) => !x)} title={visible ? 'Hide the layer' : 'Show the layer'}>
              {visible ? <Eye size={14} /> : <EyeOff size={14} />}{layer.short ?? layer.label}</MapBtn>
          </div>
          <p className={`label pointer-events-none absolute bottom-2 left-3 z-[500] hidden sm:block ${v.basemap === 'satellite' ? '!text-paper/80' : 'text-mute'}`}>
            Study domain · 5–30°N, 45–105°E · 0.25° · click the ocean to analyse a point</p>
        </div>
      </section>

      <div id="point" className="scroll-mt-[var(--bar)]">
        <ProbePanel cell={probeCell} day={day} onClose={() => v.set({ probe: null })} />
      </div>
    </div>
  )
}
