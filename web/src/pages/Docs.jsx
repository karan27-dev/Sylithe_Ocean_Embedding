import { Link } from 'react-router-dom'

const REPO = 'https://github.com/karan27-dev/Sylithe_Ocean_Embedding'

const TOC = [
  ['overview', 'Overview'], ['console', 'Using the console'], ['how', 'How it works'], ['data', 'Data and products'],
  ['run', 'Running it yourself'], ['results', 'Results'], ['limits', 'Limitations'], ['glossary', 'Glossary'], ['refs', 'References'],
]

function H({ id, children }) {
  return <h2 id={id} className="display scroll-mt-20 border-t border-line pt-10 text-[26px] first:border-0 first:pt-0">{children}</h2>
}
function P({ children }) { return <p className="mt-3 max-w-[70ch] text-[14.5px] leading-relaxed text-ink2">{children}</p> }
function Code({ children }) {
  return <pre className="num mt-3 overflow-x-auto rounded-[8px] border border-line bg-wash px-4 py-3 text-[12px] leading-relaxed text-ink">{children}</pre>
}
function Table({ head, rows }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead><tr className="border-b border-line text-left">{head.map((h) => <th key={h} className="label py-2 pr-4 font-normal">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r) => <tr key={r[0]} className="border-b border-line align-top">{r.map((c, i) => <td key={i} className={`py-2 pr-4 ${i ? 'text-ink2' : 'text-ink'}`}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

export default function Docs() {
  return (
    <div className="page pb-16 pt-12 lg:grid lg:grid-cols-[200px_1fr] lg:gap-14">
      <nav className="hidden lg:block" aria-label="Contents">
        <div className="sticky top-20">
          <p className="label mb-3">Documentation</p>
          {TOC.map(([id, t]) => <a key={id} href={`#${id}`} className="block py-1.5 text-[13px] text-mute hover:text-ink">{t}</a>)}
        </div>
      </nav>

      <article>
        <p className="label">Documentation · SIH 2026 · Problem statement 26066 · MoES / INCOIS</p>
        <h1 className="display mt-3 text-[38px] leading-tight">Sylithe Ocean Model</h1>

        <H id="overview">Overview</H>
        <P>Sylithe Ocean Model reconstructs daily ocean temperature at 15 standard depths, from the surface to 1000 m, on a 0.25° grid over
          the North Indian Ocean (5–30°N, 45–105°E), using only satellite observations of the surface. It is built for the gap between what
          satellites see (the surface, every day, everywhere) and what Argo floats measure (the full column, at a few thousand scattered points).</P>
        <P>Each temperature comes with an uncertainty. The system runs as a daily pipeline: when a day's satellite data arrive, the model
          predicts that day's ocean once and stores it.</P>

        <H id="console">Using the console</H>
        <Table head={['Page', 'Use it to']} rows={[
          [<Link className="link" to="/daily">Daily forecast</Link>, 'Pick a date and region; see the week, month, quarter or year of inputs and predictions, the day\'s map and the pipeline log.'],
          [<Link className="link" to="/explorer">Explorer</Link>, 'Any layer at any depth on a satellite or plain basemap. Click the ocean for the full profile, a vertical section and depth over time, with CSV download.'],
          [<Link className="link" to="/cyclone">Cyclone watch</Link>, 'Upper-ocean heat available to cyclones: TCHP, the 26 °C isotherm and a daily bulletin.'],
          [<Link className="link" to="/validation">Validation</Link>, 'Interactive skill by depth and float-by-float comparison with Argo.'],
          [<Link className="link" to="/research">Research</Link>, 'The leaderboard, significance tests and every figure of the evaluation.'],
          [<Link className="link" to="/embedding">Embedding</Link>, 'What the model learned: the latent ocean state and the regimes it separates.'],
          [<Link className="link" to="/model">Model</Link>, <>Architecture and training; data sources on <Link className="link" to="/pipeline">Pipeline</Link>, formats on <Link className="link" to="/data">Data</Link>.</>],
        ]} />
        <P>Press <span className="num rounded border border-line px-1">/</span> anywhere to type a command such as “TCHP in the Bay of Bengal” or “temperature at 150 m”.</P>

        <H id="how">How it works</H>
        <Table head={['Step', 'What happens']} rows={[
          ['1 · Inputs', 'Seven satellite variables, daily: SST (OSTIA), SSS (SMOS/SMAP), sea level anomaly (DUACS), surface currents U/V (OSCAR) and winds U/V (CCMP). Each is regridded to 0.25°; finer products are area-averaged, never smeared across the coast.'],
          ['2 · Window', 'The 15 days up to the target day, each variable given twice: as measured and as the difference from its normal for that day of the year.'],
          ['3 · Embedding', 'A convolutional encoder with attention over time compresses the window into a latent state. It was first trained without any subsurface data, by filling in hidden patches of the surface (self-supervised).'],
          ['4 · Reconstruction', 'A U-Net++ decoder with attention turns the latent state into temperature at 15 depths, predicted as the departure from the GLORYS12 seasonal normal, plus a per-point uncertainty.'],
          ['5 · Ensemble', 'Three independently trained copies are averaged; their disagreement is added to the uncertainty.'],
          ['6 · Daily pipeline', 'Every new day is predicted once, stored with its provenance and regional statistics, and published to this console.'],
        ]} />
        <P>Training used 2005–2021 with GLORYS12 (the problem statement's target) as the answer, 2022 to choose the best epoch, and 2023 as a
          year the model never saw. Details on the <Link className="link" to="/model">Model</Link> page.</P>

        <H id="data">Data and products</H>
        <Table head={['Product', 'Contents']} rows={[
          ['Daily 3D field (NetCDF)', 'thetao(time, depth, lat, lon) in °C and thetao_sigma (1σ uncertainty), 15 depths, 0.25°, CF conventions.'],
          ['Daily cache', 'ops/predictions.zarr with every computed day; ops/series.json regional statistics; ops/index.json provenance (when, which models, input coverage).'],
          ['Console export', 'manifest.json plus one small int16 file per layer and day; argo.json, skill_depth.json, leaderboard.json, significance files.'],
          ['Point profile', 'CSV from the Explorer: depth, temperature, uncertainty and GLORYS12 for any clicked point.'],
        ]} />
        <P>Standard depths (m): 0, 5, 10, 20, 30, 50, 75, 100, 125, 150, 200, 300, 500, 700, 1000.</P>

        <H id="run">Running it yourself</H>
        <P>All code is open in the <a className="link" href={REPO} target="_blank" rel="noreferrer">repository</a>. Colab notebooks cover every stage; a single command line covers any GPU machine.</P>
        <Code>{`# 1 · data (Colab): notebook colab/01_data_pipeline.ipynb → inputs.zarr, target.zarr on Google Drive
# 2 · train on any CUDA machine, within a time budget, resumable
python -m oceanembed.run all --data DATA --root OUT --hours 6 --seeds 42 7 1234
# 3 · evaluate and draw every figure (free Colab: notebook colab/04_finalize.ipynb)
python -m oceanembed.paper_eval --data DATA --root OUT --out OUT/paper --figures
# 4 · daily operation: predict new days once, then publish
python -m oceanembed.daily run    --data DATA --root OUT --start 2023-01-01 --end 2023-12-31
python -m oceanembed.daily export --data DATA --root OUT --out web/public/data/ops`}</Code>
        <P>Going live needs only a scheduled job that ingests the day's near-real-time satellite products and runs the two daily commands.</P>

        <H id="results">Results</H>
        <P>On 2023, never seen in training: RMSE 0.662 °C against GLORYS12 over the whole column (41 % below climatology) and 0.757 °C against
          9,469 Argo measurements. Significantly better than climatology, regression and the HYCOM operational model; better than the published
          Attention 3D U-Net++ retrained on the same data in every column, significantly so below 200 m and in the Bay of Bengal. Full tables and
          figures on the <Link className="link" to="/research">Research</Link> page.</P>

        <H id="limits">Limitations</H>
        <ul className="mt-3 max-w-[70ch] list-disc space-y-2 pl-5 text-[14.5px] leading-relaxed text-ink2">
          <li>Over the whole column the lead over the published architecture is small and not statistically significant.</li>
          <li>The model learns from GLORYS12 and inherits part of its bias (about +0.2 °C against Argo).</li>
          <li>Maps are smoother than the reanalysis: the smallest eddies are missed.</li>
          <li>The stated uncertainty is about 20 % too small (57 % of Argo errors inside ±1σ instead of 68 %).</li>
          <li>Cyclone heat potential in the Bay of Bengal is about 10 kJ cm⁻² low during Cyclone Mocha and reacts a couple of days late.</li>
          <li>2023 is replayed with reprocessed inputs; near-real-time inputs are noisier and arrive with 1–7 days' delay for salinity and winds.</li>
        </ul>

        <H id="glossary">Glossary</H>
        <Table head={['Term', 'Meaning']} rows={[
          ['SST / SSS', 'Sea surface temperature / salinity.'], ['SLA', 'Sea level anomaly: sea surface height minus its long-term mean; highs mark a deep thermocline.'],
          ['Thermocline, D20', 'The layer where temperature drops fastest; D20 is the depth of the 20 °C isotherm, the usual Indian Ocean proxy.'],
          ['D26', 'Depth of the 26 °C isotherm, the bottom of the warm water a cyclone can use.'],
          ['TCHP', 'Tropical Cyclone Heat Potential: heat in the water warmer than 26 °C, in kJ cm⁻². Above about 50 supports rapid intensification.'],
          ['MLD', 'Mixed layer depth: first depth 0.5 °C colder than at 10 m.'],
          ['GLORYS12', 'Copernicus global ocean reanalysis at 1/12°, which assimilates observations; the training target.'],
          ['Argo', 'Autonomous floats measuring temperature and salinity profiles to 2000 m; used here only to check results.'],
          ['RMSE, bias, r', 'Root-mean-square error, mean error and correlation against a reference.'],
          ['σ (sigma)', 'The model\'s own estimate of its error at each point.'],
        ]} />

        <H id="refs">References</H>
        <ul className="mt-3 max-w-[75ch] space-y-2 text-[13.5px] leading-relaxed text-ink2">
          <li>Wang, H., Zhang, L., Yang, S., Yan, X., Li, Z. (2026). Attention enhanced 3D-U-Net++ ocean temperature and salinity reconstruction in the northwestern Pacific based on transfer learning. Earth Syst. Sci. Data 18, 4617–4638.</li>
          <li>Zhou, Z. et al. (2018). UNet++: a nested U-Net architecture. · Woo, S. et al. (2018). CBAM: Convolutional Block Attention Module.</li>
          <li>He, K. et al. (2022). Masked autoencoders are scalable vision learners. · Seitzer, M. et al. (2022). On the pitfalls of heteroscedastic uncertainty estimation (β-NLL).</li>
          <li>Data: GLORYS12 (doi:10.48670/moi-00021), OSTIA (moi-00168), multi-observation SSS (moi-00051), DUACS (moi-00145), OSCAR v2.0, CCMP v3.1, HYCOM GOFS 3.1, Argo (Ifremer ERDDAP).</li>
        </ul>
      </article>
    </div>
  )
}
