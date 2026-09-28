import { useMemo } from 'react'
import { Crosshair, Info } from 'lucide-react'
import OceanMap from '../components/OceanMap'
import ProfileChart from '../components/ProfileChart'
import SectionView from '../components/SectionView'
import { DATASETS, DEPTHS, LAYERS, column, fmt, isothermDepth, layerGrid, mld, robustRange, tchp } from '../lib/ocean'

const SERIES_COLORS = { '2024-05-15': '#16a34a', '2024-01-15': '#0F172A' }

export default function Explorer({ fields, datasetId, setDatasetId, layerId, setLayerId, depthIdx, setDepthIdx, selected, setSelected }) {
  const field = fields[datasetId]
  const layer = LAYERS.find((l) => l.id === layerId)
  const grid = useMemo(() => field && layerGrid(field, layerId, depthIdx), [field, layerId, depthIdx])
  const range = useMemo(() => grid && robustRange(grid, layer.symmetric), [grid, layer.symmetric])
  // section colour range: coldest robust value at 500 m → warmest at the surface
  const tRange = useMemo(() => field && [robustRange(field.temp[DEPTHS.indexOf(500)])[0], robustRange(field.temp[0])[1]], [field])

  if (!field) return <div className="p-10 text-gray-400">Loading field…</div>

  const col = selected ? column(field, selected.y, selected.x) : null
  const series = selected ? DATASETS.filter((d) => fields[d.id]).map((d) => ({
    key: d.id, label: d.label, color: SERIES_COLORS[d.id], values: column(fields[d.id], selected.y, selected.x),
  })) : []

  return (
    <div className="p-6 space-y-5">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">North Indian Ocean · 5–30°N, 45–105°E · 0.25° daily</p>
          <h1 className="text-[26px] font-bold leading-tight">Subsurface Explorer</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="card p-1 flex">
            {DATASETS.map((d) => (
              <button key={d.id} onClick={() => setDatasetId(d.id)} className={`seg ${datasetId === d.id ? 'seg-on' : 'seg-off'}`}>{d.label}</button>
            ))}
          </div>
          <span className="chip bg-amber-50 text-amber-700" title={field.source}>Reference field: HYCOM via GEE · model output pending</span>
        </div>
      </div>

      {/* controls */}
      <div className="card px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex flex-wrap gap-1">
          {LAYERS.map((l) => (
            <button key={l.id} onClick={() => setLayerId(l.id)} className={`seg ${layerId === l.id ? 'seg-on' : 'seg-off'}`}>{l.label}</button>
          ))}
        </div>
        {layer.perDepth && (
          <div className="flex items-center gap-3 flex-1 min-w-[280px]">
            <span className="eyebrow">Depth</span>
            <input type="range" min={0} max={DEPTHS.length - 1} value={depthIdx} onChange={(e) => setDepthIdx(+e.target.value)} className="flex-1" />
            <span className="font-mono text-[15px] font-semibold w-16 text-right">{DEPTHS[depthIdx]} m</span>
          </div>
        )}
        <p className="text-[12px] text-gray-500 flex items-center gap-1.5 basis-full"><Info size={13} />{layer.help}</p>
      </div>

      {/* map + inspector */}
      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-12 xl:col-span-8 h-[560px]">
          <OceanMap field={field} grid={grid} layer={layer} range={range} depth={DEPTHS[depthIdx]}
            selected={selected} onPick={setSelected} showRegions />
        </div>
        <div className="col-span-12 xl:col-span-4 card p-5 flex flex-col">
          {!selected ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
              <Crosshair size={36} className="text-gray-300 mb-3" />
              <p className="font-semibold text-gray-500">Probe a location</p>
              <p className="text-[12px] text-gray-400 mt-1">Click anywhere on the ocean to see the full temperature profile from 0 to 1000 m and its cyclone-relevant heat metrics.</p>
            </div>
          ) : (
            <>
              <div className="flex items-baseline justify-between">
                <p className="eyebrow">Point profile</p>
                <p className="font-mono text-[12px] text-gray-500">{selected.lat.toFixed(2)}°N · {selected.lon.toFixed(2)}°E</p>
              </div>
              <div className="grid grid-cols-4 gap-2 my-4">
                <Stat label="SST" v={fmt(field.sst?.[selected.y]?.[selected.x], 1)} u="°C" />
                <Stat label="D26" v={fmt(isothermDepth(col, 26), 0)} u="m" />
                <Stat label="TCHP" v={fmt(tchp(col), 0)} u="kJ/cm²" accent={tchp(col) >= 50} />
                <Stat label="MLD" v={fmt(mld(col), 0)} u="m" />
              </div>
              <ProfileChart series={series} />
            </>
          )}
        </div>
      </div>

      {selected && (
        <div className="card p-5">
          <p className="eyebrow mb-2">Section</p>
          <SectionView field={field} row={selected.y} range={tRange} />
        </div>
      )}
    </div>
  )
}

function Stat({ label, v, u, accent }) {
  return (
    <div className={`rounded-xl px-2.5 py-2 ${accent ? 'bg-mist' : 'bg-gray-50'}`}>
      <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">{label}</p>
      <p className="text-[18px] font-bold leading-tight text-ink">{v}</p>
      <p className="text-[9px] text-gray-400">{u}</p>
    </div>
  )
}
