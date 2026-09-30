import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { NAV, useData } from '../App'
import { useView } from '../lib/store'
import { Footer, SourceStatus, Wordmark } from './ui'

// One thin bar on top. Desktop: text navigation. Mobile: a full-screen index, not a squeezed sidebar.
export default function Shell({ children }) {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const setView = useView((s) => s.set)
  const { error } = useData()
  const fullBleed = false

  useEffect(() => { setOpen(false) }, [pathname])
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && !/input|textarea/i.test(document.activeElement?.tagName)) { e.preventDefault(); setView({ copilot: true }) }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setView])

  return (
    <div className="min-h-[100dvh]">
      <header className="sticky top-0 z-[1000] h-[var(--bar)] border-b border-line bg-paper/95 backdrop-blur-sm">
        <div className="grid h-full grid-cols-[1fr_auto] items-center gap-6 px-4 sm:px-6 lg:grid-cols-[1fr_auto_1fr]">
          <Wordmark />
          <nav className="hidden h-full items-center justify-center gap-6 lg:flex" aria-label="Main">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) =>
                `relative flex h-full items-center text-[13px] transition-colors duration-150 ${isActive ? 'text-ink' : 'text-mute hover:text-ink'}`}>
                {({ isActive }) => <>{n.label}{isActive && <span className="absolute inset-x-0 -bottom-px h-px bg-ink" />}</>}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center justify-end gap-4">
            <button onClick={() => setView({ copilot: true })}
              className="hidden h-8 items-center gap-2 rounded-full bg-ink pl-2 pr-3.5 text-[12.5px] text-paper transition-colors hover:text-[#A3E635] sm:inline-flex">
              <img src="/sylithe-logo.png" alt="" className="h-5 w-5" />Ask Sylithe agent
              <kbd className="num rounded border border-white/25 px-1.5 text-[10px] text-white/60">/</kbd>
            </button>
            {/* A word, not a hamburger: the logo mark is already three lines. */}
            <button onClick={() => setOpen((o) => !o)} className="-mr-1 px-1 py-2 text-[13px] text-ink lg:hidden" aria-expanded={open}>
              {open ? 'Close' : 'Menu'}
            </button>
          </div>
        </div>
      </header>

      {open && (
        <div className="fixed inset-x-0 bottom-0 top-[var(--bar)] z-[999] flex flex-col bg-paper fade-in lg:hidden">
          <nav className="flex-1 overflow-y-auto px-5 pt-6" aria-label="Main">
            <NavLink to="/" end className="block border-b border-line py-4 font-display text-[28px] leading-none text-ink">Overview</NavLink>
            {NAV.map((n, i) => (
              <NavLink key={n.to} to={n.to} style={{ animationDelay: `${i * 25}ms` }}
                className={({ isActive }) => `rise-in flex items-baseline justify-between border-b border-line py-4 font-display text-[28px] leading-none ${isActive ? 'text-sea' : 'text-ink'}`}>
                {n.label}<span className="num text-[11px] text-faint">0{i + 1}</span>
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center justify-between border-t border-line px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <SourceStatus compact />
            <button onClick={() => { setOpen(false); setView({ copilot: true }) }} className="btn">Ask the console</button>
          </div>
        </div>
      )}

      {error && (
        <div className="page pt-6">
          <p className="border-l-2 border-heat pl-3 text-[13px] text-heat">Could not load the data export: {error}</p>
        </div>
      )}
      <main>{children}</main>
      {!fullBleed && <Footer />}
    </div>
  )
}
