// Live data proxy: the repository is private, so the browser cannot read the `live-data` branch directly.
// /live/<file> is fetched here with a read-only GitHub token (GITHUB_TOKEN, server-side only) and cached at the
// edge for 5 minutes, so the page always shows the newest 6-hourly run while GitHub sees few requests.
const REPO = 'karan27-dev/Sylithe_Ocean_Embedding'
const SAFE = /^[A-Za-z0-9_.\-/]+$/

export async function handleLive(req, res, token, path) {
  const fail = (code, msg) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: msg })) }
  if (!token) return fail(503, 'GITHUB_TOKEN is not set on the server')
  path = String(path || '').replace(/^\/+/, '').split('?')[0]
  if (!path || !SAFE.test(path) || path.includes('..')) return fail(400, 'bad path')
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/web/${path}?ref=live-data`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.raw', 'User-Agent': 'sylithe-live', 'X-GitHub-Api-Version': '2022-11-28' },
  })
  if (!r.ok) return fail(r.status === 404 ? 404 : 502, `GitHub returned ${r.status}`)
  const buf = Buffer.from(await r.arrayBuffer())
  res.statusCode = 200
  res.setHeader('Content-Type', path.endsWith('.json') ? 'application/json' : 'application/octet-stream')
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600')
  res.end(buf)
}
