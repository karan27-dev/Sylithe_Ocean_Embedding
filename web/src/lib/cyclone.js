// Cyclone logic engine. Uses only what the Sylithe Ocean Model has: the satellite inputs and the predicted temperature
// column. It scores how strongly the OCEAN can support a tropical cyclone; it is not a genesis forecast (the atmosphere,
// e.g. vertical wind shear and mid-level humidity, is not in the data). Every number is deterministic; a language model
// only ever receives the payload built here.
import { DEPTHS, REGIONS, column, derived, inRegion, isothermDepth, mld, tchp } from './ocean'

const ok = Number.isFinite
const K100 = DEPTHS.indexOf(100)

/** Each rule maps one variable to 0–1 between `lo` (no support) and `hi` (full support). */
export const RULES = [
  { key: 't100', label: 'Upper-100 m mean temperature', unit: '°C', lo: 25, hi: 29.5, w: 0.25, dp: 2,
    why: 'What a storm actually feels once it mixes the upper ocean; a better intensity predictor than SST.', ref: 'Price (2009)' },
  { key: 'tchp', label: 'Cyclone heat potential', unit: 'kJ cm⁻²', lo: 0, hi: 120, w: 0.25, dp: 0,
    why: 'Heat above 26 °C. Above about 50 the ocean can sustain rapid intensification.', ref: 'Leipper & Volgenau (1972); Mainelli et al. (2008)' },
  { key: 'sst', label: 'Sea surface temperature', unit: '°C', lo: 26, hi: 30.5, w: 0.15, dp: 2,
    why: 'Cyclones need a surface of at least 26 °C to form and keep going.', ref: 'Gray (1968)' },
  { key: 'd26', label: 'Depth of the 26 °C isotherm', unit: 'm', lo: 30, hi: 120, w: 0.1, dp: 0,
    why: 'A deep warm layer resists the cold wake a storm stirs up.', ref: 'Shay et al. (2000)' },
  { key: 'mld', label: 'Mixed-layer depth', unit: 'm', lo: 10, hi: 60, w: 0.1, dp: 0,
    why: 'A deep mixed layer brings less cold water to the surface when stirred.', ref: 'Lin et al. (2013)' },
  { key: 'sla', label: 'Sea level anomaly', unit: 'm', lo: -0.1, hi: 0.2, w: 0.1, dp: 3,
    why: 'Raised sea level marks warm-core eddies with a deep thermocline.', ref: 'Lin et al. (2005)' },
  { key: 'sss', label: 'Sea surface salinity', unit: 'psu', lo: 35, hi: 31, w: 0.05, dp: 2,
    why: 'Fresh surface water (Bay of Bengal) forms a barrier layer that suppresses storm-induced cooling.', ref: 'Balaguru et al. (2012)' },
]
export const CATS = [
  { min: 0.7, label: 'Very high', color: '#7f1c5f' }, { min: 0.5, label: 'High', color: '#dd5f58' },
  { min: 0.3, label: 'Moderate', color: '#f5a770' }, { min: 0, label: 'Low', color: '#d9d4c3' },
]
export const catOf = (v) => (ok(v) ? CATS.find((c) => v >= c.min) : null)
export const VORT = 2e-5          // s⁻¹, cyclonic surface relative vorticity marking a disturbance (northern hemisphere)
export const WIND = 10            // m s⁻¹

const clamp01 = (x) => Math.max(0, Math.min(1, x))
export const score = (r, v) => clamp01((v - r.lo) / (r.hi - r.lo))

/** Ocean Cyclone Potential Index from a dict of drivers; missing drivers are left out and the weights renormalised. */
export function ocpi(x) {
  const s = x.sst ?? x.t0
  if (!ok(s) || !ok(x.t100)) return { value: NaN, parts: {} }      // open ocean only: shelves < 100 m are left out
  if (s < 26) return { value: 0, parts: {}, gated: true }
  let a = 0, w = 0
  const parts = {}
  for (const r of RULES) {
    if (!ok(x[r.key])) continue
    parts[r.key] = score(r, x[r.key]); a += r.w * parts[r.key]; w += r.w
  }
  return { value: w ? a / w : NaN, parts }
}

/** Mean temperature of the upper 100 m, trapezoidal over the standard levels. */
export function t100(col) {
  let s = 0
  for (let k = 1; k <= K100; k++) {
    if (!ok(col[k]) || !ok(col[k - 1])) return NaN
    s += ((col[k] + col[k - 1]) / 2) * (DEPTHS[k] - DEPTHS[k - 1])
  }
  return s / 100
}

/** Per-cell features for one day, memoised on the day object. */
export function features(m, day) {
  if (day._cyc) return day._cyc
  const g = m.grid, N = m.N, mk = () => new Float32Array(N).fill(NaN)
  const d = derived(m, day)
  const out = { t100: mk(), cool: mk(), ocpi: mk(), vort: mk(), wind: mk() }
  const R = 6.371e6, rad = Math.PI / 180, dy = g.step * rad * R
  for (let y = 0; y < g.height; y++) {
    const lat = g.lat0 - y * g.step, dx = g.step * rad * R * Math.cos(lat * rad)
    for (let x = 0; x < g.width; x++) {
      const i = y * g.width + x
      if (!ok(day.temp[i])) continue
      const c = column(m, day.temp, i), tm = t100(c)
      out.t100[i] = tm; out.cool[i] = c[0] - tm
      out.ocpi[i] = ocpi({ t0: c[0], sst: day.sst?.[i], sss: day.sss?.[i], sla: day.sla?.[i], tchp: d.tchp[i], d26: d.d26[i], mld: d.mld[i], t100: tm }).value
      if (day.uw && day.vw) {
        out.wind[i] = Math.hypot(day.uw[i], day.vw[i])
        if (x > 0 && x < g.width - 1 && y > 0 && y < g.height - 1) {
          // rows run north→south: the row above (y−1) is north
          const dv = (day.vw[i + 1] - day.vw[i - 1]) / (2 * dx), du = (day.uw[i - g.width] - day.uw[i + g.width]) / (2 * dy)
          out.vort[i] = dv - du
        }
      }
    }
  }
  day._cyc = out
  return out
}

/** Per-region summary of a day. */
export function regionSummary(m, day) {
  const f = features(m, day), d = derived(m, day), g = m.grid, out = {}
  for (const r of Object.keys(REGIONS)) {
    let n = 0, s = 0, hi = 0, vhi = 0, max = -Infinity, watch = 0
    for (let y = 0; y < g.height; y++) for (let x = 0; x < g.width; x++) {
      const i = y * g.width + x, v = f.ocpi[i]
      if (!ok(v) || !inRegion(r, g.lat0 - y * g.step, g.lon0 + x * g.step)) continue
      n++; s += v; if (v >= 0.5) hi++; if (v >= 0.7) vhi++; max = Math.max(max, v)
      if (v >= 0.5 && f.vort[i] > VORT && f.wind[i] >= WIND) watch++
    }
    out[r] = { mean: n ? s / n : NaN, share_high: n ? hi / n : NaN, share_very_high: n ? vhi / n : NaN, max, watch_cells: watch, cells: n, tchp_mean: meanIn(m, d.tchp, r) }
  }
  return out
}
function meanIn(m, arr, r) {
  const g = m.grid
  let s = 0, n = 0
  for (let y = 0; y < g.height; y++) for (let x = 0; x < g.width; x++) {
    const i = y * g.width + x
    if (ok(arr[i]) && inRegion(r, g.lat0 - y * g.step, g.lon0 + x * g.step)) { s += arr[i]; n++ }
  }
  return n ? s / n : NaN
}

/** Peaks of a field, at least `sep` degrees apart, above `min`. `keep(i)` filters candidate cells. */
export function peaks(m, arr, { k = 6, sep = 4, min = -Infinity, keep = () => true } = {}) {
  const g = m.grid, cand = []
  for (let i = 0; i < m.N; i++) if (ok(arr[i]) && arr[i] >= min && keep(i)) cand.push(i)
  cand.sort((a, b) => arr[b] - arr[a])
  const out = []
  for (const i of cand) {
    const lat = g.lat0 - Math.floor(i / g.width) * g.step, lon = g.lon0 + (i % g.width) * g.step
    if (out.every((o) => Math.hypot(o.lat - lat, o.lon - lon) > sep)) out.push({ i, lat, lon, v: arr[i] })
    if (out.length === k) break
  }
  return out
}

/** Drivers of one cell, with their 0–1 scores, strongest first. */
export function drivers(m, day, i) {
  const f = features(m, day), d = derived(m, day)
  const x = { sst: day.sst?.[i] ?? day.temp[i], sss: day.sss?.[i], sla: day.sla?.[i], tchp: d.tchp[i], d26: d.d26[i], mld: d.mld[i], t100: f.t100[i] }
  return RULES.filter((r) => ok(x[r.key])).map((r) => ({ key: r.key, label: r.label, value: x[r.key], unit: r.unit, score: score(r, x[r.key]), dp: r.dp }))
    .sort((a, b) => b.score - a.score)
}

/** OCPI of an area-mean record from series.json ({ T[15], sst, sss, sla, tchp, d26, mld }). */
export function ocpiOfRecord(r) {
  if (!r?.T) return NaN
  return ocpi({ t0: r.T[0], sst: r.sst, sss: r.sss, sla: r.sla, tchp: r.tchp, d26: r.d26, mld: r.mld, t100: t100(r.T) }).value
}

export { isothermDepth, mld, tchp }
