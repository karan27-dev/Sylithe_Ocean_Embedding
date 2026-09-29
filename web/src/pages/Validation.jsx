import { useEffect, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { FlaskConical } from 'lucide-react'

// Reads /data/skill.json written by notebook 03 (Argo-matched RMSE / bias / r per depth for
// ours, GLORYS and HYCOM). Until the model is trained this page shows what will be measured, not numbers.
const SERIES = [
  { key: 'ours', label: 'OceanEmbed', color: '#16a34a' },
  { key: 'glorys', label: 'GLORYS12', color: '#0F172A' },
  { key: 'hycom', label: 'HYCOM', color: '#94a3b8' },
]

const KIND_STYLE = {
  ours: 'bg-mist text-abyss',
  'published method (retrained here)': 'bg-amber-50 text-amber-800',
  baseline: 'bg-gray-100 text-gray-600',
  'reference product': 'bg-blue-50 text-blue-700',
}
const COLS = ['RMSE vs Argo (°C)', 'RMSE vs GLORYS (°C)', 'Argo Bay of Bengal', 'Argo Arabian Sea', 'Argo bias (°C)']

function Leaderboard({ board }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-5 pt-5 pb-3">
        <p className="eyebrow">Leaderboard · test year 2023, never seen in training · same grid, depths and Argo floats for every row</p>
      </div>
      <table className="w-full text-[13px]">
        <thead className="bg-gray-50 text-left">
          <tr>
            <th className="eyebrow px-4 py-3">#</th><th className="eyebrow px-4 py-3">Method</th><th className="eyebrow px-4 py-3">Type</th>
            {COLS.map((c) => <th key={c} className="eyebrow px-4 py-3 text-right">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {board.rows.map((r, i) => (
            <tr key={r.Method} className={`border-t border-gray-100 ${r.Type === 'ours' ? 'bg-mist/40' : ''}`}>
              <td className="px-4 py-3 font-mono text-gray-400">{i + 1}</td>
              <td className="px-4 py-3 font-semibold">{r.Method}</td>
              <td className="px-4 py-3"><span className={`chip ${KIND_STYLE[r.Type] || 'bg-gray-100'}`}>{r.Type}</span></td>
              {COLS.map((c) => <td key={c} className="px-4 py-3 text-right font-mono">{r[c] == null ? '—' : Number(r[c]).toFixed(3)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {board.context?.length > 0 && (
        <div className="px-5 py-4 border-t border-gray-100 text-[12px] text-gray-500">
          <p className="eyebrow mb-1">Published results, for context only (different region, depths or reference data)</p>
          {board.context.map((c) => (
            <p key={c.method}>{c.method}: {Object.entries(c).filter(([k]) => k.startsWith('rmse')).map(([k, v]) => `${v} °C`).join(', ')} · {c.setup}</p>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Validation() {
  const [rows, setRows] = useState(null)
  const [board, setBoard] = useState(null)
  useEffect(() => {
    fetch('/data/skill.json').then((r) => (r.ok ? r.json() : null)).then(setRows).catch(() => setRows(null))
    fetch('/data/leaderboard.json').then((r) => (r.ok ? r.json() : null)).then(setBoard).catch(() => setBoard(null))
  }, [])

  return (
    <div className="p-6 space-y-5">
      <div>
        <p className="eyebrow">Independent: 2023 held out · Argo profiles never used in training · notebook 03</p>
        <h1 className="text-[26px] font-bold">Validation</h1>
      </div>
      {board && <Leaderboard board={board} />}
      {!rows ? (
        <div className="card p-10 flex flex-col items-center text-center">
          <FlaskConical size={36} className="text-gray-300 mb-3" />
          <p className="font-semibold text-gray-500">No skill scores yet</p>
          <p className="text-[12px] text-gray-400 mt-1 max-w-lg">
            Run notebooks 01 → 02 → 03 on Colab, then copy <span className="font-mono">web_export/skill.json</span> into
            <span className="font-mono"> web/public/data/</span>. This page will plot RMSE, bias and correlation per depth against Argo for
            OceanEmbed, GLORYS12 and HYCOM, overall and for the Bay of Bengal and Arabian Sea.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
        <div className="flex gap-5">
          {SERIES.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5 text-[12px] text-gray-600">
              <span className="w-4 h-[2px] rounded" style={{ background: s.color }} />{s.label}
            </span>
          ))}
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          {[['rmse', 'RMSE vs Argo (°C)'], ['bias', 'Bias vs Argo (°C)'], ['r', 'Correlation']].map(([m, title]) => (
            <div key={m} className="card p-5">
              <p className="eyebrow mb-2">{title}</p>
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={rows} layout="vertical">
                  <CartesianGrid stroke="#eef0f2" />
                  <XAxis type="number" tick={{ fontSize: 10, fontFamily: 'DM Mono', fill: '#94a3b8' }} />
                  <YAxis type="number" dataKey="depth" scale="sqrt" domain={[0, 1000]} ticks={[0, 50, 100, 200, 300, 500, 1000]}
                    tick={{ fontSize: 10, fontFamily: 'DM Mono', fill: '#94a3b8' }} width={40} unit="m" />
                  <Tooltip />
                  {SERIES.map((s) => (
                    <Line key={s.key} dataKey={`${s.key}_${m}`} name={s.label} stroke={s.color} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>
        </div>
      )}
      <div className="card p-5">
        <p className="eyebrow mb-3">Published reference: Wang et al., ESSD 18, 4617 (2026), NW Pacific</p>
        <div className="grid md:grid-cols-3 gap-4 text-[13px]">
          <div><p className="text-2xl font-black">0.351</p><p className="text-gray-500">RMSE vs WOD with Argo-pretrain → GLORYS full fine-tune (vs 0.378 without transfer; 0.456 when the encoder was frozen)</p></div>
          <div><p className="text-2xl font-black">26 d</p><p className="text-gray-500">input window where the error curve saturates (T RMSE 0.636 → 0.612 °C from 1 → 20 days)</p></div>
          <div><p className="text-2xl font-black">&gt; 0.99</p><p className="text-gray-500">correlation with GLORYS at every depth; temperature RMSE 0.025–0.125 °C, peaking near 250 m</p></div>
        </div>
      </div>
    </div>
  )
}
