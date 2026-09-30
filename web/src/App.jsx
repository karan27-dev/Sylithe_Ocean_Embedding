import { createContext, useContext, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Shell from './components/Shell'
import Copilot from './components/Copilot'
import Overview from './pages/Overview'
import Explorer from './pages/Explorer'
import Embedding from './pages/Embedding'
import Validation from './pages/Validation'
import Cyclone from './pages/Cyclone'
import Pipeline from './pages/Pipeline'
import Model from './pages/Model'
import Downloads from './pages/Downloads'
import Daily from './pages/Daily'
import { useManifest } from './lib/data'
import { useView } from './lib/store'

const DataCtx = createContext(null)
/** { m: manifest | null, error } — every page reads the export through this. */
export const useData = () => useContext(DataCtx)

export const NAV = [
  { to: '/daily', label: 'Daily forecast' },
  { to: '/explorer', label: 'Explorer' },
  { to: '/cyclone', label: 'Cyclone watch' },
  { to: '/validation', label: 'Validation' },
  { to: '/embedding', label: 'Embedding' },
  { to: '/model', label: 'Model' },
  { to: '/pipeline', label: 'Pipeline' },
  { to: '/data', label: 'Data' },
]

export default function App() {
  const data = useManifest()
  const { pathname } = useLocation()
  const { date, set } = useView()

  // Default to the export's most recent day; keep a deep-linked date only if the export has it.
  useEffect(() => {
    const m = data.m
    if (m && (!date || !(date in m.dayIndex))) set({ date: m.days[m.days.length - 1].date })
  }, [data.m, date, set])

  useEffect(() => { window.scrollTo(0, 0) }, [pathname])

  return (
    <DataCtx.Provider value={data}>
      <Shell>
        <div key={pathname} className="fade-in">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/daily" element={<Daily />} />
            <Route path="/explorer" element={<Explorer />} />
            <Route path="/embedding" element={<Embedding />} />
            <Route path="/validation" element={<Validation />} />
            <Route path="/cyclone" element={<Cyclone />} />
            <Route path="/pipeline" element={<Pipeline />} />
            <Route path="/model" element={<Model />} />
            <Route path="/data" element={<Downloads />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </Shell>
      <Copilot />
    </DataCtx.Provider>
  )
}
