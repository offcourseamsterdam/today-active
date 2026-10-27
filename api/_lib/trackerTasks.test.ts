import { describe, it, expect, vi, afterEach } from 'vitest'
import { planTrackerTaskSync, planSingleTaskMirror, type SingleTaskMirrorInput } from './trackerTasks'
import { AgentOpError } from './agentOps'
import type { Project, Task } from '../../src/types'
import type { TrackerSnapshotDoc } from './changeLog'

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

function trackerDoc(projects: Array<Record<string, unknown>>) {
  return { projects }
}

interface RawTrackerProject {
  id: string
  title: string
  status: string
  subtasks: Array<Record<string, unknown>>
}

function findTP(projects: unknown[], id: string): RawTrackerProject {
  return (projects as RawTrackerProject[]).find(p => p.id === id)!
}

const NOW = '2026-10-27T10:00:00.000Z'

describe('planTrackerTaskSync', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates a subtask for a linked task with no matching subtask', () => {
    const vp = project({ id: 'p1', trackerProjectId: 't1', tasks: [task({ id: 'task-1', title: 'Do thing' })] })
    const plan = planTrackerTaskSync([vp], trackerDoc([{ id: 't1', title: 'T1', status: 'in_progress', subtasks: [] }]), undefined, {}, NOW)

    expect(plan.changes).toHaveLength(1)
    expect(plan.changes[0]).toMatchObject({ action: 'create_subtask', vandaagProjectId: 'p1', trackerProjectId: 't1', taskId: 'task-1' })
    expect(plan.trackerChanged).toBe(true)
    const t1 = findTP(plan.trackerProjects, 't1')
    expect(t1.subtasks).toHaveLength(1)
    expect(t1.subtasks[0]).toMatchObject({ title: 'Do thing', done: false, vandaagTaskId: 'task-1' })
    expect(plan.vandaagPatch).toEqual({})
  })

  it('never duplicates: a task already linked by vandaagTaskId produces no create', () => {
    const vp = project({ id: 'p1', trackerProjectId: 't1', tasks: [task({ id: 'task-1', title: 'Do thing' })] })
    const plan = planTrackerTaskSync(
      [vp],
      trackerDoc([{ id: 't1', title: 'T1', status: 'in_progress', subtasks: [{ id: 's1', title: 'Do thing', done: false, vandaagTaskId: 'task-1' }] }]),
      undefined,
      {},
      NOW,
    )
    expect(plan.changes).toEqual([])
    expect(plan.trackerChanged).toBe(false)
  })

  it('removes the linked subtask when the Vandaag task is dropped', () => {
    const vp = project({ id: 'p1', trackerProjectId: 't1', tasks: [task({ id: 'task-1', title: 'Do thing', status: 'dropped' })] })
    const plan = planTrackerTaskSync(
      [vp],
      trackerDoc([{ id: 't1', title: 'T1', status: 'in_progress', subtasks: [{ id: 's1', title: 'Do thing', done: false, vandaagTaskId: 'task-1' }] }]),
      undefined,
      {},
      NOW,
    )
    expect(plan.changes).toEqual([{ action: 'remove_subtask', vandaagProjectId: 'p1', trackerProjectId: 't1', taskId: 'task-1', subtaskId: 's1', before: { title: 'Do thing', done: false } }])
    const t1 = findTP(plan.trackerProjects, 't1')
    expect(t1.subtasks).toEqual([])
  })

  it('does not create a subtask for a dropped task that was never linked', () => {
    const vp = project({ id: 'p1', trackerProjectId: 't1', tasks: [task({ id: 'task-1', title: 'Do thing', status: 'dropped' })] })
    const plan = planTrackerTaskSync([vp], trackerDoc([{ id: 't1', title: 'T1', status: 'in_progress', subtasks: [] }]), undefined, {}, NOW)
    expect(plan.changes).toEqual([])
  })

  it('moves the subtask when a task moves to a different linked project', () => {
    const vpOld = project({ id: 'p1', trackerProjectId: 't1', tasks: [] })
    const vpNew = project({ id: 'p2', trackerProjectId: 't2', tasks: [task({ id: 'task-1', title: 'Do thing' })] })
    const plan = planTrackerTaskSync(
      [vpOld, vpNew],
      trackerDoc([
        { id: 't1', title: 'T1', status: 'in_progress', subtasks: [{ id: 's1', title: 'Do thing', done: false, vandaagTaskId: 'task-1' }] },
        { id: 't2', title: 'T2', status: 'in_progress', subtasks: [] },
      ]),
      undefined,
      {},
      NOW,
    )
    expect(plan.changes).toHaveLength(1)
    expect(plan.changes[0]).toMatchObject({ action: 'move_subtask', fromTrackerProjectId: 't1', trackerProjectId: 't2', taskId: 'task-1' })
    const t1 = findTP(plan.trackerProjects, 't1')
    const t2 = findTP(plan.trackerProjects, 't2')
    expect(t1.subtasks).toEqual([])
    expect(t2.subtasks).toHaveLength(1)
    expect(t2.subtasks[0].vandaagTaskId).toBe('task-1')
  })

  it('preserves unknown fields on existing subtasks when pushing a Vandaag-side change', () => {
    const vp = project({ id: 'p1', trackerProjectId: 't1', tasks: [task({ id: 'task-1', title: 'New title' })] })
    const plan = planTrackerTaskSync(
      [vp],
      trackerDoc([{ id: 't1', title: 'T1', status: 'in_progress', subtasks: [{ id: 's1', title: 'Old title', done: false, vandaagTaskId: 'task-1', weirdField: 'keep-me' }] }]),
      undefined,
      {},
      NOW,
    )
    const t1 = findTP(plan.trackerProjects, 't1')
    expect(t1.subtasks[0]).toMatchObject({ title: 'New title', weirdField: 'keep-me' })
  })

  describe('conflict resolution via the tracker snapshot', () => {
    function linkedSetup(vandaagTitle: string, vandaagDone: boolean, trackerTitle: string, trackerDone: boolean, snapshot?: { title: string; done: boolean }) {
      const vp = project({ id: 'p1', trackerProjectId: 't1', tasks: [task({ id: 'task-1', title: vandaagTitle, status: vandaagDone ? 'done' : 'backlog' })] })
      const doc = trackerDoc([{ id: 't1', title: 'T1', status: 'in_progress', subtasks: [{ id: 's1', title: trackerTitle, done: trackerDone, vandaagTaskId: 'task-1' }] }])
      const trackerSnapshot: TrackerSnapshotDoc | undefined = snapshot
        ? { projects: [{ id: 't1', title: 'T1', status: 'in_progress', subtasks: [{ id: 's1', title: snapshot.title, done: snapshot.done, vandaagTaskId: 'task-1' }] }] }
        : undefined
      return planTrackerTaskSync([vp], doc, trackerSnapshot, {}, NOW)
    }

    it('tracker wins when only the tracker changed since the snapshot', () => {
      const plan = linkedSetup('Original', false, 'Renamed by tracker', false, { title: 'Original', done: false })
      expect(plan.changes[0].action).toBe('pull_from_tracker')
      expect(plan.vandaagPatch.projects?.[0].tasks[0].title).toBe('Renamed by tracker')
    })

    it('tracker un-completing wins when only the tracker changed (title same, done differs)', () => {
      const plan = linkedSetup('Task', true, 'Task', false, { title: 'Task', done: true })
      expect(plan.changes[0].action).toBe('pull_from_tracker')
      expect(plan.vandaagPatch.projects?.[0].tasks[0].status).toBe('backlog')
    })

    it('vandaag wins when only vandaag changed since the snapshot', () => {
      const plan = linkedSetup('Renamed by vandaag', false, 'Original', false, { title: 'Original', done: false })
      expect(plan.changes[0].action).toBe('push_to_tracker')
      const t1 = findTP(plan.trackerProjects, 't1')
      expect(t1.subtasks[0].title).toBe('Renamed by vandaag')
    })

    it('both changed: title follows vandaag, done is sticky-true', () => {
      const plan = linkedSetup('Vandaag title', true, 'Tracker title', false, { title: 'Original', done: false })
      expect(plan.changes[0].action).toBe('push_to_tracker')
      const t1 = findTP(plan.trackerProjects, 't1')
      expect(t1.subtasks[0]).toMatchObject({ title: 'Vandaag title', done: true })
    })

    it('both changed, tracker done true and vandaag done false: resolves to done on both sides', () => {
      const plan = linkedSetup('Task', false, 'Task', true, { title: 'Other', done: false })
      expect(plan.changes[0].action).toBe('push_to_tracker')
      const t1 = findTP(plan.trackerProjects, 't1')
      expect(t1.subtasks[0].done).toBe(true)
      expect(plan.vandaagPatch.projects?.[0].tasks[0].status).toBe('done')
    })

    it('no snapshot entry yet (first sync) is treated as both-changed', () => {
      const plan = linkedSetup('Vandaag title', false, 'Tracker title', false, undefined)
      expect(plan.changes[0].action).toBe('push_to_tracker')
      const t1 = findTP(plan.trackerProjects, 't1')
      expect(t1.subtasks[0].title).toBe('Vandaag title')
    })

    it('produces no change when title and done already agree, regardless of snapshot', () => {
      const plan = linkedSetup('Same', true, 'Same', true, { title: 'Different', done: false })
      expect(plan.changes).toEqual([])
    })
  })

  describe('unlinked subtasks and importUnlinked', () => {
    it('reports unlinked subtasks without touching them by default', () => {
      const vp = project({ id: 'p1', trackerProjectId: 't1', tasks: [] })
      const plan = planTrackerTaskSync([vp], trackerDoc([{ id: 't1', title: 'T1', status: 'in_progress', subtasks: [{ id: 's1', title: 'Unlinked', done: false }] }]), undefined, {}, NOW)
      expect(plan.unlinkedSubtasks).toEqual([{ trackerProjectId: 't1', subtaskId: 's1', title: 'Unlinked', done: false }])
      expect(plan.importedTasks).toEqual([])
      expect(plan.trackerChanged).toBe(false)
    })

    it('imports unlinked subtasks as new Vandaag tasks and stamps vandaagTaskId when importUnlinked is true', () => {
      const vp = project({ id: 'p1', trackerProjectId: 't1', tasks: [] })
      const plan = planTrackerTaskSync(
        [vp],
        trackerDoc([{ id: 't1', title: 'T1', status: 'in_progress', subtasks: [{ id: 's1', title: 'Unlinked', done: true }] }]),
        undefined,
        { importUnlinked: true },
        NOW,
      )
      expect(plan.unlinkedSubtasks).toEqual([])
      expect(plan.importedTasks).toHaveLength(1)
      expect(plan.importedTasks[0]).toMatchObject({ trackerProjectId: 't1', subtaskId: 's1', vandaagProjectId: 'p1', title: 'Unlinked' })
      const newTaskId = plan.importedTasks[0].taskId
      expect(plan.vandaagPatch.projects?.[0].tasks).toHaveLength(1)
      expect(plan.vandaagPatch.projects?.[0].tasks[0]).toMatchObject({ id: newTaskId, title: 'Unlinked', status: 'done' })
      const t1 = findTP(plan.trackerProjects, 't1')
      expect(t1.subtasks[0].vandaagTaskId).toBe(newTaskId)
    })
  })

  describe('projectIds filter', () => {
    it('restricts planning to the given Vandaag project ids', () => {
      const vp1 = project({ id: 'p1', trackerProjectId: 't1', tasks: [task({ id: 'task-1', title: 'A' })] })
      const vp2 = project({ id: 'p2', trackerProjectId: 't2', tasks: [task({ id: 'task-2', title: 'B' })] })
      const plan = planTrackerTaskSync(
        [vp1, vp2],
        trackerDoc([
          { id: 't1', title: 'T1', status: 'in_progress', subtasks: [] },
          { id: 't2', title: 'T2', status: 'in_progress', subtasks: [] },
        ]),
        undefined,
        { projectIds: ['p1'] },
        NOW,
      )
      expect(plan.changes).toHaveLength(1)
      expect(plan.changes[0].vandaagProjectId).toBe('p1')
    })

    it('rejects a non-array projectIds', () => {
      expect(() => planTrackerTaskSync([], trackerDoc([]), undefined, { projectIds: 'p1' }, NOW)).toThrow(AgentOpError)
    })
  })

  it('ignores Vandaag projects with no trackerProjectId', () => {
    const vp = project({ id: 'p1', tasks: [task({ id: 'task-1', title: 'A' })] })
    const plan = planTrackerTaskSync([vp], trackerDoc([]), undefined, {}, NOW)
    expect(plan.changes).toEqual([])
  })

  it('ignores a project linked to a tracker id that no longer exists (broken link)', () => {
    const vp = project({ id: 'p1', trackerProjectId: 'missing', tasks: [task({ id: 'task-1', title: 'A' })] })
    const plan = planTrackerTaskSync([vp], trackerDoc([{ id: 't1', title: 'T1', status: 'in_progress', subtasks: [] }]), undefined, {}, NOW)
    expect(plan.changes).toEqual([])
  })

  it('leaves untouched tracker projects out of the returned trackerProjects patch (same reference)', () => {
    const vp = project({ id: 'p1', trackerProjectId: 't1', tasks: [] })
    const untouchedRaw = { id: 't2', title: 'T2', status: 'in_progress', subtasks: [{ id: 's9', title: 'Keep', done: false }] }
    const plan = planTrackerTaskSync([vp], trackerDoc([{ id: 't1', title: 'T1', status: 'in_progress', subtasks: [] }, untouchedRaw]), undefined, {}, NOW)
    expect(plan.trackerProjects.find(p => (p as RawTrackerProject).id === 't2')).toBe(untouchedRaw)
  })
})

function mirrorInput(overrides: Partial<SingleTaskMirrorInput> & { taskId: string }): SingleTaskMirrorInput {
  return { title: 'Task', done: false, dropped: false, vandaagProjectId: 'p1', ...overrides }
}

describe('planSingleTaskMirror', () => {
  it('creates a subtask when the task has no link yet and the project is linked', () => {
    const doc = trackerDoc([{ id: 't1', title: 'T1', status: 'in_progress', subtasks: [] }])
    const plan = planSingleTaskMirror(mirrorInput({ taskId: 'task-1', title: 'New task', newTrackerProjectId: 't1' }), doc)
    expect(plan.trackerChanged).toBe(true)
    expect(plan.change).toMatchObject({ action: 'create_subtask', trackerProjectId: 't1', taskId: 'task-1' })
    const t1 = findTP(plan.trackerProjects, 't1')
    expect(t1.subtasks[0]).toMatchObject({ title: 'New task', done: false, vandaagTaskId: 'task-1' })
  })

  it('is a no-op when the project is not linked', () => {
    const plan = planSingleTaskMirror(mirrorInput({ taskId: 'task-1' }), trackerDoc([]))
    expect(plan.trackerChanged).toBe(false)
    expect(plan.change).toBeUndefined()
  })

  it('pushes a title/done change into the existing linked subtask', () => {
    const doc = trackerDoc([{ id: 't1', title: 'T1', status: 'in_progress', subtasks: [{ id: 's1', title: 'Old', done: false, vandaagTaskId: 'task-1', weirdField: 'keep' }] }])
    const plan = planSingleTaskMirror(mirrorInput({ taskId: 'task-1', title: 'New', done: true, newTrackerProjectId: 't1' }), doc)
    expect(plan.change).toMatchObject({ action: 'push_to_tracker', subtaskId: 's1' })
    const t1 = findTP(plan.trackerProjects, 't1')
    expect(t1.subtasks[0]).toMatchObject({ title: 'New', done: true, weirdField: 'keep' })
  })

  it('is a no-op when the linked subtask already matches', () => {
    const doc = trackerDoc([{ id: 't1', title: 'T1', status: 'in_progress', subtasks: [{ id: 's1', title: 'Same', done: false, vandaagTaskId: 'task-1' }] }])
    const plan = planSingleTaskMirror(mirrorInput({ taskId: 'task-1', title: 'Same', done: false, newTrackerProjectId: 't1' }), doc)
    expect(plan.trackerChanged).toBe(false)
  })

  it('removes the subtask when the task is dropped', () => {
    const doc = trackerDoc([{ id: 't1', title: 'T1', status: 'in_progress', subtasks: [{ id: 's1', title: 'Gone', done: false, vandaagTaskId: 'task-1' }] }])
    const plan = planSingleTaskMirror(mirrorInput({ taskId: 'task-1', dropped: true }), doc)
    expect(plan.change).toMatchObject({ action: 'remove_subtask', subtaskId: 's1' })
    const t1 = findTP(plan.trackerProjects, 't1')
    expect(t1.subtasks).toEqual([])
  })

  it('dropping an unlinked task is a no-op', () => {
    const plan = planSingleTaskMirror(mirrorInput({ taskId: 'task-1', dropped: true }), trackerDoc([{ id: 't1', title: 'T1', status: 'in_progress', subtasks: [] }]))
    expect(plan.trackerChanged).toBe(false)
  })

  it('moves the subtask when the task moves to a different linked project', () => {
    const doc = trackerDoc([
      { id: 't1', title: 'T1', status: 'in_progress', subtasks: [{ id: 's1', title: 'Task', done: false, vandaagTaskId: 'task-1' }] },
      { id: 't2', title: 'T2', status: 'in_progress', subtasks: [] },
    ])
    const plan = planSingleTaskMirror(mirrorInput({ taskId: 'task-1', newTrackerProjectId: 't2' }), doc)
    expect(plan.change).toMatchObject({ action: 'move_subtask', fromTrackerProjectId: 't1', trackerProjectId: 't2' })
    const t1 = findTP(plan.trackerProjects, 't1')
    const t2 = findTP(plan.trackerProjects, 't2')
    expect(t1.subtasks).toEqual([])
    expect(t2.subtasks[0].vandaagTaskId).toBe('task-1')
  })

  it('removes the stale link when the task moves to an unlinked project', () => {
    const doc = trackerDoc([{ id: 't1', title: 'T1', status: 'in_progress', subtasks: [{ id: 's1', title: 'Task', done: false, vandaagTaskId: 'task-1' }] }])
    const plan = planSingleTaskMirror(mirrorInput({ taskId: 'task-1', newTrackerProjectId: undefined }), doc)
    expect(plan.change).toMatchObject({ action: 'remove_subtask', trackerProjectId: 't1' })
  })

  it('is a no-op when newTrackerProjectId points at a tracker project that does not exist', () => {
    const plan = planSingleTaskMirror(mirrorInput({ taskId: 'task-1', newTrackerProjectId: 'missing' }), trackerDoc([]))
    expect(plan.trackerChanged).toBe(false)
  })
})
