import { getDb, getAgentUid } from './firebaseAdmin.js'
import {
  AgentOpError,
  isAgentAction,
  normalizeSyncData,
  runAgentOperation,
  stripUndefined,
} from './agentOps.js'

/**
 * Shared by api/agent.ts (plain HTTP) and api/mcp.ts (MCP tools/call): reads the
 * user doc inside a transaction, applies the pure op, and writes back only the
 * changed top-level fields plus a fresh syncedAt — so a stale client tab's
 * onSnapshot listener picks up the write instead of silently losing it.
 */
export async function executeAgentAction(action: string, params: Record<string, unknown>): Promise<unknown> {
  if (!isAgentAction(action)) {
    throw new AgentOpError(400, `Unknown action: ${action}`)
  }

  const uid = getAgentUid()
  if (!uid) throw new AgentOpError(503, 'Agent API is not configured')

  const db = getDb()
  const docRef = db.collection('users').doc(uid)

  return db.runTransaction(async tx => {
    const snap = await tx.get(docRef)
    if (!snap.exists) {
      throw new AgentOpError(404, 'User document not found')
    }
    const data = normalizeSyncData(snap.data())
    const { patch, result } = runAgentOperation(action, data, params)
    if (Object.keys(patch).length > 0) {
      tx.update(docRef, stripUndefined({ ...patch, syncedAt: new Date().toISOString() }))
    }
    return result
  })
}
