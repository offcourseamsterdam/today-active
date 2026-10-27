import { describe, it, expect } from 'vitest'
import { deepEqual, mergeField, mergeObjectFields, mergeEntityArray, mergeSyncData } from './syncMerge'
import type { SyncData } from './firestore'
import type { Project, Task, DailyPlan } from '../types'

function task(overrides: Partial<Task> & { id: string; title: string }): Task {
  return {
    status: 'backlog',
    isRecurring: false,
    isUncomfortable: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

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

function emptySyncData(overrides: Partial<SyncData> = {}): SyncData {
  return {
    projects: [],
    orphanTasks: [],
    recurringTasks: [],
    meetings: [],
    recurringMeetings: [],
    settings: { inProgressLimit: 5, planningTime: 'evening', contexts: [], inProgressLimitChangeLog: [] },
    dailyPlan: null,
    tomorrowPlan: null,
    planHistory: {},
    weekSlots: {},
    goals: [],
    personalRules: [],
    writeAway: [],
    syncedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('deepEqual', () => {
  it('is order-independent for object keys', () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
  })

  it('detects array differences', () => {
    expect(deepEqual([1, 2, 3], [1, 2])).toBe(false)
    expect(deepEqual([1, 2], [1, 2])).toBe(true)
  })

  it('handles null', () => {
    expect(deepEqual(null, null)).toBe(true)
    expect(deepEqual(null, {})).toBe(false)
  })

  it('treats undefined, null, and a missing key as equivalent', () => {
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(true)
    expect(deepEqual({ a: 1 }, { a: 1, b: null })).toBe(true)
    expect(deepEqual({ a: 1, b: undefined }, { a: 1, b: null })).toBe(true)
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true)
  })

  it('still detects a real difference alongside nullish fields', () => {
    expect(deepEqual({ a: 1, b: null }, { a: 2, b: undefined })).toBe(false)
    expect(deepEqual({ a: 1, b: null }, { a: 1, b: 'set' })).toBe(false)
  })
})

describe('mergeField', () => {
  it('keeps the value when both sides agree', () => {
    expect(mergeField('base', 'same', 'same')).toBe('same')
  })

  it('takes remote when only remote changed', () => {
    expect(mergeField('base', 'base', 'remote-changed')).toBe('remote-changed')
  })

  it('takes local when only local changed', () => {
    expect(mergeField('base', 'local-changed', 'base')).toBe('local-changed')
  })

  it('local wins when both changed', () => {
    expect(mergeField('base', 'local-changed', 'remote-changed')).toBe('local-changed')
  })
})

describe('mergeEntityArray', () => {
  it('keeps entries added on either side', () => {
    const base = [task({ id: 't1', title: 'shared' })]
    const local = [task({ id: 't1', title: 'shared' }), task({ id: 'local-only', title: 'added locally' })]
    const remote = [task({ id: 't1', title: 'shared' }), task({ id: 'remote-only', title: 'added remotely' })]
    const result = mergeEntityArray(base, local, remote)
    expect(result.map(t => t.id).sort()).toEqual(['local-only', 'remote-only', 't1'])
  })

  it('honors a remote-only deletion when local left the entity untouched', () => {
    const base = [task({ id: 't1', title: 'x' })]
    const local = [task({ id: 't1', title: 'x' })] // untouched
    const remote: Task[] = [] // deleted remotely
    expect(mergeEntityArray(base, local, remote)).toEqual([])
  })

  it('resurrects an entity that was edited locally while deleted remotely (local wins)', () => {
    const base = [task({ id: 't1', title: 'x' })]
    const local = [task({ id: 't1', title: 'edited' })]
    const remote: Task[] = []
    const result = mergeEntityArray(base, local, remote)
    expect(result).toEqual([task({ id: 't1', title: 'edited' })])
  })

  it('honors a local-only deletion even when remote also edited the entity (local wins)', () => {
    const base = [task({ id: 't1', title: 'x' })]
    const local: Task[] = []
    const remote = [task({ id: 't1', title: 'remote-edited' })]
    expect(mergeEntityArray(base, local, remote)).toEqual([])
  })

  it('uses mergeOne to resolve a both-sides-changed conflict', () => {
    const base = [task({ id: 't1', title: 'x', nextAction: 'a' })]
    const local = [task({ id: 't1', title: 'local-title', nextAction: 'a' })]
    const remote = [task({ id: 't1', title: 'x', nextAction: 'remote-action' })]
    const result = mergeEntityArray(base, local, remote, (_b, l) => l)
    expect(result).toEqual(local)
  })
})

describe('mergeObjectFields', () => {
  it('merges nested id-arrays (e.g. subtasks) by id instead of replacing wholesale', () => {
    const base = { id: 't1', title: 'x', subtasks: [{ id: 's1', title: 'sub', done: false }] }
    const local = {
      id: 't1',
      title: 'x',
      subtasks: [{ id: 's1', title: 'sub', done: false }, { id: 's-local', title: 'local sub', done: false }],
    }
    const remote = { id: 't1', title: 'x', subtasks: [{ id: 's1', title: 'sub', done: true }] }
    const merged = mergeObjectFields(base, local, remote)
    expect(merged.subtasks.map(s => s.id).sort()).toEqual(['s-local', 's1'])
    expect(merged.subtasks.find(s => s.id === 's1')!.done).toBe(true)
  })

  it('falls back to mergeField for non-id arrays', () => {
    const merged = mergeObjectFields({ tags: ['a'] }, { tags: ['a', 'b'] }, { tags: ['a'] })
    expect(merged.tags).toEqual(['a', 'b']) // only local changed -> local wins
  })

  it('resolves each key independently so edits to different fields on each side both survive', () => {
    const base = { id: 't1', title: 'Old', status: 'backlog' }
    const local = { id: 't1', title: 'New title (local edit)', status: 'backlog' }
    const remote = { id: 't1', title: 'Old', status: 'done' }
    const merged = mergeObjectFields(base, local, remote)
    expect(merged.title).toBe('New title (local edit)')
    expect(merged.status).toBe('done')
  })
})

describe('mergeSyncData', () => {
  it('REGRESSION: an agent-API change survives even though the Firestore copies use null where local has a missing/undefined key', () => {
    // base/remote as they'd actually look coming back from Firestore: deepClean()
    // turns every unset optional field into an explicit `null` before writing.
    const baseTask = {
      id: 't1',
      title: 'Task',
      status: 'backlog',
      isRecurring: false,
      isUncomfortable: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      nextAction: null,
      kanbanColumn: null,
      taskType: null,
      completedAt: null,
    } as unknown as Task
    // local: the in-memory store never sets unused optional fields at all — no
    // keys, not even `undefined` — and this tab hasn't touched the task.
    const localTask = task({ id: 't1', title: 'Task' })
    // remote: the agent API completed the task (stripUndefined omits fields that
    // were never set, so nextAction/kanbanColumn/taskType stay absent there too).
    const remoteTask = { ...baseTask, status: 'done', completedAt: '2026-02-01T00:00:00.000Z' } as unknown as Task

    const merged = mergeSyncData(
      emptySyncData({ orphanTasks: [baseTask] }),
      emptySyncData({ orphanTasks: [localTask] }),
      emptySyncData({ orphanTasks: [remoteTask] }),
    )

    expect(merged.orphanTasks[0].status).toBe('done')
    expect(merged.orphanTasks[0].completedAt).toBe('2026-02-01T00:00:00.000Z')
  })

  it('a local title edit and a remote status change on the same task both survive (per-key merge)', () => {
    const baseTask = task({ id: 't1', title: 'Old title' })
    const localTask = { ...baseTask, title: 'New title (local edit)' }
    const remoteTask = { ...baseTask, status: 'done' as const, completedAt: '2026-02-01T00:00:00.000Z' }

    const merged = mergeSyncData(
      emptySyncData({ orphanTasks: [baseTask] }),
      emptySyncData({ orphanTasks: [localTask] }),
      emptySyncData({ orphanTasks: [remoteTask] }),
    )

    expect(merged.orphanTasks[0].title).toBe('New title (local edit)')
    expect(merged.orphanTasks[0].status).toBe('done')
    expect(merged.orphanTasks[0].completedAt).toBe('2026-02-01T00:00:00.000Z')
  })

  it('REGRESSION: folding a save result back into the store (useFirestoreSync\'s merge-with-newer-local case) keeps a remote-added task and a newer local edit both', () => {
    // Mirrors what useFirestoreSync does when a local edit lands while a merged
    // save is in flight: `sent` is the snapshot that was actually saved, `written`
    // is saveUserDataGuarded's merge result (which pulled in an agent-added task),
    // and `current` is the store by the time the save resolves (it has a newer
    // edit the save never saw). mergeSyncData(sent, current, written) — sent as
    // base, current store as local, written as remote — must keep both.
    const existingTask = task({ id: 't-existing', title: 'Existing task' })
    const sent = emptySyncData({ orphanTasks: [existingTask] })
    const current = emptySyncData({
      orphanTasks: [{ ...existingTask, title: 'Existing task (edited during save)' }],
    })
    const agentAddedTask = task({ id: 't-agent', title: 'Agent added this' })
    const written = emptySyncData({ orphanTasks: [existingTask, agentAddedTask] })

    const folded = mergeSyncData(sent, current, written)

    const byId = (id: string) => folded.orphanTasks.find(t => t.id === id)
    expect(byId('t-agent')).toBeTruthy() // remote (agent) addition survives
    expect(byId('t-existing')!.title).toBe('Existing task (edited during save)') // newer local edit survives
  })
})

describe('mergeSyncData (marketingCode/marketingPeriod survive — agent-added project fields)', () => {
  // `mergeProjectEntity` (syncMerge.ts) merges a project's fields generically by whatever
  // keys are actually present on the object — there's no fixed field whitelist — so a field
  // this test suite (or any client build) doesn't explicitly know about still merges
  // correctly as long as it round-trips through Firestore like any other project field.
  it('keeps a marketingCode added remotely (e.g. by the agent) when local never touched the project', () => {
    const base = emptySyncData({ projects: [project({ id: 'p1' })] })
    const local = emptySyncData({ projects: [project({ id: 'p1' })] })
    const remote = emptySyncData({ projects: [project({ id: 'p1', marketingCode: 'SPRING26' })] })

    const merged = mergeSyncData(base, local, remote)
    expect(merged.projects[0].marketingCode).toBe('SPRING26')
  })

  it('keeps a marketingPeriod set locally alongside an unrelated remote status change (per-key merge)', () => {
    const base = emptySyncData({ projects: [project({ id: 'p1', status: 'backlog' })] })
    const local = emptySyncData({
      projects: [project({ id: 'p1', status: 'backlog', marketingPeriod: { from: '2026-03-01', to: '2026-03-31' } })],
    })
    const remote = emptySyncData({ projects: [project({ id: 'p1', status: 'in_progress' })] })

    const merged = mergeSyncData(base, local, remote)
    expect(merged.projects[0].marketingPeriod).toEqual({ from: '2026-03-01', to: '2026-03-31' })
    expect(merged.projects[0].status).toBe('in_progress') // the unrelated remote change survives too
  })

  it('local wins when both sides changed marketingCode since base', () => {
    const base = emptySyncData({ projects: [project({ id: 'p1', marketingCode: 'OLD' })] })
    const local = emptySyncData({ projects: [project({ id: 'p1', marketingCode: 'LOCAL' })] })
    const remote = emptySyncData({ projects: [project({ id: 'p1', marketingCode: 'REMOTE' })] })

    const merged = mergeSyncData(base, local, remote)
    expect(merged.projects[0].marketingCode).toBe('LOCAL')
  })

  it('a remotely cleared marketingCode (agent set it to null, deepClean-persisted) is honored when local never touched it', () => {
    const base = emptySyncData({ projects: [project({ id: 'p1', marketingCode: 'OLD' })] })
    const local = emptySyncData({ projects: [project({ id: 'p1', marketingCode: 'OLD' })] })
    // deepClean() turns `undefined` into `null` before writing — so a cleared field comes
    // back from Firestore as `null`, not a missing key.
    const remote = emptySyncData({ projects: [{ ...project({ id: 'p1' }), marketingCode: null } as never] })

    const merged = mergeSyncData(base, local, remote)
    expect(merged.projects[0].marketingCode).toBeFalsy()
  })
})

describe('mergeSyncData (entity + plan behavior)', () => {
  it('merges projects including their nested tasks by id', () => {
    const sharedTask = task({ id: 't1', title: 'shared', projectId: 'p1' })
    const base: SyncData = emptySyncData({ projects: [project({ id: 'p1', tasks: [sharedTask] })] })
    const local: SyncData = emptySyncData({
      projects: [project({ id: 'p1', tasks: [sharedTask, task({ id: 't-local', title: 'local new', projectId: 'p1' })] })],
    })
    const remote: SyncData = emptySyncData({
      projects: [project({ id: 'p1', tasks: [{ ...sharedTask, status: 'done', completedAt: '2026-02-01T00:00:00.000Z' }] })],
    })
    const merged = mergeSyncData(base, local, remote)
    const mergedProject = merged.projects.find(p => p.id === 'p1')!
    const ids = mergedProject.tasks.map(t => t.id).sort()
    expect(ids).toEqual(['t-local', 't1'])
    // remote completed t1 while local left it untouched -> remote's change wins
    expect(mergedProject.tasks.find(t => t.id === 't1')!.status).toBe('done')
  })

  it('unions tomorrowPlan id-lists when both sides changed the plan', () => {
    const base: DailyPlan = {
      date: '2026-10-26',
      deepBlock: { projectId: '' },
      shortTasks: [],
      shortProjects: [],
      maintenanceTasks: [],
      maintenanceProjects: [],
      meetings: [],
      isComplete: false,
    }
    const local: DailyPlan = { ...base, shortTasks: ['local-task'] }
    const remote: DailyPlan = { ...base, shortTasks: ['remote-task'] }
    const merged = mergeSyncData(
      emptySyncData({ tomorrowPlan: base }),
      emptySyncData({ tomorrowPlan: local }),
      emptySyncData({ tomorrowPlan: remote }),
    )
    expect(merged.tomorrowPlan!.shortTasks.sort()).toEqual(['local-task', 'remote-task'])
  })

  it('adopts a remote-only dailyPlan when local never had one', () => {
    const remotePlan: DailyPlan = {
      date: '2026-10-25',
      deepBlock: { projectId: '' },
      shortTasks: ['agent-added'],
      shortProjects: [],
      maintenanceTasks: [],
      maintenanceProjects: [],
      meetings: [],
      isComplete: false,
    }
    const merged = mergeSyncData(emptySyncData(), emptySyncData(), emptySyncData({ dailyPlan: remotePlan }))
    expect(merged.dailyPlan).toEqual(remotePlan)
  })

  it('keeps orphanTasks added independently on both sides', () => {
    const base = emptySyncData()
    const local = emptySyncData({ orphanTasks: [task({ id: 'local-1', title: 'local' })] })
    const remote = emptySyncData({ orphanTasks: [task({ id: 'remote-1', title: 'remote' })] })
    const merged = mergeSyncData(base, local, remote)
    expect(merged.orphanTasks.map(t => t.id).sort()).toEqual(['local-1', 'remote-1'])
  })

  it('preserves a remote-only trackerProjectId (an agent-API set new field) through the merge', () => {
    const base = emptySyncData({ projects: [project({ id: 'p1' })] })
    const local = emptySyncData({ projects: [project({ id: 'p1' })] })
    const remote = emptySyncData({ projects: [project({ id: 'p1', trackerProjectId: 'abcd1234' })] })
    const merged = mergeSyncData(base, local, remote)
    expect(merged.projects.find(p => p.id === 'p1')!.trackerProjectId).toBe('abcd1234')
  })

  it('keeps a local edit to one field alongside a remote-set trackerProjectId on the same project', () => {
    const base = emptySyncData({ projects: [project({ id: 'p1', title: 'Old title' })] })
    const local = emptySyncData({ projects: [project({ id: 'p1', title: 'New title' })] })
    const remote = emptySyncData({ projects: [project({ id: 'p1', title: 'Old title', trackerProjectId: 'abcd1234' })] })
    const merged = mergeSyncData(base, local, remote)
    const mergedProject = merged.projects.find(p => p.id === 'p1')!
    expect(mergedProject.title).toBe('New title')
    expect(mergedProject.trackerProjectId).toBe('abcd1234')
  })
})
