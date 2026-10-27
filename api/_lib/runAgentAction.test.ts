import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./firebaseAdmin.js', () => ({
  getDb: vi.fn(),
  getAgentUid: vi.fn(),
}))
vi.mock('./trackerOps.js', async () => {
  const actual = await vi.importActual<typeof import('./trackerOps')>('./trackerOps.js')
  return {
    ...actual,
    listTrackerProjects: vi.fn(),
    updateTrackerProject: vi.fn(),
    readRawTrackerDoc: vi.fn(),
    runTrackerDocMutation: vi.fn(),
  }
})

import { executeAgentAction } from './runAgentAction'
import { getDb, getAgentUid } from './firebaseAdmin.js'
import { listTrackerProjects, readRawTrackerDoc, runTrackerDocMutation, updateTrackerProject } from './trackerOps.js'
import { normalizeSyncData, type SyncData } from './agentOps'
import type { Project } from '../../src/types'

const mockGetDb = vi.mocked(getDb)
const mockGetAgentUid = vi.mocked(getAgentUid)
const mockListTrackerProjects = vi.mocked(listTrackerProjects)
const mockUpdateTrackerProject = vi.mocked(updateTrackerProject)
const mockReadRawTrackerDoc = vi.mocked(readRawTrackerDoc)
const mockRunTrackerDocMutation = vi.mocked(runTrackerDocMutation)

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

/** Throws if `value` contains an explicit `undefined` anywhere — what a real Firestore write would reject on. */
function assertNoUndefined(value: unknown, path = '<root>'): void {
  if (value === undefined) throw new Error(`undefined at ${path}`)
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoUndefined(v, `${path}[${i}]`))
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) assertNoUndefined(v, `${path}.${k}`)
  }
}

type Row = Record<string, unknown>

/**
 * Minimal in-memory Firestore double, generic enough for the agent write path *and*
 * everything `changeLog.ts`/`deepBlock.ts` touch: nested subcollections
 * (`users/{uid}/changes`, `.../deepBlockLog`, `.../meta`), auto-id docs, `where`/`orderBy`/
 * `limit`/`count`, batched writes, and transactions. Not a real Firestore (e.g. no actual
 * atomicity, no index requirements) — just enough behavior for these unit tests.
 */
function makeFakeFirestore(seed: Record<string, Row> = {}) {
  const store = new Map<string, Row>(Object.entries(seed))
  let autoId = 0

  function isDirectChild(basePath: string, docPath: string): boolean {
    return docPath.startsWith(`${basePath}/`) && !docPath.slice(basePath.length + 1).includes('/')
  }

  function makeDocRef(path: string) {
    return {
      path,
      id: path.split('/').pop(),
      get: async () => ({ exists: store.has(path), data: () => store.get(path), id: path.split('/').pop() }),
      set: (data: Row) => {
        store.set(path, data)
      },
      collection: (name: string) => makeCollectionRef(`${path}/${name}`),
    } as never
  }

  function makeCollectionRef(
    basePath: string,
    filters: Array<(d: Row) => boolean> = [],
    order?: { field: string; dir: 'asc' | 'desc' },
    limitN?: number,
    cursorAfterId?: string,
  ) {
    function matching(): Array<[string, Row]> {
      let entries = [...store.entries()].filter(([p]) => isDirectChild(basePath, p))
      for (const f of filters) entries = entries.filter(([, d]) => f(d))
      if (order) {
        entries = [...entries].sort((a, b) => {
          const av = a[1][order.field] as string
          const bv = b[1][order.field] as string
          const cmp = av < bv ? -1 : av > bv ? 1 : 0
          return order.dir === 'desc' ? -cmp : cmp
        })
      }
      if (cursorAfterId !== undefined) {
        const idx = entries.findIndex(([p]) => p.split('/').pop() === cursorAfterId)
        entries = idx === -1 ? [] : entries.slice(idx + 1)
      }
      if (limitN !== undefined) entries = entries.slice(0, limitN)
      return entries
    }

    return {
      doc: (id?: string) => makeDocRef(`${basePath}/${id ?? `auto${++autoId}`}`),
      where: (field: string, op: '==' | '<' | '>=', value: unknown) =>
        makeCollectionRef(
          basePath,
          [
            ...filters,
            (d: Row) => {
              const v = d[field] as string
              if (op === '==') return v === value
              if (op === '<') return v < (value as string)
              return v >= (value as string)
            },
          ],
          order,
          limitN,
          cursorAfterId,
        ),
      orderBy: (field: string, dir: 'asc' | 'desc' = 'asc') => makeCollectionRef(basePath, filters, { field, dir }, limitN, cursorAfterId),
      limit: (n: number) => makeCollectionRef(basePath, filters, order, n, cursorAfterId),
      startAfter: (doc: { id: string }) => makeCollectionRef(basePath, filters, order, limitN, doc.id),
      get: async () => ({ docs: matching().map(([p, d]) => ({ id: p.split('/').pop()!, data: () => d, ref: makeDocRef(p) })) }),
      count: () => ({ get: async () => ({ data: () => ({ count: matching().length }) }) }),
    } as never
  }

  const updates: Row[] = []

  const db = {
    collection: (name: string) => makeCollectionRef(name),
    batch: () => {
      const ops: Array<() => void> = []
      return {
        set: (ref: { path: string }, data: Row) => {
          ops.push(() => store.set(ref.path, data))
        },
        delete: (ref: { path: string }) => {
          ops.push(() => store.delete(ref.path))
        },
        commit: async () => {
          ops.forEach(op => op())
        },
      }
    },
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const tx = {
        get: (ref: { path: string }) => Promise.resolve({ exists: store.has(ref.path), data: () => store.get(ref.path) }),
        set: (ref: { path: string }, data: Row) => store.set(ref.path, data),
        update: (ref: { path: string }, data: Row) => {
          updates.push(data)
          store.set(ref.path, { ...(store.get(ref.path) ?? {}), ...data })
        },
      }
      return fn(tx)
    },
  }
  return { db, store, updates }
}

/** Seeds a fake Firestore with just the one `users/{uid}` doc, matching the old single-doc test double's shape. */
function makeFakeDb(data: SyncData | undefined) {
  return makeFakeFirestore(data !== undefined ? { 'users/uid1': data as unknown as Row } : {})
}

function changeEntries(store: Map<string, Row>): Row[] {
  return [...store.entries()].filter(([p]) => p.startsWith('users/uid1/changes/')).map(([, d]) => d)
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

  it('logs an agent-side change entry with no undefined values when it applies a change', async () => {
    const data = baseData({ projects: [project({ id: 'p1', status: 'backlog', trackerProjectId: 't1' })] })
    const { db, store } = makeFakeDb(data)
    mockGetDb.mockReturnValue(db as never)
    mockListTrackerProjects.mockResolvedValue({
      workspaceId: 'ws1',
      projects: [{ id: 't1', title: 'X', status: 'in_progress', subtasks: [], assigneeIds: [], assignees: [] }],
    })

    await executeAgentAction('sync_tracker_status', { dryRun: false })
    // The Vandaag-side status change logs as side 'agent'; the tracker project being seen
    // for the first time (no prior snapshot) separately logs as side 'tracker' drift —
    // both are expected, so filter to the one this test is about.
    const agentEntries = changeEntries(store).filter(e => e.side === 'agent')
    expect(agentEntries).toHaveLength(1)
    assertNoUndefined(agentEntries[0])
    expect(agentEntries[0]).toMatchObject({ side: 'agent', entity: 'project', id: 'p1', action: 'sync_tracker_status' })
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

describe('change log', () => {
  it('logs add_task as a single agent-side entry with only the set fields, no undefined values', async () => {
    const data = baseData({ projects: [project({ id: 'p1' })] })
    const { db, store } = makeFakeDb(data)
    mockGetDb.mockReturnValue(db as never)

    await executeAgentAction('add_task', { title: 'New task', projectId: 'p1' })

    const entries = changeEntries(store)
    expect(entries).toHaveLength(1)
    assertNoUndefined(entries[0])
    expect(entries[0].side).toBe('agent')
    expect(entries[0].entity).toBe('task')
    expect(entries[0].action).toBe('add_task')
    expect(entries[0].before).toBeUndefined()
    expect((entries[0].after as Record<string, unknown>).title).toBe('New task')
  })

  it('logs update_task with only the fields that actually changed in before/after', async () => {
    const data = baseData({
      projects: [project({ id: 'p1', tasks: [{ id: 't1', title: 'Old', status: 'backlog', isRecurring: false, isUncomfortable: false, createdAt: '2026-01-01T00:00:00.000Z', projectId: 'p1' }] })],
    })
    const { db, store } = makeFakeDb(data)
    mockGetDb.mockReturnValue(db as never)

    await executeAgentAction('update_task', { taskId: 't1', title: 'New' })

    const entries = changeEntries(store)
    expect(entries).toHaveLength(1)
    assertNoUndefined(entries[0])
    expect(entries[0].before).toEqual({ title: 'Old' })
    expect(entries[0].after).toEqual({ title: 'New' })
  })

  it('logs add_project and update_project entity as project', async () => {
    const { db, store } = makeFakeDb(baseData())
    mockGetDb.mockReturnValue(db as never)

    await executeAgentAction('add_project', { title: 'New project' })
    const entries = changeEntries(store)
    expect(entries).toHaveLength(1)
    assertNoUndefined(entries[0])
    expect(entries[0]).toMatchObject({ side: 'agent', entity: 'project', action: 'add_project' })
  })

  it('list_changes returns newest-first and respects limit', async () => {
    const { db } = makeFakeDb(baseData({ projects: [project({ id: 'p1' })] }))
    mockGetDb.mockReturnValue(db as never)

    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
      await executeAgentAction('add_task', { title: 'First', projectId: 'p1' })
      vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'))
      await executeAgentAction('add_task', { title: 'Second', projectId: 'p1' })
    } finally {
      vi.useRealTimers()
    }

    const result = (await executeAgentAction('list_changes', { limit: 1 })) as Array<{ action: string }>
    expect(result).toHaveLength(1)
    expect((result[0] as unknown as { after: { title: string } }).after.title).toBe('Second')
  })

  it('rejects an invalid list_changes side filter with a 400 AgentOpError (not a generic 500)', async () => {
    const { db } = makeFakeDb(baseData())
    mockGetDb.mockReturnValue(db as never)
    await expect(executeAgentAction('list_changes', { side: 'bogus' })).rejects.toMatchObject({ status: 400 })
  })
})

describe('complete_deep_block', () => {
  it('completes today\'s deep block, writes a deepBlockLog entry, and logs a change entry with no undefined values', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam' }).format(new Date())
    const data = baseData({
      projects: [project({ id: 'p1', category: 'marketing' })],
      dailyPlan: {
        date: today,
        deepBlock: { projectId: 'p1' },
        shortTasks: [],
        shortProjects: [],
        maintenanceTasks: [],
        maintenanceProjects: [],
        meetings: [],
        isComplete: false,
      },
    })
    const { db, store } = makeFakeDb(data)
    mockGetDb.mockReturnValue(db as never)

    const result = (await executeAgentAction('complete_deep_block', {})) as { date: string; category: string }
    expect(result.date).toBe(today)
    expect(result.category).toBe('marketing')

    const logDoc = store.get(`users/uid1/deepBlockLog/${today}`)
    expect(logDoc).toBeDefined()
    assertNoUndefined(logDoc)

    const entries = changeEntries(store)
    expect(entries).toHaveLength(1)
    assertNoUndefined(entries[0])
    expect(entries[0]).toMatchObject({ side: 'agent', entity: 'deepBlock', action: 'complete_deep_block' })
  })
})

describe('deep_block_stats', () => {
  it('merges deepBlockLog entries with ones derived from planHistory and the live dailyPlan', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam' }).format(new Date())
    const data = baseData({
      projects: [project({ id: 'p1', title: 'Today project', category: 'marketing' })],
      dailyPlan: {
        date: today,
        deepBlock: { projectId: '', completedProjectTitle: 'Today project', completedAt: `${today}T09:00:00.000Z` },
        shortTasks: [],
        shortProjects: [],
        maintenanceTasks: [],
        maintenanceProjects: [],
        meetings: [],
        isComplete: false,
      },
      planHistory: {
        '2020-01-06': {
          date: '2020-01-06',
          deepBlock: { projectId: '', completedProjectTitle: 'Unknown project', completedAt: '2020-01-06T09:00:00.000Z' },
          shortTasks: [],
          shortProjects: [],
          maintenanceTasks: [],
          maintenanceProjects: [],
          meetings: [],
          isComplete: true,
        },
      },
    })
    const { db, store } = makeFakeDb(data)
    // One explicit deepBlockLog entry, on a date planHistory does NOT cover — this just
    // proves the two sources are unioned, not that one wins (that's covered at the pure-fn
    // level in deepBlock.test.ts).
    store.set('users/uid1/deepBlockLog/2020-01-13', { date: '2020-01-13', category: 'other', completedAt: '2020-01-13T09:00:00.000Z' })
    mockGetDb.mockReturnValue(db as never)

    const result = (await executeAgentAction('deep_block_stats', { weeks: 1 })) as { total: number; byCategory: Record<string, number> }
    // Only `today`'s derived entry falls in the default 1-week window ending today.
    expect(result.total).toBe(1)
    expect(result.byCategory).toEqual({ marketing: 1, other: 0 })
  })

  it('throws 404 when the user document does not exist', async () => {
    const { db } = makeFakeDb(undefined)
    mockGetDb.mockReturnValue(db as never)
    await expect(executeAgentAction('deep_block_stats', {})).rejects.toMatchObject({ status: 404 })
  })
})

/** Wires the mocked `runTrackerDocMutation` to actually run `mutate` against a fixed in-memory tracker doc (discarding the "write", like the real transactional helper would persist it) — enough to exercise runAgentAction.ts's own orchestration without touching Firestore. */
function stubTrackerDocMutation(trackerDoc: { projects: unknown[] }) {
  mockRunTrackerDocMutation.mockImplementation(async mutate => {
    const { result } = mutate(trackerDoc)
    return result
  })
}

describe('best-effort tracker mirror on task writes', () => {
  it('add_task on a linked project creates a tracker subtask and reports tracker: {updated: true}', async () => {
    const data = baseData({ projects: [project({ id: 'p1', trackerProjectId: 't1' })] })
    const { db, store } = makeFakeDb(data)
    mockGetDb.mockReturnValue(db as never)
    stubTrackerDocMutation({ projects: [{ id: 't1', title: 'T1', status: 'in_progress', subtasks: [] }] })

    const result = (await executeAgentAction('add_task', { title: 'New task', projectId: 'p1' })) as { tracker?: TaskTrackerOutcomeShape; title: string }
    expect(result.title).toBe('New task')
    expect(result.tracker).toEqual({ updated: true })

    const entries = changeEntries(store)
    const mirrorEntry = entries.find(e => (e.action as string).startsWith('task_tracker_mirror'))
    expect(mirrorEntry).toBeDefined()
    assertNoUndefined(mirrorEntry)
    expect(mirrorEntry).toMatchObject({ side: 'agent', entity: 'subtask', action: 'task_tracker_mirror:create_subtask' })
  })

  it('add_task on an unlinked project leaves the result completely untouched (no tracker field)', async () => {
    const data = baseData({ projects: [project({ id: 'p1' })] })
    const { db } = makeFakeDb(data)
    mockGetDb.mockReturnValue(db as never)

    const result = (await executeAgentAction('add_task', { title: 'New task', projectId: 'p1' })) as { tracker?: unknown }
    expect(result.tracker).toBeUndefined()
    expect(mockRunTrackerDocMutation).not.toHaveBeenCalled()
  })

  it('complete_task on a linked project pushes done:true to the matching subtask', async () => {
    const data = baseData({
      projects: [project({
        id: 'p1',
        trackerProjectId: 't1',
        tasks: [{ id: 'task-1', title: 'Do it', status: 'backlog', isRecurring: false, isUncomfortable: false, createdAt: '2026-01-01T00:00:00.000Z', projectId: 'p1' }],
      })],
    })
    const { db, store } = makeFakeDb(data)
    mockGetDb.mockReturnValue(db as never)
    stubTrackerDocMutation({ projects: [{ id: 't1', title: 'T1', status: 'in_progress', subtasks: [{ id: 's1', title: 'Do it', done: false, vandaagTaskId: 'task-1' }] }] })

    const result = (await executeAgentAction('complete_task', { taskId: 'task-1' })) as { tracker?: TaskTrackerOutcomeShape; status: string }
    expect(result.status).toBe('done')
    expect(result.tracker).toEqual({ updated: true })

    const entries = changeEntries(store)
    const mirrorEntry = entries.find(e => (e.action as string).startsWith('task_tracker_mirror'))
    assertNoUndefined(mirrorEntry)
    expect(mirrorEntry).toMatchObject({ action: 'task_tracker_mirror:push_to_tracker', after: { done: true } })
  })

  it('drop_task on a linked project removes the matching subtask', async () => {
    const data = baseData({
      projects: [project({
        id: 'p1',
        trackerProjectId: 't1',
        tasks: [{ id: 'task-1', title: 'Do it', status: 'backlog', isRecurring: false, isUncomfortable: false, createdAt: '2026-01-01T00:00:00.000Z', projectId: 'p1' }],
      })],
    })
    const { db } = makeFakeDb(data)
    mockGetDb.mockReturnValue(db as never)
    stubTrackerDocMutation({ projects: [{ id: 't1', title: 'T1', status: 'in_progress', subtasks: [{ id: 's1', title: 'Do it', done: false, vandaagTaskId: 'task-1' }] }] })

    const result = (await executeAgentAction('drop_task', { taskId: 'task-1' })) as { tracker?: TaskTrackerOutcomeShape }
    expect(result.tracker).toEqual({ updated: true })
  })

  it('reports tracker: {error} without throwing when the tracker write rejects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const data = baseData({ projects: [project({ id: 'p1', trackerProjectId: 't1' })] })
    const { db } = makeFakeDb(data)
    mockGetDb.mockReturnValue(db as never)
    mockRunTrackerDocMutation.mockRejectedValue(new Error('tracker is on fire'))

    const result = (await executeAgentAction('add_task', { title: 'New task', projectId: 'p1' })) as { tracker?: TaskTrackerOutcomeShape }
    expect(result.tracker).toEqual({ error: 'Failed to sync to the tracker' })
  })
})

type TaskTrackerOutcomeShape = { updated: true } | { skipped: string } | { error: string }

describe('sync_tracker_tasks', () => {
  it('dry run reports planned changes without writing to Vandaag or the tracker', async () => {
    const data = baseData({
      projects: [project({
        id: 'p1',
        trackerProjectId: 't1',
        tasks: [{ id: 'task-1', title: 'Unsynced', status: 'backlog', isRecurring: false, isUncomfortable: false, createdAt: '2026-01-01T00:00:00.000Z', projectId: 'p1' }],
      })],
    })
    const { db, updates, store } = makeFakeDb(data)
    mockGetDb.mockReturnValue(db as never)
    mockReadRawTrackerDoc.mockResolvedValue({ workspaceId: 'ws1', doc: { projects: [{ id: 't1', title: 'T1', status: 'in_progress', subtasks: [] }] } })

    const result = (await executeAgentAction('sync_tracker_tasks', {})) as { dryRun: boolean; changes: unknown[]; tracker?: unknown }
    expect(result.dryRun).toBe(true)
    expect(result.changes).toHaveLength(1)
    expect(result.tracker).toBeUndefined()
    expect(updates).toHaveLength(0)
    expect(mockRunTrackerDocMutation).not.toHaveBeenCalled()
    expect(changeEntries(store)).toHaveLength(0)
  })

  it('applies changes when dryRun is false: writes the Vandaag side, writes the tracker side, logs with no undefined values', async () => {
    const data = baseData({
      projects: [project({
        id: 'p1',
        trackerProjectId: 't1',
        tasks: [{ id: 'task-1', title: 'Unsynced', status: 'backlog', isRecurring: false, isUncomfortable: false, createdAt: '2026-01-01T00:00:00.000Z', projectId: 'p1' }],
      })],
    })
    const { db, updates, store } = makeFakeDb(data)
    mockGetDb.mockReturnValue(db as never)
    mockReadRawTrackerDoc.mockResolvedValue({ workspaceId: 'ws1', doc: { projects: [{ id: 't1', title: 'T1', status: 'in_progress', subtasks: [] }] } })
    stubTrackerDocMutation({ projects: [{ id: 't1', title: 'T1', status: 'in_progress', subtasks: [] }] })

    const result = (await executeAgentAction('sync_tracker_tasks', { dryRun: false })) as { dryRun: boolean; changes: unknown[]; tracker?: TaskTrackerOutcomeShape }
    expect(result.dryRun).toBe(false)
    expect(result.tracker).toEqual({ updated: true })
    expect(updates).toHaveLength(0) // this plan has no vandaag-side patch (only a tracker-side create)

    const entries = changeEntries(store)
    expect(entries.length).toBeGreaterThan(0)
    entries.forEach(e => assertNoUndefined(e))
    expect(entries[0]).toMatchObject({ side: 'agent', entity: 'subtask', action: 'sync_tracker_tasks:create_subtask' })
  })

  it('importUnlinked creates a Vandaag task and writes it with no undefined values', async () => {
    const data = baseData({ projects: [project({ id: 'p1', trackerProjectId: 't1' })] })
    const { db, store } = makeFakeDb(data)
    mockGetDb.mockReturnValue(db as never)
    mockReadRawTrackerDoc.mockResolvedValue({
      workspaceId: 'ws1',
      doc: { projects: [{ id: 't1', title: 'T1', status: 'in_progress', subtasks: [{ id: 's1', title: 'From tracker', done: false }] }] },
    })
    stubTrackerDocMutation({ projects: [{ id: 't1', title: 'T1', status: 'in_progress', subtasks: [{ id: 's1', title: 'From tracker', done: false }] }] })

    const result = (await executeAgentAction('sync_tracker_tasks', { dryRun: false, importUnlinked: true })) as { importedTasks: Array<{ title: string }> }
    expect(result.importedTasks).toHaveLength(1)
    expect(result.importedTasks[0].title).toBe('From tracker')

    const written = store.get('users/uid1') as { projects: Array<{ tasks: unknown[] }> }
    assertNoUndefined(written.projects[0].tasks)
  })
})
