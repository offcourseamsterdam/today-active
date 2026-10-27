import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getApps, deleteApp } from 'firebase-admin/app'
import {
  summarizeTrackerProjects,
  listTrackerProjects,
  applyTrackerProjectUpdate,
  updateTrackerProject,
  type TrackerDoc,
  type RunTrackerProjectUpdate,
} from './trackerOps'
import { AgentOpError } from './agentOps'

const ENV_KEYS = [
  'TRACKER_WORKSPACE_ID',
  'TRACKER_USER_UID',
  'TRACKER_FIREBASE_PROJECT_ID',
  'TRACKER_FIREBASE_SERVICE_ACCOUNT',
  'TRACKER_FIREBASE_CLIENT_EMAIL',
  'TRACKER_FIREBASE_PRIVATE_KEY',
  'FIREBASE_PROJECT_ID',
  'FIRESTORE_EMULATOR_HOST',
] as const

let savedEnv: Record<string, string | undefined> = {}

beforeEach(async () => {
  savedEnv = {}
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
  // listTrackerProjects' default (non-injected) read path lazily initializes real
  // firebase-admin apps — clear them so each test starts from a clean app registry.
  await Promise.all(getApps().map(app => deleteApp(app)))
})

afterEach(async () => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  await Promise.all(getApps().map(app => deleteApp(app)))
})

describe('summarizeTrackerProjects', () => {
  const baseDoc: TrackerDoc = {
    people: [
      { id: 'pe1', name: 'Alice' },
      { id: 'pe2', name: 'Bob' },
    ],
    goals: [{ id: 'g1', title: 'Grow revenue' }],
    frames: [{ id: 'f1', title: 'Q4' }],
    projects: [
      {
        id: 'proj0001',
        title: 'Launch thing',
        status: 'in_progress',
        urgency: 'high',
        domain: 'marketing',
        subtasks: ['Write copy', { title: 'Design banner', done: true }],
        assigneeIds: ['pe1', 'pe2'],
        goalId: 'g1',
        frameId: 'f1',
      },
      {
        id: 'proj0002',
        title: 'Done thing',
        status: 'completed',
        assigneeIds: ['pe1'],
      },
    ],
  }

  it('resolves assignee names and normalizes mixed-shape subtasks', () => {
    const result = summarizeTrackerProjects(baseDoc)
    const proj = result.find(p => p.id === 'proj0001')!
    expect(proj.assignees).toEqual(['Alice', 'Bob'])
    expect(proj.subtasks).toEqual([
      { title: 'Write copy', done: false },
      { title: 'Design banner', done: true },
    ])
    expect(proj.goal).toEqual({ id: 'g1', title: 'Grow revenue' })
    expect(proj.frame).toEqual({ id: 'f1', title: 'Q4' })
  })

  it('includes completed projects by default', () => {
    const result = summarizeTrackerProjects(baseDoc)
    expect(result.map(p => p.id).sort()).toEqual(['proj0001', 'proj0002'])
  })

  it('excludes completed projects when includeCompleted is false', () => {
    const result = summarizeTrackerProjects(baseDoc, { includeCompleted: false })
    expect(result.map(p => p.id)).toEqual(['proj0001'])
  })

  it('filters by a single status string', () => {
    const result = summarizeTrackerProjects(baseDoc, { status: 'completed' })
    expect(result.map(p => p.id)).toEqual(['proj0002'])
  })

  it('filters by an array of statuses', () => {
    const result = summarizeTrackerProjects(baseDoc, { status: ['in_progress', 'paused'] })
    expect(result.map(p => p.id)).toEqual(['proj0001'])
  })

  it('is defensive about a malformed/empty doc', () => {
    expect(summarizeTrackerProjects(undefined)).toEqual([])
    expect(summarizeTrackerProjects({})).toEqual([])
    expect(summarizeTrackerProjects({ projects: 'not-an-array' } as unknown as TrackerDoc)).toEqual([])
  })

  it('skips projects missing an id, and tolerates missing people/subtasks/assigneeIds', () => {
    const doc: TrackerDoc = {
      projects: [
        { title: 'No id' },
        { id: 'proj0003', title: 'Bare project' },
      ],
    }
    const result = summarizeTrackerProjects(doc)
    expect(result.map(p => p.id)).toEqual(['proj0003'])
    expect(result[0]).toMatchObject({ status: 'not_started', subtasks: [], assigneeIds: [], assignees: [] })
  })

  it('falls back to the person id when a person has no name', () => {
    const doc: TrackerDoc = {
      people: [{ id: 'pe1' }],
      projects: [{ id: 'proj0004', title: 'X', assigneeIds: ['pe1'] }],
    }
    const result = summarizeTrackerProjects(doc)
    expect(result[0].assignees).toEqual(['pe1'])
  })
})

describe('listTrackerProjects', () => {
  it('throws a generic "not configured" error when neither TRACKER_WORKSPACE_ID nor TRACKER_USER_UID is set, without reading', async () => {
    const read = vi.fn()
    const readUser = vi.fn()
    await expect(listTrackerProjects({}, read, readUser)).rejects.toThrow(AgentOpError)
    await expect(listTrackerProjects({}, read, readUser)).rejects.toThrow('Tracker is not configured')
    expect(read).not.toHaveBeenCalled()
    expect(readUser).not.toHaveBeenCalled()
  })

  it('reads via the injected function and summarizes the result when configured', async () => {
    process.env.TRACKER_WORKSPACE_ID = 'ws1'
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080' // satisfies hasTrackerAdminCredentials() without real creds
    const read = vi.fn().mockResolvedValue({
      projects: [{ id: 'proj0001', title: 'Thing', status: 'in_progress' }],
    })
    const result = await listTrackerProjects({}, read)
    expect(read).toHaveBeenCalledWith('ws1')
    expect(result).toEqual({
      workspaceId: 'ws1',
      projects: [
        { id: 'proj0001', title: 'Thing', status: 'in_progress', urgency: undefined, domain: undefined, subtasks: [], assigneeIds: [], assignees: [] },
      ],
    })
  })

  it('propagates a missing-doc read as an empty project list', async () => {
    process.env.TRACKER_WORKSPACE_ID = 'ws1'
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080'
    const read = vi.fn().mockResolvedValue(undefined)
    expect(await listTrackerProjects({}, read)).toEqual({ workspaceId: 'ws1', projects: [] })
  })

  it('resolves the workspace via TRACKER_USER_UID when TRACKER_WORKSPACE_ID is unset', async () => {
    process.env.TRACKER_USER_UID = 'user1'
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080'
    const readUser = vi.fn().mockResolvedValue('ws-from-user')
    const read = vi.fn().mockResolvedValue({ projects: [] })
    const result = await listTrackerProjects({}, read, readUser)
    expect(readUser).toHaveBeenCalledWith('user1')
    expect(read).toHaveBeenCalledWith('ws-from-user')
    expect(result.workspaceId).toBe('ws-from-user')
  })

  it('prefers TRACKER_WORKSPACE_ID over TRACKER_USER_UID when both are set', async () => {
    process.env.TRACKER_WORKSPACE_ID = 'ws1'
    process.env.TRACKER_USER_UID = 'user1'
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080'
    const readUser = vi.fn()
    const read = vi.fn().mockResolvedValue({ projects: [] })
    const result = await listTrackerProjects({}, read, readUser)
    expect(readUser).not.toHaveBeenCalled()
    expect(result.workspaceId).toBe('ws1')
  })

  it('throws a generic error when TRACKER_USER_UID resolves to no workspaceId', async () => {
    process.env.TRACKER_USER_UID = 'user1'
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080'
    const readUser = vi.fn().mockResolvedValue(undefined)
    const read = vi.fn()
    await expect(listTrackerProjects({}, read, readUser)).rejects.toThrow('Tracker is not configured')
    expect(read).not.toHaveBeenCalled()
  })

  it('never leaks a malformed TRACKER_FIREBASE_SERVICE_ACCOUNT secret through the error message', async () => {
    const secretSnippet = 'super-secret-value-should-never-appear'
    process.env.TRACKER_WORKSPACE_ID = 'ws1'
    process.env.TRACKER_FIREBASE_PROJECT_ID = 'other-project'
    process.env.FIREBASE_PROJECT_ID = 'main-project' // different, so a second named app is attempted
    process.env.TRACKER_FIREBASE_SERVICE_ACCOUNT = `not valid json ${secretSnippet}`

    // Exercises the real (non-injected) read path, so it actually goes through
    // getTrackerAdminApp() -> createTrackerAdminApp() -> JSON.parse().
    let caught: unknown
    try {
      await listTrackerProjects({})
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(AgentOpError)
    expect((caught as AgentOpError).status).toBe(503)
    expect((caught as AgentOpError).message).toBe('Tracker is not configured')
    expect((caught as AgentOpError).message).not.toContain(secretSnippet)
    expect(JSON.stringify(caught)).not.toContain(secretSnippet)
  })
})

type RawProject = Record<string, unknown>

function findRaw(projects: unknown[], id: string): RawProject {
  return (projects as RawProject[]).find(p => p.id === id)!
}

describe('applyTrackerProjectUpdate', () => {
  const doc: TrackerDoc = {
    dna: { appName: 'Off Course' },
    people: [{ id: 'pe1', name: 'Alice' }],
    projects: [
      { id: 'proj0001', title: 'Launch thing', status: 'not_started', startedAt: null, completedAt: null, assigneeIds: ['pe1'] },
      { id: 'proj0002', title: 'Already going', status: 'in_progress', startedAt: '2026-01-01T00:00:00.000Z', completedAt: null },
      { id: 'proj0003', title: 'Wrapped up', status: 'completed', startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-05T00:00:00.000Z' },
    ],
  }

  it('changes status and sets startedAt when moving to in_progress for the first time', () => {
    const { projects, result } = applyTrackerProjectUpdate(doc, { projectId: 'proj0001', status: 'in_progress' })
    expect(result.previousStatus).toBe('not_started')
    expect(result.project.status).toBe('in_progress')
    const raw = findRaw(projects, 'proj0001')
    expect(raw.status).toBe('in_progress')
    expect(raw.startedAt).toBeTruthy()
  })

  it('does not clobber an existing startedAt when moving to in_progress again (resumeProject semantics)', () => {
    const { projects } = applyTrackerProjectUpdate(doc, { projectId: 'proj0002', status: 'in_progress' })
    const raw = findRaw(projects, 'proj0002')
    expect(raw.startedAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('sets completedAt to now when moving to completed', () => {
    const { projects } = applyTrackerProjectUpdate(doc, { projectId: 'proj0002', status: 'completed' })
    const raw = findRaw(projects, 'proj0002')
    expect(raw.status).toBe('completed')
    expect(raw.completedAt).toBeTruthy()
  })

  it('clears completedAt when moving away from completed', () => {
    const { projects } = applyTrackerProjectUpdate(doc, { projectId: 'proj0003', status: 'paused' })
    const raw = findRaw(projects, 'proj0003')
    expect(raw.status).toBe('paused')
    expect(raw.completedAt).toBeNull()
  })

  it('does not touch startedAt/completedAt when moving to paused', () => {
    const { projects } = applyTrackerProjectUpdate(doc, { projectId: 'proj0002', status: 'paused' })
    const raw = findRaw(projects, 'proj0002')
    expect(raw.status).toBe('paused')
    expect(raw.startedAt).toBe('2026-01-01T00:00:00.000Z')
    expect(raw.completedAt).toBeNull()
  })

  it('updates title and urgency, and returns the project summary', () => {
    const { result } = applyTrackerProjectUpdate(doc, { projectId: 'proj0001', title: ' Renamed ', urgency: 'high' })
    expect(result.project.title).toBe('Renamed')
    expect(result.project.urgency).toBe('high')
    expect(result.project.assignees).toEqual(['Alice'])
  })

  it('accepts a numeric urgency', () => {
    const { result } = applyTrackerProjectUpdate(doc, { projectId: 'proj0001', urgency: 3 })
    expect(result.project.urgency).toBe(3)
  })

  it('throws a 404 for an unknown project id', () => {
    expect(() => applyTrackerProjectUpdate(doc, { projectId: 'nope', status: 'paused' })).toThrow(AgentOpError)
    try {
      applyTrackerProjectUpdate(doc, { projectId: 'nope', status: 'paused' })
    } catch (err) {
      expect((err as AgentOpError).status).toBe(404)
    }
  })

  it('rejects a missing projectId', () => {
    expect(() => applyTrackerProjectUpdate(doc, { status: 'paused' })).toThrow('projectId is required')
  })

  it('rejects when no field to change is given', () => {
    expect(() => applyTrackerProjectUpdate(doc, { projectId: 'proj0001' })).toThrow(
      'At least one of status, title, urgency is required',
    )
  })

  it('rejects an invalid status', () => {
    expect(() => applyTrackerProjectUpdate(doc, { projectId: 'proj0001', status: 'bogus' })).toThrow(AgentOpError)
  })

  it('rejects an empty title', () => {
    expect(() => applyTrackerProjectUpdate(doc, { projectId: 'proj0001', title: '   ' })).toThrow('title must not be empty')
  })

  it('rejects a non-primitive urgency', () => {
    expect(() => applyTrackerProjectUpdate(doc, { projectId: 'proj0001', urgency: { bad: true } })).toThrow(
      'urgency must be a string or number',
    )
  })

  it('leaves other projects and other top-level doc fields untouched', () => {
    const { projects } = applyTrackerProjectUpdate(doc, { projectId: 'proj0001', status: 'in_progress' })
    const originalProjects = doc.projects as RawProject[]
    expect(findRaw(projects, 'proj0002')).toEqual(originalProjects[1])
    expect(findRaw(projects, 'proj0003')).toEqual(originalProjects[2])
    // the function only ever returns `projects` — callers write back nothing else, so
    // `dna`/`people`/etc. on the original doc are never part of what gets written.
    expect(doc.dna).toEqual({ appName: 'Off Course' })
    expect(doc.people).toEqual([{ id: 'pe1', name: 'Alice' }])
  })

  it('preserves unknown fields on the target project', () => {
    const docWithExtra: TrackerDoc = {
      projects: [{ id: 'proj0009', title: 'X', status: 'not_started', someUnknownField: 'keep-me' }],
    }
    const { projects } = applyTrackerProjectUpdate(docWithExtra, { projectId: 'proj0009', status: 'paused' })
    const raw = findRaw(projects, 'proj0009')
    expect(raw.someUnknownField).toBe('keep-me')
  })
})

describe('updateTrackerProject', () => {
  it('throws the generic 503 when not configured, without resolving a workspace or running the update', async () => {
    const readUser = vi.fn()
    const runUpdate = vi.fn()
    await expect(updateTrackerProject({ projectId: 'proj0001', status: 'paused' }, readUser, runUpdate)).rejects.toThrow(
      'Tracker is not configured',
    )
    expect(readUser).not.toHaveBeenCalled()
    expect(runUpdate).not.toHaveBeenCalled()
  })

  it('resolves the workspace and delegates to the injected transaction runner', async () => {
    process.env.TRACKER_WORKSPACE_ID = 'ws1'
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080'
    const readUser = vi.fn()
    const runUpdate: RunTrackerProjectUpdate = vi.fn().mockImplementation(async (workspaceId, mutate) => {
      expect(workspaceId).toBe('ws1')
      return mutate({ projects: [{ id: 'proj0001', title: 'X', status: 'not_started' }] }).result
    })
    const result = await updateTrackerProject({ projectId: 'proj0001', status: 'in_progress' }, readUser, runUpdate)
    expect(result.project.status).toBe('in_progress')
    expect(result.previousStatus).toBe('not_started')
  })
})
