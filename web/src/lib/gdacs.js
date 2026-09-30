// Tropical cyclones in the North Indian Ocean from GDACS (UN / European Commission Global Disaster Alert and
// Coordination System; tracks and forecasts from JTWC). Public API with CORS, read directly by the browser.
import { useEffect, useState } from 'react'

const API = 'https://www.gdacs.org/gdacsapi/api'
const BOX = { w: 40, e: 100, s: 0, n: 30 }        // North Indian Ocean: Arabian Sea, Bay of Bengal, Andaman Sea
const RANK = { TD: 1, TS: 2, HU: 3, TY: 3, C1: 3, C2: 4, C3: 5, C4: 6, C5: 7 }
export const catRank = (c) => RANK[c] ?? 1
export const catName = { TD: 'Tropical depression', TS: 'Tropical storm', HU: 'Cyclone (hurricane strength)', TY: 'Cyclone (typhoon strength)' }
export const ALERT = { Green: '#4D9F6A', Orange: '#E08A2B', Red: '#C0392B' }

const cache = new Map()
const getJSON = (url) => {
  if (!cache.has(url)) cache.set(url, fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null))
  return cache.get(url)
}

function parseTrack(geo, year, issued) {
  const feats = geo?.features ?? []
  const cats = {}
  for (const f of feats) {
    const m = /^Line_Line_(\d+)$/.exec(f.properties?.Class ?? '')
    if (m) cats[+m[1]] = f.properties.polygonlabel
  }
  const pts = []
  for (const f of feats) {
    const m = /^Point_Polygon_Point_(\d+)$/.exec(f.properties?.Class ?? '')
    if (!m || f.geometry?.type !== 'Polygon') continue
    const ring = f.geometry.coordinates[0].slice(0, -1)
    const lon = ring.reduce((a, c) => a + c[0], 0) / ring.length, lat = ring.reduce((a, c) => a + c[1], 0) / ring.length
    const k = f.properties.key                                  // MMDDHHMM
    let y = year
    if (+k.slice(0, 2) < +issued.slice(5, 7) - 6) y += 1       // track crossing into January
    const t = `${y}-${k.slice(0, 2)}-${k.slice(2, 4)}T${k.slice(4, 6)}:${k.slice(6, 8)}:00Z`
    const i = +m[1]
    pts.push({ i, t, lat, lon, cat: cats[i] ?? cats[i - 1] ?? 'TD', forecast: Date.parse(t) > Date.parse(`${issued}Z`) })
  }
  return pts.sort((a, b) => a.i - b.i)
}

/** Cyclones whose centre lies in the North Indian Ocean between two ISO dates, with their tracks. */
export async function nioCyclones(from, to) {
  const list = await getJSON(`${API}/events/geteventlist/SEARCH?eventlist=TC&fromDate=${from}&toDate=${to}&alertlevel=green;orange;red`)
  const evs = (list?.features ?? []).filter((f) => {
    const [x, y] = f.geometry?.coordinates ?? []
    return x >= BOX.w && x <= BOX.e && y >= BOX.s && y <= BOX.n
  })
  return Promise.all(evs.map(async (f) => {
    const p = f.properties
    const geo = await getJSON(`${API}/polygons/getgeometry?eventtype=TC&eventid=${p.eventid}&episodeid=${p.episodeid}`)
    const issued = geo?.features?.find((g) => g.properties?.polygondate)?.properties.polygondate ?? p.todate
    return {
      id: p.eventid, name: p.eventname ?? p.name, alert: p.alertlevel, current: p.iscurrent === 'true' || p.iscurrent === true,
      from: p.fromdate, to: p.todate, issued, severity: p.severitydata?.severitytext, country: p.country,
      report: p.url?.report, track: parseTrack(geo, +p.fromdate.slice(0, 4), issued),
    }
  }))
}

export function useCyclones(from, to) {
  const [s, set] = useState({ loading: true, list: [], error: null })
  useEffect(() => {
    if (!from || !to) return
    let live = true
    nioCyclones(from, to).then((list) => live && set({ loading: false, list, error: null }), (e) => live && set({ loading: false, list: [], error: String(e) }))
    return () => { live = false }
  }, [from, to])
  return s
}
