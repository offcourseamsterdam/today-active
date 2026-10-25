import { describe, it, expect, vi } from 'vitest'
import { handleMcpRequest, PROTOCOL_VERSION } from './mcpHandler'

describe('handleMcpRequest', () => {
  it('returns null for notifications (no id)', async () => {
    const exec = vi.fn()
    const result = await handleMcpRequest({ jsonrpc: '2.0', method: 'notifications/initialized' }, exec)
    expect(result).toBeNull()
    expect(exec).not.toHaveBeenCalled()
  })

  it('returns an Invalid Request error for malformed bodies that carry an id', async () => {
    const result = await handleMcpRequest({ id: 1, method: 'tools/list' }, vi.fn())
    expect(result).toEqual({ jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'Invalid Request' } })
  })

  it('returns null (no response) for a malformed body with no id', async () => {
    const result = await handleMcpRequest({ method: 'tools/list' }, vi.fn())
    expect(result).toBeNull()
  })

  it('handles initialize', async () => {
    const result = await handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL_VERSION } }, vi.fn())
    expect(result?.result).toMatchObject({ protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} } })
  })

  it('handles ping', async () => {
    const result = await handleMcpRequest({ jsonrpc: '2.0', id: 2, method: 'ping' }, vi.fn())
    expect(result).toEqual({ jsonrpc: '2.0', id: 2, result: {} })
  })

  it('lists tools including list_projects and add_task', async () => {
    const result = await handleMcpRequest({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, vi.fn())
    const tools = (result?.result as { tools: Array<{ name: string }> }).tools
    expect(tools.map(t => t.name)).toEqual(expect.arrayContaining(['list_projects', 'add_task']))
  })

  it('calls the injected executor for tools/call and wraps the result as text', async () => {
    const exec = vi.fn().mockResolvedValue({ id: 't1', title: 'Task' })
    const result = await handleMcpRequest(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'add_task', arguments: { title: 'Task' } } },
      exec,
    )
    expect(exec).toHaveBeenCalledWith('add_task', { title: 'Task' })
    const content = (result?.result as { content: Array<{ type: string; text: string }> }).content
    expect(JSON.parse(content[0].text)).toEqual({ id: 't1', title: 'Task' })
  })

  it('surfaces AgentOpError messages as isError text instead of throwing', async () => {
    const { AgentOpError } = await import('./agentOps')
    const exec = vi.fn().mockRejectedValue(new AgentOpError(404, 'Task not found: nope'))
    const result = await handleMcpRequest(
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'complete_task', arguments: { taskId: 'nope' } } },
      exec,
    )
    const payload = result?.result as { content: Array<{ text: string }>; isError?: boolean }
    expect(payload.isError).toBe(true)
    expect(payload.content[0].text).toBe('Task not found: nope')
  })

  it('returns Method not found for unknown methods', async () => {
    const result = await handleMcpRequest({ jsonrpc: '2.0', id: 6, method: 'bogus/method' }, vi.fn())
    expect(result?.error?.code).toBe(-32601)
  })
})
