// Ocean physics, layer catalogue, colour maps and map rendering. Grids are flat Float32Arrays (row-major,
// rows north→south, NaN = land / no data). Derived diagnostics mirror oceanembed/metrics.py with exact
// piecewise-linear integrals.
import { level } from './data'

export const DEPTHS = [0, 5, 10, 20, 30, 50, 75, 100, 125, 150, 200, 300, 500, 700, 1000]
const RHO = 1025, CP = 3985
const ok = Number.isFinite

export function column(m, arr, i) {
  const c = new Array(DEPTHS.length)
  for (let k = 0; k < DEPTHS.length; k++) c[k] = arr[k * m.N + i]
  return c
}

/** Depth (m) where the column first reaches `iso`, linear between levels; NaN if never or land. */
export function isothermDepth(col, iso) {
  if (!ok(col[0])) return NaN
  if (col[0] <= iso) return 0
  for (let k = 1; k < col.length; k++) {
    if (!ok(col[k])) return NaN
    if (col[k] <= iso) return DEPTHS[k - 1] + ((col[k - 1] - iso) / (col[k - 1] - col[k])) * (DEPTHS[k] - DEPTHS[k - 1])
  }
  return NaN
}

/** Tropical Cyclone Heat Potential, kJ cm⁻² = ρ·cp·∫₀^D26 (T − 26) dz / 1e7 */
export function tchp(col) {
  if (!ok(col[0])) return NaN
  let J = 0
  for (let k = 1; k < col.length; k++) {
    const t0 = col[k - 1], t1 = col[k]
    if (!ok(t0) || !ok(t1) || t0 <= 26) break
    const z0 = DEPTHS[k - 1], z1 = DEPTHS[k]
    if (t1 >= 26) { J += ((t0 + t1) / 2 - 26) * (z1 - z0); continue }
    J += ((t0 - 26) / 2) * ((t0 - 26) / (t0 - t1)) * (z1 - z0)
    break
  }
  return (RHO * CP * J) / 1e7
}

/** Mixed-layer depth: first depth below 10 m where T < T(10 m) − 0.5 °C */
export function mld(col, dT = 0.5) {
  const ref = col[2]
  if (!ok(ref)) return NaN
  const thr = ref - dT
  for (let k = 3; k < col.length; k++) {
    if (!ok(col[k])) return NaN
    if (col[k] < thr) return DEPTHS[k - 1] + ((col[k - 1] - thr) / (col[k - 1] - col[k])) * (DEPTHS[k] - DEPTHS[k - 1])
  }
  return NaN
}

/** Derived 2-D diagnostics for a day, computed once and memoised on the day object. */
export function derived(m, day) {
  if (day._derived) return day._derived
  const N = m.N, mk = () => new Float32Array(N).fill(NaN)
  const d20 = mk(), d26 = mk(), heat = mk(), ml = mk(), dsst = mk()
  const T = day.temp
  for (let i = 0; i < N; i++) {
    if (!ok(T[i])) continue
    const c = column(m, T, i)
    d20[i] = isothermDepth(c, 20); d26[i] = isothermDepth(c, 26); heat[i] = tchp(c); ml[i] = mld(c)
    if (day.sst && ok(day.sst[i])) dsst[i] = c[0] - day.sst[i]
  }
  day._derived = { d20, d26, tchp: heat, mld: ml, dsst }
  return day._derived
}

// ---------------------------------------------------------------- layers
// group: what the layer is. requires: which exported layers it needs.
export const LAYERS = [
  { id: 'temp', group: 'Subsurface', label: 'Temperature', unit: '°C', ramp: 'thermal', perDepth: true, dp: 2, requires: ['temp'],
    help: 'Reconstructed temperature at the selected standard depth.' },
  { id: 'sigma', group: 'Subsurface', label: 'Uncertainty', unit: '°C', ramp: 'tempo', perDepth: true, dp: 2, requires: ['sigma'],
    help: 'Predicted one-sigma uncertainty. Calibrated against Argo on the Validation page.' },
  { id: 'ref', group: 'Subsurface', label: 'GLORYS12', unit: '°C', ramp: 'thermal', perDepth: true, dp: 2, requires: ['ref'],
    help: 'The GLORYS12 reanalysis the model was trained against, for the same day and depth.' },
  { id: 'diff', group: 'Subsurface', label: 'Model − GLORYS', unit: '°C', ramp: 'balance', perDepth: true, symmetric: true, dp: 2, requires: ['temp', 'ref'],
    help: 'Reconstruction minus GLORYS12. Blue: colder than the reanalysis; red: warmer.' },
  { id: 'd20', group: 'Derived', label: 'D20 thermocline', short: 'D20', unit: 'm', ramp: 'deep', dp: 0, requires: ['temp'],
    help: 'Depth of the 20 °C isotherm, the standard Indian Ocean thermocline proxy.' },
  { id: 'd26', group: 'Derived', label: 'D26 isotherm', short: 'D26', unit: 'm', ramp: 'deep', dp: 0, requires: ['temp'],
    help: 'Depth of the 26 °C isotherm: the bottom of the warm water a cyclone can draw on.' },
  { id: 'tchp', group: 'Derived', label: 'Cyclone heat potential', short: 'TCHP', unit: 'kJ cm⁻²', ramp: 'matter', dp: 0, requires: ['temp'],
    help: 'Tropical Cyclone Heat Potential. Above about 50 kJ cm⁻² the ocean can support rapid intensification.' },
  { id: 'mld', group: 'Derived', label: 'Mixed layer depth', short: 'MLD', unit: 'm', ramp: 'deep', dp: 0, requires: ['temp'],
    help: 'Temperature-criterion mixed layer: first depth 0.5 °C colder than at 10 m.' },
  { id: 'dsst', group: 'Derived', label: 'Surface consistency', short: 'T₀ − SST', unit: '°C', ramp: 'balance', symmetric: true, dp: 2, requires: ['temp', 'sst'],
    help: 'Reconstructed 0 m temperature minus the observed SST input. Should sit near zero.' },
  { id: 'sst', group: 'Surface input', label: 'SST', unit: '°C', ramp: 'thermal', dp: 2, requires: ['sst'],
    help: 'Sea surface temperature, a model input.' },
  { id: 'sss', group: 'Surface input', label: 'SSS', unit: 'psu', ramp: 'haline', dp: 2, requires: ['sss'],
    help: 'Sea surface salinity (SMOS/SMAP), a model input.' },
  { id: 'sla', group: 'Surface input', label: 'SLA', unit: 'm', ramp: 'balance', symmetric: true, dp: 3, requires: ['sla'],
    help: 'Sea level anomaly (DUACS). Highs mark a deep thermocline, lows a shallow one.' },
  { id: 'cur', group: 'Surface input', label: 'Current', unit: 'm s⁻¹', ramp: 'speed', dp: 2, requires: ['uc', 'vc'],
    help: 'Surface current speed (OSCAR), a model input.' },
  { id: 'wind', group: 'Surface input', label: 'Wind', unit: 'm s⁻¹', ramp: 'speed', dp: 1, requires: ['uw', 'vw'],
    help: '10 m wind speed (CCMP), a model input.' },
]
export const layerById = Object.fromEntries(LAYERS.map((l) => [l.id, l]))
export const available = (m, l) => l.requires.every((r) => m.has(r))

export function layerGrid(m, day, id, k) {
  const L = layerById[id]
  if (!day || !L.requires.every((r) => day[r])) return null
  switch (id) {
    case 'temp': case 'sigma': case 'ref': return level(m, day[id], k)
    case 'diff': {
      const key = `_diff${k}`
      if (!day[key]) { const a = level(m, day.temp, k), b = level(m, day.ref, k); day[key] = a.map((v, i) => v - b[i]) }
      return day[key]
    }
    case 'cur': case 'wind': {
      const key = `_${id}`, [u, v] = id === 'cur' ? [day.uc, day.vc] : [day.uw, day.vw]
      if (!day[key]) day[key] = u.map((x, i) => Math.hypot(x, v[i]))
      return day[key]
    }
    case 'sst': case 'sss': case 'sla': return day[id]
    default: return derived(m, day)[id]
  }
}

export function robustRange(grid, symmetric = false, q = 0.02) {
  const v = []
  for (let i = 0; i < grid.length; i++) if (ok(grid[i])) v.push(grid[i])
  if (!v.length) return [0, 1]
  v.sort((a, b) => a - b)
  const lo = v[Math.floor(v.length * q)], hi = v[Math.min(v.length - 1, Math.floor(v.length * (1 - q)))]
  if (symmetric) { const s = Math.max(Math.abs(lo), Math.abs(hi)) || 1; return [-s, s] }
  return [lo, hi === lo ? lo + 1 : hi]
}

// ---------------------------------------------------------------- colour maps
// Stops sampled from cmocean (Thyng et al. 2016, Oceanography 29(3)): perceptually uniform, made for ocean data.
export const RAMPS = {
  thermal: ['#042333', '#0e3469', '#3b3496', '#63439c', '#86519a', '#aa5d8c', '#cc6b77', '#e8805a', '#f7a03e', '#fbc743', '#e8fa5b'],
  deep:    ['#fdfecc', '#c3eaa6', '#8bd3a3', '#5fb9a3', '#4a9aa0', '#417b9a', '#3e5b91', '#3b3f7b', '#2e2a55', '#281a2c'],
  matter:  ['#fdedb0', '#f9cb8e', '#f5a770', '#ec835e', '#dd5f58', '#c5405c', '#a42861', '#7f1c5f', '#561853', '#2f0f3d'],
  balance: ['#181c43', '#173f93', '#2e79b8', '#79aac8', '#c6d6df', '#f1ecec', '#e3c1b4', '#d28e75', '#bd5a3f', '#932123', '#3c0912'],
  tempo:   ['#fff6f4', '#d9e3d5', '#b0d0b8', '#86bda0', '#5ea88f', '#3c9084', '#27767b', '#1f5b70', '#1c3f5d', '#151d44'],
  haline:  ['#2a186c', '#1a3b98', '#15608f', '#257f8c', '#3a9b85', '#5bb877', '#92cf66', '#d0e06e', '#fdef9a'],
  speed:   ['#fffdcd', '#e0d98b', '#b6bb57', '#869f33', '#56832b', '#2f6428', '#1d4520', '#172313'],
}
export const CLUSTER_COLORS = ['#2F6F6A', '#C29A55', '#6E86B3', '#B0654A', '#86A873', '#6A5A8C', '#9A9A8E', '#3E4F63']

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const LUT = Object.fromEntries(Object.entries(RAMPS).map(([k, stops]) => {
  const rgb = stops.map(hex), out = new Uint8ClampedArray(256 * 3)
  for (let i = 0; i < 256; i++) {
    const t = (i / 255) * (rgb.length - 1), a = Math.floor(t), b = Math.min(a + 1, rgb.length - 1), u = t - a
    for (let c = 0; c < 3; c++) out[i * 3 + c] = rgb[a][c] + (rgb[b][c] - rgb[a][c]) * u
  }
  return [k, out]
}))
export const rampCss = (name, dir = '90deg') => `linear-gradient(${dir}, ${RAMPS[name].join(',')})`
export function colorAt(ramp, t) {
  const i = Math.max(0, Math.min(255, Math.round(t * 255))) * 3, l = LUT[ramp]
  return `rgb(${l[i]},${l[i + 1]},${l[i + 2]})`
}
export function rgbAt(ramp, t) {
  const i = Math.max(0, Math.min(255, Math.round(t * 255))) * 3, l = LUT[ramp]
  return [l[i], l[i + 1], l[i + 2]]
}

// ---------------------------------------------------------------- map geometry + rendering
// Leaflet stretches an image overlay linearly in Web-Mercator, so the grid is resampled to Mercator row
// spacing first; a plain lat/lon image would drift by ~0.3° mid-domain.
const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
const invMerc = (y) => (360 / Math.PI) * Math.atan(Math.exp(y)) - 90

export function gridBounds(g) {
  const h = g.step / 2
  return [[g.lat0 - (g.height - 1) * g.step - h, g.lon0 - h], [g.lat0 + h, g.lon0 + (g.width - 1) * g.step + h]]
}

let canvas
function mercRows(g) {
  const [[south], [north]] = gridBounds(g), H = g.height * 2, mN = merc(north), mS = merc(south)
  return Array.from({ length: H }, (_, r) => Math.round((g.lat0 - invMerc(mN - ((r + 0.5) / H) * (mN - mS))) / g.step))
}

/** paint(i) → [r,g,b] or null. Returns a data URL of the grid in Mercator row spacing. */
function paintGrid(g, paint) {
  const W = g.width, rows = mercRows(g), H = rows.length
  canvas ??= document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d'), img = ctx.createImageData(W, H)
  for (let r = 0; r < H; r++) {
    const y = rows[r]
    if (y < 0 || y >= g.height) continue
    for (let x = 0; x < W; x++) {
      const c = paint(y * W + x)
      if (!c) continue
      const p = (r * W + x) * 4
      img.data[p] = c[0]; img.data[p + 1] = c[1]; img.data[p + 2] = c[2]; img.data[p + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL()
}

export function renderGrid(g, grid, ramp, [lo, hi]) {
  const l = LUT[ramp], span = hi - lo || 1
  return paintGrid(g, (i) => {
    const v = grid[i]
    if (!ok(v)) return null
    const j = Math.max(0, Math.min(255, Math.round(((v - lo) / span) * 255))) * 3
    return [l[j], l[j + 1], l[j + 2]]
  })
}

/** rgb: Float32Array(3·N) in 0–1 (embedding principal components). */
export function renderRGB(g, rgb, N) {
  return paintGrid(g, (i) => (ok(rgb[i]) ? [rgb[i] * 255, rgb[N + i] * 255, rgb[2 * N + i] * 255] : null))
}

export function renderCategorical(g, labels, colors = CLUSTER_COLORS) {
  const pal = colors.map(hex)
  return paintGrid(g, (i) => (ok(labels[i]) ? pal[labels[i] % pal.length] : null))
}

export function cellAt(g, lat, lon) {
  const y = Math.round((g.lat0 - lat) / g.step), x = Math.round((lon - g.lon0) / g.step)
  if (y < 0 || y >= g.height || x < 0 || x >= g.width) return null
  return { y, x, i: y * g.width + x, lat: g.lat0 - y * g.step, lon: g.lon0 + x * g.step }
}

// ---------------------------------------------------------------- formatting
export const fmt = (v, d = 1) => (v == null || !ok(v) ? '—' : v.toFixed(d))
export const fmtLat = (v) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? 'N' : 'S'}`
export const fmtLon = (v) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? 'E' : 'W'}`
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const fmtDate = (iso, long = false) => {
  const [y, mo, d] = iso.split('-').map(Number)
  return long ? `${d} ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][mo - 1]} ${y}` : `${d} ${MONTHS[mo - 1]} ${y}`
}

export const REGIONS = {
  NIO: { label: 'North Indian Ocean', short: 'NIO', bounds: [[5, 45], [30, 105]] },
  BoB: { label: 'Bay of Bengal', short: 'BoB', bounds: [[5, 80], [23, 100]] },
  AS: { label: 'Arabian Sea', short: 'AS', bounds: [[5, 50], [25, 78]] },
}
export const inRegion = (r, lat, lon) => {
  const [[s, w], [n, e]] = REGIONS[r].bounds
  return lat >= s && lat <= n && lon >= w && lon <= e
}
