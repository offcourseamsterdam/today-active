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
})

describe('runAgentOperation / isAgentAction', () => {
  it('recognizes all documented actions', () => {
    expect(isAgentAction('list_projects')).toBe(true)
    expect(isAgentAction('delete_everything')).toBe(false)
  })

  it('dispatches reads with an empty patch', () => {
    const { patch, result } = runAgentOperation('list_projects', baseData())
    expect(patch).toEqual({})
    expect(result).toEqual([])
  })
})
