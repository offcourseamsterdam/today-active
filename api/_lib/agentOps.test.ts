import { describe, it, expect } from 'vitest'
import {
  AgentOpError,
  amsterdamDateString,
  normalizeSyncData,
  listProjects,
  listOrphanTasks,
  listToday,
  listTomorrow,
  addTask,
  updateTask,
  completeTask,
  dropTask,
  addProject,
  renameProject,
  updateProject,
  runAgentOperation,
  isAgentAction,
  type SyncData,
} from './agentOps'
import type { Project, Task, DailyPlan } from '../../src/types'

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
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

function baseData(overrides: Partial<SyncData> = {}): SyncData {
  return normalizeSyncData(overrides)
}

describe('normalizeSyncData', () => {
  it('fills in defaults for a missing/partial doc', () => {
    const data = normalizeSyncData(undefined)
    expect(data.projects).toEqual([])
    expect(data.orphanTasks).toEqual([])
    expect(data.dailyPlan).toBeNull()
    expect(data.settings.inProgressLimit).toBe(5)
  })
})

describe('listProjects', () => {
  it('hides done projects and done/dropped tasks by default', () => {
    const data = baseData({
      projects: [
        project({ id: 'p1', status: 'in_progress', tasks: [task({ id: 't1', title: 'open' }), task({ id: 't2', title: 'done', status: 'done' })] }),
        project({ id: 'p2', status: 'done' }),
      ],
    })
    const result = listProjects(data)
    expect(result.map(p => p.id)).toEqual(['p1'])
    expect(result[0].tasks.map(t => t.id)).toEqual(['t1'])
  })

  it('includes done projects/tasks when includeDone is true', () => {
    const data = baseData({
      projects: [
        project({ id: 'p1', tasks: [task({ id: 't1', title: 'done', status: 'done' })] }),
        project({ id: 'p2', status: 'done' }),
      ],
    })
    const result = listProjects(data, { includeDone: true })
    expect(result.map(p => p.id).sort()).toEqual(['p1', 'p2'])
    expect(result.find(p => p.id === 'p1')!.tasks).toHaveLength(1)
  })
})

describe('listOrphanTasks', () => {
  it('only returns backlog orphan tasks', () => {
    const data = baseData({
      orphanTasks: [
        task({ id: 't1', title: 'open' }),
        task({ id: 't2', title: 'done', status: 'done' }),
      ],
    })
    expect(listOrphanTasks(data).map(t => t.id)).toEqual(['t1'])
  })
})

describe('listToday / listTomorrow', () => {
  it('returns null when there is no plan', () => {
    expect(listToday(baseData())).toBeNull()
    expect(listTomorrow(baseData())).toBeNull()
  })

  it('returns null when the plan date is stale', () => {
    const data = baseData({
      dailyPlan: { date: '2000-01-01', deepBlock: { projectId: '' }, shortTasks: [], shortProjects: [], maintenanceTasks: [], maintenanceProjects: [], meetings: [], isComplete: false },
    })
    expect(listToday(data)).toBeNull()
  })

  it('resolves short/maintenance task ids and the deep block project for today', () => {
    const proj = project({ id: 'deep-proj' })
    const orphan = task({ id: 'orphan-1', title: 'Orphan task' })
    const plan: DailyPlan = {
      date: amsterdamDateString(0),
      deepBlock: { projectId: 'deep-proj', intention: 'focus' },
      shortTasks: ['orphan-1'],
      shortProjects: [],
      maintenanceTasks: [],
      maintenanceProjects: [],
      meetings: [],
      isComplete: false,
    }
    const data = baseData({ projects: [proj], orphanTasks: [orphan], dailyPlan: plan })
    const resolved = listToday(data)
    expect(resolved).not.toBeNull()
    expect(resolved!.deepBlock.project?.id).toBe('deep-proj')
    expect(resolved!.shortTasks).toHaveLength(1)
    expect(resolved!.shortTasks[0].id).toBe('orphan-1')
  })

  it('resolves tomorrow only when the plan date matches tomorrow', () => {
    const plan: DailyPlan = {
      date: amsterdamDateString(1),
      deepBlock: { projectId: '' },
      shortTasks: [],
      shortProjects: [],
      maintenanceTasks: [],
      maintenanceProjects: [],
      meetings: [],
      isComplete: false,
    }
    const data = baseData({ tomorrowPlan: plan })
    expect(listTomorrow(data)).not.toBeNull()
  })
})

describe('addTask', () => {
  it('creates an orphan task when no projectId is given', () => {
    const data = baseData()
    const { patch, result } = addTask(data, { title: '  Buy milk  ' })
    expect(result.title).toBe('Buy milk')
    expect(result.status).toBe('backlog')
    expect(patch.orphanTasks).toHaveLength(1)
    expect(patch.projects).toBeUndefined()
  })

  it('prepends the task onto the target project and bumps updatedAt', () => {
    const data = baseData({ projects: [project({ id: 'p1', updatedAt: '2020-01-01T00:00:00.000Z' })] })
    const { patch, result } = addTask(data, { title: 'New task', projectId: 'p1' })
    expect(result.projectId).toBe('p1')
    const updated = patch.projects!.find(p => p.id === 'p1')!
    expect(updated.tasks[0].title).toBe('New task')
    expect(updated.updatedAt).not.toBe('2020-01-01T00:00:00.000Z')
  })

  it('throws 404 for an unknown projectId', () => {
    const data = baseData()
    expect(() => addTask(data, { title: 'x', projectId: 'missing' })).toThrow(AgentOpError)
  })

  it('throws 400 for an empty title', () => {
    const data = baseData()
    expect(() => addTask(data, { title: '   ' })).toThrow(AgentOpError)
  })

  it('rejects an invalid taskType', () => {
    const data = baseData()
    expect(() => addTask(data, { title: 'x', taskType: 'bogus' })).toThrow(AgentOpError)
  })

  it('addToTomorrow creates a fresh tomorrow plan and appends the id to shortTasks', () => {
    const data = baseData()
    const { patch, result } = addTask(data, { title: 'Plan me', addToTomorrow: true })
    expect(patch.tomorrowPlan!.shortTasks).toContain(result.id)
    expect(patch.tomorrowPlan!.date).toBe(amsterdamDateString(1))
  })

  it('addToTomorrow with taskType maintenance appends to maintenanceTasks instead', () => {
    const data = baseData()
    const { patch, result } = addTask(data, { title: 'Water plants', taskType: 'maintenance', addToTomorrow: true })
    expect(patch.tomorrowPlan!.maintenanceTasks).toContain(result.id)
    expect(patch.tomorrowPlan!.shortTasks).not.toContain(result.id)
  })

  it('addToToday creates a fresh today plan and appends the id to shortTasks', () => {
    const data = baseData()
    const { patch, result } = addTask(data, { title: 'Plan me', addToToday: true })
    expect(patch.dailyPlan!.shortTasks).toContain(result.id)
    expect(patch.dailyPlan!.date).toBe(amsterdamDateString(0))
  })

  it('addToToday with taskType maintenance appends to maintenanceTasks instead', () => {
    const data = baseData()
    const { patch, result } = addTask(data, { title: 'Water plants', taskType: 'maintenance', addToToday: true })
    expect(patch.dailyPlan!.maintenanceTasks).toContain(result.id)
    expect(patch.dailyPlan!.shortTasks).not.toContain(result.id)
  })

  it('addToToday archives a stale dailyPlan into planHistory and rolls over its unfinished tasks', () => {
    const stalePlan: DailyPlan = {
      date: '2000-01-01',
      deepBlock: { projectId: '' },
      shortTasks: ['old-open'],
      shortProjects: [],
      maintenanceTasks: [],
      maintenanceProjects: [],
      meetings: [],
      completedItemIds: ['old-done'],
      isComplete: false,
    }
    const data = baseData({ dailyPlan: stalePlan })
    const { patch, result } = addTask(data, { title: 'New today task', addToToday: true })
    expect(patch.dailyPlan!.date).toBe(amsterdamDateString(0))
    expect(patch.dailyPlan!.shortTasks).toEqual(['old-open', result.id])
    expect(patch.planHistory!['2000-01-01']).toEqual(stalePlan)
  })

  it('addToToday promotes a tomorrowPlan dated today, then appends the new task', () => {
    const tomorrow: DailyPlan = {
      date: amsterdamDateString(0),
      deepBlock: { projectId: '' },
      shortTasks: ['carried'],
      shortProjects: [],
      maintenanceTasks: [],
      maintenanceProjects: [],
      meetings: [],
      isComplete: false,
    }
    const data = baseData({ tomorrowPlan: tomorrow })
    const { patch, result } = addTask(data, { title: 'New today task', addToToday: true })
    expect(patch.dailyPlan!.date).toBe(amsterdamDateString(0))
    expect(patch.dailyPlan!.shortTasks).toEqual(['carried', result.id])
    expect(patch.tomorrowPlan).toBeNull()
  })
})

describe('updateTask', () => {
  it('renames an orphan task', () => {
    const data = baseData({ orphanTasks: [task({ id: 't1', title: 'Old' })] })
    const { patch, result } = updateTask(data, { taskId: 't1', title: 'New' })
    expect(result.title).toBe('New')
    expect(patch.orphanTasks![0].title).toBe('New')
  })

  it('moves an orphan task into a project', () => {
    const data = baseData({
      orphanTasks: [task({ id: 't1', title: 'Orphan' })],
      projects: [project({ id: 'p1' })],
    })
    const { patch, result } = updateTask(data, { taskId: 't1', projectId: 'p1' })
    expect(result.projectId).toBe('p1')
    expect(patch.orphanTasks).toEqual([])
    expect(patch.projects![0].tasks).toHaveLength(1)
  })

  it('moves a project task to orphan via projectId: null', () => {
    const data = baseData({
      projects: [project({ id: 'p1', tasks: [task({ id: 't1', title: 'In project', projectId: 'p1' })] })],
    })
    const { patch, result } = updateTask(data, { taskId: 't1', projectId: null })
    expect(result.projectId).toBeUndefined()
    expect(patch.projects![0].tasks).toEqual([])
    expect(patch.orphanTasks).toHaveLength(1)
  })

  it('throws 404 for an unknown taskId', () => {
    expect(() => updateTask(baseData(), { taskId: 'missing' })).toThrow(AgentOpError)
  })

  it('throws 404 when moving to an unknown project', () => {
    const data = baseData({ orphanTasks: [task({ id: 't1', title: 'Orphan' })] })
    expect(() => updateTask(data, { taskId: 't1', projectId: 'missing' })).toThrow(AgentOpError)
  })

  it('updates a recurring task in place, including reassigning its project', () => {
    const data = baseData({
      recurringTasks: [task({ id: 'r1', title: 'Recurring', isRecurring: true })],
      projects: [project({ id: 'p1' })],
    })
    const { patch, result } = updateTask(data, { taskId: 'r1', projectId: 'p1', nextAction: 'call them' })
    expect(result.projectId).toBe('p1')
    expect(patch.recurringTasks![0].nextAction).toBe('call them')
  })

  describe('addToToday / addToTomorrow', () => {
    it('addToToday creates a fresh today plan and appends the task id to shortTasks', () => {
      const data = baseData({ orphanTasks: [task({ id: 't1', title: 'Orphan' })] })
      const { patch } = updateTask(data, { taskId: 't1', addToToday: true })
      expect(patch.dailyPlan!.shortTasks).toContain('t1')
      expect(patch.dailyPlan!.date).toBe(amsterdamDateString(0))
    })

    it('addToToday appends to an existing today plan', () => {
      const existingPlan: DailyPlan = {
        date: amsterdamDateString(0),
        deepBlock: { projectId: '' },
        shortTasks: ['other'],
        shortProjects: [],
        maintenanceTasks: [],
        maintenanceProjects: [],
        meetings: [],
        isComplete: false,
      }
      const data = baseData({ orphanTasks: [task({ id: 't1', title: 'Orphan' })], dailyPlan: existingPlan })
      const { patch } = updateTask(data, { taskId: 't1', addToToday: true })
      expect(patch.dailyPlan!.shortTasks).toEqual(['other', 't1'])
    })

    it('addToToday puts a maintenance task into the maintenance tier', () => {
      const data = baseData({ orphanTasks: [task({ id: 't1', title: 'Water plants', taskType: 'maintenance' })] })
      const { patch } = updateTask(data, { taskId: 't1', addToToday: true })
      expect(patch.dailyPlan!.maintenanceTasks).toContain('t1')
      expect(patch.dailyPlan!.shortTasks).not.toContain('t1')
    })

    it('does not duplicate a task already on today\'s plan (in either tier)', () => {
      const existingPlan: DailyPlan = {
        date: amsterdamDateString(0),
        deepBlock: { projectId: '' },
        shortTasks: [],
        shortProjects: [],
        maintenanceTasks: ['t1'],
        maintenanceProjects: [],
        meetings: [],
        isComplete: false,
      }
      const data = baseData({ orphanTasks: [task({ id: 't1', title: 'Orphan' })], dailyPlan: existingPlan })
      const { patch } = updateTask(data, { taskId: 't1', addToToday: true })
      expect(patch.dailyPlan).toBeUndefined()
    })

    it('addToTomorrow appends the task id to tomorrow\'s plan', () => {
      const data = baseData({ orphanTasks: [task({ id: 't1', title: 'Orphan' })] })
      const { patch } = updateTask(data, { taskId: 't1', addToTomorrow: true })
      expect(patch.tomorrowPlan!.shortTasks).toContain('t1')
      expect(patch.tomorrowPlan!.date).toBe(amsterdamDateString(1))
    })

    it('throws 404 for an unknown taskId', () => {
      expect(() => updateTask(baseData(), { taskId: 'missing', addToToday: true })).toThrow(AgentOpError)
    })

    it('rolls over a stale dailyPlan and does not duplicate a task that survives rollover, but still persists the archive', () => {
      const stalePlan: DailyPlan = {
        date: '2000-01-01',
        deepBlock: { projectId: '' },
        shortTasks: ['t1'],
        shortProjects: [],
        maintenanceTasks: [],
        maintenanceProjects: [],
        meetings: [],
        isComplete: false,
      }
      const data = baseData({ dailyPlan: stalePlan, orphanTasks: [task({ id: 't1', title: 'Orphan' })] })
      const { patch } = updateTask(data, { taskId: 't1', addToToday: true })
      // t1 is unfinished, so it survives rollover and is already present — not duplicated —
      // but the stale plan must still be archived into planHistory and the rolled-over
      // plan persisted, not silently dropped.
      expect(patch.dailyPlan!.date).toBe(amsterdamDateString(0))
      expect(patch.dailyPlan!.shortTasks).toEqual(['t1'])
      expect(patch.planHistory!['2000-01-01']).toEqual(stalePlan)
    })

    it('promotes a tomorrowPlan dated today via addToToday on update_task, then appends the existing task', () => {
      const tomorrow: DailyPlan = {
        date: amsterdamDateString(0),
        deepBlock: { projectId: '' },
        shortTasks: ['carried'],
        shortProjects: [],
        maintenanceTasks: [],
        maintenanceProjects: [],
        meetings: [],
        isComplete: false,
      }
      const data = baseData({ tomorrowPlan: tomorrow, orphanTasks: [task({ id: 't1', title: 'Orphan' })] })
      const { patch } = updateTask(data, { taskId: 't1', addToToday: true })
      expect(patch.dailyPlan!.date).toBe(amsterdamDateString(0))
      expect(patch.dailyPlan!.shortTasks).toEqual(['carried', 't1'])
      expect(patch.tomorrowPlan).toBeNull()
    })
  })
})

describe('completeTask', () => {
  it('marks an orphan task done with completedAt', () => {
    const data = baseData({ orphanTasks: [task({ id: 't1', title: 'Task' })] })
    const { result } = completeTask(data, { taskId: 't1' })
    expect(result.status).toBe('done')
  })

  it('rejects recurring tasks', () => {
    const data = baseData({ recurringTasks: [task({ id: 'r1', title: 'Recurring', isRecurring: true })] })
    expect(() => completeTask(data, { taskId: 'r1' })).toThrow(AgentOpError)
  })
})

describe('dropTask', () => {
  it('marks a project task dropped without deleting it', () => {
    const data = baseData({ projects: [project({ id: 'p1', tasks: [task({ id: 't1', title: 'x', projectId: 'p1' })] })] })
    const { patch, result } = dropTask(data, { taskId: 't1' })
    expect(result.status).toBe('dropped')
    expect(patch.projects![0].tasks).toHaveLength(1)
  })

  it('allows dropping a recurring task (plain field flip, no derived semantics)', () => {
    const data = baseData({ recurringTasks: [task({ id: 'r1', title: 'x', isRecurring: true })] })
    const { result } = dropTask(data, { taskId: 'r1' })
    expect(result.status).toBe('dropped')
  })
})

describe('addProject', () => {
  it('defaults to category personal and status backlog', () => {
    const { result } = addProject(baseData(), { title: 'New project' })
    expect(result.category).toBe('personal')
    expect(result.status).toBe('backlog')
  })

  it('rejects an invalid category', () => {
    expect(() => addProject(baseData(), { title: 'x', category: 'bogus' })).toThrow(AgentOpError)
  })

  it('sets trackerProjectId when given', () => {
    const { result } = addProject(baseData(), { title: 'x', trackerProjectId: 'abcd1234' })
    expect(result.trackerProjectId).toBe('abcd1234')
  })

  it('omits trackerProjectId when not given', () => {
    const { result } = addProject(baseData(), { title: 'x' })
    expect(result.trackerProjectId).toBeUndefined()
  })
})

describe('renameProject', () => {
  it('renames and bumps updatedAt', () => {
    const data = baseData({ projects: [project({ id: 'p1', updatedAt: '2020-01-01T00:00:00.000Z' })] })
    const { patch, result } = renameProject(data, { projectId: 'p1', title: 'Renamed' })
    expect(result.title).toBe('Renamed')
    expect(patch.projects![0].updatedAt).not.toBe('2020-01-01T00:00:00.000Z')
  })

  it('throws 404 for an unknown project', () => {
    expect(() => renameProject(baseData(), { projectId: 'missing', title: 'x' })).toThrow(AgentOpError)
  })

  it('sets trackerProjectId without requiring a title', () => {
    const data = baseData({ projects: [project({ id: 'p1', title: 'Keep me' })] })
    const { result } = renameProject(data, { projectId: 'p1', trackerProjectId: 'abcd1234' })
    expect(result.title).toBe('Keep me')
    expect(result.trackerProjectId).toBe('abcd1234')
  })

  it('clears trackerProjectId when given null', () => {
    const data = baseData({ projects: [project({ id: 'p1', trackerProjectId: 'abcd1234' })] })
    const { patch, result } = renameProject(data, { projectId: 'p1', trackerProjectId: null })
    expect(result.trackerProjectId).toBeUndefined()
    expect(patch.projects![0].trackerProjectId).toBeUndefined()
  })

  it('clears trackerProjectId when given an empty string', () => {
    const data = baseData({ projects: [project({ id: 'p1', trackerProjectId: 'abcd1234' })] })
    const { result } = renameProject(data, { projectId: 'p1', trackerProjectId: '' })
    expect(result.trackerProjectId).toBeUndefined()
  })

  it('throws 400 when neither title nor trackerProjectId is given', () => {
    const data = baseData({ projects: [project({ id: 'p1' })] })
    expect(() => renameProject(data, { projectId: 'p1' })).toThrow(AgentOpError)
  })
})

describe('updateProject', () => {
  it('changes status and bumps updatedAt', () => {
    const data = baseData({ projects: [project({ id: 'p1', status: 'backlog', updatedAt: '2020-01-01T00:00:00.000Z' })] })
    const { patch, result } = updateProject(data, { projectId: 'p1', status: 'in_progress' })
    expect(result.status).toBe('in_progress')
    expect(patch.projects![0].updatedAt).not.toBe('2020-01-01T00:00:00.000Z')
  })

  it('changes title and category', () => {
    const data = baseData({ projects: [project({ id: 'p1' })] })
    const { result } = updateProject(data, { projectId: 'p1', title: 'Renamed', category: 'ops' })
    expect(result.title).toBe('Renamed')
    expect(result.category).toBe('ops')
  })

  it('sets and clears trackerProjectId', () => {
    const data = baseData({ projects: [project({ id: 'p1' })] })
    const { result: linked } = updateProject(data, { projectId: 'p1', trackerProjectId: 'abcd1234' })
    expect(linked.trackerProjectId).toBe('abcd1234')

    const data2 = baseData({ projects: [project({ id: 'p1', trackerProjectId: 'abcd1234' })] })
    const { result: cleared } = updateProject(data2, { projectId: 'p1', trackerProjectId: null })
    expect(cleared.trackerProjectId).toBeUndefined()
  })

  it('clears waitingOn when moving to done, mirroring moveProject', () => {
    const data = baseData({ projects: [project({ id: 'p1', status: 'waiting', waitingOn: [{ person: 'Bob', since: '2026-01-01' }] })] })
    const { patch } = updateProject(data, { projectId: 'p1', status: 'done' })
    expect(patch.projects![0].waitingOn).toBeUndefined()
  })

  it('preserves waitingOn when moving to a status other than done', () => {
    const waitingOn = [{ person: 'Bob', since: '2026-01-01' }]
    const data = baseData({ projects: [project({ id: 'p1', status: 'waiting', waitingOn })] })
    const { patch } = updateProject(data, { projectId: 'p1', status: 'in_progress' })
    expect(patch.projects![0].waitingOn).toEqual(waitingOn)
  })

  it('throws 404 for an unknown project', () => {
    expect(() => updateProject(baseData(), { projectId: 'missing', status: 'done' })).toThrow(AgentOpError)
  })

  it('throws 400 when no field to change is given', () => {
    const data = baseData({ projects: [project({ id: 'p1' })] })
    expect(() => updateProject(data, { projectId: 'p1' })).toThrow(AgentOpError)
  })

  it('rejects an invalid status', () => {
    const data = baseData({ projects: [project({ id: 'p1' })] })
    expect(() => updateProject(data, { projectId: 'p1', status: 'bogus' })).toThrow(AgentOpError)
  })

  it('leaves other projects untouched', () => {
    const data = baseData({
      projects: [project({ id: 'p1', title: 'One' }), project({ id: 'p2', title: 'Two', status: 'waiting' })],
    })
    const { patch } = updateProject(data, { projectId: 'p1', status: 'in_progress' })
    expect(patch.projects!.find(p => p.id === 'p2')).toEqual(data.projects[1])
  })
})

describe('runAgentOperation / isAgentAction', () => {
  it('recognizes all documented actions', () => {
    expect(isAgentAction('list_projects')).toBe(true)
    expect(isAgentAction('update_project')).toBe(true)
    expect(isAgentAction('delete_everything')).toBe(false)
  })

  it('dispatches reads with an empty patch', () => {
    const { patch, result } = runAgentOperation('list_projects', baseData())
    expect(patch).toEqual({})
    expect(result).toEqual([])
  })
})
