// Small shared primitives. Deliberately few: most layout is written in place, page by page.
import { Link } from 'react-router-dom'
import { useData } from '../App'

/** Mark: three strata lines, the top one solid: surface over subsurface. */
export function Mark({ size = 18, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} aria-hidden="true">
      <path d="M2 6h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M2 10.5h16" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity=".55" />
      <path d="M2 15h16" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" opacity=".3" />
    </svg>
  )
}

export function Wordmark({ className = '' }) {
  return (
    <Link to="/" className={`flex items-center gap-2 text-ink ${className}`} aria-label="OceanEmbed home">
      <Mark className="text-sea" />
      <span className="font-display text-[19px] leading-none tracking-[-0.01em]">OceanEmbed</span>
    </Link>
  )
}

/** What the console is showing: the model reconstruction, or the pre-training reference field. */
export function SourceStatus({ compact = false }) {
  const { m } = useData()
  if (!m) return null
  const model = m.source.kind === 'model'
  return (
    <span className="inline-flex items-center gap-2 text-[12px] text-mute" title={m.source.detail}>
      <span className={`h-[7px] w-[7px] rounded-full ${model ? 'bg-sea' : 'border border-mute'}`} />
      {compact ? (model ? 'Model output' : 'Reference field') : model ? m.source.label : `${m.source.label} · model pending`}
    </span>
  )
}

/** Editorial section opener: an instrument label, a serif title, an optional lede. */
export function SectionHead({ label, title, children, className = '', as: H = 'h2' }) {
  return (
    <div className={className}>
      {label && <p className="label mb-3">{label}</p>}
      <H className={`display ${H === 'h1' ? 'text-[34px] sm:text-[42px] leading-[1.05]' : 'text-[24px] sm:text-[28px] leading-[1.15]'}`}>{title}</H>
      {children && <div className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-ink2">{children}</div>}
    </div>
  )
}

/** Honest empty state: says what will appear and which step produces it. No icon art. */
export function Pending({ title, children, className = '' }) {
  return (
    <div className={`border-l-2 border-line2 pl-4 py-1 ${className}`}>
      <p className="text-[13px] text-ink">{title}</p>
      {children && <p className="mt-1 max-w-[60ch] text-[12.5px] leading-relaxed text-mute">{children}</p>}
    </div>
  )
}

export function Footer() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="page flex flex-col gap-3 py-8 text-[12px] text-mute sm:flex-row sm:items-center sm:justify-between">
        <p>OceanEmbed · Smart India Hackathon 2026 · PS 26066 · MoES / INCOIS</p>
        <p>Colour maps: cmocean (Thyng et al., 2016). Basemap © CARTO, © OpenStreetMap contributors.</p>
      </div>
    </footer>
  )
}

/** Key–value row with a hairline, for compact data panels. */
export function Row({ k, v, u, strong }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2 last:border-0">
      <span className="text-[12.5px] text-mute">{k}</span>
      <span className={`num text-[13px] ${strong ? 'text-heat' : 'text-ink'}`}>{v}{u && <span className="ml-1 text-faint">{u}</span>}</span>
    </div>
  )
}
