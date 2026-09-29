// Loader for export format v2 (oceanembed/webexport.py): manifest.json + days/<date>/<layer>.bin (int16 LE,
// rows north→south, NODATA −32768). Every layer is decoded once into a Float32Array (NaN = no data) and cached.
import { useEffect, useState } from 'react'

const BASE = '/data'
const cache = new Map()
const once = (key, fn) => {
  if (!cache.has(key)) cache.set(key, fn().catch((e) => { cache.delete(key); throw e }))
  return cache.get(key)
}

export const loadManifest = () =>
  once('manifest', async () => {
    const r = await fetch(`${BASE}/manifest.json`)
    if (!r.ok) throw new Error(`manifest.json: HTTP ${r.status}`)
    const m = await r.json()
    m.N = m.grid.width * m.grid.height
    m.dayIndex = Object.fromEntries(m.days.map((d, i) => [d.date, i]))
    m.has = (name) => name in m.layers
    return m
  })

/** Optional side files (argo.json, skill_depth.json, …): resolve to null when absent. */
export const loadJSON = (name) =>
  once(`json:${name}`, async () => {
    const r = await fetch(`${BASE}/${name}`)
    if (!r.ok) return null
    const t = await r.text()
    try { return JSON.parse(t) } catch { return null }     // dev server answers index.html for missing files
  })

export const loadLayer = (m, date, name) =>
  once(`${date}/${name}`, async () => {
    const spec = m.layers[name]
    if (!spec) throw new Error(`layer ${name} is not in this export`)
    const r = await fetch(`${BASE}/days/${date}/${name}.bin`)
    if (!r.ok) throw new Error(`${date}/${name}: HTTP ${r.status}`)
    const q = new Int16Array(await r.arrayBuffer())
    const out = new Float32Array(q.length), s = spec.scale, o = spec.offset, nd = m.nodata
    for (let i = 0; i < q.length; i++) out[i] = q[i] === nd ? NaN : q[i] * s + o
    return out
  })

/** Everything the console needs for one day. Missing optional layers are simply absent. */
export const loadDay = (m, date) =>
  once(`day:${date}`, async () => {
    const meta = m.days[m.dayIndex[date]]
    const names = meta?.layers ?? []
    const entries = await Promise.all(names.map(async (n) => [n, await loadLayer(m, date, n)]))
    return { date, note: meta?.note, ...Object.fromEntries(entries) }
  })

/** Level k of a multi-level layer, as a view (no copy). */
export const level = (m, arr, k) => arr.subarray(k * m.N, (k + 1) * m.N)

// ---------------------------------------------------------------- hooks
export function useManifest() {
  const [s, set] = useState({ m: null, error: null })
  useEffect(() => { loadManifest().then((m) => set({ m, error: null }), (e) => set({ m: null, error: e.message })) }, [])
  return s
}

export function useDay(m, date) {
  const [day, setDay] = useState(null)
  useEffect(() => {
    if (!m || !date) return
    let live = true
    loadDay(m, date).then((d) => live && setDay(d))
    return () => { live = false }
  }, [m, date])
  return day && day.date === date ? day : null
}

export function useJSON(name) {
  const [v, set] = useState(undefined)            // undefined = loading, null = absent
  useEffect(() => { let live = true; loadJSON(name).then((x) => live && set(x)); return () => { live = false } }, [name])
  return v
}

/** Load a list of days (for depth–time views); returns what has arrived so far, in order. */
export function useDays(m, dates) {
  const [got, set] = useState({})
  const key = dates?.join(',')
  useEffect(() => {
    if (!m || !dates) return
    let live = true
    dates.forEach((d) => loadDay(m, d).then((x) => live && set((s) => ({ ...s, [d]: x }))))
    return () => { live = false }
  }, [m, key])                                             // eslint-disable-line react-hooks/exhaustive-deps
  return dates ? dates.map((d) => got[d]).filter(Boolean) : []
}
