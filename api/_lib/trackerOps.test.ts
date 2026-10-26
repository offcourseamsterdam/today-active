import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getApps, deleteApp } from 'firebase-admin/app'
import { summarizeTrackerProjects, listTrackerProjects, type TrackerDoc } from './trackerOps'
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
