// Vercel serverless function: POST /api/agent. Set DEEPSEEK_API_KEY in the Vercel project's environment variables.
import { handle } from '../server/agent.js'

export default function handler(req, res) {
  return handle(req, res, process.env.DEEPSEEK_API_KEY)
}
