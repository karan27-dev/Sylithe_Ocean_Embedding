// Vercel function: GET /live/<file> (rewritten to /api/live?path=<file>). Needs GITHUB_TOKEN (Contents: read-only).
import { handleLive } from '../server/live.js'

export default function handler(req, res) {
  const path = new URL(req.url, 'http://x').searchParams.get('path')
  return handleLive(req, res, process.env.GITHUB_TOKEN, path).catch((e) => { res.statusCode = 500; res.end(String(e).slice(0, 200)) })
}
