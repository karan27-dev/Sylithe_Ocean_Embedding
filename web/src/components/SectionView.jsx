import { useEffect, useRef, useState } from 'react'
import { DEPTHS, colorAt, fmt, isothermDepth } from '../lib/ocean'

// Zonal section (longitude × depth) through the probed latitude, sqrt depth axis, with the
// 20 °C and 26 °C isotherms traced on top: this is where thermocline tilt and eddies show up.
const ZMAX = 500
const sy = (z, h) => (Math.sqrt(z) / Math.sqrt(ZMAX)) * h

export default function SectionView({ field, row, range }) {
  const ref = useRef(null)
  const [hover, setHover] = useState(null)
  const W = 900, H = 220
  const lvls = DEPTHS.filter((d) => d <= ZMAX)

  useEffect(() => {
    const cv = ref.current, ctx = cv.getContext('2d')
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#d6d9dc'; ctx.fillRect(0, 0, W, H)          // sea floor / land
    const cw = W / field.width, [lo, hi] = range
    for (let x = 0; x < field.width; x++) {
      for (let k = 0; k < lvls.length; k++) {
        const v = field.temp[k][row][x]
        if (v == null) continue
        const top = k === 0 ? 0 : (DEPTHS[k - 1] + DEPTHS[k]) / 2
        const bot = k === lvls.length - 1 ? ZMAX : (DEPTHS[k] + DEPTHS[k + 1]) / 2
        ctx.fillStyle = colorAt('thermal', (v - lo) / (hi - lo))
        ctx.fillRect(x * cw, sy(top, H), cw + 0.6, sy(bot, H) - sy(top, H) + 0.6)
      }
    }
    for (const [iso, dash] of [[26, [5, 3]], [20, []]]) {
      ctx.strokeStyle = '#0F172A'; ctx.lineWidth = 1.5; ctx.setLineDash(dash); ctx.beginPath()
      let pen = false
      for (let x = 0; x < field.width; x++) {
        const z = isothermDepth(field.temp.map((l) => l[row][x]), iso)
        if (z == null || z > ZMAX) { pen = false; continue }
        const px = (x + 0.5) * cw, py = sy(z, H)
        pen ? ctx.lineTo(px, py) : ctx.moveTo(px, py); pen = true
      }
      ctx.stroke()
    }
    ctx.setLineDash([])
  }, [field, row, range, lvls.length])

  const lat = field.lat0 - row * field.step
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = Math.floor(((e.clientX - r.left) / r.width) * field.width)
    const z = ((e.clientY - r.top) / r.height) ** 2 * ZMAX
    const k = lvls.reduce((b, d, i) => (Math.abs(d - z) < Math.abs(lvls[b] - z) ? i : b), 0)
    setHover({ lon: field.lon0 + x * field.step, depth: lvls[k], v: field.temp[k][row]?.[x] })
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-[13px] text-gray-500">Zonal section at <span className="font-mono text-ink">{lat.toFixed(2)}°N</span>, 0–{ZMAX} m</p>
        <p className="font-mono text-[12px] text-ink h-4">
          {hover ? <>{fmt(hover.v, 2)} °C <span className="text-gray-400">{hover.lon.toFixed(2)}°E · {hover.depth} m</span></> : ''}
        </p>
      </div>
      <div className="flex">
        <div className="relative w-10 shrink-0 font-mono text-[10px] text-gray-400" style={{ height: H }}>
          {[0, 20, 50, 100, 200, 300, 500].map((z) => (
            <span key={z} className="absolute right-2 -translate-y-1/2" style={{ top: sy(z, H) }}>{z}</span>
          ))}
        </div>
        <canvas ref={ref} width={W} height={H} className="w-full rounded-lg cursor-crosshair" style={{ height: H }}
          onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      </div>
      <div className="flex justify-between pl-10 mt-1 font-mono text-[10px] text-gray-400">
        {[45, 55, 65, 75, 85, 95, 105].map((l) => <span key={l}>{l}°E</span>)}
      </div>
      <p className="text-[11px] text-gray-400 mt-2 pl-10">Solid line: 20 °C isotherm (thermocline) · dashed: 26 °C isotherm (cyclone-usable heat) · grey: land or sea floor</p>
    </div>
  )
}
