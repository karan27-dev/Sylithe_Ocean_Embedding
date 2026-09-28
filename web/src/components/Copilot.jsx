import { useState, useRef, useEffect } from 'react'
import { Sparkles, X, Send } from 'lucide-react'
import { DEPTHS, LAYERS, DATASETS } from '../lib/ocean'

// Phase 1: a deterministic command parser that drives the console (no LLM, no network).
// Phase 2 (ARCHITECTURE.md §7): the same actions become Claude tool definitions served by the
// FastAPI backend, so free-form questions resolve into these exact, auditable calls.
const HELP = 'Try: "tchp", "depth 150", "jan", "probe 88E 15N", "d26".'

export function parseCommand(text) {
  const t = text.toLowerCase()
  const acts = []
  const d = t.match(/(\d{1,4})\s*m\b|depth\s*(\d{1,4})/)
  if (d) {
    const want = +(d[1] ?? d[2])
    const k = DEPTHS.reduce((b, x, i) => (Math.abs(x - want) < Math.abs(DEPTHS[b] - want) ? i : b), 0)
    acts.push({ type: 'layer', id: 'temp' }, { type: 'depth', idx: k })
  }
  for (const l of LAYERS) {
    const keys = { temp: ['temperature'], sst: ['sst'], d26: ['d26', '26'], tchp: ['tchp', 'cyclone', 'heat potential'],
      d20: ['d20', 'thermocline'], mld: ['mld', 'mixed layer'], dsst: ['consistency', 'minus sst'] }[l.id]
    if (keys.some((k) => t.includes(k)) && !(l.id === 'temp' && d)) acts.push({ type: 'layer', id: l.id })
  }
  if (/\bjan|winter|monsoon/.test(t)) acts.push({ type: 'date', id: '2024-01-15' })
  if (/\bmay|pre-?monsoon|summer/.test(t)) acts.push({ type: 'date', id: '2024-05-15' })
  const p = t.match(/(\d+(?:\.\d+)?)\s*°?\s*e[^\d]+(\d+(?:\.\d+)?)\s*°?\s*n/) || t.match(/(\d+(?:\.\d+)?)\s*°?\s*n[^\d]+(\d+(?:\.\d+)?)\s*°?\s*e/)
  if (p) {
    const eFirst = /e[^\d]+\d/.test(p[0].replace(p[1], ''))
    const [lon, lat] = eFirst ? [+p[1], +p[2]] : [+p[2], +p[1]]
    acts.push({ type: 'probe', lat, lon })
  }
  return acts
}

function describe(a) {
  if (a.type === 'layer') return `layer → ${LAYERS.find((l) => l.id === a.id).label}`
  if (a.type === 'depth') return `depth → ${DEPTHS[a.idx]} m`
  if (a.type === 'date') return `date → ${DATASETS.find((d) => d.id === a.id).label}`
  if (a.type === 'probe') return `probe → ${a.lat}°N ${a.lon}°E`
  return a.type
}

export default function Copilot({ open, onClose, onActions }) {
  const [log, setLog] = useState([{ who: 'bot', text: `Console commands are live. ${HELP}` }])
  const [q, setQ] = useState('')
  const end = useRef(null)
  useEffect(() => end.current?.scrollIntoView({ behavior: 'smooth' }), [log])

  const submit = (e) => {
    e.preventDefault()
    if (!q.trim()) return
    const acts = parseCommand(q)
    const reply = acts.length ? `Done: ${acts.map(describe).join(', ')}.` : `I only understand console commands in this build. ${HELP}`
    if (acts.length) onActions(acts)
    setLog((l) => [...l, { who: 'you', text: q }, { who: 'bot', text: reply }])
    setQ('')
  }

  if (!open) return null
  return (
    <aside className="w-[340px] shrink-0 bg-white border-l border-gray-200 flex flex-col h-screen sticky top-0">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-leaf" />
          <p className="font-bold">Ocean Copilot</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-ink" aria-label="Close copilot"><X size={18} /></button>
      </div>
      <div className="mx-5 mt-4 rounded-xl bg-mist px-3 py-2 text-[11px] text-abyss">
        Offline command mode. The Claude-powered analyst (bulletins, Argo comparisons, free-form questions) connects in phase 2 via the backend.
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {log.map((m, i) => (
          <div key={i} className={`text-[13px] leading-snug ${m.who === 'you' ? 'text-right' : ''}`}>
            <span className={`inline-block rounded-2xl px-3 py-2 max-w-[90%] ${m.who === 'you' ? 'bg-ink text-white' : 'bg-gray-100 text-ink'}`}>{m.text}</span>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form onSubmit={submit} className="p-4 border-t border-gray-100 flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. cyclone heat in May"
          className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-[13px] focus:outline-none focus:border-leaf" />
        <button className="rounded-xl bg-leaf text-white px-3" aria-label="Send"><Send size={15} /></button>
      </form>
    </aside>
  )
}
