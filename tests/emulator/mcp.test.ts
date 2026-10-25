import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import handler from '../../api/mcp'
import { configureAgentEnv, seedUserDoc, readUserDoc, mockReqRes, TEST_TOKEN } from './helpers'

// Distinct from agent.test.ts's uid — vitest runs test files concurrently
// against the same emulator, so sharing a doc id would race.
const UID = 'test-uid-mcp'

function authed(body: unknown) {
  return mockReqRes({ body, headers: { authorization: `Bearer ${TEST_TOKEN}` } })
}

describe('api/mcp.ts (Firestore emulator)', () => {
  beforeAll(() => {
    configureAgentEnv(UID)
  })

  beforeEach(async () => {
    await seedUserDoc(UID, {})
  })

  it('returns 401 without a valid bearer token', async () => {
    const { req, res, result } = mockReqRes({ body: { jsonrpc: '2.0', id: 1, method: 'ping' } })
    await handler(req, res)
    expect(result.statusCode).toBe(401)
  })

  it('returns 503 when unconfigured', async () => {
    const saved = process.env.AGENT_API_TOKEN
    delete process.env.AGENT_API_TOKEN
    const { req, res, result } = authed({ jsonrpc: '2.0', id: 1, method: 'ping' })
    await handler(req, res)
    expect(result.statusCode).toBe(503)
    process.env.AGENT_API_TOKEN = saved
  })

  it('handles initialize', async () => {
    const { req, res, result } = authed({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    await handler(req, res)
    expect(result.statusCode).toBe(200)
    expect((result.body as { result: { serverInfo: { name: string } } }).result.serverInfo.name).toBeTruthy()
  })

  it('returns 202 with no body for a notification', async () => {
    const { req, res, result } = authed({ jsonrpc: '2.0', method: 'notifications/initialized' })
    await handler(req, res)
    expect(result.statusCode).toBe(202)
    expect(result.ended).toBe(true)
  })

  it('lists tools', async () => {
    const { req, res, result } = authed({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    await handler(req, res)
    const tools = (result.body as { result: { tools: Array<{ name: string }> } }).result.tools
    expect(tools.map(t => t.name)).toContain('add_project')
  })

  it('calls add_project through tools/call and persists it via the real transaction path', async () => {
    const { req, res, result } = authed({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'add_project', arguments: { title: 'From MCP' } },
    })
    await handler(req, res)
    expect(result.statusCode).toBe(200)
    const payload = (result.body as { result: { content: Array<{ text: string }> } }).result
    const created = JSON.parse(payload.content[0].text)
    expect(created.title).toBe('From MCP')

    const after = await readUserDoc(UID)
    expect(after!.projects).toHaveLength(1)
    expect(after!.projects[0].title).toBe('From MCP')
  })

  it('surfaces a 404 from tools/call as an isError content block, not an HTTP error', async () => {
    const { req, res, result } = authed({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'complete_task', arguments: { taskId: 'missing' } },
    })
    await handler(req, res)
    expect(result.statusCode).toBe(200)
    const payload = (result.body as { result: { content: Array<{ text: string }>; isError?: boolean } }).result
    expect(payload.isError).toBe(true)
  })
})
