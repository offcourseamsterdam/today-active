import { describe, it, expect } from 'vitest'
import { applyTrackerStatusChanges, buildTrackerSyncReport, computeTrackerStatusChanges, type TrackerStatusChange } from './trackerSync'
import { AgentOpError, normalizeSyncData, type SyncData } from './agentOps'
import type { Project } from '../../src/types'
import type { TrackerProjectSummary } from './trackerOps'

function project(overrides: Partial<Project> & { id: string; title: string }): Project {
  return {
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

function trackerProject(overrides: Partial<TrackerProjectSummary> & { id: string; title: string }): TrackerProjectSummary {
  return {
    status: 'not_started',
    subtasks: [],
    assigneeIds: [],
    assignees: [],
    ...overrides,
  }
}

function baseData(overrides: Partial<SyncData> = {}): SyncData {
  return normalizeSyncData(overrides)
}

describe('buildTrackerSyncReport', () => {
  it('reports a status mismatch on a linked pair with both expected statuses', () => {
    const vandaag = [project({ id: 'v1', title: 'Launch', status: 'backlog', trackerProjectId: 't1' })]
    const tracker = [trackerProject({ id: 't1', title: 'Launch', status: 'in_progress' })]
    const report = buildTrackerSyncReport(vandaag, tracker)
    expect(report.statusMismatches).toEqual([
      {
        vandaag: { id: 'v1', title: 'Launch', status: 'backlog' },
        tracker: { id: 't1', title: 'Launch', status: 'in_progress' },
        expected: { vandaagStatus: 'in_progress', trackerStatus: 'not_started' },
      },
    ])
  })

  it('reports no mismatch when a linked pair already agrees', () => {
    const vandaag = [project({ id: 'v1', title: 'Launch', status: 'in_progress', trackerProjectId: 't1' })]
    const tracker = [trackerProject({ id: 't1', title: 'Launch', status: 'in_progress' })]
    const report = buildTrackerSyncReport(vandaag, tracker)
    expect(report.statusMismatches).toEqual([])
  })

  it('still reports mismatches for done/completed projects even when includeDone is false', () => {
    const vandaag = [project({ id: 'v1', title: 'Launch', status: 'done', trackerProjectId: 't1' })]
    const tracker = [trackerProject({ id: 't1', title: 'Launch', status: 'in_progress' })]
    const report = buildTrackerSyncReport(vandaag, tracker, { includeDone: false })
    expect(report.statusMismatches).toHaveLength(1)
  })

  it('reports a broken link when trackerProjectId points nowhere', () => {
    const vandaag = [project({ id: 'v1', title: 'Launch', trackerProjectId: 'missing' })]
    const report = buildTrackerSyncReport(vandaag, [])
    expect(report.brokenLinks).toEqual([{ vandaagProjectId: 'v1', title: 'Launch', trackerProjectId: 'missing' }])
    expect(report.statusMismatches).toEqual([])
  })

  it('suggests an unlinked tracker project for an unlinked Vandaag project with a similar title', () => {
    const vandaag = [project({ id: 'v1', title: 'Website Redesign' })]
    const tracker = [trackerProject({ id: 't1', title: 'Website redesign!' })]
    const report = buildTrackerSyncReport(vandaag, tracker)
    expect(report.unlinkedVandaagProjects).toHaveLength(1)
    expect(report.unlinkedVandaagProjects[0].suggestions).toEqual([{ trackerId: 't1', title: 'Website redesign!', score: 1 }])
  })

  it('does not suggest a tracker project that is already linked elsewhere', () => {
    const vandaag = [
      project({ id: 'v1', title: 'Website Redesign', trackerProjectId: 't1' }),
      project({ id: 'v2', title: 'Website Redesign' }),
    ]
    const tracker = [trackerProject({ id: 't1', title: 'Website Redesign' })]
    const report = buildTrackerSyncReport(vandaag, tracker)
    const unlinkedV2 = report.unlinkedVandaagProjects.find(p => p.id === 'v2')!
    expect(unlinkedV2.suggestions).toEqual([])
  })

  it('does not suggest a title match below the similarity threshold', () => {
    const vandaag = [project({ id: 'v1', title: 'Quarterly taxes' })]
    const tracker = [trackerProject({ id: 't1', title: 'Website redesign' })]
    const report = buildTrackerSyncReport(vandaag, tracker)
    expect(report.unlinkedVandaagProjects[0].suggestions).toEqual([])
  })

  it('normalizes diacritics, punctuation and whitespace before comparing titles', () => {
    const vandaag = [project({ id: 'v1', title: '  Café-Project!! ' })]
    const tracker = [trackerProject({ id: 't1', title: 'cafe project' })]
    const report = buildTrackerSyncReport(vandaag, tracker)
    expect(report.unlinkedVandaagProjects[0].suggestions[0].score).toBe(1)
  })

  it('lists unlinked tracker projects, excluding ones linked from a Vandaag project', () => {
    const vandaag = [project({ id: 'v1', title: 'Linked', trackerProjectId: 't1' })]
    const tracker = [
      trackerProject({ id: 't1', title: 'Linked' }),
      trackerProject({ id: 't2', title: 'Not linked' }),
    ]
    const report = buildTrackerSyncReport(vandaag, tracker)
    expect(report.unlinkedTrackerProjects.map(t => t.id)).toEqual(['t2'])
  })

  it('excludes done Vandaag projects and completed tracker projects from unlinked lists by default', () => {
    const vandaag = [project({ id: 'v1', title: 'Finished thing', status: 'done' })]
    const tracker = [trackerProject({ id: 't1', title: 'Finished tracker thing', status: 'completed' })]
    const report = buildTrackerSyncReport(vandaag, tracker)
    expect(report.unlinkedVandaagProjects).toEqual([])
    expect(report.unlinkedTrackerProjects).toEqual([])
  })

  it('includes done/completed projects in unlinked lists when includeDone is true', () => {
    const vandaag = [project({ id: 'v1', title: 'Finished thing', status: 'done' })]
    const tracker = [trackerProject({ id: 't1', title: 'Finished tracker thing', status: 'completed' })]
    const report = buildTrackerSyncReport(vandaag, tracker, { includeDone: true })
    expect(report.unlinkedVandaagProjects.map(p => p.id)).toEqual(['v1'])
    expect(report.unlinkedTrackerProjects.map(t => t.id)).toEqual(['t1'])
  })

  it('reports Vandaag projects linked to the same tracker id as duplicates', () => {
    const vandaag = [
      project({ id: 'v1', title: 'A', trackerProjectId: 't1' }),
      project({ id: 'v2', title: 'B', trackerProjectId: 't1' }),
    ]
    const report = buildTrackerSyncReport(vandaag, [trackerProject({ id: 't1', title: 'A' })])
    expect(report.duplicates.sameTrackerLink).toEqual([
      { trackerId: 't1', vandaagProjects: [{ id: 'v1', title: 'A' }, { id: 'v2', title: 'B' }] },
    ])
  })

  it('reports near-identical Vandaag and tracker titles as duplicates', () => {
    const vandaag = [
      project({ id: 'v1', title: 'Marketing Plan' }),
      project({ id: 'v2', title: 'marketing plan!' }),
    ]
    const tracker = [
      trackerProject({ id: 't1', title: 'Budget' }),
      trackerProject({ id: 't2', title: 'Budget ' }),
    ]
    const report = buildTrackerSyncReport(vandaag, tracker)
    expect(report.duplicates.vandaagTitleDuplicates).toEqual([
      { a: { id: 'v1', title: 'Marketing Plan' }, b: { id: 'v2', title: 'marketing plan!' }, score: 1 },
    ])
    expect(report.duplicates.trackerTitleDuplicates).toEqual([
      { a: { id: 't1', title: 'Budget' }, b: { id: 't2', title: 'Budget ' }, score: 1 },
    ])
  })

  it('returns an empty report for empty inputs', () => {
    const report = buildTrackerSyncReport([], [])
    expect(report).toEqual({
      statusMismatches: [],
      brokenLinks: [],
      unlinkedVandaagProjects: [],
      unlinkedTrackerProjects: [],
      duplicates: { sameTrackerLink: [], vandaagTitleDuplicates: [], trackerTitleDuplicates: [] },
    })
  })
})

describe('computeTrackerStatusChanges', () => {
  it('reports a change for a linked project whose mapped status differs', () => {
    const vandaag = [project({ id: 'v1', title: 'Launch', status: 'backlog', trackerProjectId: 't1' })]
    const tracker = [trackerProject({ id: 't1', title: 'Launch', status: 'in_progress' })]
    expect(computeTrackerStatusChanges(vandaag, tracker)).toEqual([
      { vandaagProjectId: 'v1', title: 'Launch', from: 'backlog', to: 'in_progress', trackerId: 't1' },
    ])
  })

  it('reports nothing for an already-matching linked project', () => {
    const vandaag = [project({ id: 'v1', title: 'Launch', status: 'in_progress', trackerProjectId: 't1' })]
    const tracker = [trackerProject({ id: 't1', title: 'Launch', status: 'in_progress' })]
    expect(computeTrackerStatusChanges(vandaag, tracker)).toEqual([])
  })

  it('skips unlinked projects and broken links', () => {
    const vandaag = [
      project({ id: 'v1', title: 'Unlinked' }),
      project({ id: 'v2', title: 'Broken', status: 'backlog', trackerProjectId: 'missing' }),
    ]
    expect(computeTrackerStatusChanges(vandaag, [])).toEqual([])
  })

  it('filters by projectIds when given', () => {
    const vandaag = [
      project({ id: 'v1', title: 'A', status: 'backlog', trackerProjectId: 't1' }),
      project({ id: 'v2', title: 'B', status: 'backlog', trackerProjectId: 't2' }),
    ]
    const tracker = [
      trackerProject({ id: 't1', title: 'A', status: 'in_progress' }),
      trackerProject({ id: 't2', title: 'B', status: 'in_progress' }),
    ]
    const changes = computeTrackerStatusChanges(vandaag, tracker, { projectIds: ['v1'] })
    expect(changes.map(c => c.vandaagProjectId)).toEqual(['v1'])
  })

  it('rejects a non-array projectIds', () => {
    expect(() => computeTrackerStatusChanges([], [], { projectIds: 'v1' })).toThrow(AgentOpError)
  })

  it('rejects a projectIds array containing a non-string', () => {
    expect(() => computeTrackerStatusChanges([], [], { projectIds: ['v1', 2] })).toThrow(AgentOpError)
  })
})

describe('applyTrackerStatusChanges', () => {
  function change(overrides: Partial<TrackerStatusChange> & { vandaagProjectId: string; to: Project['status'] }): TrackerStatusChange {
    return { title: 'X', from: 'backlog', trackerId: 't1', ...overrides }
  }

  it('returns an empty patch for no changes', () => {
    const data = baseData({ projects: [project({ id: 'p1', title: 'P1' })] })
    expect(applyTrackerStatusChanges(data, [])).toEqual({})
  })

  it('applies the new status and bumps updatedAt for the changed project only', () => {
    const data = baseData({
      projects: [
        project({ id: 'p1', title: 'P1', status: 'backlog', updatedAt: '2020-01-01T00:00:00.000Z' }),
        project({ id: 'p2', title: 'P2', status: 'waiting', updatedAt: '2020-01-01T00:00:00.000Z' }),
      ],
    })
    const patch = applyTrackerStatusChanges(data, [change({ vandaagProjectId: 'p1', to: 'in_progress' })])
    const p1 = patch.projects!.find(p => p.id === 'p1')!
    const p2 = patch.projects!.find(p => p.id === 'p2')!
    expect(p1.status).toBe('in_progress')
    expect(p1.updatedAt).not.toBe('2020-01-01T00:00:00.000Z')
    expect(p2).toEqual(data.projects[1])
  })

  it('clears waitingOn when the new status is done, mirroring updateProject', () => {
    const waitingOn = [{ person: 'Bob', since: '2026-01-01' }]
    const data = baseData({ projects: [project({ id: 'p1', title: 'P1', status: 'waiting', waitingOn })] })
    const patch = applyTrackerStatusChanges(data, [change({ vandaagProjectId: 'p1', to: 'done' })])
    expect(patch.projects![0].waitingOn).toBeUndefined()
  })

  it('preserves waitingOn when the new status is not done', () => {
    const waitingOn = [{ person: 'Bob', since: '2026-01-01' }]
    const data = baseData({ projects: [project({ id: 'p1', title: 'P1', status: 'backlog', waitingOn })] })
    const patch = applyTrackerStatusChanges(data, [change({ vandaagProjectId: 'p1', to: 'in_progress' })])
    expect(patch.projects![0].waitingOn).toEqual(waitingOn)
  })

  it('contains no undefined values anywhere after JSON round-tripping (what stripUndefined relies on)', () => {
    const data = baseData({
      projects: [project({ id: 'p1', title: 'P1', status: 'waiting', waitingOn: [{ person: 'Bob', since: '2026-01-01' }] })],
    })
    const patch = applyTrackerStatusChanges(data, [change({ vandaagProjectId: 'p1', to: 'done' })])
    const roundTripped = JSON.parse(JSON.stringify(patch))
    expect('waitingOn' in roundTripped.projects[0]).toBe(false)
  })
})
