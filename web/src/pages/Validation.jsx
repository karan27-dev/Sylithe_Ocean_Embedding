import { useMemo, useState } from 'react'
import { useData } from '../App'
import OceanMap from '../components/map/OceanMap'
import ProfileChart from '../components/charts/ProfileChart'
import { Coverage, ErrorStrip, SkillByDepth, styleOf } from '../components/charts/SkillCharts'
import { Pending, SectionHead } from '../components/ui'
import { useJSON } from '../lib/data'
import { DEPTHS, REGIONS, colorAt, fmt, fmtDate, fmtLat, fmtLon, inRegion } from '../lib/ocean'

// Reported in the literature (oceanembed/benchmark.py). Different region, depths and reference data: context only.
const PUBLISHED = [
  { method: 'Attention 3D U-Net++ (Wang et al., ESSD 18:4617, 2026)', rmse: 0.61, setup: 'NW Pacific 0–40°N 120–160°E, 5–2000 m, vs WOD profiles 2023, SST + SSH inputs' },
  { method: 'DSVIT downscaling ViT (Deep-Sea Res. II, 2025)', rmse: 0.29, setup: 'tropical Indian Ocean, vs its own independent test set' },
]
const LB_COLS = ['RMSE vs Argo (°C)', 'RMSE vs GLORYS (°C)', 'Argo 0–200 m', 'Argo 200–1000 m', 'Argo Bay of Bengal', 'Argo Arabian Sea', 'Argo bias (°C)']
const ERR_MAX = 1.5

function profileRmse(p, prod) {
  const e = p.obs.map((o, k) => (p.products[prod]?.[k] ?? NaN) - (o ?? NaN)).filter(Number.isFinite)
  return e.length ? Math.sqrt(e.reduce((s, v) => s + v * v, 0) / e.length) : NaN
}

function Section({ label, title, children, lede }) {
  return (
    <section className="page mt-20">
      <SectionHead label={label} title={title}>{lede}</SectionHead>
      <div className="mt-8">{children}</div>
    </section>
  )
}

export default function Validation() {
  const { m } = useData()
  const skill = useJSON('skill_depth.json')
  const argo = useJSON('argo.json')
  const coverage = useJSON('coverage.json')
  const board = useJSON('leaderboard.json')
  const [region, setRegion] = useState('NIO')
  const [sel, setSel] = useState(null)

  const products = useMemo(() => (skill ? [...new Set(skill.map((r) => r.product))] : []), [skill])
  const primary = m?.primary && products.includes(m.primary) ? m.primary : products[0]
  const rows = useMemo(() => (skill ? skill.filter((r) => r.region === region && r.vs === 'argo') : []), [skill, region])
  const profiles = useMemo(() => (argo?.profiles ?? []).filter((p) => inRegion(region, p.lat, p.lon)), [argo, region])
  const points = useMemo(() => (argo?.profiles ?? []).map((p) => {
    const e = profileRmse(p, primary), inside = inRegion(region, p.lat, p.lon)
    return { ...p, rm: e, color: Number.isFinite(e) ? colorAt('matter', Math.min(1, e / ERR_MAX)) : '#C8C3BA',
      r: sel?.id === p.id ? 7 : 4.5, stroke: sel?.id === p.id ? '#15181A' : '#F5F3EE', weight: sel?.id === p.id ? 2 : 1, ...(inside ? {} : { color: '#D8D4CC' }) }
  }), [argo, primary, region, sel])

  if (!m || skill === undefined || argo === undefined) return <div className="page min-h-[70vh] pt-16"><p className="label">Loading</p></div>

  const model = m.source.kind === 'model'
  const cur = sel ?? profiles.slice().sort((a, b) => profileRmse(a, primary) - profileRmse(b, primary))[Math.floor(profiles.length / 2)]
  const n = profiles.length
  const overall = (() => {
    const e = profiles.flatMap((p) => p.obs.map((o, k) => (p.products[primary]?.[k] ?? NaN) - (o ?? NaN))).filter(Number.isFinite)
    return e.length ? { rmse: Math.sqrt(e.reduce((s, v) => s + v * v, 0) / e.length), bias: e.reduce((s, v) => s + v, 0) / e.length, n: e.length } : null
  })()

  return (
    <div className="pb-8">
      <div className="page pt-12 sm:pt-16">
        <SectionHead as="h1" label="Validation · independent observations" title="Scored against floats the model never saw">
          Every product is compared with quality-controlled Argo profiles, interpolated to the fifteen standard depths and
          matched to the nearest 0.25° cell {model ? 'on the same day' : `within ±${argo?.window_days ?? 3} days`}. GLORYS and HYCOM are scored on
          exactly the same floats, so the comparison is like for like.
        </SectionHead>
        {!model && (
          <Pending className="mt-8" title="These numbers are for the HYCOM reference field, not yet for Sylithe Ocean Model">
            Until the reconstruction is exported, this page scores HYCOM GOFS 3.1 against {argo?.profiles?.length ?? 0} real Argo profiles
            around {m.days.map((d) => fmtDate(d.date)).join(' and ')}. Every chart below is computed, none is illustrative. Notebook 03
            adds Sylithe Ocean Model, GLORYS12 and the held-out year 2023 to the same views.
          </Pending>
        )}

        {/* headline: one sentence of numbers, not tiles */}
        {overall && (
          <div className="mt-10 grid grid-cols-2 border-y border-line sm:grid-cols-4">
            {[
              ['Profiles', n, ''],
              ['Matched values', overall.n, ''],
              [`RMSE, ${styleOf(primary, m).label}`, fmt(overall.rmse, 2), '°C'],
              ['Mean bias', `${overall.bias > 0 ? '+' : ''}${fmt(overall.bias, 2)}`, '°C'],
            ].map(([k, v, u], i) => (
              <div key={k} className={`py-4 ${i % 2 ? 'border-l border-line pl-4 sm:pl-5' : ''} ${i === 2 ? 'sm:border-l sm:border-line sm:pl-5' : ''} ${i < 2 ? 'max-sm:border-b max-sm:border-line' : ''}`}>
                <p className="label">{k}</p>
                <p className="num mt-1.5 text-[24px] leading-none text-ink">{v}<span className="ml-1 text-[12px] text-faint">{u}</span></p>
              </div>
            ))}
          </div>
        )}

        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex gap-5" role="tablist" aria-label="Region">
            {Object.entries(REGIONS).map(([k, r]) => (
              <button key={k} role="tab" aria-selected={region === k} onClick={() => { setRegion(k); setSel(null) }} className="tab">{r.label}</button>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-mute sm:ml-auto">
            {products.map((p) => { const s = styleOf(p, m); return (
              <span key={p}><span className="mr-1.5 inline-block w-5 align-middle" style={{ borderTop: `${s.width}px ${s.dash ? 'dashed' : 'solid'} ${s.color}` }} />{s.label}</span>
            ) })}
          </div>
        </div>
      </div>

      <Section label="01 · Skill by depth" title="Where the error lives"
        lede="The upper thermocline (50–150 m) is where every product struggles: the temperature gradient is steepest, so a small vertical displacement becomes a large error. Hover to read values at a depth.">
        {rows.length ? <SkillByDepth rows={rows} products={products} m={m} /> : <Pending title="No skill table in this export" />}
      </Section>

      <Section label="02 · Argo floats" title="Every profile, where it was measured"
        lede={`${n} profiles in the ${REGIONS[region].label}. Colour is the profile's RMSE for ${styleOf(primary, m).label} over all depths. Click a float to compare it with the products.`}>
        <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <div className="h-[300px] overflow-hidden rounded-[4px] border border-line sm:h-[440px]">
              <OceanMap g={m.grid} url={null} grid={null} points={points} onPoint={setSel} region={region} padding={[12, 12]} scrollZoom={false} />
            </div>
            <div className="mt-3 flex items-center gap-3">
              <span className="label">Profile RMSE</span>
              <span className="h-[6px] w-40" style={{ background: `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map((t) => colorAt('matter', t)).join(',')})` }} />
              <span className="num text-[10.5px] text-mute">0 – {ERR_MAX}+ °C</span>
            </div>
          </div>
          <div>
            {cur ? (
              <div key={cur.id} className="fade-in">
                <p className="label">Float {cur.platform} · cycle {cur.cycle}</p>
                <p className="num mt-1 text-[14px] text-ink">{fmtLat(cur.lat)} {fmtLon(cur.lon)} <span className="text-faint">· {fmtDate(cur.date)}</span></p>
                <div className="mt-4">
                  <ProfileChart height={340}
                    main={{ label: styleOf(primary, m).label, values: cur.products[primary], sigma: cur.sigma }}
                    others={products.filter((p) => p !== primary).map((p) => ({ label: styleOf(p, m).label, values: cur.products[p], style: 'dashed' }))}
                    points={[{ label: 'Argo', values: cur.obs }]} />
                </div>
                <p className="mt-3 text-[11.5px] text-mute">
                  Line: {styleOf(primary, m).label}. Circles: the float's own measurements. Profile RMSE {fmt(profileRmse(cur, primary), 2)} °C
                  {!sel && ' (the median float; click another on the map)'}.
                </p>
              </div>
            ) : <Pending title="No profiles in this region" />}
          </div>
        </div>
      </Section>

      <Section label="03 · Error distribution" title="Every matched value, not just the average"
        lede={`${styleOf(primary, m).label} minus Argo for each profile and depth. Red: warmer than observed; blue: colder. The black tick is the median.`}>
        <ErrorStrip profiles={profiles} product={primary} height={420} />
      </Section>

      <Section label="04 · Uncertainty" title="Is the predicted uncertainty honest?"
        lede="The model predicts a standard deviation σ for every cell and depth. If it is calibrated, 68 % of Argo errors fall inside ±1σ and 95 % inside ±2σ.">
        {coverage?.length ? (
          <div className="max-w-[520px]">
            <Coverage rows={coverage} />
            <p className="mt-2 text-[11.5px] text-mute">Solid: inside ±1σ. Dashed: inside ±2σ. Vertical guides at 68 % and 95 %.</p>
          </div>
        ) : (
          <Pending title="Available with the model export">
            HYCOM and GLORYS give no per-cell uncertainty, so this check exists only for Sylithe Ocean Model. Notebook 03 writes coverage.json
            from the same Argo match.
          </Pending>
        )}
      </Section>

      <Section label="05 · Table" title="By depth">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="label pb-2 pr-4 font-normal">Depth</th>
                {products.map((p) => <th key={p} colSpan={4} className="label pb-2 pl-6 font-normal">{styleOf(p, m).label}</th>)}
              </tr>
              <tr className="border-b border-line text-right">
                <th />
                {products.flatMap((p) => ['n', 'RMSE', 'Bias', 'r'].map((h, i) => <th key={p + h} className={`label py-2 font-normal ${i === 0 ? 'pl-6' : 'pl-3'}`}>{h}</th>))}
              </tr>
            </thead>
            <tbody>
              {DEPTHS.map((z) => (
                <tr key={z} className="border-b border-line text-right hover:bg-wash">
                  <td className="num py-2 pr-4 text-left text-ink">{z} m</td>
                  {products.flatMap((p) => {
                    const r = rows.find((x) => x.product === p && x.depth === z) ?? {}
                    return [
                      <td key={p + 'n'} className="num py-2 pl-6 text-faint">{r.n ?? '—'}</td>,
                      <td key={p + 'rm'} className="num py-2 pl-3 text-ink">{fmt(r.rmse, 2)}</td>,
                      <td key={p + 'b'} className="num py-2 pl-3 text-ink2">{Number.isFinite(r.bias) && r.bias > 0 ? '+' : ''}{fmt(r.bias, 2)}</td>,
                      <td key={p + 'r'} className="num py-2 pl-3 text-ink2">{fmt(r.r, 3)}</td>,
                    ]
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section label="06 · Leaderboard" title="Every method, one referee"
        lede="Test year 2023, never seen in training. Same grid, depths and Argo floats for every row: ours, the published method retrained on our data, simple baselines and the reference products.">
        {board?.rows?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="label pb-2 font-normal">#</th><th className="label pb-2 font-normal">Method</th>
                  {LB_COLS.map((c) => <th key={c} className="label pb-2 pl-4 text-right font-normal">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {board.rows.map((r, i) => (
                  <tr key={r.Method} className={`border-b border-line ${r.Type === 'ours' ? 'bg-[#FDF1E4]' : ''}`}>
                    <td className="num py-2.5 pl-3 pr-3 text-faint">{i + 1}</td>
                    <td className="py-2.5"><span className={r.Type === 'ours' ? 'font-medium text-ink' : 'text-ink'}>{r.Method}</span>{r.Type === 'ours' ? <span className="ml-0.5 text-[#C2702E]" title="Sylithe Ocean Model">*</span> : <span className="ml-2 text-[11px] text-faint">{r.Type}</span>}</td>
                    {LB_COLS.map((c) => <td key={c} className="num py-2.5 pl-4 text-right text-ink2">{r[c] == null ? '—' : Number(r[c]).toFixed(3)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11.5px] text-faint"><span className="text-[#C2702E]">*</span> Sylithe Ocean Model (this work).</p>
          </div>
        ) : (
          <Pending title="Written by the benchmark run">
            oceanembed/benchmark.py builds leaderboard.json after training: Sylithe Ocean Model (ensemble and single model), the Attention 3D U-Net++
            retrained here, ridge regression, climatology, GLORYS12 and HYCOM.
          </Pending>
        )}
        <div className="mt-10 max-w-[70ch]">
          <p className="label mb-3">Published results, for context only</p>
          {(board?.context?.length ? board.context.map((c) => ({ method: c.method, rmse: c.rmse_argo ?? c.rmse_target, setup: c.setup })) : PUBLISHED).map((c) => (
            <p key={c.method} className="border-b border-line py-2.5 text-[12.5px] text-ink2">
              {c.method} <span className="num text-ink">· {c.rmse} °C</span>
              <span className="block text-[11.5px] text-mute">{c.setup}. Different region, depths or reference data: not comparable to the rows above.</span>
            </p>
          ))}
        </div>
      </Section>
    </div>
  )
}
