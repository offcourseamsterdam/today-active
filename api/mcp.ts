import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getAgentConfigError } from './_lib/firebaseAdmin.js'
import { checkBearerAuth } from './_lib/auth.js'
import { handleMcpRequest } from './_lib/mcpHandler.js'
import { executeAgentAction } from './_lib/runAgentAction.js'

// POST /api/mcp — Streamable HTTP transport for the Model Context Protocol,
// stateless (no session store, no server-initiated messages), POST only.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'This server does not support server-initiated streaming; use POST.' })
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

  let body: unknown = req.body
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
      return
    }
  }

  const response = await handleMcpRequest(body, executeAgentAction)
  if (response === null) {
    // A notification (no `id`) — per JSON-RPC 2.0, the server sends no body.
    res.status(202).end()
    return
  }
  res.status(200).json(response)
}
