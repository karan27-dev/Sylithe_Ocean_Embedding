// Ocean data model for the console. A "field" is one day on the 0.25° NIO grid, rows north→south:
// { date, source, lon0, lat0, step, width, height, depths[15], temp[15][H][W], sst[H][W], sigma?, reference? }
// Derived diagnostics mirror oceanembed/metrics.py (piecewise-linear columns, exact integrals).

export const DEPTHS = [0, 5, 10, 20, 30, 50, 75, 100, 125, 150, 200, 300, 500, 700, 1000]
const RHO = 1025, CP = 3985

export const DATASETS = [
  { id: '2024-05-15', label: '15 May 2024', note: 'Pre-monsoon · peak cyclone-season heat', file: '/data/hycom_2024-05-15.json' },
  { id: '2024-01-15', label: '15 Jan 2024', note: 'NE monsoon · Bay of Bengal barrier layer', file: '/data/hycom_2024-01-15.json' },
]

export async function loadField(file) {
  const r = await fetch(file)
  if (!r.ok) throw new Error(`${file}: ${r.status}`)
  const f = await r.json()
  f.derived = derive(f)
  return f
}

export function column(f, y, x) {
  return f.temp.map((lvl) => lvl[y][x])
}

// depth (m) where the column first reaches `iso` (linear between levels); null if never / land
export function isothermDepth(col, iso) {
  if (col[0] == null) return null
  if (col[0] <= iso) return 0
  for (let k = 1; k < col.length; k++) {
    if (col[k] == null) return null
    if (col[k] <= iso) {
      const t0 = col[k - 1], t1 = col[k], z0 = DEPTHS[k - 1], z1 = DEPTHS[k]
      return z0 + ((t0 - iso) / (t0 - t1)) * (z1 - z0)
    }
  }
  return null
}

// Tropical Cyclone Heat Potential, kJ cm⁻² = ρ·cp·∫₀^D26 (T−26) dz / 1e7
export function tchp(col) {
  if (col[0] == null) return null
  let J = 0
  for (let k = 1; k < col.length; k++) {
    const t0 = col[k - 1], t1 = col[k]
    if (t0 == null || t1 == null || t0 <= 26) break
    const z0 = DEPTHS[k - 1], z1 = DEPTHS[k]
    if (t1 >= 26) { J += ((t0 + t1) / 2 - 26) * (z1 - z0); continue }
    const zc = z0 + ((t0 - 26) / (t0 - t1)) * (z1 - z0)
    J += ((t0 - 26) / 2) * (zc - z0)
    break
  }
  return (RHO * CP * J) / 1e7
}

// Mixed-layer depth: first depth below 10 m where T < T(10 m) − 0.5 °C
export function mld(col, dT = 0.5) {
  const ref = col[2]
  if (ref == null) return null
  const thr = ref - dT
  for (let k = 3; k < col.length; k++) {
    if (col[k] == null) return null
    if (col[k] < thr) {
      const t0 = col[k - 1], t1 = col[k], z0 = DEPTHS[k - 1], z1 = DEPTHS[k]
      return z0 + ((t0 - thr) / (t0 - t1)) * (z1 - z0)
    }
  }
  return null
}

function derive(f) {
  const H = f.height, W = f.width
  const mk = () => Array.from({ length: H }, () => new Array(W).fill(null))
  const d20 = mk(), d26 = mk(), heat = mk(), ml = mk(), dsst = mk()
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = column(f, y, x)
    if (c[0] == null) continue
    d20[y][x] = isothermDepth(c, 20)
    d26[y][x] = isothermDepth(c, 26)
    heat[y][x] = tchp(c)
    ml[y][x] = mld(c)
    const s = f.sst?.[y]?.[x]
    dsst[y][x] = s == null ? null : c[0] - s
  }
  return { d20, d26, tchp: heat, mld: ml, dsst }
}

// ---------------------------------------------------------------- layers
export const LAYERS = [
  { id: 'temp', label: 'Temperature', unit: '°C', ramp: 'thermal', perDepth: true, help: 'Subsurface temperature at the selected standard depth.' },
  { id: 'sst', label: 'SST (input)', unit: '°C', ramp: 'thermal', help: 'OISST v2.1 sea surface temperature: a model input, not an output.' },
  { id: 'd26', label: 'D26 isotherm', unit: 'm', ramp: 'depth', help: 'Depth of the 26 °C isotherm: bottom of cyclone-usable warm water.' },
  { id: 'tchp', label: 'Cyclone heat (TCHP)', unit: 'kJ/cm²', ramp: 'heat', help: 'Tropical Cyclone Heat Potential. Above ~50 kJ/cm² supports rapid intensification.' },
  { id: 'd20', label: 'D20 thermocline', unit: 'm', ramp: 'depth', help: 'Depth of the 20 °C isotherm: the standard Indian Ocean thermocline proxy.' },
  { id: 'mld', label: 'Mixed layer', unit: 'm', ramp: 'depth', help: 'Temperature-criterion mixed-layer depth (ΔT = 0.5 °C from 10 m).' },
  { id: 'dsst', label: 'T(0 m) − SST', unit: '°C', ramp: 'diverging', symmetric: true, help: 'Reconstruction surface vs the observed SST input. Should be near zero.' },
]

export function layerGrid(f, layer, depthIdx) {
  if (layer === 'temp') return f.temp[depthIdx]
  if (layer === 'sst') return f.sst
  return f.derived[layer]
}

export function robustRange(grid, symmetric = false) {
  const v = []
  for (const row of grid) for (const x of row) if (x != null && Number.isFinite(x)) v.push(x)
  if (!v.length) return [0, 1]
  v.sort((a, b) => a - b)
  const lo = v[Math.floor(v.length * 0.02)], hi = v[Math.floor(v.length * 0.98)]
  if (symmetric) { const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1; return [-m, m] }
  return [lo, hi === lo ? lo + 1 : hi]
}

// ---------------------------------------------------------------- colour ramps
// thermal: lightness-monotonic, built from Sylithe teal → leaf → lime (cold = dark, warm = light)
// depth / heat: single-hue sequential; diverging: two hues around a neutral grey midpoint
const RAMPS = {
  thermal: ['#062125', '#08393f', '#0b5250', '#11704a', '#16a34a', '#5cbf3c', '#A3E635', '#d4f58c', '#f4fcd9'],
  depth: ['#e7f3ee', '#bfe0d1', '#8cc7b0', '#5aa98f', '#2f8a72', '#136b5a', '#08292F'],
  heat: ['#fdf4e3', '#fbdca8', '#f6b867', '#ec8a35', '#d4611c', '#a84310', '#6e2a0a'],
  diverging: ['#1d4ed8', '#5b8def', '#a9c2f5', '#e5e7eb', '#f7b98d', '#ec7b3c', '#b8420f'],
}
export const rampStops = (name) => RAMPS[name]

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const LUT = Object.fromEntries(Object.entries(RAMPS).map(([k, stops]) => {
  const rgb = stops.map(hex), n = 256, out = new Uint8ClampedArray(n * 3)
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * (rgb.length - 1), a = Math.floor(t), b = Math.min(a + 1, rgb.length - 1), u = t - a
    for (let c = 0; c < 3; c++) out[i * 3 + c] = rgb[a][c] + (rgb[b][c] - rgb[a][c]) * u
  }
  return [k, out]
}))

export function colorAt(ramp, t) {
  const i = Math.max(0, Math.min(255, Math.round(t * 255))) * 3, l = LUT[ramp]
  return `rgb(${l[i]},${l[i + 1]},${l[i + 2]})`
}

// Render a grid to a PNG data URL in Web-Mercator row spacing, so Leaflet's linear image stretch
// puts every 0.25° cell where it belongs (a plain lat/lon image drifts by ~0.3° mid-domain).
const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
const invMerc = (m) => (360 / Math.PI) * Math.atan(Math.exp(m)) - 90

export function gridBounds(f) {
  const h = f.step / 2
  const south = f.lat0 - (f.height - 1) * f.step - h, north = f.lat0 + h
  const west = f.lon0 - h, east = f.lon0 + (f.width - 1) * f.step + h
  return [[south, west], [north, east]]
}

export function renderGrid(f, grid, ramp, [lo, hi]) {
  const [[south], [north]] = gridBounds(f)
  const W = f.width, H = f.height * 2
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H
  const ctx = cv.getContext('2d'), img = ctx.createImageData(W, H), l = LUT[ramp]
  const mN = merc(north), mS = merc(south)
  for (let r = 0; r < H; r++) {
    const lat = invMerc(mN - ((r + 0.5) / H) * (mN - mS))
    const y = Math.round((f.lat0 - lat) / f.step)
    if (y < 0 || y >= f.height) continue
    for (let x = 0; x < W; x++) {
      const v = grid[y][x]
      if (v == null) continue
      const i = Math.max(0, Math.min(255, Math.round(((v - lo) / (hi - lo)) * 255))) * 3
      const p = (r * W + x) * 4
      img.data[p] = l[i]; img.data[p + 1] = l[i + 1]; img.data[p + 2] = l[i + 2]; img.data[p + 3] = 235
    }
  }
  ctx.putImageData(img, 0, 0)
  return cv.toDataURL()
}

export function cellAt(f, lat, lon) {
  const y = Math.round((f.lat0 - lat) / f.step), x = Math.round((lon - f.lon0) / f.step)
  if (y < 0 || y >= f.height || x < 0 || x >= f.width) return null
  return { y, x, lat: f.lat0 - y * f.step, lon: f.lon0 + x * f.step }
}

export const fmt = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d))
