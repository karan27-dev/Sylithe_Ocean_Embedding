import { useMemo, useState } from 'react'
import { useData } from '../App'
import { useDays, useJSON } from '../lib/data'
import { DEPTHS, column, fmt, fmtDate, fmtLat, fmtLon, isothermDepth, mld, tchp } from '../lib/ocean'
import ProfileChart from './charts/ProfileChart'
import SectionView from './charts/SectionView'
import DepthTime from './charts/DepthTime'

const km = (a, b) => {
  const r = Math.PI / 180, dy = (a.lat - b.lat) * 111.2, dx = (a.lon - b.lon) * 111.2 * Math.cos(((a.lat + b.lat) / 2) * r)
  return Math.hypot(dx, dy)
}

function Seg({ value, options, onChange }) {
  return (
    <div className="seg">
      {options.map(([v, l]) => <button key={v} aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  )
}

/** Point analysis, shown as a full-width section below the map. */
export default function ProbePanel({ cell, day, onClose }) {
  const { m } = useData()
  const argo = useJSON('argo.json')
  const [dir, setDir] = useState('zonal')
  const [zmax, setZmax] = useState(500)
  const open = !!(m && cell && day && Number.isFinite(day.temp[cell.i]))
  const dates = useMemo(() => m?.days.map((d) => d.date), [m])
  const all = useDays(open ? m : null, dates)

  const col = open ? column(m, day.temp, cell.i) : null
  const heat = col ? tchp(col) : NaN
  const ml = col ? mld(col) : NaN

  // nearest Argo profile matched to this day, within 60 km
  const float = useMemo(() => {
    if (!open || !argo?.profiles) return null
    let best = null
    for (const p of argo.profiles) {
      if ((p.day ?? p.date) !== day.date) continue
      const d = km(p, cell)
      if (d < 60 && (!best || d < best.d)) best = { ...p, d }
    }
    return best
  }, [argo, cell, day, open])

  const others = open && all.length <= 4
    ? all.filter((d) => d.date !== day.date).map((d) => ({ label: fmtDate(d.date), values: column(m, d.temp, cell.i), style: 'faint' }))
    : []
  if (open && day.ref) others.push({ label: 'GLORYS12', values: column(m, day.ref, cell.i), style: 'dashed' })

  const csv = () => {
    const head = ['depth_m', 'temperature_degC', ...(day.sigma ? ['sigma_degC'] : []), ...(day.ref ? ['glorys_degC'] : [])]
    const rows = DEPTHS.map((z, k) => [z, col[k], ...(day.sigma ? [day.sigma[k * m.N + cell.i]] : []), ...(day.ref ? [day.ref[k * m.N + cell.i]] : [])]
      .map((v) => (Number.isFinite(v) ? +v.toFixed(3) : '')).join(','))
    const blob = new Blob([`# Sylithe Ocean Model profile ${day.date} ${cell.lat.toFixed(2)}N ${cell.lon.toFixed(2)}E · ${m.source.label}\n${head.join(',')}\n${rows.join('\n')}\n`], { type: 'text/csv' })
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `sylithe_ocean_model_${day.date}_${cell.lat.toFixed(2)}N_${cell.lon.toFixed(2)}E.csv` })
    a.click(); URL.revokeObjectURL(a.href)
  }

  if (!open) {
    return (
      <section className="page py-10">
        <p className="label">Point analysis</p>
        <p className="mt-2 max-w-[60ch] text-[14px] text-mute">
          Click anywhere on the ocean to see the full temperature profile from 0 to 1000 m with its uncertainty,
          the nearest Argo float, a vertical section through that point and how the column changed over the days in view.
        </p>
      </section>
    )
  }

  return (
    <section aria-label="Point analysis" className="page rise-in py-8">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
        <div>
          <p className="label">Point analysis · {fmtDate(day.date)}</p>
          <p className="num mt-1 text-[18px] text-ink">{fmtLat(cell.lat)}  {fmtLon(cell.lon)}</p>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={csv} className="btn">Download profile (CSV)</button>
          <button onClick={onClose} className="text-[13px] text-mute hover:text-ink">Clear</button>
        </div>
      </header>

      <dl className="grid grid-cols-2 border-b border-line sm:grid-cols-5">
        {[
          ['Sea surface temperature', day.sst?.[cell.i], 1, '°C'],
          ['Mixed layer depth', ml, 0, 'm'],
          ['26 °C isotherm (D26)', isothermDepth(col, 26), 0, 'm'],
          ['20 °C isotherm (D20)', isothermDepth(col, 20), 0, 'm'],
          ['Cyclone heat potential', heat, 0, 'kJ cm⁻²'],
        ].map(([k, val, d, u], i) => (
          <div key={k} className={`py-4 ${i ? 'sm:border-l sm:border-line sm:pl-5' : ''}`}>
            <dt className="label">{k}</dt>
            <dd className={`num mt-1.5 text-[22px] leading-none ${k.startsWith('Cyclone') && heat >= 50 ? 'text-heat' : 'text-ink'}`}>{fmt(val, d)}</dd>
            <dd className="mt-1 text-[11px] text-faint">{u}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-10 pt-6 lg:grid-cols-3">
        <section>
          <h3 className="mb-2 text-[13px] text-ink">Temperature profile</h3>
          <ProfileChart
            main={{ label: m.source.kind === 'model' ? 'Sylithe Ocean Model' : fmtDate(day.date), values: col, sigma: day.sigma ? column(m, day.sigma, cell.i) : null }}
            others={others}
            points={float ? [{ label: `Argo ${float.platform}`, values: float.obs }] : []}
            mld={ml} />
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-mute">
            <span><span className="mr-1.5 inline-block w-4 border-t-[1.5px] border-ink align-middle" />{m.source.kind === 'model' ? 'Sylithe Ocean Model' : fmtDate(day.date)}</span>
            {day.sigma && <span><span className="mr-1.5 inline-block h-2 w-4 bg-sea/15 align-middle" />±1σ</span>}
            {others.map((o) => (
              <span key={o.label}><span className={`mr-1.5 inline-block w-4 border-t align-middle ${o.style === 'dashed' ? 'border-dashed border-mute' : 'border-line2'}`} />{o.label}</span>
            ))}
            {float && <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full border border-heat align-middle" />Argo float</span>}
          </div>
          {float ? (
            <p className="mt-3 text-[11.5px] leading-relaxed text-mute">
              Argo float {float.platform}, cycle {float.cycle}, surfaced {fmtDate(float.date)} {Math.round(float.d)} km away.
            </p>
          ) : argo?.profiles && (
            <p className="mt-3 text-[11.5px] text-faint">No Argo profile within 60 km on this day.</p>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-[13px] text-ink">Vertical section</h3>
            <div className="flex gap-2">
              <Seg value={dir} onChange={setDir} options={[['zonal', 'E–W'], ['meridional', 'N–S']]} />
              <Seg value={zmax} onChange={setZmax} options={[[500, '500 m'], [1000, '1000 m']]} />
            </div>
          </div>
          <SectionView m={m} day={day} cell={cell} dir={dir} zmax={zmax} />
        </section>

        <section>
          <h3 className="mb-3 text-[13px] text-ink">Depth over time <span className="text-faint">· 0–300 m</span></h3>
          {all.length >= 3 ? <DepthTime m={m} days={all} cell={cell} />
            : <p className="text-[12px] text-faint">Loading the days in view…</p>}
        </section>
      </div>
    </section>
  )
}
