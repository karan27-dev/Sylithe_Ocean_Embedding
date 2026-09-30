import { useEffect, useRef, useState } from 'react'
import { GeoJSON, Polyline, Rectangle, CircleMarker, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'

/** Draws the area of interest and, in draw mode, captures a new one.
 *  mode 'rect': press and drag. mode 'poly': click vertices, double-click (or click the first point) to finish. */
export default function AoiTools({ aoi, mode, onDone, color = '#A3E635' }) {
  const map = useMap()
  const [start, setStart] = useState(null), [cur, setCur] = useState(null), [pts, setPts] = useState([])
  const fitted = useRef(null)

  useEffect(() => {
    const el = map.getContainer()
    el.style.cursor = mode ? 'crosshair' : ''
    if (mode === 'rect') map.dragging.disable(); else map.dragging.enable()
    if (mode) map.doubleClickZoom.disable(); else map.doubleClickZoom.enable()
    setStart(null); setCur(null); setPts([])
    return () => { el.style.cursor = ''; map.dragging.enable(); map.doubleClickZoom.enable() }
  }, [mode, map])

  useEffect(() => {
    if (!aoi || fitted.current === aoi) return
    fitted.current = aoi
    try { map.flyToBounds(L.geoJSON(aoi).getBounds(), { padding: [40, 40], maxZoom: 7, duration: 0.6 }) } catch { /* empty geometry */ }
  }, [aoi, map])

  useMapEvents({
    mousedown: (e) => { if (mode === 'rect') { setStart(e.latlng); setCur(e.latlng) } },
    mousemove: (e) => { if (mode === 'rect' && start) setCur(e.latlng); if (mode === 'poly') setCur(e.latlng) },
    mouseup: (e) => {
      if (mode !== 'rect' || !start) return
      const b = [[Math.min(start.lat, e.latlng.lat), Math.min(start.lng, e.latlng.lng)], [Math.max(start.lat, e.latlng.lat), Math.max(start.lng, e.latlng.lng)]]
      setStart(null)
      if (Math.abs(b[1][0] - b[0][0]) > 0.3 && Math.abs(b[1][1] - b[0][1]) > 0.3) onDone({ kind: 'rect', bounds: b })
    },
    click: (e) => {
      if (mode !== 'poly') return
      const p = [e.latlng.lat, e.latlng.lng]
      if (pts.length >= 3 && map.latLngToContainerPoint(pts[0]).distanceTo(e.containerPoint) < 12) { onDone({ kind: 'poly', points: pts }); setPts([]); return }
      setPts((a) => [...a, p])
    },
    dblclick: () => { if (mode === 'poly' && pts.length >= 3) { onDone({ kind: 'poly', points: pts }); setPts([]) } },
  })

  return (
    <>
      {aoi && <GeoJSON key={JSON.stringify(aoi).length + JSON.stringify(aoi).slice(0, 80)} data={aoi} interactive={false}
        style={{ color, weight: 2.5, fillColor: color, fillOpacity: 0.06, dashArray: null }} />}
      {mode === 'rect' && start && cur && (
        <Rectangle bounds={[[start.lat, start.lng], [cur.lat, cur.lng]]} interactive={false} pathOptions={{ color, weight: 2, dashArray: '5 5', fillOpacity: 0.08 }} />
      )}
      {mode === 'poly' && pts.length > 0 && (
        <>
          <Polyline positions={cur ? [...pts, [cur.lat, cur.lng]] : pts} interactive={false} pathOptions={{ color, weight: 2, dashArray: '5 5' }} />
          {pts.map((p, i) => <CircleMarker key={i} center={p} radius={i ? 3 : 5} interactive={false} pathOptions={{ color, fillColor: i ? color : '#0F172A', fillOpacity: 1, weight: 2 }} />)}
        </>
      )}
    </>
  )
}
