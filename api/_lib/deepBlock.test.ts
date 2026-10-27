import { describe, it, expect } from 'vitest'
import {
  AgentOpError,
  normalizeSyncData,
  type SyncData,
} from './agentOps'
import {
  buildDeepBlockCompletion,
  categoryToDeepBlockBucket,
  computeDeepBlockStats,
  deriveDeepBlockEntriesFromHistory,
  isoWeekKey,
  mergeDeepBlockEntries,
  type DeepBlockLogEntry,
} from './deepBlock'
import type { Project, DailyPlan } from '../../src/types'

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

function plan(overrides: Partial<DailyPlan> = {}): DailyPlan {
  return {
    date: '2026-10-27',
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

function baseData(overrides: Partial<SyncData> = {}): SyncData {
  return normalizeSyncData(overrides)
}

const TODAY = '2026-10-27' // Tuesday

describe('categoryToDeepBlockBucket', () => {
  it('maps marketing to marketing', () => {
    expect(categoryToDeepBlockBucket('marketing')).toBe('marketing')
  })
  it('maps every other category to other', () => {
    expect(categoryToDeepBlockBucket('ops')).toBe('other')
    expect(categoryToDeepBlockBucket('admin')).toBe('other')
    expect(categoryToDeepBlockBucket('finance')).toBe('other')
    expect(categoryToDeepBlockBucket('product')).toBe('other')
    expect(categoryToDeepBlockBucket('personal')).toBe('other')
  })
})

describe('buildDeepBlockCompletion', () => {
  it('completes today\'s deep block and derives category from the project', () => {
    const data = baseData({
      projects: [project({ id: 'p1', title: 'Campaign', category: 'marketing' })],
      dailyPlan: plan({ date: TODAY, deepBlock: { projectId: 'p1' } }),
    })
    const { patch, entry } = buildDeepBlockCompletion(data, {}, '2026-10-27T10:00:00.000Z')
    expect(patch.dailyPlan?.deepBlock.projectId).toBe('')
    expect(patch.dailyPlan?.deepBlock.completedProjectTitle).toBe('Campaign')
    expect(patch.dailyPlan?.deepBlock.completedAt).toBe('2026-10-27T10:00:00.000Z')
    expect(entry).toEqual({
      date: TODAY,
      category: 'marketing',
      projectId: 'p1',
      projectTitle: 'Campaign',
      completedAt: '2026-10-27T10:00:00.000Z',
    })
  })

  it('category param wins over the derived category', () => {
    const data = baseData({
      projects: [project({ id: 'p1', category: 'marketing' })],
      dailyPlan: plan({ date: TODAY, deepBlock: { projectId: 'p1' } }),
    })
    const { entry } = buildDeepBlockCompletion(data, { category: 'other' }, '2026-10-27T10:00:00.000Z')
    expect(entry.category).toBe('other')
  })

  it('maps a non-marketing project category to other', () => {
    const data = baseData({
      projects: [project({ id: 'p1', category: 'product' })],
      dailyPlan: plan({ date: TODAY, deepBlock: { projectId: 'p1' } }),
    })
    const { entry } = buildDeepBlockCompletion(data, {}, '2026-10-27T10:00:00.000Z')
    expect(entry.category).toBe('other')
  })

  it('throws 400 when there is no active deep block for today and it was never completed', () => {
    const data = baseData({ dailyPlan: plan({ date: TODAY }) })
    expect(() => buildDeepBlockCompletion(data, {}, '2026-10-27T10:00:00.000Z')).toThrow(AgentOpError)
  })

  it('is idempotent: completing an already-completed today is a no-op on dailyPlan', () => {
    const data = baseData({
      dailyPlan: plan({
        date: TODAY,
        deepBlock: { projectId: '', completedProjectTitle: 'Campaign', completedAt: '2026-10-27T09:00:00.000Z' },
      }),
    })
    const { patch, entry } = buildDeepBlockCompletion(data, { category: 'marketing' }, '2026-10-27T11:00:00.000Z')
    expect(patch.dailyPlan).toBeUndefined()
    expect(entry.projectTitle).toBe('Campaign')
    expect(entry.category).toBe('marketing')
  })

  it('for a non-today date, requires category and does not touch dailyPlan', () => {
    const data = baseData({ dailyPlan: plan({ date: TODAY, deepBlock: { projectId: 'p1' } }) })
    expect(() => buildDeepBlockCompletion(data, { date: '2026-10-20' }, '2026-10-27T10:00:00.000Z')).toThrow(AgentOpError)

    const { patch, entry } = buildDeepBlockCompletion(
      data,
      { date: '2026-10-20', category: 'other' },
      '2026-10-27T10:00:00.000Z',
    )
    expect(patch.dailyPlan).toBeUndefined()
    expect(entry).toEqual({ date: '2026-10-20', category: 'other', completedAt: '2026-10-27T10:00:00.000Z' })
  })

  it('rejects a malformed date', () => {
    const data = baseData()
    expect(() => buildDeepBlockCompletion(data, { date: '27-10-2026' }, '2026-10-27T10:00:00.000Z')).toThrow(AgentOpError)
  })

  it('rejects an invalid category', () => {
    const data = baseData({ dailyPlan: plan({ date: TODAY, deepBlock: { projectId: 'p1' } }) })
    expect(() => buildDeepBlockCompletion(data, { category: 'sales' }, '2026-10-27T10:00:00.000Z')).toThrow(AgentOpError)
  })

  it('rolls over a stale dailyPlan before completing, same as addToToday', () => {
    const data = baseData({
      // pinnedItemIds keeps the unfinished deep block project alive across the rollover —
      // otherwise rolloverTasks (src/lib/dailyPlanRollover.ts) drops it, same as the client.
      dailyPlan: plan({ date: '2026-10-20', deepBlock: { projectId: 'p1' }, pinnedItemIds: ['p1'] }),
      projects: [project({ id: 'p1', category: 'ops' })],
    })
    const { patch, entry } = buildDeepBlockCompletion(data, {}, TODAY + 'T10:00:00.000Z')
    expect(patch.planHistory?.['2026-10-20']).toBeDefined()
    expect(patch.dailyPlan?.date).toBe(TODAY)
    expect(entry.category).toBe('other')
  })
})

describe('deriveDeepBlockEntriesFromHistory', () => {
  it('derives an entry from an archived planHistory plan with a completed deep block', () => {
    const projects = [project({ id: 'p1', title: 'Campaign', category: 'marketing' })]
    const planHistory = {
      '2026-10-20': plan({
        date: '2026-10-20',
        deepBlock: { projectId: '', completedProjectTitle: 'Campaign', completedAt: '2026-10-20T09:00:00.000Z' },
      }),
    }
    const entries = deriveDeepBlockEntriesFromHistory(planHistory, null, projects)
    expect(entries).toEqual([
      { date: '2026-10-20', category: 'marketing', projectTitle: 'Campaign', completedAt: '2026-10-20T09:00:00.000Z' },
    ])
  })

  it('matches completedProjectTitle case/whitespace-insensitively', () => {
    const projects = [project({ id: 'p1', title: 'Campaign', category: 'marketing' })]
    const planHistory = {
      '2026-10-20': plan({
        date: '2026-10-20',
        deepBlock: { projectId: '', completedProjectTitle: '  CAMPAIGN  ', completedAt: '2026-10-20T09:00:00.000Z' },
      }),
    }
    const entries = deriveDeepBlockEntriesFromHistory(planHistory, null, projects)
    expect(entries[0].category).toBe('marketing')
  })

  it('falls back to other when the title matches no current project', () => {
    const planHistory = {
      '2026-10-20': plan({
        date: '2026-10-20',
        deepBlock: { projectId: '', completedProjectTitle: 'Renamed or deleted project', completedAt: '2026-10-20T09:00:00.000Z' },
      }),
    }
    const entries = deriveDeepBlockEntriesFromHistory(planHistory, null, [])
    expect(entries[0].category).toBe('other')
  })

  it('prefers an exact projectId match over a title match, when present', () => {
    const projects = [
      project({ id: 'p1', title: 'Decoy title match', category: 'ops' }),
      project({ id: 'p2', title: 'Real project', category: 'marketing' }),
    ]
    const planHistory = {
      '2026-10-20': plan({
        date: '2026-10-20',
        deepBlock: { projectId: 'p2', completedProjectTitle: 'Decoy title match', completedAt: '2026-10-20T09:00:00.000Z' },
      }),
    }
    const entries = deriveDeepBlockEntriesFromHistory(planHistory, null, projects)
    expect(entries[0].category).toBe('marketing')
  })

  it('ignores planHistory entries with no completed deep block', () => {
    const planHistory = { '2026-10-20': plan({ date: '2026-10-20', deepBlock: { projectId: '' } }) }
    expect(deriveDeepBlockEntriesFromHistory(planHistory, null, [])).toEqual([])
  })

  it('also derives an entry from a completed today dailyPlan', () => {
    const projects = [project({ id: 'p1', title: 'Today project', category: 'product' })]
    const dailyPlan = plan({
      date: TODAY,
      deepBlock: { projectId: '', completedProjectTitle: 'Today project', completedAt: '2026-10-27T09:00:00.000Z' },
    })
    const entries = deriveDeepBlockEntriesFromHistory({}, dailyPlan, projects)
    expect(entries).toEqual([{ date: TODAY, category: 'other', projectTitle: 'Today project', completedAt: '2026-10-27T09:00:00.000Z' }])
  })

  it('does not derive an entry from an uncompleted today dailyPlan', () => {
    const dailyPlan = plan({ date: TODAY, deepBlock: { projectId: 'p1' } })
    expect(deriveDeepBlockEntriesFromHistory({}, dailyPlan, [])).toEqual([])
  })

  it('returns an empty array for a null dailyPlan and empty planHistory', () => {
    expect(deriveDeepBlockEntriesFromHistory({}, null, [])).toEqual([])
  })
})

describe('mergeDeepBlockEntries', () => {
  it('keeps entries unique to either side', () => {
    const primary: DeepBlockLogEntry[] = [{ date: '2026-10-27', category: 'marketing', completedAt: 'a' }]
    const derived: DeepBlockLogEntry[] = [{ date: '2026-10-20', category: 'other', completedAt: 'b' }]
    const merged = mergeDeepBlockEntries(primary, derived)
    expect(merged.map(e => e.date).sort()).toEqual(['2026-10-20', '2026-10-27'])
  })

  it('prefers the primary (explicit deepBlockLog) entry when both sides cover the same date', () => {
    const primary: DeepBlockLogEntry[] = [{ date: '2026-10-27', category: 'marketing', completedAt: 'explicit' }]
    const derived: DeepBlockLogEntry[] = [{ date: '2026-10-27', category: 'other', completedAt: 'derived' }]
    const merged = mergeDeepBlockEntries(primary, derived)
    expect(merged).toEqual([{ date: '2026-10-27', category: 'marketing', completedAt: 'explicit' }])
  })
})

describe('isoWeekKey', () => {
  it('computes a simple mid-year week', () => {
    expect(isoWeekKey('2026-10-27')).toBe('2026-W44')
  })

  it('handles the year-end boundary where Jan 1 belongs to the previous ISO year', () => {
    // 2023-01-01 is a Sunday; its week (2022-12-26..2023-01-01) has its Thursday (Dec 29) in 2022.
    expect(isoWeekKey('2023-01-01')).toBe('2022-W52')
  })

  it('handles a December date that belongs to the next ISO year', () => {
    // 2024-12-30 is a Monday starting a week whose Thursday (Jan 2, 2025) is in 2025.
    expect(isoWeekKey('2024-12-30')).toBe('2025-W01')
  })

  it('agrees for every day within one Mon-Sun week', () => {
    const week = ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09', '2026-01-10', '2026-01-11']
    const keys = new Set(week.map(isoWeekKey))
    expect(keys.size).toBe(1)
  })
})

function entry(date: string, category: DeepBlockLogEntry['category'] = 'other'): DeepBlockLogEntry {
  return { date, category, completedAt: `${date}T10:00:00.000Z` }
}

describe('computeDeepBlockStats', () => {
  it('buckets entries into the trailing N distinct ISO weeks ending at today', () => {
    const stats = computeDeepBlockStats([entry(TODAY)], TODAY, 2)
    expect(stats.weeks).toHaveLength(2)
    expect(stats.weeks[1].isoWeek).toBe(isoWeekKey(TODAY))
    expect(stats.weeks[1].total).toBe(1)
    expect(stats.total).toBe(1)
  })

  it('splits totals by category', () => {
    const stats = computeDeepBlockStats(
      [entry('2026-10-27', 'marketing'), entry('2026-10-26', 'other'), entry('2026-10-26', 'marketing')],
      TODAY,
      1,
    )
    expect(stats.byCategory).toEqual({ marketing: 2, other: 1 })
    expect(stats.total).toBe(3)
  })

  it('ignores entries outside the requested window', () => {
    const stats = computeDeepBlockStats([entry('2020-01-01')], TODAY, 1)
    expect(stats.total).toBe(0)
  })

  it('a weekend completion counts toward the weekly total but not the streak', () => {
    // 2026-10-25 is a Sunday.
    const stats = computeDeepBlockStats([entry('2026-10-25')], '2026-10-25', 1)
    expect(stats.total).toBe(1)
    expect(stats.currentStreak).toBe(0)
  })

  it('current streak counts consecutive workdays with completions', () => {
    // Mon 10-26, Tue 10-27 both done; today is Tue 10-27.
    const stats = computeDeepBlockStats([entry('2026-10-26'), entry('2026-10-27')], '2026-10-27')
    expect(stats.currentStreak).toBe(2)
  })

  it('gives today a grace day when today is an undone workday, without breaking the prior streak', () => {
    const stats = computeDeepBlockStats([entry('2026-10-26')], '2026-10-27')
    expect(stats.currentStreak).toBe(1)
  })

  it('breaks the streak at the first missed non-today workday', () => {
    // Mon 10-19 done, Fri 10-23 not done, Mon 10-26 done, today Tue 10-27 done.
    const stats = computeDeepBlockStats([entry('2026-10-19'), entry('2026-10-26'), entry('2026-10-27')], '2026-10-27')
    expect(stats.currentStreak).toBe(2)
  })

  it('a weekend with no completion does not break a streak spanning Fri -> Mon', () => {
    // Fri 2026-10-23 and Mon 2026-10-26 done, weekend untouched, today is Mon 10-26.
    const stats = computeDeepBlockStats([entry('2026-10-23'), entry('2026-10-26')], '2026-10-26')
    expect(stats.currentStreak).toBe(2)
  })

  it('currentStreak is 0 when today is a weekend and Friday was missed', () => {
    const stats = computeDeepBlockStats([], '2026-10-25') // Sunday
    expect(stats.currentStreak).toBe(0)
  })

  it('longest streak can exceed the current streak', () => {
    const entries = [
      entry('2026-10-19'), entry('2026-10-20'), entry('2026-10-21'), entry('2026-10-22'), entry('2026-10-23'),
      // gap
      entry('2026-10-27'),
    ]
    const stats = computeDeepBlockStats(entries, '2026-10-27')
    expect(stats.longestStreak).toBe(5)
    expect(stats.currentStreak).toBe(1)
  })

  it('returns zero streaks for an empty log', () => {
    const stats = computeDeepBlockStats([], TODAY)
    expect(stats.currentStreak).toBe(0)
    expect(stats.longestStreak).toBe(0)
  })
})
