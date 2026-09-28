import { useMemo, useState } from 'react'
import { MapContainer, TileLayer, ImageOverlay, CircleMarker, Rectangle, useMapEvents } from 'react-leaflet'
import { renderGrid, gridBounds, cellAt, fmt, rampStops } from '../lib/ocean'

const REGIONS = [
  { id: 'BoB', label: 'Bay of Bengal', b: [[5, 80], [23, 100]] },
  { id: 'AS', label: 'Arabian Sea', b: [[5, 50], [25, 78]] },
]

function Events({ field, grid, onPick, onHover }) {
  useMapEvents({
    click: (e) => { const c = cellAt(field, e.latlng.lat, e.latlng.lng); if (c && field.temp[0][c.y][c.x] != null) onPick(c) },
    mousemove: (e) => {
      const c = cellAt(field, e.latlng.lat, e.latlng.lng)
      onHover(c ? { ...c, v: grid[c.y][c.x] } : null)
    },
    mouseout: () => onHover(null),
  })
  return null
}

export default function OceanMap({ field, grid, layer, range, depth, selected, onPick, showRegions }) {
  const [hover, setHover] = useState(null)
  const url = useMemo(() => renderGrid(field, grid, layer.ramp, range), [field, grid, layer.ramp, range])
  const bounds = gridBounds(field)
  const decimals = layer.unit === 'm' ? 0 : layer.unit === 'kJ/cm²' ? 0 : 2

  return (
    <div className="relative h-full w-full rounded-2xl overflow-hidden border border-gray-200">
      <MapContainer center={[17.5, 77]} zoom={5} minZoom={4} maxZoom={9} zoomSnap={0.5}
        maxBounds={[[-5, 30], [40, 120]]} className="h-full w-full" attributionControl={false}>
        <TileLayer url="https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png" />
        <ImageOverlay url={url} bounds={bounds} className="pixelated" />
        <TileLayer url="https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png" opacity={0.7} />
        {showRegions && REGIONS.map((r) => (
          <Rectangle key={r.id} bounds={r.b} pathOptions={{ color: '#0F172A', weight: 1, dashArray: '4 4', fill: false }} />
        ))}
        {selected && (
          <CircleMarker center={[selected.lat, selected.lon]} radius={7}
            pathOptions={{ color: '#fff', weight: 2, fillColor: '#0F172A', fillOpacity: 1 }} />
        )}
        <Events field={field} grid={grid} onPick={onPick} onHover={setHover} />
      </MapContainer>

      {/* hover readout */}
      <div className="absolute top-3 left-3 z-[500] bg-white/95 backdrop-blur rounded-xl border border-gray-200 px-3 py-2 min-w-[190px] pointer-events-none">
        <p className="eyebrow mb-0.5">{layer.label}{layer.perDepth ? ` · ${depth} m` : ''}</p>
        {hover && hover.v != null ? (
          <p className="font-mono text-[13px] text-ink">
            <span className="text-[18px] font-semibold">{fmt(hover.v, decimals)}</span> {layer.unit}
            <span className="text-gray-400 ml-2">{hover.lat.toFixed(2)}°N {hover.lon.toFixed(2)}°E</span>
          </p>
        ) : <p className="text-[12px] text-gray-400">{hover ? 'Land / no data' : 'Hover the ocean · click to probe'}</p>}
      </div>

      <Legend layer={layer} range={range} decimals={decimals} />
    </div>
  )
}

function Legend({ layer, range, decimals }) {
  const stops = rampStops(layer.ramp)
  const grad = `linear-gradient(90deg, ${stops.join(',')})`
  const [lo, hi] = range
  const ticks = [lo, (lo + hi) / 2, hi]
  return (
    <div className="absolute bottom-3 left-3 z-[500] bg-white/95 backdrop-blur rounded-xl border border-gray-200 px-3 py-2 w-[240px]">
      <div className="flex justify-between items-baseline mb-1">
        <p className="eyebrow">{layer.label}</p>
        <p className="text-[10px] text-gray-400 font-mono">{layer.unit}</p>
      </div>
      <div className="h-2.5 rounded-full" style={{ background: grad }} />
      <div className="flex justify-between mt-1 font-mono text-[10px] text-gray-500">
        {ticks.map((t, i) => <span key={i}>{fmt(t, decimals)}</span>)}
      </div>
    </div>
  )
}
