import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../App'
import { Pending, SectionHead } from '../components/ui'
import Field from '../components/FieldCanvas'
import { linePath, linear, sqrtDepth, useWidth } from '../components/charts/scale'
import Timeline from '../components/Timeline'
import { useDay } from '../lib/data'
import { useView } from '../lib/store'
import { latentFor, latentRGB, regimeStats } from '../lib/latent'
import { CLUSTER_COLORS, DEPTHS, column, fmt, fmtDate, fmtLat, fmtLon, isothermDepth, layerById, layerGrid, rgbAt, robustRange } from '../lib/ocean'

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

export default function Embedding() {
  const { m } = useData()
  const { date, set } = useView()
  const day = useDay(m, date)
  const [cell, setCell] = useState(null)
  const [surf, setSurf] = useState('sst')
  const [dz, setDz] = useState(100)
  const [active, setActive] = useState(null)

  const lat = useMemo(() => (m && day ? latentFor(m, day) : null), [m, day])
  const stats = useMemo(() => (lat ? regimeStats(m, day, lat.cluster) : []), [lat, m, day])

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
      </section>
    </div>
  )
}
