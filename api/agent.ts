import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getAgentConfigError } from './_lib/firebaseAdmin.js'
import { checkBearerAuth } from './_lib/auth.js'
import { AgentOpError } from './_lib/agentOps.js'
import { executeAgentAction } from './_lib/runAgentAction.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const configError = getAgentConfigError()
  if (configError) {
    res.status(503).json({ error: configError })
    return
  }

  const auth = checkBearerAuth(req.headers.authorization, process.env.AGENT_API_TOKEN!)
  if (!auth.ok) {
    res.status(401).json({ error: auth.error })
    return
  }

  const body = (req.body ?? {}) as { action?: unknown; params?: unknown }
  if (typeof body.action !== 'string') {
    res.status(400).json({ error: 'action is required' })
    return
  }
  const params = body.params ?? {}
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    res.status(400).json({ error: 'params must be an object' })
    return
  }

  try {
    const result = await executeAgentAction(body.action, params as Record<string, unknown>)
    res.status(200).json({ ok: true, result })
  } catch (err) {
    if (err instanceof AgentOpError) {
      res.status(err.status).json({ error: err.message })
      return
    }
    console.error('[agent]', err)
    res.status(500).json({ error: 'Internal error' })
  }
}
