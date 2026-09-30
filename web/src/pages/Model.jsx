import { SectionHead } from '../components/ui'

// Architecture as implemented in oceanembed/model.py (OceanEmbedNet): 3-D stem + temporal attention, a CBAM encoder
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
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full min-w-[860px]" role="img" aria-label="OceanEmbedNet architecture">
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
  ['Stage 1', 'Argo background', 'Monthly inputs against INCOIS gridded Argo. Anchors the network to observed stratification and the seasonal cycle before it sees a reanalysis.', 'observation-anchored start'],
  ['Stage 2', 'GLORYS fine-tune', 'Daily inputs against GLORYS12 at 15 depths, every layer trainable: the strategy that transferred best in Wang et al. (2026). Several seeds are trained and averaged.', 'the ensemble'],
]
const LOSSES = [
  ['β-NLL', 'Learns the value and a per-cell, per-depth σ. The β = 0.5 weighting (Seitzer et al., 2022) stops the network from buying a lower loss by inflating σ on hard cells.'],
  ['Vertical gradient', 'Matches dT/dz between adjacent levels, so the thermocline stays sharp instead of being smeared.'],
  ['Surface consistency', 'The reconstructed 0 m temperature should agree with the observed SST input.'],
  ['No monotonicity penalty', 'Deliberately absent: winter temperature inversions under the Bay of Bengal barrier layer are real.'],
]
const EXPERIMENTS = [
  ['OceanEmbed ensemble vs a single model', 'what averaging seeds buys, and the ensemble spread folded into σ'],
  ['Attention 3-D U-Net++, retrained here', 'the published method on identical data, grid, depths and test year'],
  ['Ridge regression and climatology', 'how much of the skill a simple model or the seasonal cycle alone already gives'],
  ['Real-time mode', 'SST and SLA only; the variable dropout in training is what makes this work'],
  ['Window length', '1, 7, 15 and 26 days of surface history'],
  ['GLORYS12 and HYCOM against Argo', 'the reference products scored on the same floats'],
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

export default function Model() {
  return (
    <div className="pb-8">
      <div className="page pt-12 sm:pt-16">
        <SectionHead as="h1" label="Model · OceanEmbedNet" title="From a surface window to a temperature column">
          The network reads fifteen days of fourteen surface channels, the seven observed variables and their day-of-year
          anomalies, and predicts, for every ocean cell, a mean and an uncertainty at fifteen depths. It predicts anomalies from a
          climatology, so the seasonal stratification comes for free and the capacity goes to eddies, Kelvin and Rossby waves and
          cyclone cold wakes.
        </SectionHead>
      </div>

      <section className="mx-auto mt-12 w-full max-w-[1240px] px-4 sm:px-8 lg:px-12">
        <div className="overflow-x-auto border-y border-line py-8">
          <Diagram />
        </div>
        <p className="mt-3 max-w-[80ch] text-[12px] leading-relaxed text-mute">
          Every block ends in CBAM channel and spatial attention. X<sub>i,j</sub>: node at depth i of the U-Net++ grid after j
          nested convolutions; each receives all earlier nodes at its level and an upsampled node from below. The deepest
          encoder level, projected to 64 channels, is the embedding shown on the Embedding page. Weights are an exponential moving
          average; about 2.4 M parameters at base width 32.
        </p>
      </section>

      <section className="page mt-20">
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
      </section>

      <section className="page mt-20 grid gap-16 lg:grid-cols-2">
        <div>
          <p className="label mb-4">Losses</p>
          <Rows items={LOSSES} grid="sm:grid-cols-[170px_1fr]" />
        </div>
        <div>
          <p className="label mb-4">Experiments reported</p>
          <Rows items={EXPERIMENTS} grid="sm:!gap-y-0.5" />
        </div>
      </section>

      <section className="page mt-20">
        <SectionHead label="Why not a language model" title="The science stays in the network, and it stays auditable">
          Mapping surface fields to a temperature volume is regression on gridded tensors. A language model would add no skill, add
          latency and risk inventing numbers in a disaster-management product. Where language helps, in explaining a map or
          drafting a bulletin, it should only call the same deterministic functions this console uses.
        </SectionHead>
      </section>
    </div>
  )
}
