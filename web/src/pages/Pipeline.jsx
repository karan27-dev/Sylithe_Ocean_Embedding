import { useData } from '../App'
import { SectionHead } from '../components/ui'

// Sources as configured in oceanembed/config.py (IDs follow the problem statement's table).
const SOURCES = [
  ['SST', 'OSTIA L4 (reprocessed, then NRT)', '0.05° daily', 'NaN-aware area mean → 0.25°, K → °C', 'Copernicus Marine', 'moi-00168'],
  ['SSS', 'Multi-observation SMOS / SMAP L4', '0.125° daily', 'area mean → 0.25°', 'Copernicus Marine', 'moi-00051'],
  ['SLA', 'DUACS L4 all-satellite', '0.125° daily', 'area mean → 0.25°', 'Copernicus Marine', 'moi-00145'],
  ['Currents U, V', 'OSCAR v2.0 final', '0.25° daily', 'bilinear', 'NASA PO.DAAC', 'OSCAR_L4_OC_FINAL_V2.0'],
  ['Winds U, V', 'CCMP v3.1', '0.25° 6-hourly', 'daily mean, bilinear', 'NASA PO.DAAC', 'CCMP_WINDS_10M6HR_L4_V3.1'],
  ['Target T', 'GLORYS12 reanalysis', '1/12° daily, 50 levels', '15 standard depths, then area mean', 'Copernicus Marine', 'moi-00021'],
  ['Comparator T', 'HYCOM GOFS 3.1', '1/12° 3-hourly, 40 levels', 'daily mean, 15 depths', 'Google Earth Engine', 'HYCOM/sea_temp_salinity'],
  ['Validation', 'Argo core profiles, QC 1–2', 'point profiles', 'standard depths with gap limits', 'Ifremer ERDDAP', 'ArgoFloats'],
  ['Pretraining', 'Gridded Argo', '1° monthly', 'linear → 0.25°', 'INCOIS LAS', 'manual export'],
]

const STEPS = [
  ['Ingest', 'Copernicus products are streamed lazily from ARCO stores; PO.DAAC granules are downloaded, subset and deleted; Earth Engine is sampled on the exact target grid. Every block is logged, so an interrupted run resumes where it stopped.'],
  ['Harmonise', 'Finer grids are averaged, not interpolated: a sparse cell-overlap matrix with cos(latitude) weights that ignores land, so coastal cells average only their ocean part. Grids already at 0.25° are interpolated bilinearly; 6-hourly winds become daily means.'],
  ['Verticalise', 'GLORYS levels are interpolated to 0, 5, 10, 20, 30, 50, 75, 100, 125, 150, 200, 300, 500, 700 and 1000 m before the horizontal step. Columns shallower than a standard depth stay empty: nothing is extrapolated below the sea floor.'],
  ['Store', 'Zarr on Google Drive, one chunk per day. The target is stored as int16 at 0.001 °C, halving storage at no meaningful loss.'],
  ['Normalise', 'Inputs become z-scores over the training years. The target becomes an anomaly from a 31-day smoothed day-of-year climatology, divided by each depth\'s anomaly spread.'],
]

export default function Pipeline() {
  const { m } = useData()
  return (
    <div className="pb-8">
      <div className="page pt-12 sm:pt-16">
        <SectionHead as="h1" label="Pipeline" title="Five products, one grid">
          Every input is brought to the same 0.25° daily grid over 5–30°N, 45–105°E before the model sees it. Products are never
          silently mixed: when a source fails, the gap stays empty and is reported, rather than filled from a different quantity.
        </SectionHead>

        <dl className="mt-12 grid border-y border-line sm:grid-cols-4">
          {[['Grid', '101 × 241', '0.25°, cell centres'], ['Period', '2005–2023', 'train ≤ 2021 · validate 2022 · test 2023'],
            ['Inputs', '7 channels', 'SST SSS SLA Uc Vc Uw Vw'], ['Target', '15 depths', '0–1000 m, GLORYS12']].map(([k, v, s], i) => (
            <div key={k} className={`py-5 ${i ? 'sm:border-l sm:border-line sm:pl-6' : ''} max-sm:border-b max-sm:border-line`}>
              <dt className="label">{k}</dt>
              <dd className="display mt-2 text-[26px] leading-none">{v}</dd>
              <dd className="mt-2 text-[12px] text-mute">{s}</dd>
            </div>
          ))}
        </dl>
      </div>

      <section className="page mt-20">
        <p className="label">Sources</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[860px] text-[13px]">
            <thead>
              <tr className="border-b border-line text-left">
                {['Variable', 'Product', 'Native', 'To 0.25° daily', 'Provider', 'Identifier'].map((h) => <th key={h} className="label pb-2 pr-4 font-normal">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {SOURCES.map(([v, p, n, t, pr, id]) => (
                <tr key={v} className="border-b border-line align-baseline">
                  <td className="py-3 pr-4 text-ink">{v}</td>
                  <td className="py-3 pr-4 text-ink2">{p}</td>
                  <td className="num py-3 pr-4 text-[12px] text-mute">{n}</td>
                  <td className="py-3 pr-4 text-mute">{t}</td>
                  <td className="py-3 pr-4 text-ink2">{pr}</td>
                  <td className="num py-3 text-[11.5px] text-faint">{id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="page mt-20">
        <p className="label">Steps</p>
        <ol className="mt-4 border-t border-line">
          {STEPS.map(([t, d], i) => (
            <li key={t} className="grid gap-2 border-b border-line py-6 sm:grid-cols-[60px_200px_1fr] sm:gap-6">
              <span className="num text-[12px] text-faint">0{i + 1}</span>
              <h3 className="display text-[22px] leading-tight">{t}</h3>
              <p className="max-w-[70ch] text-[14px] leading-relaxed text-ink2">{d}</p>
            </li>
          ))}
        </ol>
        <p className="mt-6 max-w-[70ch] text-[12.5px] leading-relaxed text-mute">
          Runs on Google Colab or any CUDA machine (<span className="num">oceanembed/run.py</span>); the console only reads the export.
          {m && ` This console currently reads ${m.days.length} exported day${m.days.length > 1 ? 's' : ''} of ${m.source.label}.`}
        </p>
      </section>
    </div>
  )
}
