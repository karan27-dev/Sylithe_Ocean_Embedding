import { useEffect, useRef } from 'react'

const LAND = [222, 218, 210]

/** Plain equirectangular panel of the domain (no basemap: the three panels must line up cell for cell). */
export default function Field({ m, paint, cell, onHover, dim, label, markRow }) {
  const cv = useRef(null)
  const g = m.grid
  useEffect(() => {
    const c = cv.current, ctx = c.getContext('2d'), img = ctx.createImageData(g.width, g.height)
    for (let i = 0; i < m.N; i++) {
      const p = paint(i) ?? LAND, a = dim && dim(i) ? 0.18 : 1
      img.data[i * 4] = p[0] * a + 245 * (1 - a); img.data[i * 4 + 1] = p[1] * a + 243 * (1 - a); img.data[i * 4 + 2] = p[2] * a + 238 * (1 - a); img.data[i * 4 + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
  }, [paint, dim, m, g])
  const move = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = Math.floor(((e.clientX - r.left) / r.width) * g.width), y = Math.floor(((e.clientY - r.top) / r.height) * g.height)
    if (onHover && x >= 0 && y >= 0 && x < g.width && y < g.height) onHover({ x, y, i: y * g.width + x, lat: g.lat0 - y * g.step, lon: g.lon0 + x * g.step })
  }
  return (
    <div className="relative" onMouseMove={move} onClick={move}>
      <canvas ref={cv} width={g.width} height={g.height} aria-label={label}
        className={`block w-full rounded-[3px] ${onHover ? 'cursor-crosshair' : ''}`} style={{ aspectRatio: `${g.width} / ${g.height}` }} />
      {markRow != null && (
        <span className="pointer-events-none absolute inset-x-0 border-t border-dashed border-ink/60" style={{ top: `${((markRow + 0.5) / g.height) * 100}%` }} />
      )}
      {cell && (
        <>
          <span className="pointer-events-none absolute inset-y-0 w-px bg-ink/40" style={{ left: `${((cell.x + 0.5) / g.width) * 100}%` }} />
          <span className="pointer-events-none absolute inset-x-0 h-px bg-ink/40" style={{ top: `${((cell.y + 0.5) / g.height) * 100}%` }} />
          <span className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-paper bg-ink"
            style={{ left: `${((cell.x + 0.5) / g.width) * 100}%`, top: `${((cell.y + 0.5) / g.height) * 100}%` }} />
        </>
      )}
    </div>
  )
}
