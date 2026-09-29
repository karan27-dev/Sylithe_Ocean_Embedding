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

/** Point inspector. Desktop: a docked column that slides in. Phone: a bottom sheet over the map. */
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
    const blob = new Blob([`# OceanEmbed profile ${day.date} ${cell.lat.toFixed(2)}N ${cell.lon.toFixed(2)}E · ${m.source.label}\n${head.join(',')}\n${rows.join('\n')}\n`], { type: 'text/csv' })
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `oceanembed_${day.date}_${cell.lat.toFixed(2)}N_${cell.lon.toFixed(2)}E.csv` })
    a.click(); URL.revokeObjectURL(a.href)
  }

  return (
    <aside aria-label="Point profile" aria-hidden={!open}
      className={`z-[800] flex flex-col bg-paper transition-[transform,width,opacity] duration-300 ease-out
        max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:max-h-[72dvh] max-lg:rounded-t-[14px] max-lg:border-t max-lg:border-line
        lg:relative lg:shrink-0 lg:border-l lg:border-line
        ${open ? 'max-lg:translate-y-0 lg:w-[400px] opacity-100' : 'max-lg:translate-y-full lg:w-0 opacity-0 pointer-events-none'}`}>
      {open && (
        <div className="flex min-h-0 flex-1 flex-col lg:w-[400px]">
          <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-line2 lg:hidden" />
          <header className="flex items-start justify-between px-5 pb-3 pt-4">
            <div>
              <p className="label">Point profile · {fmtDate(day.date)}</p>
              <p className="num mt-1 text-[15px] text-ink">{fmtLat(cell.lat)}  {fmtLon(cell.lon)}</p>
            </div>
            <button onClick={onClose} className="-mr-1 p-1 text-[13px] text-mute hover:text-ink">Close</button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8">
            <dl className="grid grid-cols-5 border-y border-line">
              {[
                ['SST', day.sst?.[cell.i], 1, '°C'],
                ['MLD', ml, 0, 'm'],
                ['D26', isothermDepth(col, 26), 0, 'm'],
                ['D20', isothermDepth(col, 20), 0, 'm'],
                ['TCHP', heat, 0, 'kJ cm⁻²'],
              ].map(([k, val, d, u], i) => (
                <div key={k} className={`py-3 ${i ? 'border-l border-line pl-3' : ''}`}>
                  <dt className="label">{k}</dt>
                  <dd className={`num mt-1 text-[17px] leading-none ${k === 'TCHP' && heat >= 50 ? 'text-heat' : 'text-ink'}`}>{fmt(val, d)}</dd>
                  <dd className="mt-1 text-[10px] text-faint">{u}</dd>
                </div>
              ))}
            </dl>

            <section className="rise-in pt-5">
              <div className="mb-2 flex items-baseline justify-between">
                <h3 className="text-[13px] text-ink">Temperature profile</h3>
                <button onClick={csv} className="text-[12px] text-mute hover:text-ink">CSV</button>
              </div>
              <ProfileChart
                main={{ label: m.source.kind === 'model' ? 'OceanEmbed' : fmtDate(day.date), values: col, sigma: day.sigma ? column(m, day.sigma, cell.i) : null }}
                others={others}
                points={float ? [{ label: `Argo ${float.platform}`, values: float.obs }] : []}
                mld={ml} />
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-mute">
                <span><span className="mr-1.5 inline-block w-4 border-t-[1.5px] border-ink align-middle" />{m.source.kind === 'model' ? 'Reconstruction' : fmtDate(day.date)}</span>
                {day.sigma && <span><span className="mr-1.5 inline-block h-2 w-4 bg-sea/15 align-middle" />±1σ</span>}
                {others.map((o) => (
                  <span key={o.label}><span className={`mr-1.5 inline-block w-4 border-t align-middle ${o.style === 'dashed' ? 'border-dashed border-mute' : 'border-line2'}`} />{o.label}</span>
                ))}
                {float && <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full border border-heat align-middle" />Argo float</span>}
              </div>
              {float ? (
                <p className="mt-3 text-[11.5px] leading-relaxed text-mute">
                  Argo float {float.platform}, cycle {float.cycle}, surfaced {fmtDate(float.date)} {Math.round(float.d)} km away.
                  {float.date !== day.date && ' Matched within the demo ±3-day window.'}
                </p>
              ) : argo?.profiles && (
                <p className="mt-3 text-[11.5px] text-faint">No Argo profile within 60 km on this day.</p>
              )}
            </section>

            <section className="mt-7 border-t border-line pt-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-[13px] text-ink">Section</h3>
                <div className="flex gap-2">
                  <Seg value={dir} onChange={setDir} options={[['zonal', 'E–W'], ['meridional', 'N–S']]} />
                  <Seg value={zmax} onChange={setZmax} options={[[500, '500 m'], [1000, '1000 m']]} />
                </div>
              </div>
              <SectionView m={m} day={day} cell={cell} dir={dir} zmax={zmax} />
            </section>

            {all.length >= 3 && (
              <section className="mt-7 border-t border-line pt-5">
                <h3 className="mb-3 text-[13px] text-ink">Depth over time <span className="text-faint">· 0–300 m</span></h3>
                <DepthTime m={m} days={all} cell={cell} />
              </section>
            )}
          </div>
        </div>
      )}
    </aside>
  )
}
