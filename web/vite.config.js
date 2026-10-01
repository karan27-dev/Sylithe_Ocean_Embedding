import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { handle } from './server/agent.js'
import { handleLive } from './server/live.js'

// In development the Sylithe agent's endpoint runs inside the dev server; the key comes from web/.env.local
// (git-ignored), never from the browser bundle (it has no VITE_ prefix).
const agent = (key, gh) => ({
  name: 'sylithe-agent',
  configureServer(server) {
    server.middlewares.use('/api/agent', (req, res) => handle(req, res, key))
    server.middlewares.use('/live', (req, res) => handleLive(req, res, gh, req.url))
  },
  configurePreviewServer(server) { server.middlewares.use('/api/agent', (req, res) => handle(req, res, key)) },
})

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return { plugins: [react(), agent(env.DEEPSEEK_API_KEY, env.GITHUB_TOKEN)], preview: { port: 4173 } }
})
