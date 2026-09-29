import { useState } from 'react'
import { DEPTHS, fmt } from '../../lib/ocean'
import { linePath, linear, sqrtDepth, ticks, useWidth } from './scale'

export const PRODUCT_STYLE = {
  ours: { color: 'rgb(var(--sea))', width: 2, label: 'OceanEmbed' },
  glorys: { color: 'rgb(var(--ink))', width: 1.4, dash: '4 3', label: 'GLORYS12' },
  hycom: { color: '#8A6F4E', width: 1.5, label: 'HYCOM' },
}
export const styleOf = (p, m) => ({ ...(PRODUCT_STYLE[p] ?? { color: 'rgb(var(--mute))', width: 1.4 }), label: m?.products?.[p]?.label ?? PRODUCT_STYLE[p]?.label ?? p })

const ZT = [0, 50, 100, 200, 500, 1000]

/** One metric against depth for several products. rows: skill rows already filtered to a region. */
function MetricPanel({ rows, products, metric, title, zero, domain, m, hover, setHover }) {
  const [ref, W] = useWidth(300)
  const H = 300, L = { t: 12, r: 10, b: 26, l: 40 }
  const vals = rows.filter((r) => products.includes(r.product)).map((r) => r[metric]).filter(Number.isFinite)
  const [lo, hi] = domain ?? [Math.min(0, ...vals), Math.max(...vals) * 1.08 || 1]
  const x = linear(lo, hi, L.l, W - L.r), y = sqrtDepth(1000, L.t, H - L.b)
  return (
    <figure ref={ref}>
      <figcaption className="mb-2 text-[13px] text-ink">{title}</figcaption>
      <svg width={W} height={H} className="block overflow-visible"
        onMouseMove={(e) => { const py = e.clientY - e.currentTarget.getBoundingClientRect().top; setHover(DEPTHS.reduce((b, z) => (Math.abs(y(z) - py) < Math.abs(y(b) - py) ? z : b), 0)) }}
        onMouseLeave={() => setHover(null)}>
        {ZT.map((z) => (
          <g key={z}><line x1={L.l} x2={W - L.r} y1={y(z)} y2={y(z)} stroke="rgb(var(--line))" />
            <text x={L.l - 8} y={y(z) + 3.5} textAnchor="end" className="num fill-faint text-[10px]">{z}</text></g>
        ))}
        {ticks(lo, hi, 4).map((t) => <text key={t} x={x(t)} y={H - 8} textAnchor="middle" className="num fill-faint text-[10px]">{t}</text>)}
        {zero != null && zero >= lo && zero <= hi && <line x1={x(zero)} x2={x(zero)} y1={L.t} y2={H - L.b} stroke="rgb(var(--ink))" strokeOpacity=".35" />}
        {products.map((p) => {
          const s = styleOf(p, m), pr = rows.filter((r) => r.product === p).sort((a, b) => a.depth - b.depth)
          return (
            <g key={p}>
              <path d={linePath(pr.map((r) => [x(r[metric] ?? NaN), y(r.depth)]))} fill="none" stroke={s.color} strokeWidth={s.width} strokeDasharray={s.dash} />
              {pr.map((r) => Number.isFinite(r[metric]) && <circle key={r.depth} cx={x(r[metric])} cy={y(r.depth)} r={hover === r.depth ? 3.6 : 2.2} fill={s.color} />)}
            </g>
          )
        })}
        {hover != null && <line x1={L.l} x2={W - L.r} y1={y(hover)} y2={y(hover)} stroke="rgb(var(--ink))" strokeOpacity=".25" />}
      </svg>
    </figure>
  )
}

/** RMSE, bias and correlation against depth, side by side, sharing one hover depth. */
export function SkillByDepth({ rows, products, m }) {
  const [hover, setHover] = useState(null)
  const common = { rows, products, m, hover, setHover }
  const at = hover != null ? rows.filter((r) => r.depth === hover && products.includes(r.product)) : []
  return (
    <div>
      <div className="grid gap-8 md:grid-cols-3">
        <MetricPanel {...common} metric="rmse" title="RMSE (°C)" />
        <MetricPanel {...common} metric="bias" title="Bias, product − Argo (°C)" zero={0}
          domain={(() => { const b = Math.max(0.2, ...rows.map((r) => Math.abs(r.bias)).filter(Number.isFinite)) * 1.1; return [-b, b] })()} />
        <MetricPanel {...common} metric="r" title="Correlation" domain={[Math.min(0.5, ...rows.map((r) => r.r).filter(Number.isFinite)), 1]} />
      </div>
      <p className="num mt-3 h-4 text-[11.5px] text-mute">
        {hover != null && <>{hover} m · {at.map((r) => `${styleOf(r.product, m).label} RMSE ${fmt(r.rmse, 2)} · bias ${fmt(r.bias, 2)} · r ${fmt(r.r, 3)} · n ${r.n}`).join('   ')}</>}
      </p>
    </div>
  )
}

/** Every matched (profile, depth) error as a dot, one row per depth: shows spread and outliers, not only a mean. */
export function ErrorStrip({ profiles, product, height = 360 }) {
  const [ref, W] = useWidth(600)
  const L = { t: 10, r: 16, b: 26, l: 48 }, lim = 3
  const x = linear(-lim, lim, L.l, W - L.r)
  const row = (H) => (k) => L.t + (k + 0.5) * ((H - L.t - L.b) / DEPTHS.length)
  const y = row(height)
  const dots = []
  const med = DEPTHS.map((_, k) => {
    const e = profiles.map((p) => (p.products[product]?.[k] ?? NaN) - (p.obs[k] ?? NaN)).filter(Number.isFinite)
    e.forEach((v, j) => dots.push([k, v, j]))
    const s = e.slice().sort((a, b) => a - b)
    return s.length ? s[Math.floor(s.length / 2)] : NaN
  })
  const jit = (j) => (((j * 2654435761) % 1000) / 1000 - 0.5) * 0.55 * ((height - L.t - L.b) / DEPTHS.length)
  return (
    <div ref={ref}>
      <svg width={W} height={height} className="block">
        {[-2, -1, 0, 1, 2].map((t) => (
          <g key={t}><line x1={x(t)} x2={x(t)} y1={L.t} y2={height - L.b} stroke={t ? 'rgb(var(--line))' : 'rgb(var(--ink))'} strokeOpacity={t ? 1 : 0.35} />
            <text x={x(t)} y={height - 8} textAnchor="middle" className="num fill-faint text-[10px]">{t > 0 ? `+${t}` : t}°</text></g>
        ))}
        {DEPTHS.map((z, k) => <text key={z} x={L.l - 10} y={y(k) + 3.5} textAnchor="end" className="num fill-faint text-[10px]">{z} m</text>)}
        {dots.map(([k, v, j]) => (
          <circle key={`${k}-${j}`} cx={x(Math.max(-lim, Math.min(lim, v)))} cy={y(k) + jit(j + k * 31)} r="1.8"
            fill={v > 0 ? 'rgb(var(--heat))' : 'rgb(var(--cold))'} opacity=".45" />
        ))}
        {med.map((v, k) => Number.isFinite(v) && <line key={k} x1={x(v)} x2={x(v)} y1={y(k) - 7} y2={y(k) + 7} stroke="rgb(var(--ink))" strokeWidth="2" />)}
      </svg>
    </div>
  )
}

/** Fraction of Argo errors inside ±1σ / ±2σ against the Gaussian targets (68 % / 95 %). */
export function Coverage({ rows }) {
  const [ref, W] = useWidth(400)
  const H = 260, L = { t: 10, r: 12, b: 26, l: 40 }
  const x = linear(0, 1, L.l, W - L.r), y = sqrtDepth(1000, L.t, H - L.b)
  const line = (key) => linePath(rows.map((r) => [x(r[key] ?? NaN), y(r.depth)]))
  return (
    <div ref={ref}>
      <svg width={W} height={H} className="block">
        {ZT.map((z) => <g key={z}><line x1={L.l} x2={W - L.r} y1={y(z)} y2={y(z)} stroke="rgb(var(--line))" /><text x={L.l - 8} y={y(z) + 3.5} textAnchor="end" className="num fill-faint text-[10px]">{z}</text></g>)}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => <text key={t} x={x(t)} y={H - 8} textAnchor="middle" className="num fill-faint text-[10px]">{t * 100}%</text>)}
        {[[0.683, '68 %'], [0.954, '95 %']].map(([t, l]) => (
          <g key={l}><line x1={x(t)} x2={x(t)} y1={L.t} y2={H - L.b} stroke="rgb(var(--ink))" strokeOpacity=".35" strokeDasharray="3 3" /></g>
        ))}
        <path d={line('inside1')} fill="none" stroke="rgb(var(--sea))" strokeWidth="2" />
        <path d={line('inside2')} fill="none" stroke="rgb(var(--sea))" strokeWidth="1.3" strokeDasharray="4 3" />
      </svg>
    </div>
  )
}
