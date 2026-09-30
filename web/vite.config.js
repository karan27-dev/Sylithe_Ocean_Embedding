import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { handle } from './server/agent.js'

// In development the Sylithe agent's endpoint runs inside the dev server; the key comes from web/.env.local
// (git-ignored), never from the browser bundle (it has no VITE_ prefix).
const agent = (key) => ({
  name: 'sylithe-agent',
  configureServer(server) { server.middlewares.use('/api/agent', (req, res) => handle(req, res, key)) },
  configurePreviewServer(server) { server.middlewares.use('/api/agent', (req, res) => handle(req, res, key)) },
})

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return { plugins: [react(), agent(env.DEEPSEEK_API_KEY)], preview: { port: 4173 } }
})
