import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Copy, Search } from 'lucide-react'

const REPO = 'https://github.com/karan27-dev/Sylithe_Ocean_Embedding'
const LIVE = 'https://sylithe-ocean-model.vercel.app/live'

const NAV = [
  ['Getting started', [['intro', 'Introduction'], ['quickstart', 'Quickstart'], ['install', 'Installation']]],
  ['Concepts', [['grid', 'Grid, depths, regions'], ['inputs', 'Inputs'], ['predictions', 'Predictions and uncertainty'], ['derived', 'Derived quantities'], ['live', 'Live pipeline']]],
  ['Guides', [['console', 'Using the console'], ['aoi', 'Areas of interest'], ['train', 'Training'], ['evaluate', 'Evaluation'], ['deploy', 'Going live']]],
  ['Reference', [['cli', 'Command line'], ['python', 'Python API'], ['formats', 'Data formats'], ['endpoints', 'Live endpoints'], ['config', 'Configuration']]],
  ['Project', [['results', 'Results'], ['limits', 'Limitations'], ['glossary', 'Glossary'], ['refs', 'References']]],
]
const IDS = NAV.flatMap(([, items]) => items.map(([id]) => id))

// ---------------------------------------------------------------- typography
function H({ id, group, children }) {
  return (
    <header id={id} className="scroll-mt-24 border-t border-line pt-12 first:border-0 first:pt-0">
      {group && <p className="label mb-2">{group}</p>}
      <h2 className="display text-[28px] leading-tight text-ink">{children}</h2>
    </header>
  )
}
const H3 = ({ children }) => <h3 className="mt-8 text-[15px] font-medium text-ink">{children}</h3>
const P = ({ children }) => <p className="mt-3 max-w-[72ch] text-[14.5px] leading-relaxed text-ink2">{children}</p>
const C = ({ children }) => <code className="num rounded-[4px] bg-wash px-1.5 py-0.5 text-[12.5px] text-ink">{children}</code>

function Note({ kind = 'note', children }) {
  const c = kind === 'warn' ? 'border-heat' : 'border-sea'
  return <div className={`mt-4 max-w-[72ch] border-l-2 ${c} bg-wash/60 px-4 py-3 text-[13.5px] leading-relaxed text-ink2`}>
    <span className="label mr-2">{kind === 'warn' ? 'Caution' : 'Note'}</span>{children}</div>
}

function Code({ lang = 'bash', children }) {
  const [ok, setOk] = useState(false)
  const copy = () => { navigator.clipboard?.writeText(children).then(() => { setOk(true); setTimeout(() => setOk(false), 1200) }) }
  return (
    <div className="mt-4 overflow-hidden rounded-[10px] border border-line bg-[#0F172A]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-1.5">
        <span className="num text-[10.5px] uppercase tracking-wider text-white/40">{lang}</span>
        <button onClick={copy} className="flex items-center gap-1 text-[11px] text-white/50 hover:text-[#A3E635]">
          {ok ? <><Check size={12} />Copied</> : <><Copy size={12} />Copy</>}</button>
      </div>
      <pre className="num overflow-x-auto px-4 py-3 text-[12.5px] leading-relaxed text-[#E2E8F0]">{children}</pre>
    </div>
  )
}

function Table({ head, rows, mono = [0] }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[560px] text-[13px]">
        <thead><tr className="border-b border-line text-left">{head.map((h) => <th key={h} className="label py-2 pr-4 font-normal">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, j) => <tr key={j} className="border-b border-line align-top">
          {r.map((c, i) => <td key={i} className={`py-2 pr-4 ${i ? 'text-ink2' : 'text-ink'} ${mono.includes(i) ? 'num text-[12.5px]' : ''}`}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

/** A function or command signature with its parameters. */
function Api({ sig, children, params }) {
  return (
    <div className="mt-6 rounded-[10px] border border-line">
      <p className="num overflow-x-auto border-b border-line bg-wash px-4 py-2.5 text-[12.5px] text-ink">{sig}</p>
      <div className="px-4 pb-3 pt-1 text-[13.5px] leading-relaxed text-ink2">
        <div className="mt-2">{children}</div>
        {params && <dl className="mt-3 space-y-1.5">{params.map(([k, v]) => (
          <div key={k} className="grid gap-1 sm:grid-cols-[170px_1fr] sm:gap-4"><dt className="num text-[12.5px] text-ink">{k}</dt><dd className="text-[13px]">{v}</dd></div>))}</dl>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- page
export default function Docs() {
  const [active, setActive] = useState('intro')
  const [q, setQ] = useState('')
  useEffect(() => {
    const els = IDS.map((id) => document.getElementById(id)).filter(Boolean)
    const io = new IntersectionObserver((es) => {
      const vis = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      if (vis[0]) setActive(vis[0].target.id)
    }, { rootMargin: '-80px 0px -70% 0px' })
    els.forEach((e) => io.observe(e))
    return () => io.disconnect()
  }, [])
  const nav = useMemo(() => NAV.map(([g, items]) => [g, items.filter(([, t]) => t.toLowerCase().includes(q.toLowerCase()))]).filter(([, i]) => i.length), [q])

  return (
    <div className="mx-auto w-full max-w-[1320px] px-4 pb-20 pt-10 sm:px-8 lg:grid lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-14 lg:px-12">
      <nav className="hidden lg:block" aria-label="Documentation">
        <div className="sticky top-[calc(var(--bar)+24px)] max-h-[calc(100dvh-var(--bar)-48px)] overflow-y-auto pb-6">
          <p className="display text-[18px] text-ink">Sylithe Ocean Model</p>
          <p className="num mt-0.5 text-[11px] text-faint">docs · models-v1 · export format v2</p>
          <label className="mt-4 flex items-center gap-2 rounded-[7px] border border-line bg-paper px-2.5">
            <Search size={13} className="text-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter topics" className="h-8 w-full bg-transparent text-[12.5px] text-ink outline-none placeholder:text-faint" />
          </label>
          {nav.map(([g, items]) => (
            <div key={g} className="mt-5">
              <p className="label mb-1.5">{g}</p>
              {items.map(([id, t]) => (
                <a key={id} href={`#${id}`} className={`block border-l py-1 pl-3 text-[13px] transition-colors ${active === id ? 'border-ink text-ink' : 'border-line text-mute hover:text-ink'}`}>{t}</a>
              ))}
            </div>
          ))}
        </div>
      </nav>

      <article className="min-w-0">
        <p className="label">Documentation · SIH 2026 · Problem statement 26066 · MoES / INCOIS</p>
        <h1 className="display mt-3 text-[40px] leading-tight">Sylithe Ocean Model</h1>
        <p className="mt-3 max-w-[70ch] text-[16px] leading-relaxed text-ink2">Daily ocean temperature from the surface to 1000 m over the North Indian Ocean,
          reconstructed from satellite observations of the surface alone, with an uncertainty for every value.</p>

        {/* ============================================================ getting started */}
        <div className="mt-12" />
        <H id="intro" group="Getting started">Introduction</H>
        <P>Satellites see the ocean surface every day, everywhere. Argo floats measure the full water column, but only at a few thousand scattered points.
          The Sylithe Ocean Model fills the gap: a neural network that has learned how the surface relates to the temperature beneath it, trained on
          19 years of satellite data against the GLORYS12 reanalysis and checked against independent Argo floats.</P>
        <Table head={['', 'Value']} mono={[]} rows={[
          ['Coverage', 'North Indian Ocean, 5–30°N × 45–105°E'], ['Resolution', '0.25°, daily'], ['Depths', '15 standard levels, 0–1000 m'],
          ['Inputs', 'SST, SSS, sea level anomaly, surface currents, 10 m winds'], ['Latency', 'a few hours after SST and sea level are published'],
          ['Accuracy (2023)', '0.757 °C RMSE against 9,469 Argo measurements'],
        ]} />
        <P>The project has three parts: the Python package <C>oceanembed</C> (data, training, evaluation, daily and live pipelines), a scheduled
          GitHub Actions job that runs the live pipeline, and this web console.</P>

        <H id="quickstart">Quickstart</H>
        <H3>1 · In the browser</H3>
        <P>Open <Link className="link" to="/daily">Daily forecast</Link>. Pick a date and an area in the left sidebar, choose a layer and depth, and
          scroll down for profiles, depth–time sections and week, month, quarter and year graphs. Click the ocean for a point profile.</P>
        <H3>2 · Read the live data from JavaScript</H3>
        <P>The live pipeline publishes static files; no key or login is needed.</P>
        <Code lang="javascript">{`const BASE = '${LIVE}'
const m = await (await fetch(\`\${BASE}/manifest.json\`)).json()
const date = m.days.at(-1).date                          // newest predicted day
const q = new Int16Array(await (await fetch(\`\${BASE}/days/\${date}/temp.bin\`)).arrayBuffer())

const { width, height, lat0, lon0, step } = m.grid, N = width * height
const cell = (lat, lon) => Math.round((lat0 - lat) / step) * width + Math.round((lon - lon0) / step)
const k = m.depths.indexOf(100)                         // 100 m
const raw = q[k * N + cell(15.0, 88.0)]
const T = raw === m.nodata ? NaN : raw * m.layers.temp.scale + m.layers.temp.offset
console.log(\`\${date}: \${T.toFixed(2)} °C at 100 m, 15°N 88°E\`)`}</Code>
        <H3>3 · Read the live data from Python</H3>
        <Code lang="python">{`import numpy as np, requests

BASE = "${LIVE}"
m = requests.get(f"{BASE}/manifest.json").json()
date = m["days"][-1]["date"]
g, spec = m["grid"], m["layers"]["temp"]
q = np.frombuffer(requests.get(f"{BASE}/days/{date}/temp.bin").content, "<i2")
T = np.where(q == m["nodata"], np.nan, q * spec["scale"] + spec["offset"])
T = T.reshape(len(m["depths"]), g["height"], g["width"])       # (depth, lat north→south, lon)
print(date, T.shape, np.nanmean(T[m["depths"].index(100)]))`}</Code>

        <H id="install">Installation</H>
        <P>Python 3.10+ with PyTorch for the model; Node 18+ for the console.</P>
        <Code>{`git clone ${REPO}.git
cd Sylithe_Ocean_Embedding
pip install -r requirements-live.txt     # CPU stack: model, live pipeline, NRT ingest
pip install copernicusmarine earthaccess zarr netCDF4 matplotlib   # + data download, training, figures

cd web && npm install && npm run dev     # console on http://localhost:5173`}</Code>
        <Note>Data download and training were run on Google Colab and RunPod; the notebooks in <C>colab/</C> are generated by <C>colab/_build_notebooks.py</C>.</Note>

        {/* ============================================================ concepts */}
        <H id="grid" group="Concepts">Grid, depths, regions</H>
        <Table head={['Item', 'Definition']} mono={[]} rows={[
          ['Grid', '101 latitudes (5–30°N) × 241 longitudes (45–105°E), cell centres every 0.25°; stored north to south.'],
          ['Depths (m)', '0, 5, 10, 20, 30, 50, 75, 100, 125, 150, 200, 300, 500, 700, 1000'],
          ['NIO', 'North Indian Ocean, the whole domain'], ['BoB', 'Bay of Bengal, 5–23°N × 80–100°E'], ['AS', 'Arabian Sea, 5–25°N × 50–78°E'],
          ['Periods', 'train 2005–2021 · validation 2022 · test 2023'],
        ]} />

        <H id="inputs">Inputs</H>
        <Table head={['Channel', 'Variable', 'Training product', 'Live product']} rows={[
          ['sst', 'Sea surface temperature (°C)', 'OSTIA L4 reprocessed', 'OSTIA NRT'],
          ['sss', 'Sea surface salinity (psu)', 'SMOS/SMAP multi-obs L4', 'multi-obs NRT (~6 days late)'],
          ['sla', 'Sea level anomaly (m)', 'DUACS DT all-satellite', 'DUACS NRT'],
          ['uc, vc', 'Surface current (m s⁻¹)', 'OSCAR v2.0 final', 'DUACS geostrophic'],
          ['uw, vw', '10 m wind (m s⁻¹)', 'CCMP v3.1', 'ASCAT-blended L4 (~1 day late)'],
        ]} />
        <P>Every product is area-averaged onto the grid and masked with the GLORYS12 ocean mask. The model reads a 15-day window of each variable
          plus its anomaly from the day-of-year mean. SSS, currents and winds may be missing; SST and SLA are required.</P>

        <H id="predictions">Predictions and uncertainty</H>
        <P>For each day the model outputs temperature <C>T(z, lat, lon)</C> and a 1σ uncertainty <C>σ(z, lat, lon)</C>, both in °C. Three independently
          trained members are averaged; σ² is the mean member variance plus the variance of the member means.</P>
        <Code lang="text">{`μ  = mean(μ_m)                          m = 1..3
σ² = mean(σ_m²) + mean((μ_m − μ)²)
T  = μ · s_z + climatology(day of year, z)`}</Code>
        <Note>σ is slightly too small: in 2023, 57 % of Argo errors fell inside ±1σ (68 % would be ideal).</Note>

        <H id="derived">Derived quantities</H>
        <Table head={['Name', 'Definition', 'Unit']} mono={[0]} rows={[
          ['D20', 'Depth where temperature first drops to 20 °C (thermocline proxy)', 'm'],
          ['D26', 'Depth where temperature first drops to 26 °C', 'm'],
          ['TCHP', 'ρ·cₚ·∫₀^D26 (T − 26) dz, integrated over the top 300 m; zero where SST < 26 °C', 'kJ cm⁻²'],
          ['MLD', 'First depth 0.5 °C colder than at 10 m', 'm'],
        ]} />
        <P>Profiles are interpolated to 1 m before integration. A TCHP above about 50 kJ cm⁻² can support cyclone rapid intensification.</P>

        <H id="live">Live pipeline</H>
        <P>Four times a day a GitHub Actions job runs <C>python -m oceanembed.live run</C>:</P>
        <ol className="mt-3 max-w-[72ch] list-decimal space-y-1.5 pl-5 text-[14.5px] leading-relaxed text-ink2">
          <li>read the newest date of every near-real-time source from the Copernicus catalogue;</li>
          <li>ingest only the days not yet stored, straight onto the 0.25° grid;</li>
          <li>predict every day whose SST and SLA are in;</li>
          <li>predict again any of the last 21 days whose inputs changed (late salinity or winds): the day's <C>revision</C> goes up by one;</li>
          <li>score the last 30 days against Argo floats that have surfaced;</li>
          <li>publish the console files to the <C>live-data</C> branch.</li>
        </ol>

        {/* ============================================================ guides */}
        <H id="console" group="Guides">Using the console</H>
        <Table head={['Page', 'Use it to']} mono={[]} rows={[
          [<Link className="link" to="/daily">Daily forecast</Link>, 'The live or 2023 prediction for any day and area: map layers, AOI tools, profiles, depth–time sections, graphs, inputs and run log.'],
          [<Link className="link" to="/explorer">Explorer</Link>, 'Any layer at any depth; click for the full profile, a vertical section and depth over time, with CSV download.'],
          [<Link className="link" to="/cyclone">Cyclone watch</Link>, 'Upper-ocean heat available to cyclones: TCHP, the 26 °C isotherm and a daily bulletin.'],
          [<Link className="link" to="/validation">Validation</Link>, 'Skill by depth and float-by-float comparison with Argo.'],
          [<Link className="link" to="/research">Research</Link>, 'Leaderboard, significance tests and every figure of the evaluation.'],
          [<Link className="link" to="/embedding">Embedding</Link>, 'The latent ocean state the encoder learned and the regimes it separates.'],
          [<Link className="link" to="/model">Model</Link>, 'Model card, architecture, training and the methods compared.'],
        ]} />
        <P>Press <C>/</C> anywhere to ask the console, for example “TCHP in the Bay of Bengal”.</P>

        <H id="aoi">Areas of interest</H>
        <P>On the Daily page, section 3 of the sidebar sets the area every number and graph refers to.</P>
        <Table head={['Format', 'How to supply it']} rows={[
          ['.kml', 'a single file'], ['.kmz', 'a single file (the first .kml inside is read)'], ['.geojson / .json', 'FeatureCollection, Feature or bare geometry'],
          ['.zip', 'a zipped shapefile'], ['.shp + .dbf + .prj', 'select the files together'], ['drawn', 'Rectangle (drag) or Polygon (click, double-click to finish)'],
        ]} />
        <P>Only Polygon and MultiPolygon geometries are used; holes are respected. A grid cell belongs to the area when its centre falls inside. Use
          <em> Export area</em> to save it as GeoJSON.</P>

        <H id="train">Training</H>
        <Code>{`# data (Colab notebook colab/01_data_pipeline.ipynb) → DATA/inputs.zarr, DATA/target.zarr
python -m oceanembed.run all --data DATA --root OUT --hours 6 --seeds 42 7 1234`}</Code>
        <P>Steps can be run one by one: <C>stats</C> (normalisation and climatology), <C>ssl</C> (masked-autoencoder pretraining), <C>ours</C> (GLORYS
          fine-tune per seed), <C>paper</C> (Attention 3-D U-Net++ baseline), <C>ridge</C>, <C>leaderboard</C>, <C>web</C>. Checkpoints go to
          <C>OUT/checkpoints/oceanembed_w15/seed*/glorys_best.pt</C>; a run resumes where it stopped.</P>

        <H id="evaluate">Evaluation</H>
        <Code>{`python -m oceanembed.paper_eval --data DATA --root OUT --out OUT/paper --figures
# reuse a saved ensemble reconstruction instead of recomputing it
python -m oceanembed.paper_eval --data DATA --root OUT --out OUT/paper --ensemble-nc OUT/ensemble_2023.nc`}</Code>
        <P>Writes the leaderboard, paired-bootstrap significance tests over Argo profiles, monthly and depth-wise skill, and every figure.</P>

        <H id="deploy">Going live</H>
        <ol className="mt-3 max-w-[72ch] list-decimal space-y-1.5 pl-5 text-[14.5px] leading-relaxed text-ink2">
          <li>Add repository secrets <C>CMEMS_USER</C> and <C>CMEMS_PASS</C> (Copernicus Marine login).</li>
          <li>Publish a release tagged <C>models-v1</C> with <C>seed42.pt</C>, <C>seed7.pt</C>, <C>seed1234.pt</C> and <C>stats_v2.npz</C>.</li>
          <li>Run the <C>live</C> workflow once by hand; the first run ingests the last 45 days.</li>
        </ol>
        <Note kind="warn">Never commit credentials. The workflow reads them only from GitHub secrets.</Note>

        {/* ============================================================ reference */}
        <H id="cli" group="Reference">Command line</H>
        <Api sig="python -m oceanembed.run STEP --data DIR --root DIR [options]" params={[
          ['STEP', 'all | stats | ssl | ours | paper | ridge | leaderboard | web'], ['--hours H', 'GPU-hour budget for training stages (default: epoch-limited)'],
          ['--seeds S …', 'seeds of the ensemble (default 42)'], ['--window N', 'days of surface history (default 15)'], ['--base N', 'first-level width (default 32)'],
          ['--batch N', 'batch size (default 16)'], ['--workers N', 'data-loader workers (default 8)'], ['--epochs N / --epochs-ssl N', 'epoch caps (60 / 30)'],
          ['--web-days START END', 'days exported for the console'],
        ]}>Data preparation, training, baselines and export.</Api>
        <Api sig="python -m oceanembed.paper_eval --data DIR --root DIR --out DIR [--window N] [--ensemble-nc FILE] [--figures]">
          Full evaluation of every method on the test year.</Api>
        <Api sig="python -m oceanembed.daily run|export --data DIR --root DIR [options]" params={[
          ['run --start --end', 'days to predict (default: the test year); cached days are skipped'], ['run --force', 'recompute cached days'],
          ['run --from-nc FILE', 'take predictions from a saved ensemble reconstruction'], ['export --out DIR', 'write the console files'],
          ['export --maps-last N', 'full maps for the last N days (default 31); statistics for every day'],
        ]}>Replay a period day by day with reprocessed inputs.</Api>
        <Api sig="python -m oceanembed.live run --state DIR --models DIR [--stats FILE] [--today YYYY-MM-DD] [--no-argo]" params={[
          ['--state', 'folder holding stored inputs, predictions and the web export'], ['--models', 'folder with seed*/glorys_best.pt (or seed*.pt) and stats_v2.npz'],
          ['--today', 'pretend today is this date (for back-filling)'], ['--no-argo', 'skip the Argo check'],
        ]}>One live cycle. <C>python -m oceanembed.live sources</C> prints the newest date of every feed without logging in.</Api>

        <H id="python">Python API</H>
        <Api sig="train.seed_checkpoints(ck_dir) → list[str]">Paths of <C>seed&lt;digits&gt;/glorys_best.pt</C> under a folder; archived runs are ignored.</Api>
        <Api sig="train.load_model(ckpt) → (model, cfg)">Rebuilds a network from its checkpoint alone; architecture and width come from the saved config.</Api>
        <Api sig="dataset.load_stats(path) → dict">Normalisation statistics and the day-of-year climatology (<C>stats_v2.npz</C>).</Api>
        <Api sig="infer.reconstruct(models, inputs_path, stats, start, end, window, batch=4) → xarray.Dataset">
          Daily 3-D temperature for a period. <C>models</C> may be one network or a list (ensemble). Returns <C>thetao</C> and <C>thetao_sigma</C>.</Api>
        <Api sig="metrics.tchp(T) · metrics.isotherm_depth(T, iso) · metrics.mld(T, dT=0.5) · metrics.skill(pred, true)">
          Derived quantities on a <C>(depth, lat, lon)</C> array; <C>*_fast</C> variants are vectorised over time.</Api>
        <Api sig="live.run(state_dir, models_dir, stats_path=None, today=None, argo=True) → State">One live cycle, as the CLI.</Api>
        <Code lang="python">{`from oceanembed import train as TR, dataset as D, infer, metrics

members = [TR.load_model(p)[0] for p in TR.seed_checkpoints("OUT/checkpoints/oceanembed_w15")]
S = D.load_stats("OUT/stats_v2.npz")
ds = infer.reconstruct(members, "DATA/inputs.zarr", S, "2023-05-01", "2023-05-31", window=15)
heat = metrics.tchp(ds.thetao.sel(time="2023-05-12").values)      # kJ cm⁻², (lat, lon)
ds.to_netcdf("may2023.nc")`}</Code>

        <H id="formats">Data formats</H>
        <H3>manifest.json</H3>
        <Code lang="json">{`{
  "version": 2,
  "grid":   { "lon0": 45.0, "lat0": 30.0, "step": 0.25, "width": 241, "height": 101 },
  "depths": [0, 5, 10, 20, 30, 50, 75, 100, 125, 150, 200, 300, 500, 700, 1000],
  "days":   [{ "date": "2026-09-29", "layers": ["temp", "sigma", "sst", "sla", "uc", "vc"] }],
  "layers": { "temp": { "scale": 0.001, "offset": 20.0, "unit": "°C", "levels": 15 }, … },
  "nodata": -32768
}`}</Code>
        <H3>days/&lt;date&gt;/&lt;layer&gt;.bin</H3>
        <P>Little-endian int16, <C>levels × height × width</C> values, row-major, latitude north to south. Decode with
          <C> value = raw × scale + offset</C>; <C>raw = nodata</C> means land or missing.</P>
        <Table head={['Layer', 'Levels', 'Scale', 'Offset', 'Unit']} rows={[
          ['temp', '15', '0.001', '20', '°C'], ['sigma', '15', '0.0005', '0', '°C'], ['sst', '1', '0.001', '20', '°C'], ['sss', '1', '0.001', '35', 'psu'],
          ['sla', '1', '0.0001', '0', 'm'], ['uc, vc', '1', '0.0001', '0', 'm s⁻¹'], ['uw, vw', '1', '0.001', '0', 'm s⁻¹'],
        ]} mono={[0, 1, 2, 3]} />
        <H3>Other files</H3>
        <Table head={['File', 'Contents']} rows={[
          ['series.json', 'days[date][NIO|BoB|AS] → { T[15], sigma[15], sst, sss, sla, cur, wind, tchp, tchp_ge50, d26, d20, mld }'],
          ['index.json', 'days (predicted), maps (with full grids), runs[date] → { computed_at, members, window, revision, inputs_valid, missing_today }'],
          ['status.json', 'live only: updated_at, run_seconds, sources (newest date and delay per feed), recomputed days'],
          ['skill.json', 'live only: rmse, bias, profiles, points, from, to (Argo check of the last 30 days)'],
          ['NetCDF', 'thetao(time, depth, lat, lon) and thetao_sigma, °C, CF conventions'],
        ]} />

        <H id="endpoints">Live endpoints</H>
        <P>Static files, updated every six hours, served by GitHub with CORS enabled.</P>
        <Table head={['Path', 'Description']} rows={[
          ['/manifest.json', 'grid, depths, layers and the list of mapped days'], ['/days/{date}/{layer}.bin', 'one layer of one day'],
          ['/series.json', 'area statistics for every predicted day'], ['/index.json', 'provenance of every day'],
          ['/status.json', 'feed status of the last run'], ['/skill.json', 'live Argo check'],
        ]} />
        <Code lang="text">{`Base URL: ${LIVE}`}</Code>

        <H id="config">Configuration</H>
        <P>All constants live in <C>oceanembed/config.py</C>: the grid (<C>LAT_MIN…LON_MAX</C>, <C>RES</C>), <C>DEPTHS</C>, the periods
          (<C>TRAIN</C>, <C>VAL</C>, <C>TEST</C>), the source products per variable (<C>SOURCES</C>), the target product (<C>TARGET_PRODUCT</C>) and the
          training settings in <C>TrainConfig</C> (window 15, base 32, lr 2e-4, weight decay 0.05, crops 64 × 128, patience 8, variable dropout 0.3,
          β 0.5, EMA 0.999). Change the domain or years there and every notebook follows.</P>

        {/* ============================================================ project */}
        <H id="results" group="Project">Results</H>
        <P>On 2023, never seen in training: RMSE 0.662 °C against GLORYS12 over the whole column (41 % below climatology) and 0.757 °C against
          9,469 Argo measurements; better than climatology, ridge regression and the HYCOM operational model, and better than the published
          Attention 3-D U-Net++ retrained on the same data in every column, significantly so below 200 m and in the Bay of Bengal. See
          <Link className="link" to="/research"> Research</Link>.</P>

        <H id="limits">Limitations</H>
        <ul className="mt-3 max-w-[72ch] list-disc space-y-2 pl-5 text-[14.5px] leading-relaxed text-ink2">
          <li>Over the whole column the lead over the published architecture is small and not statistically significant.</li>
          <li>The model inherits part of the GLORYS12 bias (about +0.2 °C against Argo).</li>
          <li>Maps are smoother than the reanalysis: the smallest eddies are missed.</li>
          <li>σ is about 20 % too small.</li>
          <li>Live inputs are noisier; the first month scored 1.05 °C against Argo.</li>
        </ul>

        <H id="glossary">Glossary</H>
        <Table head={['Term', 'Meaning']} mono={[]} rows={[
          ['SST / SSS', 'Sea surface temperature / salinity.'], ['SLA', 'Sea level anomaly; highs mark a deep thermocline.'],
          ['Thermocline', 'The layer where temperature drops fastest with depth.'], ['GLORYS12', 'Copernicus global ocean reanalysis at 1/12°; the training target.'],
          ['Argo', 'Autonomous profiling floats; used only to check results.'], ['NRT', 'Near real time: products published within hours to days.'],
          ['RMSE, bias, r', 'Root-mean-square error, mean error, correlation.'], ['σ', 'The model\'s own estimate of its error.'],
          ['Revision', 'How many times a day has been re-predicted after late inputs.'],
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
