// View state shared by every page and mirrored in the query string, so any view is a shareable link:
//   /explorer?date=2024-05-15&layer=tchp&depth=100&probe=88,15&region=BoB
import { create } from 'zustand'
import { DEPTHS } from './ocean'

const q = new URLSearchParams(window.location.search)
const probe = (() => {
  const [lon, lat] = (q.get('probe') || '').split(',').map(Number)
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null
})()
const depth = q.has('depth') ? DEPTHS.indexOf(+q.get('depth')) : -1       // +null is 0, a valid depth

export const useView = create((set) => ({
  date: q.get('date') || null,
  layer: q.get('layer') || 'temp',
  depth: depth >= 0 ? depth : DEPTHS.indexOf(100),
  probe,
  region: q.get('region') || 'NIO',
  compare: q.get('compare') === '1',
  copilot: q.get('copilot') === '1',
  set: (patch) => set(patch),
}))

useView.subscribe((s) => {
  const p = new URLSearchParams()
  if (s.date) p.set('date', s.date)
  if (s.layer !== 'temp') p.set('layer', s.layer)
  p.set('depth', DEPTHS[s.depth])
  if (s.probe) p.set('probe', `${s.probe.lon.toFixed(2)},${s.probe.lat.toFixed(2)}`)
  if (s.region !== 'NIO') p.set('region', s.region)
  if (s.compare) p.set('compare', '1')
  const url = `${window.location.pathname}?${p}`
  if (url !== window.location.pathname + window.location.search) window.history.replaceState(window.history.state, '', url)
})
