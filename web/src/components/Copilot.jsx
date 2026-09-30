import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useData } from '../App'
import { loadDay } from '../lib/data'
import { useView } from '../lib/store'
import { DEPTHS, LAYERS, cellAt, column, fmt, fmtDate, fmtLat, fmtLon, isothermDepth, mld, tchp } from '../lib/ocean'

// A deterministic command line for the console: phrases become the same actions the controls perform, and
// answers are computed from the loaded fields. No language model, no network: every number is auditable.
// ARCHITECTURE.md §7 describes the phase-2 analyst that would expose these same actions as tools.

const PAGES = { explorer: '/explorer', map: '/explorer', embedding: '/embedding', latent: '/embedding', validation: '/validation',
  argo: '/validation', skill: '/validation', cyclone: '/cyclone', bulletin: '/cyclone', pipeline: '/pipeline', model: '/model',
  architecture: '/model', data: '/data', download: '/data', overview: '/', home: '/' }
const LAYER_WORDS = {
  temp: ['temperature'], sigma: ['uncertainty', 'sigma', 'σ'], ref: ['glorys'], diff: ['difference', 'error map', 'minus glorys'],
  d20: ['d20', 'thermocline'], d26: ['d26'], tchp: ['tchp', 'heat potential', 'cyclone heat'], mld: ['mld', 'mixed layer'],
  dsst: ['consistency', 'minus sst'], sst: ['sst', 'surface temperature'], sss: ['salinity', 'sss'], sla: ['sla', 'sea level'],
  cur: ['current'], wind: ['wind'],
}
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const SUGGEST = ['cyclone heat in the Bay of Bengal', 'temperature at 150 m', 'probe 88E 15N', 'D20 in January', 'open validation']

export function parse(text, days) {
  const t = text.toLowerCase(), acts = []
  const d = t.match(/(\d{1,4})\s*m\b(?!ay)|depth\s*(\d{1,4})/)
  if (d) {
    const want = +(d[1] ?? d[2])
    acts.push({ type: 'depth', idx: DEPTHS.reduce((b, x, i) => (Math.abs(x - want) < Math.abs(DEPTHS[b] - want) ? i : b), 0) })
  }
  for (const l of LAYERS) if (LAYER_WORDS[l.id].some((w) => t.includes(w))) { acts.push({ type: 'layer', id: l.id }); break }
  if (d && !acts.some((a) => a.type === 'layer')) acts.push({ type: 'layer', id: 'temp' })
  if (/bay of bengal|\bbob\b/.test(t)) acts.push({ type: 'region', id: 'BoB' })
  else if (/arabian/.test(t)) acts.push({ type: 'region', id: 'AS' })
  else if (/whole|north indian|\bnio\b|all basins/.test(t)) acts.push({ type: 'region', id: 'NIO' })
  // dates: ISO, "15 may", "may 15", or a month name alone (closest exported day in that month)
  const iso = t.match(/\d{4}-\d{2}-\d{2}/)?.[0]
  const mi = MONTHS.findIndex((mo) => new RegExp(`\\b${mo}`).test(t))
  const dayNum = mi >= 0 ? +(t.match(new RegExp(`(\\d{1,2})\\s*${MONTHS[mi]}|${MONTHS[mi]}\\w*\\s*(\\d{1,2})\\b`)) ?? []).slice(1).find(Boolean) || 0 : 0
  const date = iso ? days.find((x) => x === iso) : mi >= 0
    ? days.filter((x) => +x.slice(5, 7) === mi + 1).sort((a, b) => Math.abs(+a.slice(8) - dayNum) - Math.abs(+b.slice(8) - dayNum))[0] : null
  if (date) acts.push({ type: 'date', id: date })
  const p = t.match(/(\d+(?:\.\d+)?)\s*°?\s*e\b[^\d]*(\d+(?:\.\d+)?)\s*°?\s*n\b/) || t.match(/(\d+(?:\.\d+)?)\s*°?\s*n\b[^\d]*(\d+(?:\.\d+)?)\s*°?\s*e\b/)
  if (p) {
    const eFirst = /^\s*\d+(?:\.\d+)?\s*°?\s*e/.test(t.slice(p.index))
    const [lon, lat] = eFirst ? [+p[1], +p[2]] : [+p[2], +p[1]]
    acts.push({ type: 'probe', lat, lon })
  }
  const page = Object.keys(PAGES).find((k) => new RegExp(`\\b(open|go to|show)\\b.*\\b${k}\\b`).test(t) || t.trim() === k)
  if (page) acts.push({ type: 'page', to: PAGES[page] })
  return acts
}

const describe = (a) => ({
  layer: () => `layer ${LAYERS.find((l) => l.id === a.id).label}`, depth: () => `depth ${DEPTHS[a.idx]} m`,
  region: () => `region ${a.id}`, date: () => fmtDate(a.id), probe: () => `probe ${fmtLat(a.lat)} ${fmtLon(a.lon)}`, page: () => `open ${a.to}`,
}[a.type]())

export default function Copilot() {
  const { m } = useData()
  const view = useView()
  const nav = useNavigate()
  const [log, setLog] = useState([])
  const [q, setQ] = useState('')
  const inp = useRef(null), end = useRef(null)
  const open = view.copilot

  useEffect(() => { if (open) setTimeout(() => inp.current?.focus(), 50) }, [open])
  // braces matter: scrollIntoView returns a Promise in current browsers, and an effect must not return one
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [log])
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && view.set({ copilot: false })
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [view])

  const run = async (text) => {
    if (!text.trim() || !m) return
    const acts = parse(text, m.days.map((d) => d.date))
    const patch = {}
    let reply = acts.length ? `Done: ${acts.map(describe).join(', ')}.` : 'I did not recognise a command. I understand layers, depths, days, regions, coordinates and page names.'
    for (const a of acts) {
      if (a.type === 'layer') patch.layer = a.id
      if (a.type === 'depth') patch.depth = a.idx
      if (a.type === 'region') patch.region = a.id
      if (a.type === 'date') patch.date = a.id
      if (a.type === 'probe') patch.probe = { lat: a.lat, lon: a.lon }
    }
    const probe = acts.find((a) => a.type === 'probe')
    if (probe) {
      const day = await loadDay(m, patch.date ?? view.date), c = cellAt(m.grid, probe.lat, probe.lon)
      if (!c || !Number.isFinite(day.temp[c.i])) reply = `${fmtLat(probe.lat)} ${fmtLon(probe.lon)} is land or outside the domain (5–30°N, 45–105°E).`
      else {
        const col = column(m, day.temp, c.i)
        reply = `${fmtLat(c.lat)} ${fmtLon(c.lon)}, ${fmtDate(day.date)}: ${day.sst ? `SST ${fmt(day.sst[c.i], 1)} °C, ` : ''}mixed layer ${fmt(mld(col), 0)} m, `
          + `D26 ${fmt(isothermDepth(col, 26), 0)} m, D20 ${fmt(isothermDepth(col, 20), 0)} m, TCHP ${fmt(tchp(col), 0)} kJ cm⁻², `
          + `${fmt(col[DEPTHS.indexOf(100)], 2)} °C at 100 m.`
      }
    }
    view.set(patch)
    const page = acts.find((a) => a.type === 'page')
    if (page) nav(page.to)
    else if (acts.length) nav('/explorer' + window.location.search)
    setLog((l) => [...l, { who: 'you', text }, { who: 'console', text: reply }])
    setQ('')
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[1200] flex justify-end bg-ink/10 fade-in" onClick={() => view.set({ copilot: false })}>
      <aside onClick={(e) => e.stopPropagation()} aria-label="Ask the console"
        className="rise-in flex h-full w-full max-w-[420px] flex-col border-l border-line bg-paper">
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <p className="display text-[19px] leading-none">Ask the console</p>
            <p className="mt-1.5 text-[11.5px] text-mute">Deterministic commands. Answers are computed from the loaded fields.</p>
          </div>
          <button onClick={() => view.set({ copilot: false })} className="text-[13px] text-mute hover:text-ink">Close</button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {!log.length && (
            <div>
              <p className="label mb-3">Try</p>
              <ul className="border-t border-line">
                {SUGGEST.map((s) => (
                  <li key={s}><button onClick={() => run(s)} className="w-full border-b border-line py-2.5 text-left text-[13.5px] text-ink2 transition-colors hover:text-sea">{s}</button></li>
                ))}
              </ul>
            </div>
          )}
          <div className="space-y-4">
            {log.map((e, i) => (
              <div key={i} className="rise-in">
                <p className="label mb-1">{e.who}</p>
                <p className={`text-[13.5px] leading-relaxed ${e.who === 'you' ? 'text-ink' : 'num text-[12.5px] text-ink2'}`}>{e.text}</p>
              </div>
            ))}
            <div ref={end} />
          </div>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); run(q) }} className="border-t border-line p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center gap-2 rounded-[8px] border border-line bg-paper px-3 focus-within:border-line2">
            <input ref={inp} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. TCHP in the Arabian Sea on 15 May"
              className="h-10 flex-1 bg-transparent text-[13.5px] text-ink placeholder:text-faint focus:outline-none" />
            <button className="text-[12.5px] text-sea disabled:text-faint" disabled={!q.trim()}>Run</button>
          </div>
        </form>
      </aside>
    </div>
  )
}
