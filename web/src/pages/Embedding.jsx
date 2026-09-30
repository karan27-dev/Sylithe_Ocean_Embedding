import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../App'
import { Pending, SectionHead } from '../components/ui'
import Field from '../components/FieldCanvas'
import { linePath, linear, sqrtDepth, useWidth } from '../components/charts/scale'
import Timeline from '../components/Timeline'
import { useDay, useDays } from '../lib/data'
import { useView } from '../lib/store'
import { latentFor, latentRGB, regimeStats } from '../lib/latent'
import { CLUSTER_COLORS, DEPTHS, colorAt, column, derived, fmt, fmtDate, fmtLat, fmtLon, isothermDepth, layerById, layerGrid, rgbAt, robustRange } from '../lib/ocean'
import { t100 } from '../lib/cyclone'

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))

function Arrow({ label }) {
  return (
    <div className="flex items-center justify-center py-2 lg:flex-col lg:self-center lg:px-1 lg:py-0 lg:pb-10">
      <span className="label lg:mb-2 lg:[writing-mode:vertical-rl] lg:rotate-180 max-lg:mr-2">{label}</span>
      <svg width="28" height="10" viewBox="0 0 28 10" className="text-mute max-lg:rotate-90" aria-hidden="true">
        <path d="M0 5h26M22 1l4 4-4 4" stroke="currentColor" fill="none" strokeWidth="1" />
      </svg>
    </div>
  )
}

function Mini({ values, color = 'rgb(var(--ink))', height = 96 }) {
  const [ref, W] = useWidth(120)
  const zs = DEPTHS.filter((z) => z <= 500), v = values.slice(0, zs.length)
  const ok = v.filter(Number.isFinite)
  if (!ok.length) return <div ref={ref} style={{ height }} />
  const x = linear(Math.min(...ok) - 0.5, Math.max(...ok) + 0.5, 4, W - 4), y = sqrtDepth(500, 4, height - 4)
  return (
    <div ref={ref}>
      <svg width={W} height={height} className="block">
        {[0, 100, 500].map((z) => <line key={z} x1={0} x2={W} y1={y(z)} y2={y(z)} stroke="rgb(var(--line))" />)}
        <path d={linePath(zs.map((z, k) => [x(v[k]), y(z)]))} fill="none" stroke={color} strokeWidth="1.6" />
      </svg>
    </div>
  )
}

function RegimeProfiles({ stats, active, onActive }) {
  const [ref, W] = useWidth(320)
  const H = 300, zs = DEPTHS.filter((z) => z <= 500)
  const all = stats.flatMap((s) => s.profile.slice(0, zs.length)).filter(Number.isFinite)
  const x = linear(Math.floor(Math.min(...all)), Math.ceil(Math.max(...all)), 34, W - 8), y = sqrtDepth(500, 10, H - 22)
  return (
    <div ref={ref}>
      <svg width={W} height={H} className="block">
        {[0, 50, 100, 200, 500].map((z) => (
          <g key={z}><line x1={34} x2={W - 8} y1={y(z)} y2={y(z)} stroke="rgb(var(--line))" />
            <text x={28} y={y(z) + 3.5} textAnchor="end" className="num fill-faint text-[10px]">{z}</text></g>
        ))}
        {[10, 15, 20, 25, 30].filter((t) => t >= Math.floor(Math.min(...all)) && t <= Math.ceil(Math.max(...all))).map((t) => (
          <text key={t} x={x(t)} y={H - 6} textAnchor="middle" className="num fill-faint text-[10px]">{t}°</text>
        ))}
        {stats.map((s) => (
          <path key={s.r} d={linePath(zs.map((z, k) => [x(s.profile[k]), y(z)]))} fill="none" stroke={CLUSTER_COLORS[s.r]}
            strokeWidth={active === s.r ? 2.6 : 1.6} opacity={active == null || active === s.r ? 1 : 0.2}
            className="transition-opacity duration-200" onMouseEnter={() => onActive(s.r)} onMouseLeave={() => onActive(null)} />
        ))}
      </svg>
    </div>
  )
}

const DEPTH_OPTS = [50, 100, 200]

function pearson(a, b) {
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i]
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    n++; sa += x; sb += y; saa += x * x; sbb += y * y; sab += x * y
  }
  if (n < 30) return NaN
  const cov = sab / n - (sa / n) * (sb / n), va = saa / n - (sa / n) ** 2, vb = sbb / n - (sb / n) ** 2
  return cov / Math.sqrt(va * vb)
}

/** Per-cell physical diagnostics the components are compared with. */
function diagnostics(m, day) {
  const d = derived(m, day), T100 = new Float32Array(m.N).fill(NaN)
  for (let i = 0; i < m.N; i++) if (Number.isFinite(day.temp[i])) T100[i] = t100(column(m, day.temp, i))
  return [['SST', day.sst ?? level0(m, day)], ['Sea level anomaly', day.sla], ['Mixed-layer depth', d.mld], ['Upper-100 m temperature', T100],
    ['D26 (warm-layer depth)', d.d26], ['D20 (thermocline depth)', d.d20], ['Cyclone heat potential', d.tchp]].filter(([, a]) => a)
}
const level0 = (m, day) => day.temp.subarray(0, m.N)

const STEPS = [
  ['Surface window', '15 days × 7 variables, raw + anomaly', '14 × 15 × 101 × 241'],
  ['Encoder', '3-D stem, temporal attention, CBAM blocks', '32 → 256 channels'],
  ['Embedding z', 'the ocean state, per 2° patch', '64 × 14 × 32'],
  ['Decoder', 'U-Net++ with deep supervision', 'μ and σ'],
  ['Temperature column', '15 depths, 0–1000 m', '15 × 101 × 241'],
]

/** Share of each regime over the exported days, as a stacked area chart. */
function RegimeShares({ days, k }) {
  const [ref, W] = useWidth(600)
  const H = 190, L = 34, R = 8, T = 8, B = 24
  if (days.length < 2) return <div ref={ref} />
  const x = (i) => L + (i / (days.length - 1)) * (W - L - R), y = (v) => T + (1 - v) * (H - T - B)
  const shares = days.map((d) => {
    const c = new Array(k).fill(0); let n = 0
    for (const v of d.cluster) if (Number.isFinite(v) && v < k) { c[v]++; n++ }
    return c.map((v) => v / (n || 1))
  })
  const layers = []
  const acc = days.map(() => 0)
  for (let r = 0; r < k; r++) {
    const lo = acc.slice(), hi = acc.map((a, i) => a + shares[i][r])
    layers.push({ r, d: `M${hi.map((v, i) => `${x(i)},${y(v)}`).join('L')}L${lo.map((v, i) => `${x(i)},${y(v)}`).reverse().join('L')}Z` })
    hi.forEach((v, i) => { acc[i] = v })
  }
  const step = Math.max(1, Math.ceil(days.length / 6))
  return (
    <div ref={ref}>
      <svg width={W} height={H} className="block">
        {layers.map((l) => <path key={l.r} d={l.d} fill={CLUSTER_COLORS[l.r]} opacity="0.9" />)}
        {[0, 0.5, 1].map((v) => <text key={v} x={L - 6} y={y(v) + 3.5} textAnchor="end" className="num fill-faint text-[10px]">{v * 100}%</text>)}
        {days.map((d, i) => i % step === 0 && <text key={d.date} x={x(i)} y={H - 6} textAnchor="middle" className="num fill-faint text-[10px]">{fmtDate(d.date).slice(0, 6)}</text>)}
      </svg>
    </div>
  )
}

export default function Embedding() {
  const { m } = useData()
  const { date, set } = useView()
  const day = useDay(m, date)
  const [cell, setCell] = useState(null)
  const [surf, setSurf] = useState('sst')
  const [dz, setDz] = useState(100)
  const [active, setActive] = useState(null)
  const [pin, setPin] = useState(null)

  const lat = useMemo(() => (m && day ? latentFor(m, day) : null), [m, day])
  const stats = useMemo(() => (lat ? regimeStats(m, day, lat.cluster) : []), [lat, m, day])
  const allDays = useDays(m, useMemo(() => m?.days.map((d) => d.date) ?? null, [m]))
  const corr = useMemo(() => {
    if (!lat || !day) return []
    const pcs = [0, 1, 2].map((c) => lat.rgb.subarray(c * m.N, (c + 1) * m.N))
    return diagnostics(m, day).map(([name, a]) => ({ name, r: pcs.map((pc) => pearson(pc, a)) }))
  }, [lat, day, m])
  const sim = useMemo(() => {
    if (!lat || !pin) return null
    const N = m.N, p = [0, 1, 2].map((c) => lat.rgb[c * N + pin.i])
    if (!p.every(Number.isFinite)) return null
    const s = new Float32Array(N).fill(NaN)
    for (let i = 0; i < N; i++) {
      const q = [lat.rgb[i], lat.rgb[N + i], lat.rgb[2 * N + i]]
      if (q.every(Number.isFinite)) s[i] = Math.exp(-((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2) / 0.06)
    }
    const g = m.grid, cand = []
    for (let i = 0; i < N; i++) if (s[i] > 0.05) cand.push(i)
    cand.sort((a, b) => s[b] - s[a])
    const far = []
    for (const i of cand) {
      const la = g.lat0 - Math.floor(i / g.width) * g.step, lo = g.lon0 + (i % g.width) * g.step
      if (Math.hypot(la - pin.lat, lo - pin.lon) > 4 && far.every((f) => Math.hypot(f.lat - la, f.lon - lo) > 4)) far.push({ lat: la, lon: lo, s: s[i] })
      if (far.length === 3) break
    }
    const share = Array.from(s).filter((v) => v > 0.5).length / Array.from(s).filter(Number.isFinite).length
    return { s, far, share }
  }, [lat, pin, m])
  const paintSim = useMemo(() => sim && ((i) => (Number.isFinite(sim.s[i]) ? rgbAt('tempo', sim.s[i]) : null)), [sim])

  const surfLayers = m ? ['sst', 'sss', 'sla', 'cur', 'wind'].filter((id) => layerById[id].requires.every((r) => m.has(r))) : []
  const sGrid = useMemo(() => day && layerGrid(m, day, surf, 0), [m, day, surf])
  const sRange = useMemo(() => sGrid && robustRange(sGrid, layerById[surf].symmetric), [sGrid, surf])
  const tGrid = useMemo(() => day && layerGrid(m, day, 'temp', DEPTHS.indexOf(dz)), [m, day, dz])
  const tRange = useMemo(() => tGrid && robustRange(tGrid), [tGrid])

  const paintS = useMemo(() => sGrid && ((i) => Number.isFinite(sGrid[i]) ? rgbAt(layerById[surf].ramp, (sGrid[i] - sRange[0]) / (sRange[1] - sRange[0])) : null), [sGrid, sRange, surf])
  const paintZ = useMemo(() => lat && ((i) => Number.isFinite(lat.rgb[i]) ? latentRGB(lat.rgb[i], lat.rgb[m.N + i], lat.rgb[2 * m.N + i]) : null), [lat, m])
  const paintT = useMemo(() => tGrid && ((i) => Number.isFinite(tGrid[i]) ? rgbAt('thermal', (tGrid[i] - tRange[0]) / (tRange[1] - tRange[0])) : null), [tGrid, tRange])
  const paintC = useMemo(() => lat && ((i) => Number.isFinite(lat.cluster[i]) ? hex(CLUSTER_COLORS[lat.cluster[i]]) : null), [lat])
  const dimC = useMemo(() => (active == null || !lat ? null : (i) => lat.cluster[i] !== active), [active, lat])

  useEffect(() => { if (m && !cell) { const y = Math.round((m.grid.lat0 - 15) / m.grid.step), x = Math.round((88 - m.grid.lon0) / m.grid.step); setCell({ x, y, i: y * m.grid.width + x, lat: 15, lon: 88 }) } }, [m, cell])
  useEffect(() => { if (m && !pin) { const y = Math.round((m.grid.lat0 - 15) / m.grid.step), x = Math.round((88 - m.grid.lon0) / m.grid.step); setPin({ x, y, i: y * m.grid.width + x, lat: 15, lon: 88 }) } }, [m, pin])

  if (!m || !day || !lat) return <div className="page min-h-[70vh] pt-16"><p className="label">Loading</p></div>

  const col = cell && column(m, day.temp, cell.i)
  const ocean = cell && Number.isFinite(day.temp[cell.i])
  const z3 = ocean ? [0, 1, 2].map((c) => lat.rgb[c * m.N + cell.i]) : null
  const regime = ocean ? lat.cluster[cell.i] : NaN

  return (
    <div className="pb-8">
      <div className="page pt-12 sm:pt-16">
        <SectionHead as="h1" label="Embedding engine" title="The ocean surface, compressed to what matters below it">
          A masked autoencoder reads fifteen days of seven surface variables and learns a 64-dimensional state for every
          patch of ocean, without ever seeing a subsurface label. The reconstruction decodes temperature at fifteen depths from
          that state. Hover any panel: the three views are the same ocean, cell for cell.
        </SectionHead>
        <ol className="mt-8 grid gap-2 md:grid-cols-5">
          {STEPS.map(([t, d, sh], i) => (
            <li key={t} className={`rounded-[10px] border px-3 py-2.5 ${i === 2 ? 'border-ink bg-ink text-paper' : 'border-[#EBDCCB] bg-[#FAF0E6]'}`}>
              <p className="num text-[10.5px] opacity-60">0{i + 1}</p>
              <p className="text-[13px] font-medium">{t}</p>
              <p className="mt-0.5 text-[11.5px] opacity-75">{d}</p>
              <p className="num mt-1 text-[10.5px] opacity-60">{sh}</p>
            </li>))}
        </ol>
        <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-line bg-line sm:grid-cols-5">
          {[['64', 'dimensions per patch'], ['2°', 'patch size (1/8 of the grid)'], ['19 years', 'of surface data, no labels, for pretraining'],
            [lat.explained ? `${Math.round(lat.explained.reduce((a, b) => a + b, 0) * 100)} %` : '3', lat.explained ? 'variance in the 3 components shown' : 'components shown as colour'],
            [String(stats.length), 'ocean regimes (k-means)']].map(([v, l]) => (
            <div key={l} className="bg-paper px-4 py-3"><p className="num text-[20px] leading-none text-ink">{v}</p><p className="mt-1 text-[11.5px] text-mute">{l}</p></div>))}
        </div>
        {lat.preview && (
          <Pending className="mt-8" title="Preview: the learned embedding is not exported yet">
            The middle panel currently shows the three leading principal components of the reference temperature columns
            (0–300 m) on {fmtDate(day.date)}: the structure the encoder has to learn from the surface. Notebook 03 replaces it
            with the encoder's own 64-d embedding, projected the same way, and its k-means regimes.
          </Pending>
        )}
        <div className="mt-6 flex items-center gap-4">
          <span className="label">Day</span>
          <Timeline days={m.days} value={date} onChange={(d) => set({ date: d })} className="min-w-[280px] max-w-[640px] flex-1" />
          <span className="num text-[12.5px] text-ink">{fmtDate(date)}</span>
        </div>
      </div>

      {/* triptych */}
      <section className="mx-auto mt-10 w-full max-w-[1480px] px-4 sm:px-8">
        <div className="grid items-start gap-0 lg:grid-cols-[1fr_auto_1fr_auto_1fr] lg:gap-3">
          <figure>
            <figcaption className="mb-3 flex h-6 items-center justify-between gap-3">
              <span><span className="label mr-2">01</span><span className="text-[14px] text-ink">Surface state</span></span>
              <span className="flex gap-3">
                {surfLayers.map((id) => (
                  <button key={id} onClick={() => setSurf(id)} aria-selected={surf === id} className="tab !py-0 text-[12px]">{layerById[id].label}</button>
                ))}
              </span>
            </figcaption>
            <Field m={m} paint={paintS} cell={cell} onHover={setCell} label="Surface state" />
            <p className="mt-2 text-[11.5px] text-mute">{layerById[surf].help} {surfLayers.length < 5 && 'The other inputs arrive with the model export.'}</p>
          </figure>
          <Arrow label="encoder" />
          <figure>
            <figcaption className="mb-3 flex h-6 items-center justify-between gap-3">
              <span><span className="label mr-2">02</span><span className="text-[14px] text-ink">Latent representation</span></span>
              <span className="label">{lat.preview ? 'preview · PCA' : '64-d → 3 PCs'}</span>
            </figcaption>
            <Field m={m} paint={paintZ} cell={cell} onHover={setCell} label="Latent representation" />
            <p className="mt-2 text-[11.5px] text-mute">Colour is position in latent space: similar colours, similar ocean state.
              {lat.explained && ` First three components explain ${Math.round(lat.explained.reduce((a, b) => a + b, 0) * 100)} % of the variance.`}</p>
          </figure>
          <Arrow label="decoder" />
          <figure>
            <figcaption className="mb-3 flex h-6 items-center justify-between gap-3">
              <span><span className="label mr-2">03</span><span className="text-[14px] text-ink">Subsurface structure</span></span>
              <span className="flex gap-3">
                {DEPTH_OPTS.map((z) => <button key={z} onClick={() => setDz(z)} aria-selected={dz === z} className="tab !py-0 text-[12px]">{z} m</button>)}
              </span>
            </figcaption>
            <Field m={m} paint={paintT} cell={cell} onHover={setCell} label="Subsurface temperature" />
            <p className="mt-2 text-[11.5px] text-mute">Temperature at {dz} m, {fmt(tRange[0], 1)}–{fmt(tRange[1], 1)} °C.</p>
          </figure>
        </div>

        {/* linked readout */}
        <div className="mt-8 grid border-y border-line lg:grid-cols-[1fr_auto_1fr_auto_1fr] lg:gap-3">
          <div className="py-4">
            <p className="label">At {cell ? `${fmtLat(cell.lat)} ${fmtLon(cell.lon)}` : '—'}</p>
            {ocean ? (
              <p className="num mt-2 text-[22px] leading-none text-ink">{fmt(sGrid[cell.i], layerById[surf].dp)}<span className="ml-1 text-[12px] text-faint">{layerById[surf].unit} {layerById[surf].label}</span></p>
            ) : <p className="mt-2 text-[13px] text-mute">Land</p>}
          </div>
          <span className="hidden w-[36px] lg:block" />
          <div className="border-t border-line py-4 lg:border-0">
            <p className="label">Latent state</p>
            {z3 && (
              <div className="mt-2 flex items-center gap-4">
                <span className="h-9 w-9 shrink-0 rounded-[3px]" style={{ background: `rgb(${latentRGB(...z3).map(Math.round).join(',')})` }} />
                <div className="min-w-0 flex-1 space-y-1">
                  {z3.map((v, c) => (
                    <div key={c} className="flex items-center gap-2">
                      <span className="num w-7 text-[10.5px] text-faint">PC{c + 1}</span>
                      <span className="h-[3px] flex-1 bg-line"><span className="block h-full bg-ink transition-[width] duration-200" style={{ width: `${v * 100}%` }} /></span>
                    </div>
                  ))}
                </div>
                {Number.isFinite(regime) && <span className="shrink-0 text-[12px] text-mute"><span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: CLUSTER_COLORS[regime] }} />Regime {regime + 1}</span>}
              </div>
            )}
          </div>
          <span className="hidden w-[36px] lg:block" />
          <div className="flex items-center gap-4 border-t border-line py-4 lg:border-0">
            <div className="w-24 shrink-0">{col && <Mini values={col} height={64} />}</div>
            {ocean && (
              <dl className="num grid grid-cols-2 gap-x-5 gap-y-1 text-[12px]">
                <dt className="text-faint">D20</dt><dd className="text-ink">{fmt(isothermDepth(col, 20), 0)} m</dd>
                <dt className="text-faint">D26</dt><dd className="text-ink">{fmt(isothermDepth(col, 26), 0)} m</dd>
              </dl>
            )}
          </div>
        </div>
      </section>

      {/* meaning of the components */}
      <section className="page mt-20 grid gap-10 lg:grid-cols-[1fr_1.2fr]">
        <SectionHead label="What the embedding knows" title="Each component tracks something physical">
          The encoder was never told about the thermocline or cyclone heat. Correlating its three leading components with physical quantities,
          cell by cell on {fmtDate(date)}, shows what it learned on its own from the surface. |r| close to 1 means the component carries that property.
        </SectionHead>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[460px] text-[12.5px]">
            <thead><tr className="border-b border-line text-left"><th className="label py-2 font-normal">Property</th>
              {['PC1', 'PC2', 'PC3'].map((h) => <th key={h} className="label py-2 text-center font-normal">{h}</th>)}</tr></thead>
            <tbody>{corr.map((c) => (
              <tr key={c.name} className="border-b border-line">
                <td className="py-2 pr-3 text-ink">{c.name}</td>
                {c.r.map((r, j) => (
                  <td key={j} className="py-1.5 text-center">
                    <span className="num inline-block min-w-[58px] rounded-[4px] px-2 py-1 text-[12px]"
                      style={{ background: Number.isFinite(r) ? colorAt('balance', (r + 1) / 2) : 'transparent', color: Math.abs(r) > 0.55 ? '#fff' : 'rgb(var(--ink))' }}>
                      {Number.isFinite(r) ? (r >= 0 ? '+' : '') + r.toFixed(2) : '—'}</span></td>))}
              </tr>))}</tbody>
          </table>
          {corr.length > 0 && (() => {
            const best = [0, 1, 2].map((j) => corr.reduce((b, c) => (Math.abs(c.r[j]) > Math.abs(b.r[j]) ? c : b), corr[0]))
            return <p className="mt-3 text-[12.5px] text-ink2">{best.map((b, j) => `PC${j + 1} is most related to ${b.name.toLowerCase()} (r = ${b.r[j].toFixed(2)})`).join('; ')}. No single component equals one property: the 64 dimensions mix them, which is why the decoder, not a linear readout, turns them into temperature.</p>
          })()}
          <p className="mt-1 text-[11.5px] text-faint">Pearson r over all ocean cells. Red: higher component, higher value; blue: the opposite.</p>
        </div>
      </section>

      {/* similarity search */}
      <section className="page mt-20">
        <SectionHead label="Find similar ocean" title="Click any cell: where else is the ocean in the same state?">
          Distance in the embedding measures how alike two places are, from the surface down. Click the map to choose a reference cell;
          brighter means closer in latent space.
        </SectionHead>
        <div className="mt-8 grid gap-8 lg:grid-cols-[1.4fr_1fr]">
          <div onClick={() => cell && setPin(cell)}>
            <Field m={m} paint={paintSim ?? paintZ} cell={pin} onHover={setCell} label="Latent similarity" />
            <p className="mt-2 text-[11.5px] text-mute">Similarity = exp(−d² / 0.06), d = distance between cells in the three leading components.</p>
          </div>
          <div>
            <p className="label">Reference cell</p>
            <p className="num mt-1 text-[18px] text-ink">{pin ? `${fmtLat(pin.lat)} ${fmtLon(pin.lon)}` : '—'}</p>
            {sim ? (<>
              <p className="mt-3 text-[13px] text-ink2">{Math.round(sim.share * 100)} % of the basin is in a similar state (similarity &gt; 0.5).</p>
              <p className="label mt-5 mb-2">Closest matches at least 4° away</p>
              <ol className="border-t border-line">{sim.far.map((f, i) => (
                <li key={i} className="num flex justify-between border-b border-line py-2 text-[12.5px]"><span className="text-ink">{i + 1}. {fmtLat(f.lat)} {fmtLon(f.lon)}</span><span className="text-mute">{f.s.toFixed(2)}</span></li>))}
                {!sim.far.length && <li className="py-2 text-[12.5px] text-mute">No distant cell is even loosely similar: the state is local.</li>}</ol>
            </>) : <p className="mt-3 text-[13px] text-mute">Choose an ocean cell.</p>}
            <p className="mt-4 text-[11.5px] text-faint">Use it to find analogues of a known condition, e.g. the ocean ahead of a past cyclone, or waters like a productive fishing ground.</p>
          </div>
        </div>
      </section>

      {/* regimes */}
      <section className="page mt-20">
        <SectionHead label="Latent regimes" title="Nearby in latent space, alike below the surface">
          Clustering the latent states groups the ocean into regimes. If the representation is useful, each regime should have
          its own vertical structure: a distinct mixed layer, thermocline depth and heat content. Hover a regime to isolate it.
        </SectionHead>
        <div className="mt-10 grid gap-10 lg:grid-cols-[1.35fr_1fr]">
          <div>
            <Field m={m} paint={paintC} dim={dimC} cell={null} onHover={() => {}} label="Latent regimes" />
            <p className="mt-2 text-[11.5px] text-mute">k-means on the {lat.preview ? 'leading principal components' : 'embedding'}, k = {stats.length}. Regimes are ordered by thermocline depth, shallow first.</p>
          </div>
          <div>
            <RegimeProfiles stats={stats} active={active} onActive={setActive} />
            <table className="mt-4 w-full text-[12.5px]">
              <thead><tr className="border-b border-line text-left"><th className="label pb-2 font-normal">Regime</th><th className="label pb-2 text-right font-normal">Area</th><th className="label pb-2 text-right font-normal">D20</th><th className="label pb-2 text-right font-normal">TCHP</th></tr></thead>
              <tbody>
                {stats.map((s) => (
                  <tr key={s.r} onMouseEnter={() => setActive(s.r)} onMouseLeave={() => setActive(null)}
                    className={`cursor-default border-b border-line transition-colors ${active === s.r ? 'bg-wash' : ''}`}>
                    <td className="py-2"><span className="mr-2 inline-block h-2 w-2 rounded-full align-middle" style={{ background: CLUSTER_COLORS[s.r] }} />{s.r + 1}</td>
                    <td className="num py-2 text-right text-ink2">{Math.round(s.share * 100)} %</td>
                    <td className="num py-2 text-right text-ink2">{fmt(s.d20, 0)} m</td>
                    <td className="num py-2 text-right text-ink2">{fmt(s.tchp, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-[11.5px] text-mute">Mean over the regime. TCHP in kJ cm⁻². <Link to="/explorer" className="link">Open in the Explorer</Link></p>
          </div>
        </div>
        {allDays.length > 1 && !lat.preview && (
          <div className="mt-10">
            <p className="label mb-2">Regime share, day by day · {fmtDate(allDays[0].date)} – {fmtDate(allDays[allDays.length - 1].date)}</p>
            <RegimeShares days={allDays.filter((d) => d.cluster)} k={stats.length} />
            <p className="mt-1 text-[11.5px] text-mute">A regime growing or shrinking over days is the ocean changing state, e.g. a warm deep layer spreading before the monsoon onset.</p>
          </div>
        )}
      </section>

      {/* how it was learned */}
      <section className="page mt-20 grid gap-10 lg:grid-cols-2">
        <SectionHead label="How it was learned" title="Self-supervised first, then taught the subsurface">
          The encoder was pretrained as a masked autoencoder on nineteen years of surface data (2005–2023) with no subsurface labels: half of the
          16 × 16 patches in the last three days were hidden and whole variables were dropped, and it had to fill them in. To do that it must learn how
          eddies, fronts and currents evolve. Only then was the full network fine-tuned against GLORYS12 to predict temperature at depth.
        </SectionHead>
        <dl className="border-t border-line text-[13.5px]">
          {[['Why it matters', 'The embedding exists before any reanalysis is seen, so it describes the surface ocean on its own terms.'],
            ['What it bought', 'The largest gains over the published architecture are where the surface–subsurface link is weakest: below 200 m (p = 0.003) and in the Bay of Bengal (p = 0.007).'],
            ['What is shown here', '3 leading principal components of the 64-d embedding, scaled to 0–1 and mapped to colour; regimes are k-means on the embedding.'],
            ['Limits', 'Each vector describes a 2° patch, so features smaller than that are summarised; 3 components show most, not all, of the 64 dimensions.']].map(([t, d]) => (
            <div key={t} className="grid gap-1 border-b border-line py-3 sm:grid-cols-[150px_1fr] sm:gap-5"><dt className="text-ink">{t}</dt><dd className="text-ink2">{d}</dd></div>))}
        </dl>
      </section>
    </div>
  )
}
