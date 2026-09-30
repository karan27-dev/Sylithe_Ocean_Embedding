import { Link } from 'react-router-dom'
import { SectionHead } from '../components/ui'
import { useJSON } from '../lib/data'

// Architecture as implemented in oceanembed/model.py (Sylithe Ocean Model): 3-D stem + temporal attention, a CBAM encoder
// whose deepest level gives the embedding, and a U-Net++ nested decoder with deep supervision.
const L = 4, DX = 92, DY = 62, X0 = 440, Y0 = 52
const node = (i, j) => [X0 + j * DX, Y0 + i * DY]
const CH = [32, 64, 128, 256]

function Diagram() {
  const nodes = []
  for (let i = 0; i < L; i++) for (let j = 0; j < L - i; j++) nodes.push([i, j])
  const W = 1000, H = 330
  const box = (x, y, w, h, props = {}) => <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx="3" {...props} />
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full min-w-[860px]" role="img" aria-label="Sylithe Ocean Model architecture">
      <defs>
        <marker id="ar" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0L8 4L0 8z" fill="rgb(var(--mute))" />
        </marker>
      </defs>
      {/* input */}
      {[0, 1, 2, 3].map((k) => box(70 + k * 5, 80 - k * 5, 96, 64, { key: k, fill: 'rgb(var(--paper))', stroke: 'rgb(var(--line2))' }))}
      <text x="85" y="140" textAnchor="middle" className="fill-ink text-[12px]">Surface window</text>
      <text x="85" y="156" textAnchor="middle" className="num fill-faint text-[10px]">14 × 15 d × 101 × 241</text>
      <text x="85" y="170" textAnchor="middle" className="fill-faint text-[10px]">7 variables + anomalies</text>
      <path d="M140 62H188" stroke="rgb(var(--mute))" markerEnd="url(#ar)" />
      {/* stem */}
      {box(245, 52, 112, 44, { fill: 'rgb(var(--wash))', stroke: 'none' })}
      <text x="250" y="48" textAnchor="middle" className="fill-ink text-[11.5px]">3-D stem +</text>
      <text x="250" y="62" textAnchor="middle" className="fill-ink text-[11.5px]">temporal attention</text>
      <text x="250" y="92" textAnchor="middle" className="fill-faint text-[10px]">learns which days matter</text>
      <path d={`M310 ${Y0}H${X0 - 32}`} stroke="rgb(var(--mute))" markerEnd="url(#ar)" />

      {/* encoder down path */}
      {[0, 1, 2].map((i) => { const [x, y] = node(i, 0); return <path key={i} d={`M${x} ${y + 13}V${y + DY - 15}`} stroke="rgb(var(--ink))" strokeOpacity=".5" markerEnd="url(#ar)" /> })}
      {/* nested decoder edges */}
      {nodes.filter(([, j]) => j > 0).map(([i, j]) => {
        const [x, y] = node(i, j), [ux, uy] = node(i + 1, j - 1), [lx] = node(i, j - 1)
        return (
          <g key={`e${i}${j}`}>
            <path d={`M${ux + 22} ${uy - 13}L${x - 24} ${y + 11}`} stroke="rgb(var(--mute))" strokeOpacity=".6" markerEnd="url(#ar)" />
            <path d={`M${lx + 30} ${y}H${x - 32}`} stroke="rgb(var(--line2))" markerEnd="url(#ar)" />
          </g>
        )
      })}
      {nodes.map(([i, j]) => {
        const [x, y] = node(i, j), enc = j === 0
        return (
          <g key={`n${i}${j}`}>
            {box(x, y, 58, 26, { fill: enc ? 'rgb(var(--paper))' : 'rgb(var(--wash))', stroke: enc ? 'rgb(var(--ink))' : 'none', strokeWidth: 1 })}
            <text x={x} y={y + 4} textAnchor="middle" className="num fill-ink text-[10.5px]">X{i},{j}</text>
          </g>
        )
      })}
      {CH.map((c, i) => <text key={c} x={X0 - (i ? 40 : 34)} y={node(i, 0)[1] + (i ? 4 : 20)} textAnchor="end" className="num fill-faint text-[10px]">{c} ch · {i ? `1/${2 ** i}` : 'full res'}</text>)}
      <text x={X0} y={Y0 - 22} textAnchor="middle" className="label fill-faint text-[9.5px]">CBAM ENCODER</text>
      <text x={X0 + 2 * DX - 20} y={Y0 + 2 * DY + 4} className="label fill-faint text-[9.5px]">U-NET++ NESTED DECODER</text>

      {/* embedding */}
      {(() => { const [x, y] = node(3, 0); return (
        <g>
          <path d={`M${x} ${y + 13}V${y + 42}`} stroke="rgb(var(--sea))" markerEnd="url(#ar)" />
          {box(x, y + 62, 160, 34, { fill: 'rgb(var(--sea))' })}
          <text x={x} y={y + 60} textAnchor="middle" className="fill-paper text-[11.5px]">embedding z</text>
          <text x={x} y={y + 73} textAnchor="middle" className="num fill-paper text-[10px] opacity-80">64-d · 1/8 resolution</text>
        </g>
      ) })()}

      {/* heads */}
      {[1, 2, 3].map((j) => { const [x, y] = node(0, j); return <path key={j} d={`M${x} ${y - 13}V${Y0 - 30}`} stroke="rgb(var(--line2))" /> })}
      <path d={`M${node(0, 1)[0]} ${Y0 - 30}H890V${100 - 42}`} fill="none" stroke="rgb(var(--line2))" markerEnd="url(#ar)" />
      <text x={node(0, 2)[0]} y={Y0 - 36} textAnchor="middle" className="fill-faint text-[10px]">deep supervision: three heads, averaged</text>
      {box(890, 100, 176, 64, { fill: 'rgb(var(--paper))', stroke: 'rgb(var(--ink))' })}
      <text x="890" y="88" textAnchor="middle" className="fill-ink text-[12px]">μ and σ</text>
      <text x="890" y="104" textAnchor="middle" className="num fill-faint text-[10px]">15 depths × 101 × 241</text>
      <text x="890" y="178" textAnchor="middle" className="fill-faint text-[10px]">+ day-of-year climatology</text>
      <text x="890" y="192" textAnchor="middle" className="fill-faint text-[10px]">= temperature, °C</text>
    </svg>
  )
}

const STAGES = [
  ['Stage 0', 'Embedding engine', 'Masked autoencoder on the surface inputs only. Half of the 16 × 16 patches in the last three days are hidden, and whole variables are dropped. No subsurface labels.', 'encoder weights, the embedding'],
  ['Stage 1 · optional', 'Argo background', 'Monthly inputs against INCOIS gridded Argo, to anchor the network to observed stratification before it sees a reanalysis (Wang et al. 2026). Built and supported, but not used in this run: the gridded Argo export was not available, so training went from stage 0 straight to stage 2.', 'not used in the reported results'],
  ['Stage 2', 'GLORYS fine-tune', 'Daily inputs against GLORYS12 at 15 depths, every layer trainable: the strategy that transferred best in Wang et al. (2026). Several seeds are trained and averaged.', 'the ensemble'],
]
const LOSSES = [
  ['β-NLL', 'Learns the value and a per-cell, per-depth σ. The β = 0.5 weighting (Seitzer et al., 2022) stops the network from buying a lower loss by inflating σ on hard cells.'],
  ['Vertical gradient', 'Matches dT/dz between adjacent levels, so the thermocline stays sharp instead of being smeared.'],
  ['Surface consistency', 'The reconstructed 0 m temperature should agree with the observed SST input.'],
  ['No monotonicity penalty', 'Deliberately absent: winter temperature inversions under the Bay of Bengal barrier layer are real.'],
]
function Rows({ items, grid = 'sm:grid-cols-[200px_1fr]' }) {
  return (
    <dl className="border-t border-line">
      {items.map(([t, d]) => (
        <div key={t} className={`grid gap-1 border-b border-line py-4 sm:gap-6 ${grid}`}>
          <dt className="text-[14px] text-ink">{t}</dt>
          <dd className="max-w-[68ch] text-[14px] leading-relaxed text-ink2">{d}</dd>
        </div>
      ))}
    </dl>
  )
}

function Table({ head, rows, mono = [] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-[13px]">
        <thead><tr className="border-b border-line text-left">{head.map((h) => <th key={h} className="label py-2 pr-4 font-normal">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, j) => (
          <tr key={j} className="border-b border-line align-top">
            {r.map((c, i) => <td key={i} className={`py-2.5 pr-4 ${i === 0 ? 'text-ink' : 'text-ink2'} ${mono.includes(i) ? 'num' : ''}`}>{c}</td>)}
          </tr>))}</tbody>
      </table>
    </div>
  )
}

const CARD = [
  ['Name', 'Sylithe Ocean Model'], ['Release', 'models-v1 (GitHub release) · 3 seeds: 42, 7, 1234'],
  ['Task', 'Daily 3-D ocean temperature from surface satellite data (SIH 2026 · PS 26066 · MoES / INCOIS)'],
  ['Domain', 'North Indian Ocean, 5–30°N × 45–105°E, 0.25° grid (101 × 241 cells)'],
  ['Depths', '15 levels: 0, 5, 10, 20, 30, 50, 75, 100, 125, 150, 200, 300, 500, 700, 1000 m'],
  ['Inputs', 'SST, SSS, SLA, surface current U/V, 10 m wind U/V: 15 days, each as value and day-of-year anomaly'],
  ['Outputs', 'Temperature μ (°C) and 1σ uncertainty (°C) at every cell and depth'],
  ['Target', 'GLORYS12 reanalysis (Copernicus, 1/12°, area-averaged to 0.25°)'],
  ['Data split', 'Train 2005–2021 · validation 2022 (epoch selection) · test 2023 (never seen)'],
  ['Size', '≈2.4 M parameters per member at base width 32 · three members'],
  ['Score (2023)', 'RMSE 0.662 °C vs GLORYS12 · 0.757 °C vs 9,469 independent Argo measurements'],
  ['Runs on', 'Any CPU (live pipeline on GitHub Actions); a GPU for training'],
]

const SPEC = [
  ['Input', 'values + missing flags', '28 × 15 d × 112 × 256', '14 channels (7 variables raw + anomaly), each with a 0/1 missing flag; padded 101×241 → 112×256'],
  ['3-D stem', '2 × Conv3d 3³ + GELU', '32 × 15 × 112 × 256', 'mixes variables and neighbouring days'],
  ['Temporal attention', 'Conv3d 1³ → softmax over time', '32 × 112 × 256', 'a learned weight for each of the 15 days, per cell'],
  ['Fuse', 'concat 5 static + ConvBlock + CBAM', 'X0,0 · 32 × 112 × 256', 'static: ocean mask, lat, lon, sin/cos day of year'],
  ['Encoder', '3 × (max-pool 2 + residual ConvBlock + CBAM)', 'X1,0 64 · X2,0 128 · X3,0 256', '1/2, 1/4 and 1/8 resolution'],
  ['Embedding', 'Conv2d 1×1', 'z · 64 × 14 × 32', 'the latent ocean state (Embedding page)'],
  ['Nested decoder', 'U-Net++ nodes Xi,j, j = 1…3', '6 nodes', 'each node sees every earlier node at its level plus an upsampled node from below'],
  ['Heads', '3 × Conv2d 1×1 on X0,1 X0,2 X0,3, averaged', '30 × 101 × 241', 'deep supervision: 15 means + 15 log-variances'],
  ['Output', 'μ·σ_depth + climatology; σ = exp(½ logvar)·σ_depth', '2 × 15 × 101 × 241', 'log-variance clamped to [−8, 6]'],
]

const HYPER = [
  ['Window', '15 days', 'ablated at 1, 7, 15, 26'], ['Base width / levels', '32 / 4', 'channels 32 · 64 · 128 · 256'],
  ['Embedding size', '64', ''], ['Optimiser', 'AdamW, lr 2 × 10⁻⁴, weight decay 0.05', 'cosine schedule over a GPU-time budget'],
  ['Batch', '8–16 random 64 × 128 crops', 'full domain at validation and inference'], ['Early stopping', 'patience 8 epochs', 'on validation RMSE'],
  ['Weight averaging', 'EMA, decay 0.999, with warm-up', 'EMA weights are validated, saved and used'],
  ['Variable dropout', 'p = 0.3 per droppable variable', 'SSS, currents and winds; trains the SST + SLA-only mode'],
  ['Loss weights', 'β-NLL β = 0.5 · vertical gradient 0.5 · surface 0.1', ''],
  ['SSL pretraining', '30 epochs, masked autoencoder', '50 % of 16 × 16 patches in the last 3 days hidden'],
  ['Mixed precision', 'on (AMP)', ''], ['Seeds', '42, 7, 1234', 'averaged into the ensemble'],
]

const CHANNELS = [
  ['sst', 'Sea surface temperature', '°C', 'OSTIA L4 (moi-00168)', 'OSTIA NRT', 'always required'],
  ['sss', 'Sea surface salinity', 'psu', 'SMOS/SMAP multi-obs L4 (moi-00051)', 'multi-obs NRT', 'droppable · ~6 d late'],
  ['sla', 'Sea level anomaly', 'm', 'DUACS DT all-sat (moi-00145)', 'DUACS NRT', 'always required'],
  ['uc, vc', 'Surface current U, V', 'm s⁻¹', 'OSCAR v2.0 final', 'DUACS geostrophic', 'droppable'],
  ['uw, vw', '10 m wind U, V', 'm s⁻¹', 'CCMP v3.1', 'ASCAT-blended L4', 'droppable · ~1 d late'],
]

export default function Model() {
  const lb = useJSON('leaderboard.json')
  const rows = lb?.rows ?? []
  const best = Math.min(...rows.filter((r) => !/reference/.test(r.Type)).map((r) => r['RMSE vs Argo (°C)']).filter(Number.isFinite))
  return (
    <div className="pb-8">
      <div className="page pt-12 sm:pt-16">
        <SectionHead as="h1" label="Model · Sylithe Ocean Model" title="From a surface window to a temperature column">
          The network reads fifteen days of fourteen surface channels, the seven observed variables and their day-of-year
          anomalies, and predicts, for every ocean cell, a mean and an uncertainty at fifteen depths. It predicts anomalies from a
          climatology, so the seasonal stratification comes for free and the capacity goes to eddies, Kelvin and Rossby waves and
          cyclone cold wakes.
        </SectionHead>
        <nav className="mt-8 flex flex-wrap gap-x-5 gap-y-2 border-y border-line py-3 text-[13px]" aria-label="On this page">
          {[['card', 'Model card'], ['arch', 'Architecture'], ['io', 'Inputs and outputs'], ['train', 'Training'], ['family', 'Models compared'],
            ['sigma', 'Uncertainty'], ['modes', 'Operating modes'], ['limits', 'Limitations']].map(([id, t]) =>
            <a key={id} href={`#${id}`} className="text-mute hover:text-ink">{t}</a>)}
        </nav>
      </div>

      <section id="card" className="page mt-12 scroll-mt-20">
        <p className="label mb-4">Model card</p>
        <dl className="grid border-t border-line md:grid-cols-2 md:gap-x-12">
          {CARD.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[120px_1fr] gap-4 border-b border-line py-3 text-[13.5px]">
              <dt className="text-mute">{k}</dt><dd className="text-ink">{v}</dd>
            </div>))}
        </dl>
      </section>

      <section id="arch" className="mx-auto mt-16 w-full max-w-[1240px] scroll-mt-20 px-4 sm:px-8 lg:px-12">
        <p className="label mb-4">Architecture</p>
        <div className="overflow-x-auto border-y border-line py-8">
          <Diagram />
        </div>
        <p className="mt-3 max-w-[80ch] text-[12px] leading-relaxed text-mute">
          Every block ends in CBAM channel and spatial attention. X<sub>i,j</sub>: node at depth i of the U-Net++ grid after j
          nested convolutions; each receives all earlier nodes at its level and an upsampled node from below. The deepest
          encoder level, projected to 64 channels, is the embedding shown on the <Link className="link" to="/embedding">Embedding</Link> page.
        </p>
        <div className="mt-8"><Table head={['Block', 'Operation', 'Output (C × T × H × W)', 'Note']} rows={SPEC} mono={[2]} /></div>
      </section>

      <section id="io" className="page mt-16 scroll-mt-20">
        <SectionHead label="Inputs and outputs" title="Seven variables in, a temperature column out">
          Training used reprocessed products; the live pipeline swaps in near-real-time equivalents, since reprocessed currents and winds
          arrive a month late. The model was trained to tolerate missing variables, so a day is predicted as soon as SST and sea level exist.
        </SectionHead>
        <div className="mt-6"><Table head={['Channel', 'Variable', 'Unit', 'Training product', 'Live product', 'Availability']} rows={CHANNELS} mono={[0]} /></div>
        <p className="mt-4 max-w-[80ch] text-[13px] leading-relaxed text-ink2">Each variable is regridded to the 0.25° grid by area averaging, then
          normalised with training-period statistics. The model also sees each variable's anomaly from its 31-day-smoothed day-of-year mean,
          a 0/1 flag for every missing value, and five static channels (ocean mask, latitude, longitude, sin and cos of the day of year).
          The output is an anomaly from the GLORYS12 day-of-year climatology; adding the climatology back gives temperature in °C.</p>
      </section>

      <section id="train" className="page mt-16 scroll-mt-20">
        <p className="label">Training</p>
        <ol className="mt-4 grid border-t border-line md:grid-cols-3">
          {STAGES.map(([n, t, d, out], i) => (
            <li key={n} className={`py-7 md:pr-8 ${i ? 'border-t border-line md:border-l md:border-t-0 md:pl-8' : ''}`}>
              <p className="num text-[11px] text-faint">{n}</p>
              <h3 className="display mt-2 text-[22px]">{t}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-ink2">{d}</p>
              <p className="num mt-4 text-[11.5px] text-mute">→ {out}</p>
            </li>
          ))}
        </ol>
        <div className="mt-10 grid gap-12 lg:grid-cols-2">
          <div><p className="label mb-4">Hyperparameters</p><Table head={['Setting', 'Value', 'Note']} rows={HYPER} /></div>
          <div><p className="label mb-4">Losses</p><Rows items={LOSSES} grid="sm:grid-cols-[150px_1fr]" /></div>
        </div>
      </section>

      <section id="family" className="page mt-16 scroll-mt-20">
        <SectionHead label="Models compared" title="Every method scored on the same year and the same floats">
          All learned methods were trained on identical data, grid, depths and years; reference products are scored on the same 9,469 Argo
          measurements from 2023. Lower is better. Significance tests and figures are on the <Link className="link" to="/research">Research</Link> page.
        </SectionHead>
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[820px] text-[13px]">
            <thead><tr className="border-b border-line text-left">
              {['Method', 'Type', 'vs GLORYS', 'vs Argo', 'Argo 0–200 m', 'Argo 200–1000 m', 'Bay of Bengal', 'Arabian Sea', 'Bias'].map((h, i) => <th key={h} className={`label py-2 pr-4 font-normal ${i ? '' : 'pl-3'}`}>{h}</th>)}</tr></thead>
            <tbody>{rows.map((r) => {
              const ours = r.Type === 'ours'
              const v = (k) => (r[k] == null ? '—' : r[k].toFixed(3))
              return (
                <tr key={r.Method} className={`border-b border-line ${ours ? 'bg-[#FDF1E4]' : ''}`}>
                  <td className={`py-2.5 pl-3 pr-4 ${ours ? 'font-medium text-ink' : 'text-ink2'}`}>{r.Method}{ours && <span className="ml-0.5 text-[#C2702E]" title="Sylithe Ocean Model">*</span>}</td>
                  <td className="py-2.5 pr-4 text-mute">{r.Type}</td>
                  <td className="num py-2.5 pr-4">{v('RMSE vs GLORYS (°C)')}</td>
                  <td className={`num py-2.5 pr-4 ${r['RMSE vs Argo (°C)'] === best ? 'font-medium text-sea' : ''}`}>{v('RMSE vs Argo (°C)')}</td>
                  <td className="num py-2.5 pr-4">{v('Argo 0–200 m')}</td><td className="num py-2.5 pr-4">{v('Argo 200–1000 m')}</td>
                  <td className="num py-2.5 pr-4">{v('Argo Bay of Bengal')}</td><td className="num py-2.5 pr-4">{v('Argo Arabian Sea')}</td>
                  <td className="num py-2.5 pr-4 text-mute">{r['Argo bias (°C)'] >= 0 ? '+' : ''}{v('Argo bias (°C)')}</td>
                </tr>)
            })}</tbody>
          </table>
          <p className="mt-2 text-[11.5px] text-faint"><span className="text-[#C2702E]">*</span> Sylithe Ocean Model (this work). RMSE in °C over 2023. GLORYS12 assimilates observations, so its Argo score is the floor any model trained on it can approach.</p>
        </div>
        <div className="mt-8 grid gap-px overflow-hidden rounded-[12px] border border-line bg-line md:grid-cols-2 lg:grid-cols-3">
          {[['Sylithe Ocean Model', 'ours', 'Embedding encoder + U-Net++ decoder, SSL-pretrained, β-NLL, 3-seed ensemble. Predicts a mean and σ.'],
            ['Attention 3-D U-Net++', 'published', 'Wang et al., ESSD 18:4617 (2026). Time treated as the 3-D axis and mapped to depth. Retrained here on our data.'],
            ['Ridge regression', 'baseline', 'Per-depth linear model on local surface features. Shows how much a simple statistical model already gets.'],
            ['Climatology', 'baseline', 'GLORYS12 mean for the day of year: the seasonal cycle with no weather. Any useful model must beat it.'],
            ['HYCOM GOFS 3.1', 'reference', 'Independent operational ocean model (via Google Earth Engine), never used in training.'],
            ['GLORYS12', 'reference', 'The training target itself, scored against Argo to show the ceiling set by the target.']].map(([t, k, d]) => (
            <div key={t} className="bg-paper p-5">
              <p className="label">{k}</p><h3 className="mt-1 text-[15px] text-ink">{t}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-ink2">{d}</p>
            </div>))}
        </div>
      </section>

      <section id="sigma" className="page mt-16 grid scroll-mt-20 gap-12 lg:grid-cols-2">
        <SectionHead label="Uncertainty" title="How sure the model is, cell by cell">
          Each member predicts a mean and a log-variance. The ensemble's variance is the average member variance (what each model
          cannot know from the surface) plus the spread of the member means (where the models disagree). On 2023 Argo, 57 % of errors fell
          inside ±1σ against 68 % for a perfectly calibrated Gaussian, so the stated σ is about 20 % too small. It is largest in the
          thermocline (75–150 m) and in the Bay of Bengal.
        </SectionHead>
        <div className="rounded-[12px] border border-line bg-wash p-5">
          <p className="label mb-3">Formula</p>
          <p className="num text-[13px] leading-loose text-ink">μ = (1/M) Σ μ<sub>m</sub><br />σ² = (1/M) Σ σ<sub>m</sub>² + (1/M) Σ (μ<sub>m</sub> − μ)²<br />
            T = μ · s<sub>z</sub> + clim(doy, z)   σ<sub>T</sub> = σ · s<sub>z</sub></p>
          <p className="mt-3 text-[12px] text-mute">M = 3 members; s<sub>z</sub> = training standard deviation of the anomaly at depth z.</p>
        </div>
      </section>

      <section id="modes" className="page mt-16 scroll-mt-20">
        <p className="label mb-4">Operating modes</p>
        <Rows items={[
          ['Reprocessed (evaluation)', 'All seven variables from reprocessed products. Used for the 2023 test year and every score on this page.'],
          ['Live (near real time)', 'NRT substitutes for currents and winds, salinity usually missing for the most recent ~6 days. A day is predicted when SST and SLA arrive and predicted again, with a new revision number, when late inputs land. Live RMSE against Argo is tracked separately on the Daily page (about 1.05 °C in the first month).'],
          ['SST + SLA only', 'The minimum the model accepts. Variable dropout during training taught it to fall back on sea surface temperature and height alone.'],
        ]} />
      </section>

      <section id="limits" className="page mt-16 scroll-mt-20">
        <p className="label mb-4">Intended use and limitations</p>
        <div className="grid gap-12 lg:grid-cols-2">
          <ul className="list-disc space-y-2 pl-5 text-[14px] leading-relaxed text-ink2">
            <li>Intended for research and decision support: thermocline monitoring, cyclone heat potential, fisheries and acoustics context.</li>
            <li>Not a substitute for in-situ measurement or an operational assimilating ocean model.</li>
            <li>Learns from GLORYS12 and inherits part of its bias (about +0.2 °C against Argo).</li>
          </ul>
          <ul className="list-disc space-y-2 pl-5 text-[14px] leading-relaxed text-ink2">
            <li>Smoother than the reanalysis: the smallest eddies are missed.</li>
            <li>The lead over the published architecture is small over the whole column; significant below 200 m and in the Bay of Bengal.</li>
            <li>Near-real-time inputs lower the skill; a fine-tune on the NRT archive is the next step.</li>
          </ul>
        </div>
      </section>

      <section className="page mt-16">
        <SectionHead label="Why not a language model" title="The science stays in the network, and it stays auditable">
          Mapping surface fields to a temperature volume is regression on gridded tensors. A language model would add no skill, add
          latency and risk inventing numbers in a disaster-management product. Where language helps, in explaining a map or
          drafting a bulletin, it should only call the same deterministic functions this console uses.
        </SectionHead>
      </section>
    </div>
  )
}
