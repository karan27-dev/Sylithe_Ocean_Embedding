import { useEffect, useState } from 'react'
import { Map, Database, Brain, FlaskConical, Sparkles, Waves } from 'lucide-react'
import Explorer from './pages/Explorer'
import Pipeline from './pages/Pipeline'
import Model from './pages/Model'
import Validation from './pages/Validation'
import Copilot from './components/Copilot'
import { DATASETS, DEPTHS, loadField, cellAt } from './lib/ocean'

const NAV = [
  { id: 'explorer', label: 'Explorer', icon: Map },
  { id: 'validation', label: 'Validation', icon: FlaskConical },
  { id: 'pipeline', label: 'Pipeline', icon: Database },
  { id: 'model', label: 'Model', icon: Brain },
]

export default function App() {
  const [page, setPage] = useState('explorer')
  const [fields, setFields] = useState({})
  const [error, setError] = useState(null)
  const [datasetId, setDatasetId] = useState(DATASETS[0].id)
  const [layerId, setLayerId] = useState('temp')
  const [depthIdx, setDepthIdx] = useState(DEPTHS.indexOf(100))
  const [selected, setSelected] = useState(null)
  const [copilot, setCopilot] = useState(false)

  useEffect(() => {
    DATASETS.forEach((d) =>
      loadField(d.file).then((f) => setFields((s) => ({ ...s, [d.id]: f }))).catch((e) => setError(e.message)))
  }, [])

  const applyActions = (acts) => {
    setPage('explorer')
    for (const a of acts) {
      if (a.type === 'layer') setLayerId(a.id)
      if (a.type === 'depth') setDepthIdx(a.idx)
      if (a.type === 'date') setDatasetId(a.id)
      if (a.type === 'probe') {
        const f = fields[datasetId]
        const c = f && cellAt(f, a.lat, a.lon)
        if (c && f.temp[0][c.y][c.x] != null) setSelected(c)
      }
    }
  }

  return (
    <div className="flex min-h-screen">
      <nav className="w-[220px] shrink-0 bg-abyss text-white flex flex-col h-screen sticky top-0">
        <div className="px-5 py-6 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-mint/15 grid place-items-center"><Waves size={18} className="text-mint" /></div>
          <div>
            <p className="font-bold leading-none">OceanEmbed</p>
            <p className="text-[10px] text-mint/70 mt-1 tracking-wider">SIH 26066 · INCOIS</p>
          </div>
        </div>
        <div className="px-3 space-y-1">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setPage(id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors ${
                page === id ? 'bg-white/10 text-white' : 'text-white/60 hover:text-white hover:bg-trench'}`}>
              <Icon size={17} className={page === id ? 'text-mint' : ''} />{label}
            </button>
          ))}
        </div>
        <div className="mt-auto p-3">
          <button onClick={() => setCopilot((o) => !o)}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-mint text-abyss font-bold text-[13px] py-2.5 hover:bg-lime transition-colors">
            <Sparkles size={15} /> Ocean Copilot
          </button>
          <p className="text-[10px] text-white/40 mt-3 px-1 leading-snug">Surface satellites → 15-level temperature, 0–1000 m. North Indian Ocean.</p>
        </div>
      </nav>

      <main className="flex-1 min-w-0">
        {error && <div className="m-6 card p-4 text-[13px] text-red-600">Could not load data: {error}</div>}
        {page === 'explorer' && (
          <Explorer fields={fields} datasetId={datasetId} setDatasetId={setDatasetId} layerId={layerId} setLayerId={setLayerId}
            depthIdx={depthIdx} setDepthIdx={setDepthIdx} selected={selected} setSelected={setSelected} />
        )}
        {page === 'validation' && <Validation />}
        {page === 'pipeline' && <Pipeline />}
        {page === 'model' && <Model />}
      </main>

      <Copilot open={copilot} onClose={() => setCopilot(false)} onActions={applyActions} />
    </div>
  )
}
