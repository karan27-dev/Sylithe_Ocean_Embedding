// Sylithe agent: answers questions about the Sylithe Ocean Model, its outputs and the cyclone logic, grounded in
// facts sent with every request. Runs on the server only (Vite dev middleware locally, a Vercel function when
// deployed), so the DeepSeek key never reaches the browser.

import { createHash } from 'node:crypto'

const API = 'https://api.deepseek.com/chat/completions'

// ---------------------------------------------------------------- budget guards (per server instance)
const LIMIT_PER_IP_HOUR = 20                // DeepSeek calls one IP address may cause per hour
const LIMIT_PER_IP_DAY = 60                 // … and per day
const LIMIT_PER_DAY = 400                   // DeepSeek calls per day for the whole site (per instance)
const CACHE_MS = 6 * 3600e3                 // identical requests reuse the answer for 6 h (one live run)
const hits = new Map()                      // ip → [timestamps]
const cache = new Map()                     // hash → { at, body }
let day = { key: '', n: 0 }
const hash = (o) => createHash('sha1').update(JSON.stringify(o)).digest('hex')

function allow(ip) {
  const now = Date.now(), today = new Date().toISOString().slice(0, 10)
  if (day.key !== today) day = { key: today, n: 0 }
  if (day.n >= LIMIT_PER_DAY) return 'day'
  const h = (hits.get(ip) ?? []).filter((t) => now - t < 86400e3)
  if (h.filter((t) => now - t < 3600e3).length >= LIMIT_PER_IP_HOUR) { hits.set(ip, h); return 'ip' }
  if (h.length >= LIMIT_PER_IP_DAY) { hits.set(ip, h); return 'ip_day' }
  h.push(now); hits.set(ip, h); day.n++
  if (hits.size > 5000) hits.clear()
  return null
}
function cached(k) {
  const c = cache.get(k)
  if (c && Date.now() - c.at < CACHE_MS) return c.body
  if (c) cache.delete(k)
  return null
}
function remember(k, body) {
  if (cache.size > 2000) cache.delete(cache.keys().next().value)
  cache.set(k, { at: Date.now(), body })
}
const MODEL = 'deepseek-chat'

const FACTS = `
SYLITHE OCEAN MODEL (SIH 2026, problem statement 26066, MoES / INCOIS)
- Task: daily 3-D ocean temperature (latitude × longitude × depth) over the North Indian Ocean, 5–30°N, 45–105°E, 0.25° grid
  (101 × 241 cells), 15 depths: 0, 5, 10, 20, 30, 50, 75, 100, 125, 150, 200, 300, 500, 700, 1000 m, from surface satellite data only.
- Inputs (15-day window, each as value + day-of-year anomaly): SST (OSTIA), SSS (SMOS/SMAP multi-obs), sea level anomaly (DUACS),
  surface currents U/V (OSCAR in training, DUACS geostrophic live), 10 m winds U/V (CCMP in training, ASCAT-blended live).
- Target: GLORYS12 reanalysis. Train 2005–2021, validation 2022, test 2023 (never seen). Independent check: Argo floats.
- Architecture: 3-D convolutional stem + temporal attention over the 15 days, CBAM attention encoder giving a 64-d embedding
  at 1/8 resolution, U-Net++ nested decoder with deep supervision; outputs a mean and a log-variance per cell and depth.
  Self-supervised masked-autoencoder pretraining, β-NLL loss (β = 0.5), vertical-gradient and surface-consistency losses,
  AdamW lr 2e-4, weight decay 0.05, random 64×128 crops, EMA 0.999, variable dropout 0.3, early stopping.
  3-seed ensemble (42, 7, 1234), about 2.4 M parameters per member. σ² = mean member variance + spread of member means.
- 2023 results: RMSE 0.662 °C vs GLORYS12 (41 % below climatology); 0.757 °C vs 9,469 Argo measurements (single model 0.754).
  Published Attention 3D U-Net++ (Wang et al., ESSD 2026) retrained on the same data: 0.668 / 0.762. Ridge 0.740 / 0.804.
  HYCOM 1.193 / 0.806. Climatology 1.119 / 0.952. GLORYS12 itself vs Argo 0.684 (it assimilates Argo).
  Lead over the published method is significant below 200 m and in the Bay of Bengal; small over the whole column.
  Uncertainty: 57 % of Argo errors inside ±1σ (68 % ideal), so σ is about 20 % too small. Largest errors 75–150 m (thermocline).
- Live system: GitHub Actions every 6 h ingests near-real-time satellite data, predicts every day whose SST and sea level are in,
  re-predicts recent days (revision +1) when late salinity (~6 days) or winds (~1 day) arrive, checks against Argo
  (first month about 1.05 °C RMSE, worse than 2023 because of near-real-time substitute inputs).
- Derived: TCHP = ρ·cp·∫(T − 26) dz above the 26 °C isotherm (kJ cm⁻², ≥ 50 supports rapid intensification); D26, D20
  (thermocline) = depth of the 26 / 20 °C isotherm; MLD = first depth 0.5 °C colder than at 10 m; T100 = mean of the upper 100 m.
- Cyclone logic: Ocean Cyclone Potential Index (OCPI, 0–1) = weighted mean of 0–1 scores: T100 25→29.5 °C (0.25),
  TCHP 0→120 (0.25), SST 26→30.5 °C (0.15), D26 30→120 m (0.10), MLD 10→60 m (0.10), SLA −0.1→0.2 m (0.10),
  SSS 35→31 psu (0.05); 0 where SST < 26 °C. Low < 0.3 ≤ Moderate < 0.5 ≤ High < 0.7 ≤ Very high.
  Disturbance watch: surface-wind relative vorticity > 2e-5 s⁻¹, wind ≥ 10 m/s, OCPI ≥ 0.5.
  It measures ocean support for cyclones, NOT genesis, track or landfall (no shear or humidity in the data).
- Website pages: Daily forecast (live map, AOI tools, profiles, graphs), Explorer, Cyclone watch, Validation, Research,
  Embedding, Model, Docs. Code: github.com/karan27-dev/Sylithe_Ocean_Embedding.
`

const SYSTEM = `You are the Sylithe agent, the assistant of the Sylithe Ocean Model website.
Visitors may ask anything. Questions about the Sylithe Ocean Model, its predictions, validation, the live system, the website
or the cyclone logic are answered from the FACTS and LIVE CONTEXT below; other questions (oceanography, cyclones, climate,
machine learning, how to use the site, or anything general) are answered from your general knowledge.
Rules:
- For anything about this model or today's ocean, quote numbers exactly as given in FACTS / LIVE CONTEXT; never invent or
  extrapolate them. If such a number is not there, say so and point to the page that would show it.
- For general questions, answer normally and say when something is general knowledge rather than a Sylithe result.
- Never forecast cyclone genesis, track, intensity or landfall; describe ocean conditions only, and refer to IMD / INCOIS for official advisories.
- Be specific and short: 2–6 sentences or a compact list. Use units. No marketing language.
FACTS:${FACTS}`

const BULLETIN = `You write the daily ocean-heat bulletin of the Sylithe Ocean Model for cyclone forecasters.
Use ONLY the numbers in the JSON below; never invent, round differently or add numbers.
Do not forecast cyclone genesis, track, intensity or landfall: the data describe the ocean only;
vertical wind shear, humidity and other atmospheric conditions are not assessed.
Write 120–180 words: a one-line headline, then Bay of Bengal, Arabian Sea, hotspots
(with coordinates and their strongest drivers), any disturbance-over-warm-ocean watch points,
the 7-day change, and the caveats listed in the JSON.
End with "Watch next:" and two short, specific suggestions for forecasters, each tied to a hotspot,
watch point or trend in the JSON (e.g. which coordinates to monitor and why).
Plain text with short **bold** section labels; no tables.`

async function deepseek(messages, key, max_tokens = 700) {
  const r = await fetch(API, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.2, max_tokens }),
  })
  if (!r.ok) return { status: 502, body: { error: r.status === 402 ? 'no_balance' : 'upstream', message: `DeepSeek returned ${r.status}` } }
  const j = await r.json()
  return { status: 200, body: { answer: j.choices?.[0]?.message?.content?.trim() ?? '', model: MODEL } }
}

export async function answer({ question, context, history = [], task, payload }, key, ip = 'local') {
  if (!key) return { status: 503, body: { error: 'no_key', message: 'DEEPSEEK_API_KEY is not set on the server.' } }
  if (task === 'bulletin') {
    if (!payload || typeof payload !== 'object') return { status: 400, body: { error: 'bad_payload' } }
    const k = 'b' + hash(payload)                                  // one bulletin per day's numbers, shared by every visitor
    const hit = cached(k)
    if (hit) return { status: 200, body: { ...hit, cached: true } }
    const why = allow(ip)
    if (why) return { status: 429, body: { error: 'rate_limited', scope: why } }
    const r = await deepseek([{ role: 'system', content: BULLETIN }, { role: 'user', content: JSON.stringify(payload).slice(0, 12000) }], key, 900)
    if (r.status === 200) remember(k, r.body)
    return r
  }
  if (!question || typeof question !== 'string' || question.length > 600) return { status: 400, body: { error: 'bad_question' } }
  const qk = 'q' + hash([question.trim().toLowerCase().replace(/\s+/g, ' '), history.length ? history.slice(-2) : null, context?.cyclone_today?.date ?? null])
  const hit = cached(qk)
  if (hit) return { status: 200, body: { ...hit, cached: true } }
  const why = allow(ip)
  if (why) return { status: 429, body: { error: 'rate_limited', scope: why } }
  const ctx = JSON.stringify(context ?? {}).slice(0, 10000)
  const messages = [
    { role: 'system', content: `${SYSTEM}\nLIVE CONTEXT (JSON, from the website at the time of the question):\n${ctx}` },
    ...history.slice(-6).filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map((m) => ({ role: m.role, content: m.content.slice(0, 1500) })),
    { role: 'user', content: question },
  ]
  const r = await deepseek(messages, key, 450)
  if (r.status === 200) remember(qk, r.body)
  return r
}

/** Node request handler shared by the Vite middleware and the Vercel function. */
export async function handle(req, res, key) {
  const send = (status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)) }
  if (req.method !== 'POST') return send(405, { error: 'method' })
  try {
    let raw = ''
    if (req.body && typeof req.body === 'object') raw = JSON.stringify(req.body)
    else for await (const c of req) raw += c
    const ip = String(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? 'local').split(',')[0].trim()
    const { status, body } = await answer(JSON.parse(raw || '{}'), key, ip)
    send(status, body)
  } catch (e) {
    send(500, { error: 'server', message: String(e).slice(0, 200) })
  }
}
