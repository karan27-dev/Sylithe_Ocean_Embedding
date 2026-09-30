import { useData } from '../App'
import { SectionHead } from '../components/ui'
import { fmtDate } from '../lib/ocean'

const VARS = [
  ['thetao', '(time, depth, lat, lon)', '°C', 'Reconstructed sea water potential temperature at the 15 standard depths.'],
  ['thetao_sigma', '(time, depth, lat, lon)', '°C', 'Predicted one-sigma uncertainty: member variance plus ensemble spread.'],
  ['depth', '15', 'm', '0, 5, 10, 20, 30, 50, 75, 100, 125, 150, 200, 300, 500, 700, 1000.'],
  ['lat, lon', '101, 241', '°', 'Cell centres, 5–30°N and 45–105°E every 0.25°.'],
  ['time', 'daily', '', 'One field per day; 2023 is the held-out test year.'],
]
const DERIVED = [
  ['D20', 'm', 'Depth of the 20 °C isotherm, the thermocline proxy.'],
  ['D26', 'm', 'Depth of the 26 °C isotherm.'],
  ['TCHP', 'kJ cm⁻²', 'ρ·cp·∫(T − 26) dz from the surface to D26.'],
  ['MLD', 'm', 'First depth 0.5 °C colder than at 10 m.'],
]
const CREDITS = [
  'GLORYS12 reanalysis, E.U. Copernicus Marine Service (doi:10.48670/moi-00021)',
  'OSTIA sea surface temperature (moi-00168); multi-observation SSS (moi-00051); DUACS sea level (moi-00145)',
  'OSCAR v2.0 surface currents and CCMP v3.1 winds, NASA PO.DAAC',
  'HYCOM GOFS 3.1 and NOAA OISST v2.1, via Google Earth Engine',
  'Argo float data, collected and made freely available by the International Argo Program (doi:10.17882/42182)',
]

const kb = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} kB`)

export default function Downloads() {
  const { m } = useData()
  return (
    <div className="pb-8">
      <div className="page pt-12 sm:pt-16">
        <SectionHead as="h1" label="Data" title="The output, and how to read it">
          The reconstruction is written as CF-1.8 NetCDF, one file per period, on the same grid as every input. The console reads a
          compact export of the same fields.
        </SectionHead>
      </div>

      <section className="page mt-16">
        <p className="label">NetCDF product · Sylithe Ocean Model_NIO_T_&lt;year&gt;.nc</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead><tr className="border-b border-line text-left">{['Variable', 'Dimensions', 'Units', 'Meaning'].map((h) => <th key={h} className="label pb-2 pr-6 font-normal">{h}</th>)}</tr></thead>
            <tbody>
              {VARS.map(([v, d, u, t]) => (
                <tr key={v} className="border-b border-line align-baseline">
                  <td className="num py-3 pr-6 text-ink">{v}</td><td className="num py-3 pr-6 text-[12px] text-mute">{d}</td>
                  <td className="py-3 pr-6 text-mute">{u}</td><td className="py-3 text-ink2">{t}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 max-w-[72ch] text-[12.5px] leading-relaxed text-mute">
          Written by notebook 03 (or <span className="num">oceanembed/run.py</span>) to the project's Drive folder. Land and cells below the
          sea floor are NaN; nothing is extrapolated. Derived diagnostics are computed from <span className="num">thetao</span>:
        </p>
        <dl className="mt-4 grid max-w-[900px] gap-x-8 sm:grid-cols-2">
          {DERIVED.map(([k, u, d]) => (
            <div key={k} className="flex gap-4 border-b border-line py-3">
              <dt className="num w-14 shrink-0 text-[13px] text-ink">{k}</dt>
              <dd className="text-[13px] text-ink2">{d} <span className="text-faint">{u}</span></dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="page mt-20">
        <p className="label">Console export{m && ` · ${m.source.label}`}</p>
        {m && (
          <>
            <ul className="mt-4 border-t border-line">
              {[['manifest.json', 'Grid, depths, days, layers and their scale factors'],
                ...Object.values(m.files).map((f) => [f, { argo: 'Matched Argo profiles with every product at the standard depths', skill_depth: 'RMSE, bias and r per product, region and depth', coverage: 'Uncertainty calibration against Argo', leaderboard: 'Every method on the held-out year' }[f.split('.')[0]] ?? ''])]
                .map(([f, d]) => (
                  <li key={f} className="grid grid-cols-[1fr_auto] items-baseline gap-4 border-b border-line py-3 sm:grid-cols-[220px_1fr_auto]">
                    <span className="num text-[13px] text-ink">{f}</span>
                    <span className="hidden text-[13px] text-mute sm:block">{d}</span>
                    <a href={`/data/${f}`} download className="link text-[12.5px]">Download</a>
                  </li>
                ))}
              {m.days.map((d) => (
                <li key={d.date} className="grid grid-cols-[1fr_auto] items-baseline gap-4 border-b border-line py-3 sm:grid-cols-[220px_1fr_auto]">
                  <span className="num text-[13px] text-ink">days/{d.date}/</span>
                  <span className="hidden text-[13px] text-mute sm:block">{fmtDate(d.date)}{d.note ? ` · ${d.note}` : ''}</span>
                  <span className="flex flex-wrap justify-end gap-x-4">
                    {d.layers.map((l) => (
                      <a key={l} href={`/data/days/${d.date}/${l}.bin`} download={`${d.date}_${l}.bin`} className="link num text-[12px]">
                        {l}.bin <span className="text-faint">{kb(m.layers[l].levels * m.N * 2)}</span>
                      </a>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-6 max-w-[76ch] text-[12.5px] leading-relaxed text-mute">
              <p>Each <span className="num">.bin</span> is little-endian int16, levels × {m.grid.height} rows (north to south) × {m.grid.width} columns.
                Value = raw × scale + offset, with the scale and offset per layer in the manifest; {m.nodata} marks land and missing data.</p>
              <pre className="num mt-3 overflow-x-auto rounded-[4px] bg-wash px-4 py-3 text-[12px] text-ink2">{`import numpy as np, json
m = json.load(open("manifest.json")); s = m["layers"]["temp"]
q = np.fromfile("days/${m.days[0].date}/temp.bin", "<i2").reshape(s["levels"], ${m.grid.height}, ${m.grid.width})
T = np.where(q == ${m.nodata}, np.nan, q * s["scale"] + s["offset"])   # °C, north → south`}</pre>
            </div>
          </>
        )}
      </section>

      <section className="page mt-20">
        <p className="label">Data sources</p>
        <ul className="mt-4 max-w-[80ch] border-t border-line">
          {CREDITS.map((c) => <li key={c} className="border-b border-line py-3 text-[13px] text-ink2">{c}</li>)}
        </ul>
      </section>
    </div>
  )
}
