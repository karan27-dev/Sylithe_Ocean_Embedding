const STAGES = [
  { n: 'Stage 0', t: 'Embedding engine', d: 'Masked surface autoencoder on 8 years of inputs. Random 16×16 patches and whole variables hidden. No labels.', out: 'encoder weights · latent z (64-d)' },
  { n: 'Stage 1', t: 'Argo background', d: 'Monthly inputs → INCOIS gridded Argo. Learns observed stratification and seasonal cycle.', out: 'observation-anchored init' },
  { n: 'Stage 2', t: 'GLORYS fine-tune', d: 'Daily inputs → GLORYS12 at 15 depths. All layers trainable (the paper\'s best strategy).', out: 'final model' },
]

const BLOCKS = [
  ['Surface window', '7 vars × 15 days × 101×241', 'bg-gray-100'],
  ['3D stem + temporal attention', 'collapses time, learns which days matter', 'bg-mist'],
  ['CBAM encoder ×4', 'multiscale features + embedding z', 'bg-mist'],
  ['U-Net++ nested decoder', 'dense skips · deep supervision', 'bg-mist'],
  ['Heads', 'μ and σ at 15 depths', 'bg-abyss text-white'],
]

const LOSSES = [
  ['Gaussian NLL', 'value + per-pixel uncertainty (σ is shown in the console)'],
  ['Vertical gradient', 'dT/dz between levels, keeps the thermocline sharp'],
  ['Surface consistency', 'T(0 m) agrees with the observed SST'],
  ['No monotonic-T penalty', 'on purpose: Bay of Bengal winter inversions are real'],
]

export default function Model() {
  return (
    <div className="p-6 space-y-5">
      <div>
        <p className="eyebrow">Runs on Google Colab GPU · notebook 02</p>
        <h1 className="text-[26px] font-bold">Model</h1>
      </div>
      <div className="card p-5">
        <p className="eyebrow mb-3">OceanEmbedNet · forward pass</p>
        <div className="flex flex-wrap items-stretch gap-2">
          {BLOCKS.map(([t, d, c], i) => (
            <div key={t} className="flex items-center gap-2">
              <div className={`rounded-xl px-4 py-3 w-[190px] h-full ${c}`}>
                <p className="font-bold text-[13px]">{t}</p>
                <p className={`text-[11px] mt-0.5 ${c.includes('text-white') ? 'text-mint' : 'text-gray-500'}`}>{d}</p>
              </div>
              {i < BLOCKS.length - 1 && <span className="text-gray-300 text-xl">→</span>}
            </div>
          ))}
        </div>
      </div>
      <div className="grid md:grid-cols-3 gap-4">
        {STAGES.map((s) => (
          <div key={s.n} className="card p-5">
            <p className="font-mono text-[11px] text-leaf">{s.n}</p>
            <p className="font-bold text-[16px]">{s.t}</p>
            <p className="text-[12px] text-gray-500 mt-1 leading-snug">{s.d}</p>
            <p className="text-[11px] mt-3 font-mono text-gray-400">→ {s.out}</p>
          </div>
        ))}
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="card p-5">
          <p className="eyebrow mb-3">Loss</p>
          {LOSSES.map(([t, d]) => (
            <div key={t} className="py-2 border-b border-gray-100 last:border-0">
              <p className="text-[13px] font-semibold">{t}</p><p className="text-[12px] text-gray-500">{d}</p>
            </div>
          ))}
        </div>
        <div className="card p-5">
          <p className="eyebrow mb-3">Experiments to report</p>
          {[['Ours', 'embedding + U-Net++ 2D, 7 inputs'], ['Published baseline', 'Attention 3D U-Net++ (Wang et al., ESSD 2026) on the same data'],
            ['Real-time mode', 'SST + SLA only (variable dropout trains this)'], ['Window ablation', '1 / 7 / 15 / 26 days'],
            ['Reference products', 'GLORYS, HYCOM against the same Argo profiles']].map(([t, d]) => (
            <div key={t} className="py-2 border-b border-gray-100 last:border-0">
              <p className="text-[13px] font-semibold">{t}</p><p className="text-[12px] text-gray-500">{d}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
