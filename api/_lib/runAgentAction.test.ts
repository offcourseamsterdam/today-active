import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./firebaseAdmin.js', () => ({
  getDb: vi.fn(),
  getAgentUid: vi.fn(),
}))
vi.mock('./trackerOps.js', () => ({
  listTrackerProjects: vi.fn(),
  updateTrackerProject: vi.fn(),
}))

import { executeAgentAction } from './runAgentAction'
import { getDb, getAgentUid } from './firebaseAdmin.js'
import { listTrackerProjects, updateTrackerProject } from './trackerOps.js'
import { normalizeSyncData, type SyncData } from './agentOps'
import type { Project } from '../../src/types'

const mockGetDb = vi.mocked(getDb)
const mockGetAgentUid = vi.mocked(getAgentUid)
const mockListTrackerProjects = vi.mocked(listTrackerProjects)
const mockUpdateTrackerProject = vi.mocked(updateTrackerProject)

function project(overrides: Partial<Project> & { id: string }): Project {
  return {
    title: 'Project',
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

function baseData(overrides: Partial<SyncData> = {}): SyncData {
  return normalizeSyncData(overrides)
}

interface FakeDb {
  collection: (name: string) => { doc: (id: string) => { get: () => Promise<FakeSnapshot> } }
  runTransaction: <T>(fn: (tx: FakeTx) => Promise<T>) => Promise<T>
}

interface FakeSnapshot {
  exists: boolean
  data: () => SyncData | undefined
}

interface FakeTx {
  get: (ref: unknown) => Promise<FakeSnapshot>
  update: (ref: unknown, payload: Record<string, unknown>) => void
}

/** Minimal Firestore double: one doc, captures every `tx.update`/`update` payload. */
function makeFakeDb(data: SyncData | undefined): { db: FakeDb; updates: Array<Record<string, unknown>> } {
  const updates: Array<Record<string, unknown>> = []
  const snapshot: FakeSnapshot = { exists: data !== undefined, data: () => data }
  const docRef = { get: async () => snapshot }
  const db: FakeDb = {
    collection: () => ({ doc: () => docRef }),
    runTransaction: async fn =>
      fn({
        get: async () => snapshot,
        update: (_ref, payload) => {
          updates.push(payload)
        },
      }),
  }
  return { db, updates }
}

/** Throws if `value` contains an explicit `undefined` anywhere — what `tx.update` would reject on for real. */
function assertNoUndefined(value: unknown, path = '<root>'): void {
  if (value === undefined) throw new Error(`undefined at ${path}`)
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoUndefined(v, `${path}[${i}]`))
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) assertNoUndefined(v, `${path}.${k}`)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetAgentUid.mockReturnValue('uid1')
})

describe('sync_tracker_status', () => {
  it('defaults to a dry run: reports changes without writing', async () => {
    const data = baseData({ projects: [project({ id: 'p1', status: 'backlog', trackerProjectId: 't1' })] })
    const { db, updates } = makeFakeDb(data)
    mockGetDb.mockReturnValue(db as never)
    mockListTrackerProjects.mockResolvedValue({
      workspaceId: 'ws1',
      projects: [{ id: 't1', title: 'X', status: 'in_progress', subtasks: [], assigneeIds: [], assignees: [] }],
    })

    const result = (await executeAgentAction('sync_tracker_status', {})) as { dryRun: boolean; changes: unknown[] }
    expect(result.dryRun).toBe(true)
    expect(result.changes).toEqual([{ vandaagProjectId: 'p1', title: 'Project', from: 'backlog', to: 'in_progress', trackerId: 't1' }])
    expect(updates).toHaveLength(0)
  })

  it('applies changes when dryRun is false, writing a payload with no undefined values anywhere', async () => {
    const data = baseData({
      projects: [
        project({ id: 'p1', status: 'waiting', trackerProjectId: 't1', waitingOn: [{ person: 'Bob', since: '2026-01-01' }] }),
      ],
    })
    const { db, updates } = makeFakeDb(data)
    mockGetDb.mockReturnValue(db as never)
    mockListTrackerProjects.mockResolvedValue({
      workspaceId: 'ws1',
      projects: [{ id: 't1', title: 'X', status: 'completed', subtasks: [], assigneeIds: [], assignees: [] }],
    })

    const result = (await executeAgentAction('sync_tracker_status', { dryRun: false })) as { dryRun: boolean; changes: unknown[] }
    expect(result.dryRun).toBe(false)
    expect(result.changes).toHaveLength(1)
    expect(updates).toHaveLength(1)
    assertNoUndefined(updates[0])
    const updatedProjects = updates[0].projects as Array<Record<string, unknown>>
    expect(updatedProjects[0].status).toBe('done')
    expect('waitingOn' in updatedProjects[0]).toBe(false)
  })

  it('does not write anything when there are no changes, even with dryRun: false', async () => {
    const data = baseData({ projects: [project({ id: 'p1', status: 'in_progress', trackerProjectId: 't1' })] })
    const { db, updates } = makeFakeDb(data)
    mockGetDb.mockReturnValue(db as never)
    mockListTrackerProjects.mockResolvedValue({
      workspaceId: 'ws1',
      projects: [{ id: 't1', title: 'X', status: 'in_progress', subtasks: [], assigneeIds: [], assignees: [] }],
    })

    await executeAgentAction('sync_tracker_status', { dryRun: false })
    expect(updates).toHaveLength(0)
  })
})

describe('update_project with syncStatus', () => {
  it('calls updateTrackerProject with the mapped status when linked and status changed', async () => {
    const data = baseData({ projects: [project({ id: 'p1', status: 'backlog', trackerProjectId: 't1' })] })
    const { db } = makeFakeDb(data)
    mockGetDb.mockReturnValue(db as never)
    mockUpdateTrackerProject.mockResolvedValue({
      project: { id: 't1', title: 'X', status: 'in_progress', subtasks: [], assigneeIds: [], assignees: [] },
      previousStatus: 'not_started',
    })

    const result = (await executeAgentAction('update_project', {
      projectId: 'p1',
      status: 'in_progress',
      syncStatus: true,
    })) as { project: { status: string }; tracker?: Record<string, unknown> }

    expect(mockUpdateTrackerProject).toHaveBeenCalledWith({ projectId: 't1', status: 'in_progress' })
    expect(result.project.status).toBe('in_progress')
    expect(result.tracker).toEqual({ updated: true, previousStatus: 'not_started', status: 'in_progress' })
  })

  it('skips the tracker call when the project is not linked', async () => {
    const data = baseData({ projects: [project({ id: 'p1', status: 'backlog' })] })
    const { db } = makeFakeDb(data)
    mockGetDb.mockReturnValue(db as never)

    const result = (await executeAgentAction('update_project', {
      projectId: 'p1',
      status: 'in_progress',
      syncStatus: true,
    })) as { tracker?: Record<string, unknown> }

    expect(mockUpdateTrackerProject).not.toHaveBeenCalled()
    expect(result.tracker).toEqual({ skipped: 'Project is not linked to a tracker project' })
  })

  it('skips the tracker call when the status did not actually change', async () => {
    const data = baseData({ projects: [project({ id: 'p1', status: 'backlog', trackerProjectId: 't1' })] })
    const { db } = makeFakeDb(data)
    mockGetDb.mockReturnValue(db as never)

    const result = (await executeAgentAction('update_project', {
      projectId: 'p1',
      status: 'backlog',
      syncStatus: true,
    })) as { tracker?: Record<string, unknown> }

    expect(mockUpdateTrackerProject).not.toHaveBeenCalled()
    expect(result.tracker).toEqual({ skipped: 'Status did not change' })
  })

  it('omits the tracker field entirely when syncStatus is not set', async () => {
    const data = baseData({ projects: [project({ id: 'p1', status: 'backlog', trackerProjectId: 't1' })] })
    const { db } = makeFakeDb(data)
    mockGetDb.mockReturnValue(db as never)

    const result = (await executeAgentAction('update_project', { projectId: 'p1', status: 'in_progress' })) as {
      tracker?: unknown
    }

    expect(mockUpdateTrackerProject).not.toHaveBeenCalled()
    expect(result.tracker).toBeUndefined()
  })

  it('returns a generic error without throwing when the tracker update rejects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const data = baseData({ projects: [project({ id: 'p1', status: 'backlog', trackerProjectId: 't1' })] })
    const { db } = makeFakeDb(data)
    mockGetDb.mockReturnValue(db as never)
    mockUpdateTrackerProject.mockRejectedValue(new Error('tracker is on fire'))

    const result = (await executeAgentAction('update_project', {
      projectId: 'p1',
      status: 'in_progress',
      syncStatus: true,
    })) as { project: { status: string }; tracker?: Record<string, unknown> }

    expect(result.project.status).toBe('in_progress')
    expect(result.tracker).toEqual({ error: 'Failed to sync status to the tracker' })
  })
})
