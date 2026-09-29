import { useEffect, useRef, useState } from 'react'

/** Measure an element's width so SVG charts draw at true pixel size (crisp hairlines, unscaled text). */
export function useWidth(initial = 360) {
  const ref = useRef(null)
  const [w, setW] = useState(initial)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

export const linear = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0)
/** Square-root depth axis: the upper ocean (mixed layer, thermocline) gets the room it deserves. */
export const sqrtDepth = (zmax, r0, r1) => (z) => r0 + Math.sqrt(Math.max(0, z) / zmax) * (r1 - r0)

export function ticks(lo, hi, target = 5) {
  const span = hi - lo, raw = span / target, mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((k) => k * mag).find((s) => span / s <= target) ?? 10 * mag
  const out = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6))
  return out
}

/** SVG path through [x, y] points, breaking at gaps (NaN). */
export function linePath(pts) {
  let d = '', pen = false
  for (const [x, y] of pts) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) { pen = false; continue }
    d += `${pen ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
    pen = true
  }
  return d
}
