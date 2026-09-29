import { useData } from '../App'
import { column, fmt, fmtLat, fmtLon, isothermDepth, mld, tchp } from '../lib/ocean'

/** Point inspector. Desktop: a docked column that slides in. Phone: a bottom sheet over the map. */
export default function ProbePanel({ cell, day, onClose }) {
  const { m } = useData()
  const open = !!(cell && day && Number.isFinite(day.temp[cell.i]))
  const col = open ? column(m, day.temp, cell.i) : null
  const heat = col ? tchp(col) : NaN

  return (
    <aside aria-label="Point profile" aria-hidden={!open}
      className={`z-[800] flex flex-col bg-paper transition-[transform,width,opacity] duration-300 ease-out
        max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:max-h-[72dvh] max-lg:rounded-t-[14px] max-lg:border-t max-lg:border-line
        lg:relative lg:shrink-0 lg:border-l lg:border-line
        ${open ? 'max-lg:translate-y-0 lg:w-[400px] opacity-100' : 'max-lg:translate-y-full lg:w-0 opacity-0 pointer-events-none'}`}>
      {open && (
        <div className="flex min-h-0 flex-1 flex-col lg:w-[400px]">
          <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-line2 lg:hidden" />
          <header className="flex items-start justify-between px-5 pb-3 pt-4">
            <div>
              <p className="label">Point profile</p>
              <p className="num mt-1 text-[15px] text-ink">{fmtLat(cell.lat)}  {fmtLon(cell.lon)}</p>
            </div>
            <button onClick={onClose} className="-mr-1 p-1 text-[13px] text-mute hover:text-ink">Close</button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
            <dl className="grid grid-cols-5 border-y border-line">
              {[
                ['SST', day.sst?.[cell.i], 1, '°C'],
                ['MLD', mld(col), 0, 'm'],
                ['D26', isothermDepth(col, 26), 0, 'm'],
                ['D20', isothermDepth(col, 20), 0, 'm'],
                ['TCHP', heat, 0, 'kJ cm⁻²'],
              ].map(([k, val, d, u], i) => (
                <div key={k} className={`py-3 ${i ? 'border-l border-line pl-3' : ''}`}>
                  <dt className="label">{k}</dt>
                  <dd className={`num mt-1 text-[17px] leading-none ${k === 'TCHP' && heat >= 50 ? 'text-heat' : 'text-ink'}`}>{fmt(val, d)}</dd>
                  <dd className="mt-1 text-[10px] text-faint">{u}</dd>
                </div>
              ))}
            </dl>
            <div id="probe-body" />
          </div>
        </div>
      )}
    </aside>
  )
}
