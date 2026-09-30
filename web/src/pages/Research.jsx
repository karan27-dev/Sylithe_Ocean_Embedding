import { useEffect, useState } from 'react'
import { SectionHead } from '../components/ui'
import { useJSON } from '../lib/data'

const F = (name) => `/figures/${name}.png`

// Captions state what each figure shows and what it means; numbers come from the 2023 evaluation.
const GROUPS = [
  {
    title: 'Where and how it was tested',
    figs: [
      ['fig01_domain', 'Study domain and independent observations', 'North Indian Ocean on the 0.25° grid, with the Bay of Bengal and Arabian Sea boxes and the 663 quality-controlled Argo profiles of 2023 used as the independent check. None of them was used in training.'],
      ['fig02_training_curves', 'Training', 'Validation error (GLORYS12, 2022) per epoch for the three Sylithe Ocean Model seeds and the published Attention 3D U-Net++. Random-crop training and early stopping keep the best epoch before the models start memorising the training years.'],
    ],
  },
  {
    title: 'Skill by depth',
    figs: [
      ['fig03_skill_depth_glorys', 'Against GLORYS12, every day and grid cell of 2023', 'RMSE, bias and correlation from 0 to 1000 m. Largest errors sit in the thermocline (75–150 m), where the ocean changes most from day to day. Sylithe Ocean Model and the published architecture track each other closely; both are far better than HYCOM and climatology there.'],
      ['fig04_skill_depth_argo', 'Against independent Argo floats', 'The same scores against real float measurements. GLORYS12 is best near the surface because it assimilates these floats; below 200 m Sylithe Ocean Model matches or beats it.'],
      ['paper_fig16_rmse_profiles_argo', 'RMSE profiles of every product against Argo', 'Layout of Wang et al. (2026) Fig. 16, for the North Indian Ocean in 2023.'],
      ['paper_fig07_rmse_r_depth_monthly', 'Month by month', 'Layout of Wang et al. (2026) Fig. 7: RMSE and correlation against GLORYS12 by depth, one curve per month.'],
      ['fig05_rmse_month_depth', 'Error by month and depth', 'The monsoon seasons move where the errors are; the thermocline is hardest all year.'],
      ['fig12_regions', 'Bay of Bengal and Arabian Sea', 'Regional skill against GLORYS12. The Bay of Bengal, with its fresh surface layer, is the harder basin.'],
    ],
  },
  {
    title: 'Maps',
    figs: [
      ['paper_fig09_maps_2023-01-01', 'Reconstruction, reference and difference, 1 January 2023', 'Layout of Wang et al. (2026) Fig. 9 at 50, 200, 500 and 1000 m. The large-scale structure is reproduced; the reconstruction is smoother than GLORYS12 and misses the smallest eddies.'],
      ['fig06_maps_2023-05-12', 'During Cyclone Mocha, 12 May 2023', 'GLORYS12, Sylithe Ocean Model and both methods\' errors at four depths.'],
      ['paper_fig11_rmse_maps', 'Where the errors are', 'Layout of Wang et al. (2026) Fig. 11: year-mean RMSE against GLORYS12 at four depths.'],
      ['fig07_rmse_maps', 'Error maps, both deep-learning methods', 'Sylithe Ocean Model above, the published Attention 3D U-Net++ below, same colour scale.'],
      ['fig09_section_2023-05-12', 'Vertical section at 15°N', 'Temperature from the Arabian Sea across India to the Bay of Bengal, with the 20 °C thermocline (solid) and 26 °C isotherm (dashed).'],
    ],
  },
  {
    title: 'Against real observations',
    figs: [
      ['paper_fig17_density_scatter_argo', 'Density scatter against Argo', 'Layout of Wang et al. (2026) Fig. 17. At 1000 m Sylithe Ocean Model has the highest R² (0.931, GLORYS12 0.889); at 500 m its RMSE is below GLORYS12\'s (0.313 vs 0.327 °C). Near the surface GLORYS12, which assimilates these floats, is best.'],
      ['fig08_argo_scatter', 'All depths together', 'Reconstruction against every Argo measurement, coloured by depth.'],
      ['paper_fig12_argo_locations_rmse', 'Float locations and RMSE with depth', 'Layout of Wang et al. (2026) Fig. 12.'],
      ['paper_fig13_binned_rmse_argo', 'Error on a 2° grid', 'Layout of Wang et al. (2026) Fig. 13: RMSE against Argo in 2°×2° boxes for Sylithe Ocean Model, GLORYS12 and their difference (blue: ours lower).'],
      ['paper_fig14_monthly_rmse_argo', 'Month by month against Argo', 'Layout of Wang et al. (2026) Fig. 14, every product.'],
    ],
  },
  {
    title: 'Use: uncertainty and cyclones',
    figs: [
      ['fig10_uncertainty_calibration', 'Is the uncertainty honest?', 'Share of errors inside ±kσ. 57 % of Argo errors fall inside ±1σ where 68 % would be ideal: the stated uncertainty is somewhat too small and should be scaled by about 1.2.'],
      ['fig11_mocha_tchp', 'Cyclone Mocha, May 2023', 'Tropical Cyclone Heat Potential from satellites only. The drop during the storm and the recovery are captured, but the level is about 10 kJ cm⁻² below GLORYS12 and the drop arrives about two days later.'],
    ],
  },
]

const COMPARE = [
  ['Region', 'North-west Pacific, 0–40°N 120–160°E', 'North Indian Ocean, 5–30°N 45–105°E'],
  ['Depths', '26 levels, 5–2000 m', '15 levels, 0–1000 m (problem statement)'],
  ['Inputs', 'SST, SSH (26-day window)', 'SST, SSS, SLA, currents, winds (15-day window, raw + anomaly)'],
  ['Architecture', 'Attention 3D U-Net++ (CBAM)', 'Self-supervised surface embedding + attention U-Net++ decoder, uncertainty head, 3-model ensemble'],
  ['Training', 'Argo pre-training → GLORYS2V4 fine-tuning, 1993–2022', 'Self-supervised pre-training → GLORYS12, 2005–2021, random-crop training'],
  ['Independent check', 'WOD profiles, 2023', 'Argo profiles, 2023 (663 profiles, 9,469 points)'],
  ['Reported RMSE vs in-situ', '≈ 0.61 °C (their region)', '0.757 °C (our region; not directly comparable)'],
  ['Same-data comparison', '—', 'Their architecture retrained on our data: 0.762 °C vs our 0.757 °C'],
]

function Lightbox({ fig, onClose }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  if (!fig) return null
  return (
    <div className="fixed inset-0 z-[2000] flex flex-col bg-ink/85 p-4 sm:p-10" onClick={onClose}>
      <div className="mb-3 flex items-baseline justify-between text-paper">
        <p className="text-[14px]">{fig[1]}</p>
        <button className="text-[13px] opacity-80 hover:opacity-100">Close</button>
      </div>
      <img src={F(fig[0])} alt={fig[1]} className="min-h-0 flex-1 object-contain" />
      <p className="mx-auto mt-3 max-w-[90ch] text-center text-[12.5px] text-paper/80">{fig[2]}</p>
    </div>
  )
}

const pct = (v) => `${v >= 0 ? '' : '−'}${Math.abs(v).toFixed(3)}`

export default function Research() {
  const board = useJSON('leaderboard.json')
  const sig = useJSON('significance.json')
  const sigR = useJSON('significance_regions.json')
  const [open, setOpen] = useState(null)
  const cols = ['RMSE vs GLORYS (°C)', 'RMSE vs Argo (°C)', 'Argo 0–200 m', 'Argo 200–1000 m', 'Argo Bay of Bengal', 'Argo Arabian Sea', 'Argo bias (°C)']
  const best = Object.fromEntries(cols.map((c) => [c, board ? Math.min(...board.rows.filter((r) => !r.Method.startsWith('GLORYS')).map((r) => (c.includes('bias') ? Math.abs(r[c]) : r[c])).filter((v) => v != null)) : null]))

  return (
    <div className="page pb-16 pt-12">
      <SectionHead as="h1" label="Research results · test year 2023, never seen in training" title="How well it works, measured honestly">
        Every method is scored on the same held-out year, the same 0.25° grid, the same 15 depths and the same 663 Argo
        float profiles. The published state-of-the-art architecture was retrained on exactly our data, so the comparison is like for like.
      </SectionHead>

      {/* headline numbers */}
      <div className="mt-10 grid grid-cols-2 gap-y-8 border-y border-line py-7 lg:grid-cols-4">
        {[
          ['41 %', 'less error than climatology', '1.119 → 0.662 °C against GLORYS12, whole column'],
          ['0.757 °C', 'RMSE against Argo floats', 'satellite inputs only; 9,469 measurements'],
          ['p = 0.002', 'better than HYCOM', 'an operational ocean model, against the same floats'],
          ['5 %', 'better than the published method in the Bay of Bengal', '0.833 vs 0.879 °C (37 profiles, p = 0.006)'],
        ].map(([v, k, d], i) => (
          <div key={k} className={i ? 'border-l border-line pl-5' : ''}>
            <p className="display text-[32px] leading-none text-sea">{v}</p>
            <p className="mt-2 text-[13px] text-ink">{k}</p>
            <p className="mt-1 text-[11.5px] text-mute">{d}</p>
          </div>
        ))}
      </div>

      {/* leaderboard */}
      <section className="pt-12">
        <SectionHead label="Leaderboard" title="Every method, one referee" />
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[900px] text-[12.5px]">
            <thead><tr className="border-b border-line text-left">
              <th className="label py-2 pr-4 font-normal">Method</th>
              {cols.map((c) => <th key={c} className="label py-2 pr-3 text-right font-normal">{c.replace(' (°C)', '')}</th>)}
            </tr></thead>
            <tbody>
              {board?.rows.map((r) => {
                const ours = r.Type === 'ours'
                return (
                  <tr key={r.Method} className={`border-b border-line ${ours ? 'bg-[#FDF1E4]' : ''}`}>
                    <td className="py-2.5 pl-3 pr-4"><span className={ours ? 'font-medium text-ink' : 'text-ink2'}>{r.Method}</span>
                      {ours ? <span className="ml-0.5 text-[#C2702E]" title="Sylithe Ocean Model">*</span> : <span className="ml-2 text-[11px] text-faint">{r.Type}</span>}</td>
                    {cols.map((c) => {
                      const v = r[c]
                      const isBest = v != null && !r.Method.startsWith('GLORYS') && (c.includes('bias') ? Math.abs(v) : v) === best[c]
                      return <td key={c} className={`num py-2.5 pr-3 text-right ${isBest ? 'font-medium text-sea' : 'text-ink2'}`}>{v == null ? '—' : v.toFixed(3)}</td>
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[11.5px] text-faint"><span className="text-[#C2702E]">*</span> Sylithe Ocean Model (this work).</p>
          <p className="mt-2 text-[11.5px] text-mute">RMSE in °C, lower is better; best satellite-only value per column in teal. GLORYS12 assimilates the Argo floats it is
            scored against and is published weeks to years later; it is shown as the reference, not a competitor.</p>
        </div>
      </section>

      {/* significance */}
      <section className="pt-12">
        <SectionHead label="Statistical significance" title="Which differences are real">
          Paired bootstrap over the 663 Argo profiles (2,000–4,000 resamples, whole profiles kept together). A difference counts as real
          when p &lt; 0.05; with several tests against the published method, the stricter threshold is about 0.006.
        </SectionHead>
        <div className="mt-5 grid gap-10 lg:grid-cols-2">
          <table className="w-full text-[12.5px]">
            <thead><tr className="border-b border-line text-left">
              {['Sylithe Ocean Model vs', 'Improvement (°C)', '95 % range', 'p', ''].map((h) => <th key={h} className="label py-2 pr-3 font-normal">{h}</th>)}
            </tr></thead>
            <tbody>
              {sig?.filter((r) => !r.vs.includes('single')).map((r) => (
                <tr key={r.vs} className="border-b border-line">
                  <td className="py-2 pr-3 text-ink2">{r.vs}</td>
                  <td className="num py-2 pr-3">{pct(r.improvement)}</td>
                  <td className="num py-2 pr-3 text-mute">{pct(r.ci95_low)} … {pct(r.ci95_high)}</td>
                  <td className="num py-2 pr-3">{r.p_not_better < 0.001 ? '< 0.001' : r.p_not_better.toFixed(3)}</td>
                  <td className="py-2 text-[11.5px]">{r.improvement < 0 ? <span className="text-mute">reference is better</span>
                    : r.p_not_better < 0.05 ? <span className="text-sea">significant</span> : <span className="text-mute">not significant</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="w-full text-[12.5px]">
            <thead><tr className="border-b border-line text-left">
              {['vs published method', 'Profiles', 'Ours', 'Theirs', 'p', ''].map((h) => <th key={h} className="label py-2 pr-3 font-normal">{h}</th>)}
            </tr></thead>
            <tbody>
              {sigR?.filter((r) => r.vs.startsWith('Attention')).map((r) => (
                <tr key={r.region + r.depths} className="border-b border-line">
                  <td className="py-2 pr-3 text-ink2">{{ NIO: 'Whole region', BoB: 'Bay of Bengal', AS: 'Arabian Sea' }[r.region]}, {r.depths}</td>
                  <td className="num py-2 pr-3 text-mute">{r.profiles}</td>
                  <td className="num py-2 pr-3">{r.rmse_ours.toFixed(3)}</td>
                  <td className="num py-2 pr-3">{r.rmse_other.toFixed(3)}</td>
                  <td className="num py-2 pr-3">{r.p_not_better < 0.001 ? '< 0.001' : r.p_not_better.toFixed(3)}</td>
                  <td className="py-2 text-[11.5px]">{r.p_not_better < 0.006 ? <span className="text-sea">significant (strict)</span>
                    : r.p_not_better < 0.05 ? <span className="text-sea/70">significant</span> : <span className="text-mute">not significant</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-6 grid gap-6 text-[13px] leading-relaxed text-ink2 md:grid-cols-2">
          <p><span className="text-ink">What this supports.</span> Sylithe Ocean Model is significantly better than climatology, statistical regression and
            the HYCOM operational model against independent floats, and significantly better than the published architecture below 200 m
            (whole region and Arabian Sea) and in the Bay of Bengal.</p>
          <p><span className="text-ink">What it does not.</span> Over the whole column and region the lead over the published architecture (0.006 °C) is within
            noise. GLORYS12, which assimilates these floats, remains better near the surface. The Bay of Bengal result rests on 37 profiles.</p>
        </div>
      </section>

      {/* figures */}
      {GROUPS.map((g) => (
        <section key={g.title} className="pt-14">
          <SectionHead label="Figures" title={g.title} />
          <div className="mt-6 grid gap-x-8 gap-y-10 md:grid-cols-2">
            {g.figs.map((f) => (
              <figure key={f[0]}>
                <button onClick={() => setOpen(f)} className="block w-full overflow-hidden rounded-[8px] border border-line bg-white p-2 transition-colors hover:border-line2">
                  <img src={F(f[0])} alt={f[1]} loading="lazy" className="mx-auto max-h-[360px] w-auto" />
                </button>
                <figcaption className="mt-3">
                  <p className="text-[13.5px] text-ink">{f[1]}</p>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-mute">{f[2]}</p>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}

      {/* comparison */}
      <section className="pt-14">
        <SectionHead label="Context" title="Alongside Wang et al. (2026)">
          The closest published study (Earth Syst. Sci. Data 18, 4617–4638). Several figures above use its layouts so the two can be read side by side.
          Its reported numbers come from another ocean and depth range, so only the same-data row is a direct comparison.
        </SectionHead>
        <table className="mt-5 w-full text-[12.5px]">
          <thead><tr className="border-b border-line text-left">
            {['', 'Wang et al. (2026)', 'Sylithe Ocean Model'].map((h) => <th key={h} className="label py-2 pr-4 font-normal">{h}</th>)}
          </tr></thead>
          <tbody>{COMPARE.map(([k, a, b]) => (
            <tr key={k} className="border-b border-line align-top">
              <td className="py-2.5 pr-4 text-mute">{k}</td><td className="py-2.5 pr-4 text-ink2">{a}</td><td className="py-2.5 text-ink">{b}</td>
            </tr>))}
          </tbody>
        </table>
      </section>

      <Lightbox fig={open} onClose={() => setOpen(null)} />
    </div>
  )
}
