import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { MapContainer, Pane, TileLayer, CircleMarker, Rectangle, useMap, useMapEvents } from 'react-leaflet'
import { cellAt, gridBounds, REGIONS } from '../../lib/ocean'

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas'
const DOMAIN = [[5, 45], [30, 105]]

/** Image overlay that cross-fades to each new field instead of blinking: depth and date changes read as motion. */
function FadeOverlay({ url, bounds, opacity = 1 }) {
  const map = useMap()
  const cur = useRef(null)
  useEffect(() => {
    if (!url) return
    const next = L.imageOverlay(url, bounds, { opacity: 0, className: 'data', interactive: false }).addTo(map)
    const prev = cur.current
    cur.current = next
    const show = () => requestAnimationFrame(() => next.setOpacity(opacity))
    next.once('load', show)
    const t = prev && setTimeout(() => map.removeLayer(prev), 320)
    return () => { clearTimeout(t) }
  }, [url]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { cur.current?.setOpacity(opacity) }, [opacity])
  useEffect(() => () => { cur.current && map.removeLayer(cur.current) }, [map])
  return null
}

function Events({ grid, g, onPick, onHover }) {
  useMapEvents({
    click: (e) => {
      const c = cellAt(g, e.latlng.lat, e.latlng.lng)
      if (c && Number.isFinite(grid?.[c.i])) onPick?.(c)
    },
    mousemove: (e) => {
      const c = cellAt(g, e.latlng.lat, e.latlng.lng)
      onHover?.(c ? { ...c, v: grid?.[c.i], px: e.containerPoint } : null)
    },
    mouseout: () => onHover?.(null),
  })
  return null
}

/** Frame the chosen region: fly on change, and re-frame when the container resizes (the probe panel
 *  opening) unless the user has panned or zoomed by hand since. */
function Framer({ region, padding }) {
  const map = useMap()
  const first = useRef(true)
  const manual = useRef(false)
  const target = () => REGIONS[region]?.bounds ?? DOMAIN
  useEffect(() => {
    manual.current = false
    if (first.current) { map.fitBounds(target(), { padding }); first.current = false; return }
    map.flyToBounds(target(), { padding, duration: 0.7, easeLinearity: 0.2 })
  }, [region]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = map.getContainer()
    const mark = () => { manual.current = true }
    map.on('dragstart', mark)
    el.addEventListener('wheel', mark, { passive: true })
    el.addEventListener('dblclick', mark)
    const ro = new ResizeObserver(() => {
      map.invalidateSize({ pan: false })
      if (!manual.current) map.fitBounds(target(), { padding, animate: false })
    })
    ro.observe(el)
    return () => { ro.disconnect(); map.off('dragstart', mark); el.removeEventListener('wheel', mark); el.removeEventListener('dblclick', mark) }
  }, [map, region]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

/**
 * The console's map. Props:
 *  g          grid spec from the manifest
 *  url        rendered overlay (data URL), cross-faded on change
 *  grid       Float32Array behind the overlay, for hover/click
 *  probe      {lat, lon} marker
 *  points     [{lat, lon, color, r, id}] e.g. Argo floats
 *  region     'NIO' | 'BoB' | 'AS' — framed with a fly-to
 */
const IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services'

export default function OceanMap({ g, url, grid, probe, onPick, onHover, points, onPoint, region = 'NIO', showRegion = true,
  padding = [24, 24], zoomControl = true, scrollZoom = true, basemap = 'light', opacity = 1, className = '', children }) {
  const sat = basemap === 'satellite'

  const bounds = gridBounds(g)
  const [ready, setReady] = useState(false)
  return (
    <MapContainer bounds={DOMAIN} minZoom={3} maxZoom={9} zoomSnap={0.25} zoomDelta={0.5} wheelPxPerZoomLevel={120}
      maxBounds={[[-5, 30], [40, 120]]} zoomControl={false} attributionControl scrollWheelZoom={scrollZoom}
      whenReady={() => setReady(true)} className={`h-full w-full ${className}`}>
      {sat ? (
        <TileLayer key="sat" url={`${IMAGERY}/World_Imagery/MapServer/tile/{z}/{y}/{x}`} maxNativeZoom={17}
          attribution="Imagery © Esri, Maxar, Earthstar Geographics" />
      ) : (
        <TileLayer key="light" url={`${ESRI}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`} maxNativeZoom={16}
          attribution="Basemap © Esri" />
      )}
      <FadeOverlay url={url} bounds={bounds} opacity={opacity} />
      {/* place names sit above the data, below markers */}
      <Pane name="labels" style={{ zIndex: 450, pointerEvents: 'none' }}>
        {sat ? (
          <TileLayer key="satl" url={`${IMAGERY}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`} maxNativeZoom={16} opacity={0.8} />
        ) : (
          <TileLayer key="lightl" url={`${ESRI}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`} maxNativeZoom={16} opacity={0.65} />
        )}
      </Pane>
      {showRegion && region !== 'NIO' && (
        <Rectangle bounds={REGIONS[region].bounds} interactive={false}
          pathOptions={{ color: sat ? '#F5F3EE' : '#15181A', weight: 1.2, opacity: 0.8, dashArray: '3 5', fill: false }} />
      )}
      {points?.map((p) => (
        <CircleMarker key={p.id} center={[p.lat, p.lon]} radius={p.r ?? 4}
          pathOptions={{ color: p.stroke ?? '#F5F3EE', weight: p.weight ?? 1, fillColor: p.color, fillOpacity: 1 }}
          eventHandlers={onPoint ? { click: (e) => { L.DomEvent.stopPropagation(e); onPoint(p) } } : undefined} />
      ))}
      {probe && (
        <>
          <CircleMarker center={[probe.lat, probe.lon]} radius={11} interactive={false}
            pathOptions={{ color: '#15181A', weight: 1, opacity: 0.35, fill: false }} />
          <CircleMarker center={[probe.lat, probe.lon]} radius={4} interactive={false}
            pathOptions={{ color: '#F5F3EE', weight: 1.5, fillColor: '#15181A', fillOpacity: 1 }} />
        </>
      )}
      {ready && <Framer region={region} padding={padding} />}
      {zoomControl && <ZoomControl />}
      <Events grid={grid} g={g} onPick={onPick} onHover={onHover} />
      {children}
    </MapContainer>
  )
}

function ZoomControl() {
  const map = useMap()
  useEffect(() => {
    const z = L.control.zoom({ position: 'topright' }).addTo(map)
    return () => z.remove()
  }, [map])
  return null
}
