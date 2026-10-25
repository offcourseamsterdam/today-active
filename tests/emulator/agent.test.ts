import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import handler from '../../api/agent'
import { configureAgentEnv, seedUserDoc, readUserDoc, mockReqRes, TEST_TOKEN } from './helpers'
import type { Project, Task } from '../../src/types'

const UID = 'test-uid'

function project(overrides: Partial<Project> & { id: string }): Project {
  return {
    title: 'Project One',
    category: 'personal',
    status: 'backlog',
    bodyContent: '',
    tasks: [],
    trackProgress: false,
    daysWorked: 0,
    daysWorkedLog: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function task(overrides: Partial<Task> & { id: string; title: string }): Task {
  return {
    status: 'backlog',
    isRecurring: false,
    isUncomfortable: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function authed(body: unknown) {
  return mockReqRes({ body, headers: { authorization: `Bearer ${TEST_TOKEN}` } })
}

describe('api/agent.ts (Firestore emulator)', () => {
  beforeAll(() => {
    configureAgentEnv(UID)
  })

  beforeEach(async () => {
    await seedUserDoc(UID, { projects: [project({ id: 'p1' })] })
  })

  it('rejects non-POST methods', async () => {
    const { req, res, result } = mockReqRes({ method: 'GET' })
    await handler(req, res)
    expect(result.statusCode).toBe(405)
  })

  it('returns 503 without leaking any secret when AGENT_API_TOKEN is unset', async () => {
    const saved = process.env.AGENT_API_TOKEN
    delete process.env.AGENT_API_TOKEN
    const { req, res, result } = authed({ action: 'list_projects' })
    await handler(req, res)
    expect(result.statusCode).toBe(503)
    expect(JSON.stringify(result.body)).not.toContain(TEST_TOKEN)
    process.env.AGENT_API_TOKEN = saved
  })

  it('returns 503 when no uid is configured', async () => {
    delete process.env.AGENT_UID
    const { req, res, result } = authed({ action: 'list_projects' })
    await handler(req, res)
    expect(result.statusCode).toBe(503)
    process.env.AGENT_UID = UID
  })

  it('returns 401 for a missing bearer token', async () => {
    const { req, res, result } = mockReqRes({ body: { action: 'list_projects' } })
    await handler(req, res)
    expect(result.statusCode).toBe(401)
  })

  it('returns 401 for a wrong bearer token', async () => {
    const { req, res, result } = mockReqRes({ body: { action: 'list_projects' }, headers: { authorization: 'Bearer wrong' } })
    await handler(req, res)
    expect(result.statusCode).toBe(401)
  })

  it('returns 400 when action is missing', async () => {
    const { req, res, result } = authed({})
    await handler(req, res)
    expect(result.statusCode).toBe(400)
  })

  it('returns 400 for an unknown action', async () => {
    const { req, res, result } = authed({ action: 'nonsense' })
    await handler(req, res)
    expect(result.statusCode).toBe(400)
  })

  it('lists seeded projects', async () => {
    const { req, res, result } = authed({ action: 'list_projects' })
    await handler(req, res)
    expect(result.statusCode).toBe(200)
    expect((result.body as { result: Array<{ id: string }> }).result.map(p => p.id)).toEqual(['p1'])
  })

  it('returns 404 when adding a task to an unknown project', async () => {
    const { req, res, result } = authed({ action: 'add_task', params: { title: 'x', projectId: 'missing' } })
    await handler(req, res)
    expect(result.statusCode).toBe(404)
  })

  it('adds an orphan task transactionally and bumps syncedAt', async () => {
    const before = await readUserDoc(UID)
    const { req, res, result } = authed({ action: 'add_task', params: { title: 'New task' } })
    await handler(req, res)
    expect(result.statusCode).toBe(200)
    const after = await readUserDoc(UID)
    expect(after!.orphanTasks).toHaveLength(1)
    expect(after!.orphanTasks[0].title).toBe('New task')
    expect(after!.syncedAt).not.toBe(before!.syncedAt)
  })

  it('completes a task end-to-end and persists it', async () => {
    await seedUserDoc(UID, { orphanTasks: [task({ id: 't1', title: 'Finish me' })] })
    const { req, res, result } = authed({ action: 'complete_task', params: { taskId: 't1' } })
    await handler(req, res)
    expect(result.statusCode).toBe(200)
    const after = await readUserDoc(UID)
    expect(after!.orphanTasks[0].status).toBe('done')
    expect(after!.orphanTasks[0].completedAt).toBeTruthy()
  })

  it('rejects completing a recurring task with a 400', async () => {
    await seedUserDoc(UID, { recurringTasks: [task({ id: 'r1', title: 'Recurring', isRecurring: true })] })
    const { req, res, result } = authed({ action: 'complete_task', params: { taskId: 'r1' } })
    await handler(req, res)
    expect(result.statusCode).toBe(400)
  })

  it('does not bump syncedAt for a pure read', async () => {
    const before = await readUserDoc(UID)
    const { req, res, result } = authed({ action: 'list_orphan_tasks' })
    await handler(req, res)
    expect(result.statusCode).toBe(200)
    const after = await readUserDoc(UID)
    expect(after!.syncedAt).toBe(before!.syncedAt)
  })

  it('renames a project', async () => {
    const { req, res, result } = authed({ action: 'rename_project', params: { projectId: 'p1', title: 'Renamed' } })
    await handler(req, res)
    expect(result.statusCode).toBe(200)
    const after = await readUserDoc(UID)
    expect(after!.projects[0].title).toBe('Renamed')
  })
})
