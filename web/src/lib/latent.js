// Latent-space views for the Embedding page.
//  - model export: day.embed (3 principal components of the encoder's 64-d embedding, 0–1) + day.cluster
//  - before that: a *preview* computed here from the reference temperature columns (0–300 m): principal
//    components and k-means regimes of the vertical structure. It is labelled as such in the UI; it shows the
//    structure the learned embedding has to capture, it is not the embedding.
import { DEPTHS, column, isothermDepth, tchp } from './ocean'

const K_LEVELS = DEPTHS.indexOf(300) + 1

function jacobiEigen(A) {
  const n = A.length, a = A.map((r) => r.slice()), V = a.map((_, i) => a.map((_, j) => +(i === j)))
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] ** 2
    if (off < 1e-12) break
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p][q]) < 1e-15) continue
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1))
      const c = 1 / Math.sqrt(t * t + 1), s = t * c
      for (let k = 0; k < n; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y }
      for (let k = 0; k < n; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y }
      for (let k = 0; k < n; k++) { const x = V[k][p], y = V[k][q]; V[k][p] = c * x - s * y; V[k][q] = s * x + c * y }
    }
  }
  const vals = a.map((r, i) => r[i]), order = vals.map((_, i) => i).sort((i, j) => vals[j] - vals[i])
  return { values: order.map((i) => vals[i]), vectors: order.map((i) => V.map((r) => r[i])) }
}

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) }

function kmeans(X, k, iters = 25) {
  const r = rng(7), n = X.length, d = X[0].length
  const cent = [X[Math.floor(r() * n)].slice()]
  while (cent.length < k) {                                     // k-means++ seeding
    const dist = X.map((x) => Math.min(...cent.map((c) => c.reduce((s, v, j) => s + (v - x[j]) ** 2, 0))))
    let t = r() * dist.reduce((a, b) => a + b, 0), i = 0
    while ((t -= dist[i]) > 0 && i < n - 1) i++
    cent.push(X[i].slice())
  }
  const lab = new Int32Array(n)
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < n; i++) {
      let b = 0, bd = Infinity
      for (let c = 0; c < k; c++) { let s = 0; for (let j = 0; j < d; j++) s += (X[i][j] - cent[c][j]) ** 2; if (s < bd) { bd = s; b = c } }
      lab[i] = b
    }
    const sum = cent.map(() => new Array(d).fill(0)), cnt = new Array(k).fill(0)
    for (let i = 0; i < n; i++) { cnt[lab[i]]++; for (let j = 0; j < d; j++) sum[lab[i]][j] += X[i][j] }
    for (let c = 0; c < k; c++) if (cnt[c]) cent[c] = sum[c].map((v) => v / cnt[c])
  }
  return lab
}

/** { rgb: Float32Array(3N), cluster: Float32Array(N), explained: [3 fractions], preview: true } */
export function previewLatent(m, day, k = 6) {
  if (day._latent) return day._latent
  const N = m.N, idx = [], X = []
  for (let i = 0; i < N; i++) {
    const c = column(m, day.temp, i).slice(0, K_LEVELS)
    if (c.every(Number.isFinite)) { idx.push(i); X.push(c) }
  }
  const mu = new Array(K_LEVELS).fill(0), sd = new Array(K_LEVELS).fill(0)
  X.forEach((x) => x.forEach((v, j) => { mu[j] += v / X.length }))
  X.forEach((x) => x.forEach((v, j) => { sd[j] += (v - mu[j]) ** 2 / X.length }))
  const Z = X.map((x) => x.map((v, j) => (v - mu[j]) / (Math.sqrt(sd[j]) || 1)))
  const C = mu.map((_, a) => mu.map((_, b) => Z.reduce((s, z) => s + z[a] * z[b], 0) / Z.length))
  const { values, vectors } = jacobiEigen(C)
  const tot = values.reduce((a, b) => a + b, 0)
  const P = Z.map((z) => vectors.slice(0, 4).map((v) => v.reduce((s, w, j) => s + w * z[j], 0)))
  const rgb = new Float32Array(3 * N).fill(NaN), cluster = new Float32Array(N).fill(NaN)
  for (let c = 0; c < 3; c++) {
    const s = P.map((p) => p[c]).sort((a, b) => a - b), lo = s[Math.floor(s.length * 0.01)], hi = s[Math.floor(s.length * 0.99)]
    P.forEach((p, n) => { rgb[c * N + idx[n]] = Math.max(0, Math.min(1, (p[c] - lo) / (hi - lo))) })
  }
  const lab = kmeans(P, k)
  idx.forEach((i, n) => { cluster[i] = lab[n] })
  day._latent = { rgb, cluster: orderRegimes(m, day, cluster, k), explained: values.slice(0, 3).map((v) => v / tot), preview: true }
  return day._latent
}

/** Relabel regimes by mean D20 (shallow thermocline first) so colours mean the same on every day. */
function orderRegimes(m, day, cluster, k) {
  const d = new Array(k).fill(0), n = new Array(k).fill(0)
  for (let i = 0; i < m.N; i++) {
    if (!Number.isFinite(cluster[i])) continue
    const z = isothermDepth(column(m, day.temp, i), 20)
    if (Number.isFinite(z)) { d[cluster[i]] += z; n[cluster[i]]++ }
  }
  const order = d.map((s, c) => [n[c] ? s / n[c] : Infinity, c]).sort((a, b) => a[0] - b[0]).map(([, c]) => c)
  const map = Object.fromEntries(order.map((c, r) => [c, r]))
  return cluster.map((c) => (Number.isFinite(c) ? map[c] : NaN))
}

export function latentFor(m, day) {
  if (day.embed && day.cluster) return { rgb: day.embed, cluster: day.cluster, preview: false }
  return previewLatent(m, day)
}

/** Mean profile, area share and diagnostics per regime. */
export function regimeStats(m, day, cluster) {
  const k = Math.max(0, ...Array.from(cluster).filter(Number.isFinite)) + 1
  const out = Array.from({ length: k }, (_, r) => ({ r, n: 0, sum: new Array(DEPTHS.length).fill(0), cnt: new Array(DEPTHS.length).fill(0), d20: 0, nd20: 0, heat: 0 }))
  for (let i = 0; i < m.N; i++) {
    const c = cluster[i]
    if (!Number.isFinite(c)) continue
    const o = out[c], col = column(m, day.temp, i)
    o.n++
    col.forEach((v, j) => { if (Number.isFinite(v)) { o.sum[j] += v; o.cnt[j]++ } })
    const z = isothermDepth(col, 20)
    if (Number.isFinite(z)) { o.d20 += z; o.nd20++ }
    o.heat += tchp(col) || 0
  }
  const total = out.reduce((s, o) => s + o.n, 0)
  return out.map((o) => ({ r: o.r, share: o.n / total, profile: o.sum.map((s, j) => (o.cnt[j] > o.n * 0.5 ? s / o.cnt[j] : NaN)),
    d20: o.nd20 ? o.d20 / o.nd20 : NaN, tchp: o.n ? o.heat / o.n : NaN }))
}

/** Three latent components (0–1) → a perceptual colour: PC1 drives OKLab lightness, PC2/PC3 a muted hue plane.
 *  Keeps "similar colour = similar state" while staying inside a restrained, print-like gamut. */
export function latentRGB(p1, p2, p3) {
  const L = 0.36 + 0.5 * p1, a = (p2 - 0.5) * 0.2, b = (p3 - 0.5) * 0.2
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b, m_ = L - 0.1055613458 * a - 0.0638541728 * b, s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
  return lin.map((c) => 255 * Math.max(0, Math.min(1, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)))
}
