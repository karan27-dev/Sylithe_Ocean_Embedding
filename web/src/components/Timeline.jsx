import { useEffect, useState } from 'react'
import { fmtDate } from '../lib/ocean'

const t = (iso) => Date.parse(iso)

/** Day scrubber over the exported days, positioned by real date, with play/step. Hidden for a single day. */
export default function Timeline({ days, value, onChange, className = '' }) {
  const [playing, setPlaying] = useState(false)
  const i = days.findIndex((d) => d.date === value)
  const step = (d) => onChange(days[(i + d + days.length) % days.length].date)

  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => step(1), 900)
    return () => clearInterval(id)
  }) // re-armed each render so it always steps from the current day

  if (days.length < 2) return value ? <p className="num text-[12px] text-ink">{fmtDate(value)}</p> : null
  const t0 = t(days[0].date), span = t(days[days.length - 1].date) - t0 || 1
  const x = (d) => `${((t(d) - t0) / span) * 100}%`
  const few = days.length <= 8

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="flex items-center">
        <button onClick={() => step(-1)} className="p-1.5 text-mute hover:text-ink" aria-label="Previous day">
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M8 2L4 6l4 4" stroke="currentColor" fill="none" strokeWidth="1.3" /></svg>
        </button>
        <button onClick={() => setPlaying((p) => !p)} className="p-1.5 text-ink" aria-label={playing ? 'Pause' : 'Play'}>
          <svg width="12" height="12" viewBox="0 0 12 12">{playing
            ? <path d="M3.5 2v8M8.5 2v8" stroke="currentColor" strokeWidth="1.6" />
            : <path d="M3 1.8v8.4L10 6z" fill="currentColor" />}</svg>
        </button>
        <button onClick={() => step(1)} className="p-1.5 text-mute hover:text-ink" aria-label="Next day">
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M4 2l4 4-4 4" stroke="currentColor" fill="none" strokeWidth="1.3" /></svg>
        </button>
      </div>
      <div className="relative h-8 min-w-[160px] flex-1">
        <div className="absolute inset-x-0 top-[9px] h-px bg-line2" />
        {days.map((d) => (
          <button key={d.date} onClick={() => onChange(d.date)} title={fmtDate(d.date)}
            className="group absolute top-0 h-5 w-3 -translate-x-1/2" style={{ left: x(d.date) }}>
            <span className={`absolute left-1/2 top-[5px] w-px -translate-x-1/2 transition-all ${d.date === value ? 'h-[9px] bg-ink' : 'h-[5px] bg-mute group-hover:h-[9px]'}`} />
          </button>
        ))}
        <span className="absolute top-[4px] h-[11px] w-[11px] -translate-x-1/2 rounded-full border-[1.5px] border-ink bg-paper transition-[left] duration-300 ease-out pointer-events-none"
          style={{ left: x(value) }} />
        {few ? days.map((d) => (
          <span key={d.date} className={`num absolute top-[19px] whitespace-nowrap text-[10px] ${d.date === value ? 'text-ink' : 'text-faint'}`}
            style={{ left: x(d.date), transform: d === days[0] ? 'none' : d === days[days.length - 1] ? 'translateX(-100%)' : 'translateX(-50%)' }}>
            {fmtDate(d.date)}
          </span>
        )) : (
          <>
            <span className="num absolute left-0 top-[19px] text-[10px] text-faint">{fmtDate(days[0].date)}</span>
            <span className="num absolute right-0 top-[19px] text-[10px] text-faint">{fmtDate(days[days.length - 1].date)}</span>
          </>
        )}
      </div>
    </div>
  )
}
