// Area of interest: import (KML, KMZ, GeoJSON, Shapefile ZIP / .shp+.dbf), rasterise onto the 0.25° grid, and
// summarise a day over it. Same import formats as the Sylithe LULC tools.
import { DEPTHS, REGIONS, column, isothermDepth, mld, tchp } from './ocean'

const EARTH = 6371.0088

/** Parse a FileList into a GeoJSON FeatureCollection of polygons. Returns { geojson, format, name }. */
export async function readAoiFiles(files) {
  const list = [...files]
  const byExt = Object.fromEntries(list.map((f) => [f.name.split('.').pop().toLowerCase(), f]))
  const name = list[0]?.name ?? 'area'
  let gj, format
  if (byExt.kml) {
    const { kml } = await import('@tmcw/togeojson')
    gj = kml(new DOMParser().parseFromString(await byExt.kml.text(), 'text/xml')); format = 'KML'
  } else if (byExt.kmz) {
    const [{ kml }, JSZip] = await Promise.all([import('@tmcw/togeojson'), import('jszip').then((m) => m.default)])
    const zip = await JSZip.loadAsync(await byExt.kmz.arrayBuffer())
    const doc = Object.values(zip.files).find((f) => f.name.toLowerCase().endsWith('.kml'))
    if (!doc) throw new Error('No .kml inside the KMZ')
    gj = kml(new DOMParser().parseFromString(await doc.async('text'), 'text/xml')); format = 'KMZ'
  } else if (byExt.geojson || byExt.json) {
    gj = JSON.parse(await (byExt.geojson ?? byExt.json).text()); format = 'GeoJSON'
  } else if (byExt.zip) {
    const shp = (await import('shpjs')).default
    gj = await shp(await byExt.zip.arrayBuffer()); format = 'Shapefile (ZIP)'
    if (Array.isArray(gj)) gj = { type: 'FeatureCollection', features: gj.flatMap((c) => c.features) }
  } else if (byExt.shp) {
    const { parseShp, parseDbf, combine } = await import('shpjs')
    const prj = byExt.prj ? await byExt.prj.text() : false
    gj = combine([parseShp(await byExt.shp.arrayBuffer(), prj), byExt.dbf ? parseDbf(await byExt.dbf.arrayBuffer()) : undefined])
    format = 'Shapefile'
  } else {
    throw new Error('Use a .kml, .kmz, .geojson/.json, a zipped shapefile, or .shp (+ .dbf, .prj)')
  }
  const fc = normalise(gj)
  if (!fc.features.length) throw new Error('No polygon found in the file')
  return { geojson: fc, format, name }
}

function normalise(gj) {
  const feats = gj.type === 'FeatureCollection' ? gj.features : gj.type === 'Feature' ? [gj] : [{ type: 'Feature', properties: {}, geometry: gj }]
  return { type: 'FeatureCollection', features: feats.filter((f) => f?.geometry && /Polygon/.test(f.geometry.type)) }
}

/** Polygon rings as [[lon, lat], ...] lists: [outer, hole, hole, ...] per polygon. */
function polygons(fc) {
  const out = []
  for (const f of fc.features) {
    const g = f.geometry
    if (g.type === 'Polygon') out.push(g.coordinates)
    if (g.type === 'MultiPolygon') out.push(...g.coordinates)
  }
  return out
}

function inRing(x, y, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Grid-cell indices whose centre lies inside the AOI (holes respected). */
export function maskFor(g, fc) {
  const polys = polygons(fc), idx = []
  const bb = polys.flat(2).reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity])
  for (let r = 0; r < g.height; r++) {
    const lat = g.lat0 - r * g.step
    if (lat < bb[1] || lat > bb[3]) continue
    for (let c = 0; c < g.width; c++) {
      const lon = g.lon0 + c * g.step
      if (lon < bb[0] || lon > bb[2]) continue
      if (polys.some(([outer, ...holes]) => inRing(lon, lat, outer) && !holes.some((h) => inRing(lon, lat, h)))) idx.push(r * g.width + c)
    }
  }
  return idx
}

/** Geodesic polygon area in km² (spherical excess), for display. */
export function areaKm2(fc) {
  const rad = Math.PI / 180
  const ring = (pts) => {
    let s = 0
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]
      s += (x2 - x1) * rad * (2 + Math.sin(y1 * rad) + Math.sin(y2 * rad))
    }
    return Math.abs((s * EARTH * EARTH) / 2)
  }
  return polygons(fc).reduce((a, [outer, ...holes]) => a + ring(outer) - holes.reduce((h, r) => h + ring(r), 0), 0)
}

export const rectangle = ([[s, w], [n, e]]) => ({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } }],
})
export const polygon = (latlngs) => ({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...latlngs.map(([la, lo]) => [lo, la]), [latlngs[0][1], latlngs[0][0]]]] } }],
})
export const presetAoi = (key) => rectangle(REGIONS[key].bounds)

const mean = (a) => { let s = 0, n = 0; for (const v of a) if (Number.isFinite(v)) { s += v; n++ } return n ? s / n : NaN }

/** One day summarised over the cells `idx`: the same fields as the daily pipeline's series.json. */
export function summarise(m, day, idx) {
  if (!day?.temp || !idx.length) return null
  const N = m.N, D = DEPTHS.length
  const T = [], S = []
  for (let k = 0; k < D; k++) {
    T.push(mean(idx.map((i) => day.temp[k * N + i])))
    S.push(day.sigma ? mean(idx.map((i) => day.sigma[k * N + i])) : NaN)
  }
  const cols = idx.map((i) => column(m, day.temp, i)).filter((c) => Number.isFinite(c[0]))
  const heat = cols.map(tchp)
  const pick = (k) => (day[k] ? mean(idx.map((i) => day[k][i])) : NaN)
  const speed = (u, v) => (day[u] && day[v] ? mean(idx.map((i) => Math.hypot(day[u][i], day[v][i]))) : NaN)
  return {
    T, sigma: S, sst: pick('sst'), sss: pick('sss'), sla: pick('sla'), cur: speed('uc', 'vc'), wind: speed('uw', 'vw'),
    tchp: mean(heat), tchp_ge50: heat.length ? heat.filter((h) => h >= 50).length / heat.length : NaN,
    d26: mean(cols.map((c) => isothermDepth(c, 26))), d20: mean(cols.map((c) => isothermDepth(c, 20))), mld: mean(cols.map(mld)),
    cells: cols.length,
  }
}

/** CSV download of any table. */
export function downloadCsv(name, header, rows) {
  const esc = (v) => (typeof v === 'number' ? (Number.isFinite(v) ? +v.toFixed(4) : '') : `"${String(v ?? '').replace(/"/g, '""')}"`)
  const text = [header.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n')
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'text/csv' })), download: name })
  a.click(); URL.revokeObjectURL(a.href)
}
