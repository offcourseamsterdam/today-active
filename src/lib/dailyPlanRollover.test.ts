import { describe, it, expect } from 'vitest'
import { rolloverTasks, computeDailyPlanRefresh } from './dailyPlanRollover'
import type { DailyPlan } from '../types'

function plan(overrides: Partial<DailyPlan> & { date: string }): DailyPlan {
  return {
    deepBlock: { projectId: '' },
    shortTasks: [],
    shortProjects: [],
    maintenanceTasks: [],
    maintenanceProjects: [],
    meetings: [],
    isComplete: false,
    ...overrides,
  }
}

describe('rolloverTasks', () => {
  it('drops done tasks/projects unless pinned', () => {
    const p = plan({
      date: '2026-01-01',
      shortTasks: ['t1', 't2'],
      maintenanceTasks: ['t3'],
      shortProjects: ['p1'],
      completedItemIds: ['t1', 'p1'],
    })
    const carried = rolloverTasks(p, [{ id: 't1', status: 'backlog' }, { id: 't2', status: 'backlog' }])
    expect(carried.shortTasks).toEqual(['t2'])
    expect(carried.shortProjects).toEqual([])
    expect(carried.maintenanceTasks).toEqual(['t3'])
  })

  it('drops tasks whose status is done, even without completedItemIds', () => {
    const p = plan({ date: '2026-01-01', shortTasks: ['t1', 't2'] })
    const carried = rolloverTasks(p, [{ id: 't1', status: 'done' }, { id: 't2', status: 'backlog' }])
    expect(carried.shortTasks).toEqual(['t2'])
  })

  it('keeps pinned items even if completed', () => {
    const p = plan({
      date: '2026-01-01',
      shortTasks: ['t1'],
      completedItemIds: ['t1'],
      pinnedItemIds: ['t1'],
    })
    const carried = rolloverTasks(p, [])
    expect(carried.shortTasks).toEqual(['t1'])
  })

  it('carries the deep project only if pinned', () => {
    const unpinned = plan({ date: '2026-01-01', deepBlock: { projectId: 'proj1' } })
    expect(rolloverTasks(unpinned, []).deepProjectId).toBe('')

    const pinned = plan({ date: '2026-01-01', deepBlock: { projectId: 'proj1' }, pinnedItemIds: ['proj1'] })
    expect(rolloverTasks(pinned, []).deepProjectId).toBe('proj1')
  })
})

describe('computeDailyPlanRefresh', () => {
  const today = '2026-10-26'

  it('is a no-op when dailyPlan is already today and there is no tomorrowPlan', () => {
    const result = computeDailyPlanRefresh({
      dailyPlan: plan({ date: today }),
      tomorrowPlan: null,
      planHistory: {},
      allTasks: [],
      today,
    })
    expect(result.changed).toBe(false)
  })

  it('promotes tomorrowPlan dated today when there is no stale dailyPlan to roll over', () => {
    const tomorrow = plan({ date: today, shortTasks: ['t1'] })
    const result = computeDailyPlanRefresh({
      dailyPlan: null,
      tomorrowPlan: tomorrow,
      planHistory: {},
      allTasks: [],
      today,
    })
    expect(result.changed).toBe(true)
    expect(result.dailyPlan?.date).toBe(today)
    expect(result.dailyPlan?.shortTasks).toEqual(['t1'])
    expect(result.tomorrowPlan).toBeNull()
    expect(result.planHistory).toEqual({})
  })

  it('promotes tomorrowPlan dated today AND merges in a stale dailyPlan\'s unfinished tasks, archiving it', () => {
    const stale = plan({ date: '2026-10-25', shortTasks: ['old-1', 'old-done'], completedItemIds: ['old-done'] })
    const tomorrow = plan({ date: today, shortTasks: ['new-1'] })
    const result = computeDailyPlanRefresh({
      dailyPlan: stale,
      tomorrowPlan: tomorrow,
      planHistory: {},
      allTasks: [],
      today,
    })
    expect(result.changed).toBe(true)
    expect(result.dailyPlan?.shortTasks.sort()).toEqual(['new-1', 'old-1'])
    expect(result.tomorrowPlan).toBeNull()
    expect(result.planHistory['2026-10-25']).toEqual(stale)
  })

  it('clears a stale (past-dated) tomorrowPlan without archiving it', () => {
    const result = computeDailyPlanRefresh({
      dailyPlan: null,
      tomorrowPlan: plan({ date: '2026-10-20' }),
      planHistory: {},
      allTasks: [],
      today,
    })
    expect(result.changed).toBe(true)
    expect(result.tomorrowPlan).toBeNull()
    expect(result.planHistory).toEqual({})
  })

  it('archives a stale dailyPlan and rolls over its unfinished tasks into a fresh plan for today', () => {
    const stale = plan({ date: '2026-10-25', shortTasks: ['keep-me', 'done-one'], completedItemIds: ['done-one'] })
    const result = computeDailyPlanRefresh({
      dailyPlan: stale,
      tomorrowPlan: null,
      planHistory: {},
      allTasks: [],
      today,
    })
    expect(result.changed).toBe(true)
    expect(result.dailyPlan?.date).toBe(today)
    expect(result.dailyPlan?.shortTasks).toEqual(['keep-me'])
    expect(result.planHistory['2026-10-25']).toEqual(stale)
  })

  it('archives a stale dailyPlan with nothing left to carry as a null dailyPlan', () => {
    const stale = plan({ date: '2026-10-25', shortTasks: ['done-one'], completedItemIds: ['done-one'] })
    const result = computeDailyPlanRefresh({
      dailyPlan: stale,
      tomorrowPlan: null,
      planHistory: {},
      allTasks: [],
      today,
    })
    expect(result.changed).toBe(true)
    expect(result.dailyPlan).toBeNull()
    expect(result.planHistory['2026-10-25']).toEqual(stale)
  })

  it('preserves existing planHistory entries while adding the newly archived one', () => {
    const stale = plan({ date: '2026-10-25' })
    const result = computeDailyPlanRefresh({
      dailyPlan: stale,
      tomorrowPlan: null,
      planHistory: { '2026-10-01': plan({ date: '2026-10-01' }) },
      allTasks: [],
      today,
    })
    expect(Object.keys(result.planHistory).sort()).toEqual(['2026-10-01', '2026-10-25'])
  })
})
