import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useData } from '../App'
import { loadDay, loadJSON, loadManifest } from '../lib/data'
import { features, peaks, regionSummary } from '../lib/cyclone'
import { useView } from '../lib/store'
import { DEPTHS, LAYERS, cellAt, column, fmt, fmtDate, fmtLat, fmtLon, isothermDepth, mld, tchp } from '../lib/ocean'

// Sylithe agent. Map commands ("temperature at 150 m", "probe 88E 15N") act on the console directly, computed from the
// loaded fields. Questions go to /api/agent (DeepSeek on the server), grounded in the model facts and the live context
// sent with them: status, Argo check, leaderboard and today's cyclone numbers.
const LIVE = import.meta.env.VITE_LIVE_BASE || 'https://raw.githubusercontent.com/karan27-dev/Sylithe_Ocean_Embedding/live-data/web'
const QUESTION = /\?|^(what|why|how|which|where|when|who|is|are|does|do|can|could|should|explain|compare|tell|summar|describe|give)\b/i

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
const SUGGEST = ['Where is cyclone potential highest today?', 'How accurate is the model against Argo?', 'Why is the error largest at 100 m?',
  'How does the Sylithe Ocean Model beat the published U-Net++?', 'temperature at 150 m', 'probe 88E 15N']

async function liveContext(view, path) {
  const [status, skill, bulletin, board] = await Promise.all([loadJSON('status.json', LIVE), loadJSON('skill.json', LIVE),
    loadJSON('bulletin.json', LIVE), loadJSON('leaderboard.json')])
  return {
    page: path, view: { date: view.date, layer: view.layer, depth_m: DEPTHS[view.depth], region: view.region },
    live_status: status && { updated_at: status.updated_at, last_predicted: status.last_predicted, predicted_days: status.predicted_days,
      sources: Object.values(status.sources ?? {}).map((x) => ({ source: x.label, newest: x.latest_available, delay_days: x.lag_days })) },
    live_argo_check: skill && { rmse_c: skill.rmse, bias_c: skill.bias, profiles: skill.profiles, from: skill.from, to: skill.to },
    cyclone_today: bulletin?.payload ?? null,
    leaderboard_2023: board?.rows?.map((r) => ({ method: r.Method, rmse_vs_argo: r['RMSE vs Argo (°C)'], rmse_vs_glorys: r['RMSE vs GLORYS (°C)'],
      argo_0_200: r['Argo 0–200 m'], argo_200_1000: r['Argo 200–1000 m'], bay_of_bengal: r['Argo Bay of Bengal'], arabian_sea: r['Argo Arabian Sea'] })),
  }
}

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

/** Today's cyclone numbers straight from the newest live prediction (used when bulletin.json is not published yet). */
async function liveCyclone() {
  const m = await loadManifest(LIVE), date = m.days.at(-1).date, day = await loadDay(m, date)
  const f = features(m, day)
  return { date, hs: peaks(m, f.ocpi, { k: 5, sep: 4, min: 0.5 }), sum: regionSummary(m, day) }
}

const pct = (v) => `${Math.round((v ?? 0) * 100)} %`
const f2 = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—')

/** Deterministic answers to the common questions, from the same live context the language model would get. */
async function localAnswer(q, ctx) {
  const t = q.toLowerCase()
  const board = ctx.leaderboard_2023 ?? []
  const row = (re) => board.find((r) => re.test(r.method))
  if (/cyclone|ocpi|hotspot|potential|storm|tchp|heat/.test(t)) {
    const c = await liveCyclone()
    const hs = c.hs.map((h, i) => `${i + 1}. ${fmtLat(h.lat)} ${fmtLon(h.lon)} — OCPI ${f2(h.v)}`).join('\n')
    return `Newest prediction (${fmtDate(c.date)}):\n${hs || 'No cell reaches High (OCPI ≥ 0.5).'}\n\nShare of ocean at High or above: Bay of Bengal ${pct(c.sum.BoB.share_high)}, Arabian Sea ${pct(c.sum.AS.share_high)} `
      + `(mean OCPI ${f2(c.sum.BoB.mean)} and ${f2(c.sum.AS.mean)}). Mean cyclone heat potential: Bay of Bengal ${f2(c.sum.BoB.tchp_mean, 0)}, Arabian Sea ${f2(c.sum.AS.tchp_mean, 0)} kJ cm⁻².\n`
      + 'This is ocean support only, not a cyclone forecast — see Cyclone watch, and IMD for official warnings.'
  }
  if (/beat|compar|u-?net|published|better|benchmark|leaderboard|rank|hycom|ridge/.test(t)) {
    const e = row(/ensemble/), u = row(/U-Net/), r = row(/Ridge/), h = row(/HYCOM/), c = row(/Climatology/)
    return `2023 test year, RMSE against 9,469 Argo measurements: Sylithe ensemble ${f2(e?.rmse_vs_argo, 3)} °C, published Attention 3D U-Net++ ${f2(u?.rmse_vs_argo, 3)}, `
      + `ridge ${f2(r?.rmse_vs_argo, 3)}, HYCOM ${f2(h?.rmse_vs_argo, 3)}, climatology ${f2(c?.rmse_vs_argo, 3)} °C. Against GLORYS12: ${f2(e?.rmse_vs_glorys, 3)} vs ${f2(u?.rmse_vs_glorys, 3)} °C for the U-Net++.\n`
      + 'The gain over the published model is statistically significant below 200 m (p = 0.003) and in the Bay of Bengal (p = 0.007); over the whole column it is small (p = 0.12). Details: Validation and Research pages.'
  }
  if (/depth|100 ?m|thermocline|why.*(error|worse|largest)|where.*error/.test(t)) {
    return 'Errors peak in the thermocline, 75–150 m: RMSE against Argo is 0.35 °C at the surface, about 1.25 °C at 100–125 m and 0.22 °C at 1000 m. '
      + 'There temperature falls fastest with depth, so a few metres of vertical displacement (eddies, Kelvin and Rossby waves) becomes a large temperature error, and the surface signal is weakest. '
      + 'The model\'s own uncertainty σ is also largest there. Below 300 m it matches or beats GLORYS12.'
  }
  if (/accura|rmse|error|argo|skill|how good|reliable|trust/.test(t)) {
    const s = ctx.live_argo_check
    return 'On 2023 (never seen in training): 0.662 °C RMSE against GLORYS12 and 0.757 °C against 9,469 independent Argo measurements.'
      + (s?.rmse_c != null ? ` Live, last 30 days: ${f2(s.rmse_c, 3)} °C against ${s.profiles} Argo profiles (bias ${f2(s.bias_c, 3)} °C) — higher because near-real-time inputs replace the reprocessed ones used in training.` : '')
      + ' Uncertainty: 57 % of Argo errors fall inside ±1σ (68 % would be ideal).'
  }
  if (/live|latest|update|status|delay|input|satellite|when/.test(t)) {
    const s = ctx.live_status
    if (!s) return 'Live status is not available right now.'
    return `Last live run: ${s.updated_at?.replace('T', ' ').slice(0, 16)} UTC; newest prediction ${s.last_predicted} (${s.predicted_days} days predicted). Newest satellite data: `
      + s.sources.map((x) => `${x.source} ${x.newest} (${x.delay_days} d delay)`).join('; ') + '. Days are predicted again when late salinity or winds arrive.'
  }
  if (/model|architect|how does|work|train|network|embedding/.test(t)) {
    return 'The Sylithe Ocean Model reads 15 days of SST, SSS, sea level anomaly, currents and winds (each also as an anomaly), passes them through a 3-D stem with temporal attention and a CBAM encoder '
      + 'to a 64-d embedding (pretrained as a masked autoencoder), and a U-Net++ decoder predicts the anomaly from climatology plus an uncertainty at 15 depths, 0–1000 m. '
      + 'Three seeds are averaged. Trained on GLORYS12 2005–2021, validated 2022, tested 2023. More on the Model page.'
  }
  return null
}

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

  const ask = async (text) => {
    setLog((l) => [...l, { who: 'you', text }, { who: 'Sylithe agent', text: '…', pending: true }])
    setQ('')
    let reply
    try {
      const history = log.filter((e) => !e.pending).map((e) => ({ role: e.who === 'you' ? 'user' : 'assistant', content: e.text }))
      const r = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text, history, context: await liveContext(view, window.location.pathname) }) })
      const j = await r.json().catch(() => ({}))
      if (r.ok) reply = j.answer
    } catch { /* endpoint unreachable: answer locally */ }
    if (!reply) {
      const local = await localAnswer(text, await liveContext(view, window.location.pathname)).catch(() => null)
      reply = local ? `${local}\n\n· Answered from live data (DeepSeek not connected on this server).`
        : 'DeepSeek is not connected on this server, and this question needs it. Without it I can answer about cyclone potential and hotspots, accuracy, errors by depth, the benchmark, live status and the model. Map commands such as "temperature at 150 m" also work.'
    }
    setLog((l) => [...l.filter((e) => !e.pending), { who: 'Sylithe agent', text: reply }])
  }

  const run = async (text) => {
    if (!text.trim() || !m) return
    const acts = parse(text, m.days.map((d) => d.date))
    if (!acts.length || QUESTION.test(text.trim())) return ask(text)
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
    setLog((l) => [...l, { who: 'you', text }, { who: 'Sylithe agent', text: reply }])
    setQ('')
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[1200] flex justify-end bg-ink/10 fade-in" onClick={() => view.set({ copilot: false })}>
      <aside onClick={(e) => e.stopPropagation()} aria-label="Ask the Sylithe agent"
        className="rise-in flex h-full w-full max-w-[420px] flex-col border-l border-line bg-paper">
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <p className="display flex items-center gap-2 text-[19px] leading-none"><img src="/sylithe-logo.png" alt="" className="h-6 w-6" />Sylithe agent</p>
            <p className="mt-1.5 text-[11.5px] text-mute">Answers from the model's facts and today's live data. Ocean conditions only; official cyclone advisories come from IMD.</p>
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
                <p className={`whitespace-pre-line text-[13.5px] leading-relaxed ${e.who === 'you' ? 'text-ink' : 'text-ink2'} ${e.pending ? 'animate-pulse' : ''}`}>
                  {e.text.split(/(\*\*[^*]+\*\*)/).map((seg, j) => (seg.startsWith('**') && seg.endsWith('**') ? <b key={j} className="font-medium text-ink">{seg.slice(2, -2)}</b> : seg))}</p>
              </div>
            ))}
            <div ref={end} />
          </div>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); run(q) }} className="border-t border-line p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center gap-2 rounded-[8px] border border-line bg-paper px-3 focus-within:border-line2">
            <input ref={inp} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about the model, today’s ocean or cyclone potential"
              className="h-10 flex-1 bg-transparent text-[13.5px] text-ink placeholder:text-faint focus:outline-none" />
            <button className="text-[12.5px] text-sea disabled:text-faint" disabled={!q.trim()}>Ask</button>
          </div>
        </form>
      </aside>
    </div>
  )
}
