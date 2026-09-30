import { useState } from 'react'
import { useWidth } from './scale'

// Release-style benchmark chart: one group of bars per benchmark, one bar per method, the value printed on every bar.
// Scores are skill over climatology, 100 × (1 − RMSE / RMSE_climatology): higher is better, 0 = no better than the
// seasonal cycle. Negative scores (worse than climatology) drop below the axis.

const METHODS = [
  { match: /3-model ensemble/, label: 'Sylithe Ocean Model (ensemble)', color: '#D9722B' },
  { match: /single model/, label: 'Sylithe Ocean Model (single)', color: '#F1B888' },
  { match: /Attention 3D U-Net/, label: 'Attention 3D U-Net++ (Wang et al. 2026)', color: '#334155' },
  { match: /Ridge/, label: 'Ridge regression', color: '#7C8798' },
  { match: /HYCOM/, label: 'HYCOM GOFS 3.1', color: '#B6BECA' },
  { match: /GLORYS12 reanalysis/, label: 'GLORYS12 (reference, assimilates Argo)', color: 'none', ref: true },
]
const BENCH = [
  ['RMSE vs Argo (°C)', 'Argo, 0–1000 m'], ['Argo 0–200 m', 'Argo, 0–200 m'], ['Argo 200–1000 m', 'Argo, 200–1000 m'],
  ['Argo Bay of Bengal', 'Bay of Bengal'], ['Argo Arabian Sea', 'Arabian Sea'], ['RMSE vs GLORYS (°C)', 'GLORYS12 field'],
]

export default function BenchmarkBars({ rows }) {
  const [ref, W] = useWidth(900)
  const [hov, setHov] = useState(null)
  const clim = rows.find((r) => /Climatology/.test(r.Method))
  if (!clim) return null
  const ms = METHODS.map((m) => ({ ...m, row: rows.find((r) => m.match.test(r.Method)) })).filter((m) => m.row)
  const score = (r, k) => (r[k] == null || clim[k] == null ? null : 100 * (1 - r[k] / clim[k]))
  const all = BENCH.flatMap(([k]) => ms.map((m) => score(m.row, k))).filter((v) => v != null)
  const top = Math.ceil(Math.max(...all) / 10) * 10, bot = Math.min(0, Math.floor(Math.min(...all) / 10) * 10)
  const H = 300, T = 22, B = 44, L = 34
  const gw = (W - L) / BENCH.length, bw = Math.min(26, (gw - 18) / ms.length)
  const y = (v) => T + ((top - v) / (top - bot)) * (H - T - B)

  return (
    <div ref={ref} className="relative w-full">
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12px] text-ink2">
        {ms.map((m) => (
          <span key={m.label} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-[2px]" style={m.ref ? { border: '1.5px dashed #64748B' } : { background: m.color }} />{m.label}
          </span>))}
      </div>
      <svg width={W} height={H} className="block">
        <defs>
          <pattern id="bb-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="5" stroke="#94A3B8" strokeWidth="1.2" /></pattern>
        </defs>
        {Array.from({ length: (top - bot) / 10 + 1 }, (_, i) => bot + i * 10).map((v) => (
          <g key={v}>
            <line x1={L} x2={W} y1={y(v)} y2={y(v)} stroke={v === 0 ? '#0F172A' : 'rgb(var(--line))'} strokeOpacity={v === 0 ? 0.5 : 1} />
            <text x={L - 6} y={y(v) + 3.5} textAnchor="end" className="num fill-faint text-[10px]">{v}</text>
          </g>))}
        {BENCH.map(([k, label], g) => {
          const x0 = L + g * gw + (gw - bw * ms.length) / 2
          return (
            <g key={k}>
              {ms.map((m, j) => {
                const v = score(m.row, k)
                if (v == null) return null
                const x = x0 + j * bw, y0 = y(Math.max(0, v)), h = Math.abs(y(v) - y(0)), on = hov && hov.g === g && hov.j === j
                return (
                  <g key={m.label} onMouseEnter={() => setHov({ g, j, v, k, m })} onMouseLeave={() => setHov(null)}>
                    <rect x={x + 1.5} y={y0} width={bw - 3} height={Math.max(1, h)} rx="2"
                      fill={m.ref ? 'url(#bb-hatch)' : m.color} stroke={m.ref ? '#64748B' : 'none'} strokeDasharray={m.ref ? '3 2' : undefined}
                      opacity={hov && !on ? 0.55 : 1} />
                    <text x={x + bw / 2} y={v >= 0 ? y0 - 4 : y(v) + 11} textAnchor="middle"
                      className={`num text-[9.5px] ${j === 0 ? 'fill-[#B45309] font-semibold' : 'fill-mute'}`}>{v.toFixed(1)}</text>
                  </g>)
              })}
              <text x={L + g * gw + gw / 2} y={H - B + 20} textAnchor="middle" className="fill-ink text-[11.5px]">{label}</text>
            </g>)
        })}
        <text x={10} y={(H - B) / 2} transform={`rotate(-90 10 ${(H - B) / 2})`} textAnchor="middle" className="fill-mute text-[10px]">Skill over climatology (%)</text>
      </svg>
      {hov && (
        <div className="pointer-events-none absolute left-1/2 top-8 -translate-x-1/2 rounded-[6px] border border-line bg-paper/95 px-2.5 py-1.5 text-[11.5px]">
          <p className="text-ink">{hov.m.label}</p>
          <p className="num text-mute">{BENCH.find(([k]) => k === hov.k)[1]}: {hov.v.toFixed(1)} % · RMSE {hov.m.row[hov.k].toFixed(3)} °C vs climatology {clim[hov.k].toFixed(3)} °C</p>
        </div>
      )}
      <p className="mt-1 text-[11.5px] text-faint">Skill = 100 × (1 − RMSE / RMSE of climatology) on the 2023 test year; higher is better, 0 means no better than the seasonal cycle.
        GLORYS12 is the training target and assimilates Argo, so on the Argo benchmarks it is a reference, not a competitor.</p>
    </div>
  )
}
