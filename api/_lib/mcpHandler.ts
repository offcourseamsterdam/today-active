/**
 * Framework-free JSON-RPC 2.0 dispatch for the MCP Streamable HTTP transport
 * (api/mcp.ts). Stateless — every request is handled independently.
 * Pattern mirrors a standard hand-rolled MCP server: initialize →
 * notifications/initialized → tools/list → tools/call, plus ping.
 */
import { MCP_TOOLS } from './agentTools.js'
import { AgentOpError } from './agentOps.js'

export const PROTOCOL_VERSION = '2025-06-18'
const SERVER_INFO = { name: 'vandaag-agent-api', version: '1.0.0' }

interface JsonRpcRequest {
  jsonrpc: '2.0'
  method: string
  params?: unknown
  id?: string | number | null
}

/** `null` means "notification — send no response", per JSON-RPC 2.0 (a request with no `id`). */
export type JsonRpcResult =
  | { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: { code: number; message: string; data?: unknown } }
  | null

export type ActionExecutor = (action: string, params: Record<string, unknown>) => Promise<unknown>

function handleInitialize(params: unknown): unknown {
  const requested = (params as { protocolVersion?: unknown } | undefined)?.protocolVersion
  return {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: { tools: {} },
    serverInfo: SERVER_INFO,
    instructions:
      'Tools for reading and editing Vandaag projects, tasks, and daily plans. ' +
      (requested && requested !== PROTOCOL_VERSION
        ? `Note: this server only speaks protocol version ${PROTOCOL_VERSION}.`
        : ''),
  }
}

async function handleToolsCall(
  params: unknown,
  executeAction: ActionExecutor,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const { name, arguments: args } = (params ?? {}) as { name?: unknown; arguments?: unknown }

  if (typeof name !== 'string') {
    return { content: [{ type: 'text', text: 'Tool name is required' }], isError: true }
  }
  const toolArgs = (args ?? {}) as unknown
  if (typeof toolArgs !== 'object' || toolArgs === null || Array.isArray(toolArgs)) {
    return { content: [{ type: 'text', text: 'Tool arguments must be an object' }], isError: true }
  }

  try {
    const result = await executeAction(name, toolArgs as Record<string, unknown>)
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  } catch (err) {
    if (err instanceof AgentOpError) {
      return { content: [{ type: 'text', text: err.message }], isError: true }
    }
    console.error('[mcp] tool execution failed:', err)
    return { content: [{ type: 'text', text: 'Internal error running tool' }], isError: true }
  }
}

/**
 * Dispatches one JSON-RPC 2.0 message. `executeAction` is injected so this
 * stays unit-testable without touching Firestore (api/mcp.ts wires it to
 * executeAgentAction in production).
 */
export async function handleMcpRequest(body: unknown, executeAction: ActionExecutor): Promise<JsonRpcResult> {
  const req = body as Partial<JsonRpcRequest> | null
  const hasId = !!req && typeof req === 'object' && 'id' in req && req.id !== undefined
  const id = hasId ? (req!.id as string | number | null) : null

  if (!req || typeof req !== 'object' || req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
    return hasId ? { jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid Request' } } : null
  }

  // Notifications (no `id`) get no response, per JSON-RPC 2.0.
  if (!hasId) {
    if (req.method !== 'notifications/initialized' && req.method !== 'notifications/cancelled') {
      console.warn(`[mcp] unhandled notification: ${req.method}`)
    }
    return null
  }

  switch (req.method) {
    case 'initialize':
      return { jsonrpc: '2.0', id, result: handleInitialize(req.params) }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} }
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } }
    case 'tools/call':
      return { jsonrpc: '2.0', id, result: await handleToolsCall(req.params, executeAction) }
    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${req.method}` } }
  }
}
