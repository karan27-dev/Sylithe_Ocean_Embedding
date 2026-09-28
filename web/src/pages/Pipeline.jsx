import { CheckCircle2, KeyRound, CircleDashed } from 'lucide-react'

// Status reflects what was verified on 2026-09-29: GEE queried live; CMEMS / Earthdata need the team's free logins.
const SOURCES = [
  { v: 'SST', product: 'OSTIA L4', res: '0.05° daily', to: 'area-mean → 0.25°', provider: 'Copernicus Marine', id: 'moi-00168', status: 'creds' },
  { v: 'SSS', product: 'Multi-obs SMOS/SMAP L4', res: '0.125° daily', to: 'area-mean → 0.25°', provider: 'Copernicus Marine', id: 'moi-00051', status: 'creds' },
  { v: 'SLA', product: 'DUACS L4', res: '0.125° daily', to: 'area-mean → 0.25°', provider: 'Copernicus Marine', id: 'moi-00145', status: 'creds' },
  { v: 'Currents U,V', product: 'OSCAR v2.0 final', res: '0.25° daily', to: 'bilinear', provider: 'NASA PO.DAAC', id: 'OSCAR_L4_OC_FINAL_V2.0', status: 'creds' },
  { v: 'Winds U,V', product: 'CCMP v3.1', res: '0.25° 6-hourly', to: 'daily mean', provider: 'NASA PO.DAAC', id: 'CCMP_WINDS_10M6HR_L4_V3.1', status: 'creds' },
  { v: 'Target T', product: 'GLORYS12 reanalysis', res: '1/12° daily, 50 lv', to: '15 std depths + area-mean', provider: 'Copernicus Marine', id: 'moi-00021', status: 'creds' },
  { v: 'Comparator T', product: 'HYCOM GOFS 3.1', res: '1/12° 3-hourly, 40 lv', to: 'daily mean, 15 depths', provider: 'Google Earth Engine', id: 'HYCOM/sea_temp_salinity', status: 'live' },
  { v: 'SST fallback', product: 'NOAA OISST v2.1', res: '0.25° daily', to: 'as is', provider: 'Google Earth Engine', id: 'NOAA/CDR/OISST/V2_1', status: 'live' },
  { v: 'Validation', product: 'Argo profiles (QC)', res: 'point profiles', to: 'std depths, nearest cell', provider: 'argopy / GDAC', id: 'erddap', status: 'open' },
  { v: 'Pretrain T', product: 'Gridded Argo', res: '1° monthly', to: 'linear → 0.25°', provider: 'INCOIS LAS', id: 'manual export', status: 'manual' },
]
const BADGE = {
  live: ['bg-green-50 text-green-700', CheckCircle2, 'Connected'],
  creds: ['bg-amber-50 text-amber-700', KeyRound, 'Needs login'],
  open: ['bg-green-50 text-green-700', CheckCircle2, 'Open access'],
  manual: ['bg-gray-100 text-gray-600', CircleDashed, 'Manual export'],
}

const STEPS = [
  ['Ingest', 'Copernicus ARCO stream · PO.DAAC download→subset→delete · GEE computePixels on the exact grid'],
  ['Harmonise', 'NaN-aware area-mean for finer grids, bilinear for 0.25°, 6-hourly → daily, K → °C'],
  ['Verticalise', 'GLORYS levels → 0,5,10,20,30,50,75,100,125,150,200,300,500,700,1000 m; no extrapolation below the sea floor'],
  ['Store', 'Zarr on Google Drive, one chunk per day, int16 target (0.001 °C), resumable per block'],
  ['Normalise', 'Inputs: train-period z-score. Target: anomaly vs 31-day smoothed GLORYS day-of-year climatology ÷ per-depth σ'],
]

export default function Pipeline() {
  return (
    <div className="p-6 space-y-5">
      <div>
        <p className="eyebrow">Runs on Google Colab → Google Drive · notebook 01</p>
        <h1 className="text-[26px] font-bold">Data Pipeline</h1>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[['Grid', '101 × 241', '0.25° · 5–30°N · 45–105°E'], ['Period', '2005–2023', '6,939 days · train ≤2021 · val 2022 · test 2023'],
          ['Inputs', '7 channels', 'SST SSS SLA Uc Vc Uw Vw'], ['Target', '15 depths', '0 → 1000 m, GLORYS12']].map(([l, v, s]) => (
          <div key={l} className="card p-5">
            <p className="eyebrow mb-1">{l}</p>
            <p className="text-2xl font-black leading-none">{v}</p>
            <p className="text-[11px] text-gray-400 mt-1">{s}</p>
          </div>
        ))}
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-gray-50 text-left">
            <tr>{['Variable', 'Product', 'Native', 'Harmonisation', 'Provider', 'ID', 'Status'].map((h) => <th key={h} className="eyebrow px-4 py-3">{h}</th>)}</tr>
          </thead>
          <tbody>
            {SOURCES.map((s) => {
              const [cls, Icon, txt] = BADGE[s.status]
              return (
                <tr key={s.id + s.v} className="border-t border-gray-100">
                  <td className="px-4 py-3 font-semibold">{s.v}</td>
                  <td className="px-4 py-3">{s.product}</td>
                  <td className="px-4 py-3 font-mono text-[12px] text-gray-500">{s.res}</td>
                  <td className="px-4 py-3 text-gray-500">{s.to}</td>
                  <td className="px-4 py-3">{s.provider}</td>
                  <td className="px-4 py-3 font-mono text-[11px] text-gray-500">{s.id}</td>
                  <td className="px-4 py-3"><span className={`chip inline-flex items-center gap-1 ${cls}`}><Icon size={12} />{txt}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="grid md:grid-cols-5 gap-3">
        {STEPS.map(([t, d], i) => (
          <div key={t} className="card p-4">
            <p className="font-mono text-[11px] text-leaf font-medium">0{i + 1}</p>
            <p className="font-bold mt-1">{t}</p>
            <p className="text-[12px] text-gray-500 mt-1 leading-snug">{d}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
