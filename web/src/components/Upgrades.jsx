import { SectionHead } from './ui'
import { useJSON } from '../lib/data'

// Finale experiments (oceanembed/upgrades.py, run on RunPod). Each block renders as soon as its result exists in
// /data/upgrades.json; until then it states what is being measured and how.

const f = (v, d = 3) => (v == null || !Number.isFinite(+v) ? '—' : (+v).toFixed(d))
const sg = (v, d = 3) => (v == null ? '—' : `${v > 0 ? '+' : ''}${(+v).toFixed(d)}`)

function Block({ n, title, what, children, ready }) {
  return (
    <div className="border-t border-line py-7">
      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <div>
          <p className="label">{n}</p>
          <h3 className="mt-1 text-[16px] text-ink">{title}</h3>
          <p className="mt-2 text-[13px] leading-relaxed text-ink2">{what}</p>
          {!ready && <p className="mt-3 inline-block rounded-[6px] bg-wash px-2 py-1 text-[11px] text-mute">Running on RunPod · results appear here automatically</p>}
        </div>
        <div className="min-w-0 overflow-x-auto">{children}</div>
      </div>
    </div>
  )
}

function T({ head, rows, hl }) {
  return (
    <table className="w-full min-w-[560px] text-[12.5px]">
      <thead><tr className="border-b border-line text-left">{head.map((h, i) => <th key={h} className={`label py-2 pr-4 font-normal ${i ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, j) => (
        <tr key={j} className={`border-b border-line ${hl?.(j) ? 'bg-[#FDF1E4]' : ''}`}>
          {r.map((c, i) => <td key={i} className={`py-2 pr-4 ${i ? 'num text-right text-ink2' : 'text-ink'}`}>{c}</td>)}</tr>))}</tbody>
    </table>
  )
}

export default function Upgrades() {
  const u = useJSON('upgrades.json') || {}
  const { calibration: cal, gridded_argo: ga, ablation: ab, thermocline: th, nrt, cyclones: cy } = u
  return (
    <section className="pt-14">
      <SectionHead label="Finale experiments" title="Closing the remaining gaps">
        Six experiments run after the main evaluation: independent gridded-Argo validation, ablations that isolate what the satellite
        embedding contributes, uncertainty calibration, the near-real-time gap, the thermocline, and cyclone tracks. Same test year, same floats.
      </SectionHead>

      <Block n="01" title="Gridded Argo validation" ready={!!ga?.rows}
        what="Monthly 2023 fields of every product against an independent gridded Argo analysis (INCOIS LAS product, or Roemmich–Gilson), area-averaged to its grid, at the 15 standard depths.">
        {ga?.rows ? (<>
          <T head={['Product', '0–1000 m', '0–200 m', '75–150 m', '200–1000 m', 'Bay of Bengal', 'Arabian Sea', 'r']}
            rows={ga.rows.map((r) => [r.product, f(r['0–1000 m']), f(r['0–200 m']), f(r['75–150 m']), f(r['200–1000 m']), f(r['Bay of Bengal']), f(r['Arabian Sea']), f(r.r)])}
            hl={(j) => ga.rows[j].product.startsWith('Sylithe')} />
          <p className="mt-2 text-[11.5px] text-faint">RMSE °C against {ga.source}, {ga.grid} grid, monthly means.</p></>) : null}
      </Block>

      <Block n="02" title="Ablations: what each part is worth" ready={!!ab?.rows}
        what="Each variant removes one ingredient and is trained with the same seed, data and time budget. The linear probes train one layer on a frozen encoder: the gap between the self-supervised embedding and a random encoder is what the satellite embedding itself knows about the subsurface.">
        {ab?.rows ? (<>
          <T head={['Variant', 'vs GLORYS12', 'vs Argo', 'Argo 75–150 m', 'Δ vs full (Argo)']}
            rows={ab.rows.map((r) => [r.label, f(r['glorys 0–1000 m']), f(r['argo 0–1000 m']), f(r['argo 75–150 m']), r.name === 'full' ? '—' : sg(r['Δ argo 0–1000 m'])])}
            hl={(j) => ab.rows[j].name === 'full'} />
          <p className="mt-2 text-[11.5px] text-faint">RMSE °C, 2023. Positive Δ = worse without that part. {ab.budget_minutes} min of training per variant.</p></>) : null}
      </Block>

      <Block n="03" title="Calibrated uncertainty" ready={cal?.inside_1sigma_after != null}
        what="A per-depth scale on σ, fitted on 2022 Argo only, so that ±1σ covers 68 % of real errors. Checked on 2023, never used for fitting.">
        {cal?.inside_1sigma_after != null ? (
          <T head={['', 'Before', 'After', 'Ideal']} rows={[
            ['Argo errors inside ±1σ', `${f(cal.inside_1sigma_before, 1)} %`, `${f(cal.inside_1sigma_after, 1)} %`, '68.3 %'],
            ['Argo errors inside ±2σ', `${f(cal.inside_2sigma_before, 1)} %`, `${f(cal.inside_2sigma_after, 1)} %`, '95.4 %']]} />) : null}
      </Block>

      <Block n="04" title="Near-real-time gap" ready={!!nrt?.rows}
        what="2023 reconstructed from the near-real-time products the live system uses, before and after fine-tuning on near-real-time inputs of July–December 2022. The reprocessed row is the offline evaluation for reference.">
        {nrt?.rows ? (<>
          <T head={['Inputs and models', 'vs GLORYS12', 'vs Argo', 'Argo 0–200 m', 'Argo 75–150 m']}
            rows={nrt.rows.map((r) => [r.name, f(r['glorys 0–1000 m']), f(r['argo 0–1000 m']), f(r['argo 0–200 m']), f(r['argo 75–150 m'])])}
            hl={(j) => j === 2} />
          <p className="mt-2 text-[11.5px] text-faint">Live system now runs the {nrt.release} models.</p></>) : null}
      </Block>

      <Block n="05" title="Thermocline (75–150 m)" ready={!!th?.rows}
        what="Where the remaining error is. The ensemble is fine-tuned with a loss that weights 75–150 m about twice as much, and kept only if the thermocline improves without hurting the whole column.">
        {th?.rows ? (<>
          <T head={['Model', 'Argo 0–1000 m', 'Argo 75–150 m', 'Argo 200–1000 m', 'GLORYS 75–150 m']}
            rows={th.rows.map((r) => [r.name, f(r['argo 0–1000 m']), f(r['argo 75–150 m']), f(r['argo 200–1000 m']), f(r['glorys 75–150 m'])])}
            hl={(j) => j === 1 && th.adopted} />
          <p className="mt-2 text-[11.5px] text-faint">{th.adopted ? 'Adopted: the thermocline improved and the whole column did not get worse.' : 'Not adopted: it did not improve the thermocline without a cost elsewhere.'}</p></>) : null}
      </Block>

      <Block n="06" title="Along the 2023 cyclone tracks" ready={!!cy?.storms}
        what="Every 6-hourly IBTrACS position of the 2023 North Indian Ocean cyclones. The ocean is sampled the day before the storm reaches it: heat potential against GLORYS12, and whether the Ocean Cyclone Potential Index was higher before rapid intensification (+30 kt in 24 h).">
        {cy?.storms ? (<>
          <T head={['Storm', 'Track points', 'Max wind (kt)', 'TCHP ours', 'TCHP GLORYS12', 'OCPI', 'RI points']}
            rows={cy.storms.map((s) => [s.storm, s.points, s.max_wind_kt, f(s.tchp_mean, 1), f(s.tchp_glorys_mean, 1), f(s.ocpi_mean, 2), s.ri_points])} />
          <p className="mt-2 text-[12px] text-ink2">TCHP along tracks: RMSE {f(cy.tchp_rmse_vs_glorys, 1)} kJ cm⁻², r = {f(cy.tchp_r_vs_glorys, 2)} against GLORYS12.
            {cy.ocpi_auc_ri != null && <> OCPI before rapid intensification {f(cy.ocpi_mean_before_ri, 2)} vs {f(cy.ocpi_mean_otherwise, 2)} otherwise (AUC {f(cy.ocpi_auc_ri, 2)}, {cy.ri_points} RI points).</>}</p></>) : null}
      </Block>
    </section>
  )
}
