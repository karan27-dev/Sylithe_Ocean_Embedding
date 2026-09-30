import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../App'
import Field from '../components/FieldCanvas'
import SectionView from '../components/charts/SectionView'
import { linePath, linear, sqrtDepth, useWidth } from '../components/charts/scale'
import { useDay, useJSON } from '../lib/data'
import { useView } from '../lib/store'
import { cellAt, fmt, fmtDate, rgbAt, robustRange } from '../lib/ocean'

const SECTION_LAT = 15

const STEPS = [
  ['Surface', 'Seven satellite variables, daily at 0.25°: temperature, salinity, sea level anomaly, currents and winds, over a 15-day window.', '/pipeline'],
  ['Embedding', 'A masked autoencoder compresses each window into a 64-dimensional latent state per patch of ocean, trained without subsurface labels.', '/embedding'],
  ['Reconstruction', 'A nested U-Net decodes temperature at 15 standard depths from 0 to 1000 m, with a calibrated uncertainty for every value.', '/model'],
]

const INDEX = [
  ['/daily', 'Daily forecast', 'Each day\'s satellite inputs and the model\'s prediction, by week, month, quarter or year, computed once and cached.'],
  ['/explorer', 'Explorer', 'Any day, any depth, on satellite imagery. Click a point for its full profile, section and nearby Argo floats.'],
  ['/cyclone', 'Cyclone watch', 'Upper-ocean heat available to cyclones: TCHP, D26 and a daily bulletin.'],
  ['/validation', 'Validation', 'Depth-wise skill against independent Argo profiles, float by float.'],
  ['/research', 'Research', 'Leaderboard against the published state of the art, significance tests and every figure.'],
  ['/embedding', 'Embedding', 'The latent representation, side by side with the surface it reads and the ocean it predicts.'],
  ['/model', 'Model', 'Architecture, training stages, losses and the experiments reported.'],
  ['/docs', 'Docs', 'How to use the console, how it works, data formats, running it yourself and limitations.'],
]

/** Small RMSE-by-depth trace for the validation teaser. */
function RmseTrace({ rows }) {
  const [ref, W] = useWidth(260)
  const H = 150, x = linear(0, Math.max(...rows.map((r) => r.rmse)) * 1.1, 30, W - 6), y = sqrtDepth(1000, 6, H - 18)
  return (
    <div ref={ref}>
      <svg width={W} height={H} className="block">
        {[0, 100, 500, 1000].map((z) => <g key={z}><line x1={30} x2={W - 6} y1={y(z)} y2={y(z)} stroke="rgb(var(--line))" /><text x={24} y={y(z) + 3.5} textAnchor="end" className="num fill-faint text-[10px]">{z}</text></g>)}
        <path d={linePath(rows.map((r) => [x(r.rmse), y(r.depth)]))} fill="none" stroke="rgb(var(--ink))" strokeWidth="1.6" />
        {[0, 0.5, 1, 1.5].filter((t) => x(t) < W - 6).map((t) => <text key={t} x={x(t)} y={H - 3} textAnchor="middle" className="num fill-faint text-[10px]">{t}</text>)}
      </svg>
    </div>
  )
}

export default function Overview() {
  const { m } = useData()
  const { date } = useView()
  const day = useDay(m, date)
  const skill = useJSON('skill_depth.json')
  const argo = useJSON('argo.json')

  const cell = m && cellAt(m.grid, SECTION_LAT, 88)
  const range = useMemo(() => day && robustRange(day.sst ?? day.temp.subarray(0, m.N)), [day, m])
  const paint = useMemo(() => day && ((i) => {
    const v = (day.sst ?? day.temp)[i]
    return Number.isFinite(v) ? rgbAt('thermal', (v - range[0]) / (range[1] - range[0])) : null
  }), [day, range])
  const primary = m?.primary
  const trace = skill?.filter((r) => r.region === 'NIO' && r.product === primary && Number.isFinite(r.rmse))

  return (
    <div>
      {/* hero */}
      <section className="page grid gap-12 pt-14 sm:pt-20 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <div className="lg:pt-6">
          <p className="label">North Indian Ocean · 5–30°N, 45–105°E · 0.25° · daily</p>
          <h1 className="display mt-5 text-[40px] leading-[1.04] sm:text-[54px]">Reconstructing the ocean beneath the surface.</h1>
          <p className="mt-6 max-w-[46ch] text-[16px] leading-relaxed text-ink2">
            Satellites see the ocean's skin every day. Sylithe Ocean Model learns what that surface implies about the water below and
            reconstructs temperature at fifteen depths, from the surface to 1000 m, with an honest uncertainty on every value.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-5">
            <Link to="/explorer" className="btn-solid">Open the Explorer</Link>
            <Link to="/validation" className="link text-[13.5px]">How it is validated</Link>
          </div>
        </div>

        <figure className="min-w-0">
          {m && day ? (
            <>
              <div className="flex items-baseline justify-between">
                <p className="label">Surface · {day.sst ? 'SST' : 'temperature at 0 m'}</p>
                <p className="num text-[10.5px] text-faint">{fmt(range[0], 1)}–{fmt(range[1], 1)} °C</p>
              </div>
              <div className="mt-2 pl-[34px]"><Field m={m} paint={paint} markRow={cell.y} label="Sea surface temperature" /></div>
              <div className="mt-5 flex items-baseline justify-between">
                <p className="label">Below · section along {SECTION_LAT}°N, 0–500 m</p>
              </div>
              <div className="mt-2"><SectionView m={m} day={day} cell={cell} dir="zonal" zmax={500} height={170} /></div>
              <figcaption className="mt-3 text-[11.5px] leading-relaxed text-mute">
                {fmtDate(day.date)}. The dashed line on the map is the section below it: the Arabian Sea on the left, India in grey,
                the Bay of Bengal on the right. {m.source.kind !== 'model' && `Shown with ${m.source.label}, a reference field, until the reconstruction is exported.`}
              </figcaption>
            </>
          ) : <div className="aspect-[4/3] bg-wash/60" />}
        </figure>
      </section>

      {/* the gap */}
      <section className="page mt-28">
        <p className="label">The gap</p>
        <div className="mt-6 grid gap-10 border-t border-line pt-8 md:grid-cols-3">
          {[
            ['Every day, everywhere', 'Satellites map surface temperature, salinity, sea level and winds daily at a quarter degree. None of them see below the top few metres.'],
            ['A few thousand profiles', 'Argo floats measure the full column, but one float per three-degree square every ten days leaves most of the ocean unobserved on any given day.'],
            ['What forecasters need', 'Cyclone intensity, monsoon onset and marine heatwaves depend on the warm layer and thermocline below the surface, daily and basin-wide.'],
          ].map(([t, d]) => (
            <div key={t}>
              <h3 className="display text-[21px] leading-snug">{t}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-ink2">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* method */}
      <section className="page mt-28">
        <p className="label">Method</p>
        <ol className="mt-6 grid border-t border-line md:grid-cols-3">
          {STEPS.map(([t, d, to], i) => (
            <li key={t} className={`py-8 md:pr-8 ${i ? 'border-t border-line md:border-l md:border-t-0 md:pl-8' : ''}`}>
              <p className="num text-[11px] text-faint">0{i + 1}</p>
              <h3 className="display mt-2 text-[24px]">{t}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-ink2">{d}</p>
              <Link to={to} className="link mt-4 inline-block text-[12.5px]">More</Link>
            </li>
          ))}
        </ol>
      </section>

      {/* validation teaser */}
      <section className="page mt-24">
       <div className="grid gap-10 border-t border-line pt-10 md:grid-cols-[1fr_300px]">
        <div>
          <p className="label">Validation</p>
          <h2 className="display mt-3 text-[28px] leading-tight">Judged by the floats, not by the model it was trained on.</h2>
          <p className="mt-3 max-w-[56ch] text-[14.5px] leading-relaxed text-ink2">
            Scores come from quality-controlled Argo profiles withheld from training, with GLORYS and HYCOM scored on the same
            floats. {argo?.profiles && m?.source.kind !== 'model' && `Right now the page scores the HYCOM reference against ${argo.profiles.length} real profiles; the reconstruction joins it once exported.`}
          </p>
          <Link to="/validation" className="link mt-4 inline-block text-[13px]">Open Validation</Link>
        </div>
        {trace?.length > 0 && (
          <figure>
            <p className="label mb-2">RMSE vs Argo by depth, {m.products?.[primary]?.label ?? primary}</p>
            <RmseTrace rows={trace} />
          </figure>
        )}
       </div>
      </section>

      {/* index */}
      <section className="page mt-24">
        <p className="label">Inside</p>
        <ul className="mt-6 border-t border-line">
          {INDEX.map(([to, t, d]) => (
            <li key={to} className="border-b border-line">
              <Link to={to} className="group grid grid-cols-[1fr_auto] items-baseline gap-4 py-5 sm:grid-cols-[220px_1fr_auto]">
                <span className="display text-[22px] transition-colors group-hover:text-sea">{t}</span>
                <span className="hidden text-[14px] text-mute sm:block">{d}</span>
                <span className="text-mute transition-transform duration-200 group-hover:translate-x-1" aria-hidden="true">→</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
