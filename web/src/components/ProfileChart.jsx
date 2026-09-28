import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts'
import { DEPTHS, fmt } from '../lib/ocean'

// Vertical temperature profile(s) at the probed cell. Depth runs down on a sqrt scale so the
// upper 200 m (mixed layer + thermocline) gets the room it deserves.
export default function ProfileChart({ series }) {
  const rows = DEPTHS.map((d, k) => {
    const r = { depth: d }
    for (const s of series) r[s.key] = s.values[k]
    return r
  })
  const all = series.flatMap((s) => s.values).filter((v) => v != null)
  const lo = Math.floor(Math.min(...all, 26) - 1), hi = Math.ceil(Math.max(...all) + 0.5)

  return (
    <div>
      <div className="flex gap-4 mb-2">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-[11px] text-gray-600">
            <span className="w-4 h-[2px] rounded" style={{ background: s.color }} />{s.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-[11px] text-gray-400">
          <span className="w-4 border-t border-dashed border-gray-400" />26 °C / 20 °C
        </span>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={rows} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="#eef0f2" />
          <XAxis type="number" domain={[lo, hi]} tick={{ fontSize: 10, fill: '#94a3b8', fontFamily: 'DM Mono' }}
            tickLine={false} axisLine={{ stroke: '#e5e7eb' }} unit="°" />
          <YAxis type="number" dataKey="depth" reversed scale="sqrt" domain={[0, 1000]}
            ticks={[0, 20, 50, 100, 200, 300, 500, 1000]} tick={{ fontSize: 10, fill: '#94a3b8', fontFamily: 'DM Mono' }}
            tickLine={false} axisLine={{ stroke: '#e5e7eb' }} width={40} unit="m" />
          <ReferenceLine x={26} stroke="#94a3b8" strokeDasharray="3 3" />
          <ReferenceLine x={20} stroke="#94a3b8" strokeDasharray="3 3" />
          <Tooltip content={<Tip series={series} />} cursor={{ stroke: '#0F172A', strokeWidth: 1 }} />
          {series.map((s) => (
            <Line key={s.key} dataKey={s.key} stroke={s.color} strokeWidth={2} isAnimationActive={false}
              dot={{ r: 3, strokeWidth: 0, fill: s.color }} activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }} connectNulls={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function Tip({ active, payload, series }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-sm">
      <p className="eyebrow mb-1">{row.depth} m</p>
      {series.map((s) => (
        <p key={s.key} className="text-[12px] text-ink font-mono flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
          {fmt(row[s.key], 2)} °C <span className="text-gray-400 font-sans">{s.label}</span>
        </p>
      ))}
    </div>
  )
}
