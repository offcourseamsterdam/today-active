import { describe, it, expect } from 'vitest'
import {
  diffEntityFields,
  buildChangeEntry,
  diffTrackerSnapshot,
  toTrackerSnapshot,
  listChanges,
  LIST_CHANGES_PAGE_SIZE,
  type ChangeEntry,
  type TrackerSnapshotDoc,
} from './changeLog'
import { AgentOpError } from './agentOps'
import type { TrackerProjectSummary } from './trackerOps'

function trackerProject(overrides: Partial<TrackerProjectSummary> & { id: string }): TrackerProjectSummary {
  return {
    title: 'Project',
    status: 'not_started',
    subtasks: [],
    assigneeIds: [],
    assignees: [],
    ...overrides,
  }
}

describe('diffEntityFields', () => {
  it('reports every present key as "after" when before is undefined (create)', () => {
    const { before, after } = diffEntityFields(undefined, { title: 'X', status: 'backlog', nextAction: undefined }, ['title', 'status', 'nextAction'])
    expect(before).toBeUndefined()
    expect(after).toEqual({ title: 'X', status: 'backlog' })
  })

  it('reports only the keys that changed', () => {
    const { before, after } = diffEntityFields(
      { title: 'Old', status: 'backlog' },
      { title: 'New', status: 'backlog' },
      ['title', 'status'],
    )
    expect(before).toEqual({ title: 'Old' })
    expect(after).toEqual({ title: 'New' })
  })

  it('returns no before/after when nothing in the key list changed', () => {
    const { before, after } = diffEntityFields({ title: 'Same' }, { title: 'Same' }, ['title'])
    expect(before).toBeUndefined()
    expect(after).toBeUndefined()
  })

  it('treats undefined-on-both-sides as unchanged', () => {
    const { before, after } = diffEntityFields({ title: 'X', nextAction: undefined }, { title: 'X', nextAction: undefined }, ['title', 'nextAction'])
    expect(before).toBeUndefined()
    expect(after).toBeUndefined()
  })

  it('deep-compares object values (e.g. marketingPeriod)', () => {
    const { after } = diffEntityFields(
      { marketingPeriod: { from: '2026-01-01' } },
      { marketingPeriod: { from: '2026-01-01' } },
      ['marketingPeriod'],
    )
    expect(after).toBeUndefined()

    const { after: changedAfter } = diffEntityFields(
      { marketingPeriod: { from: '2026-01-01' } },
      { marketingPeriod: { from: '2026-02-01' } },
      ['marketingPeriod'],
    )
    expect(changedAfter).toEqual({ marketingPeriod: { from: '2026-02-01' } })
  })
})

describe('buildChangeEntry', () => {
  it('omits before/after keys entirely when they are empty', () => {
    const entry = buildChangeEntry({ at: '2026-01-01T00:00:00.000Z', side: 'agent', entity: 'task', id: 't1', action: 'complete_task' })
    expect('before' in entry).toBe(false)
    expect('after' in entry).toBe(false)
  })

  it('keeps non-empty before/after', () => {
    const entry = buildChangeEntry({
      at: '2026-01-01T00:00:00.000Z',
      side: 'agent',
      entity: 'task',
      id: 't1',
      action: 'update_task',
      before: { title: 'Old' },
      after: { title: 'New' },
    })
    expect(entry.before).toEqual({ title: 'Old' })
    expect(entry.after).toEqual({ title: 'New' })
  })
})

describe('toTrackerSnapshot', () => {
  it('reduces tracker projects to the minimal id/title/status/subtasks shape', () => {
    const snapshot = toTrackerSnapshot([
      trackerProject({
        id: 't1',
        title: 'Project One',
        status: 'in_progress',
        urgency: 'high',
        subtasks: [{ id: 's1', title: 'Sub', done: false, vandaagTaskId: 'task-1' }],
      }),
    ])
    expect(snapshot.projects).toEqual([
      { id: 't1', title: 'Project One', status: 'in_progress', subtasks: [{ id: 's1', title: 'Sub', done: false, vandaagTaskId: 'task-1' }] },
    ])
  })

  it('drops subtasks with no stable id (legacy string-form subtasks)', () => {
    const snapshot = toTrackerSnapshot([trackerProject({ id: 't1', subtasks: [{ title: 'Legacy', done: false }] })])
    expect(snapshot.projects[0].subtasks).toEqual([])
  })

  it('omits vandaagTaskId when unset', () => {
    const snapshot = toTrackerSnapshot([trackerProject({ id: 't1', subtasks: [{ id: 's1', title: 'Sub', done: true }] })])
    expect(snapshot.projects[0].subtasks[0]).toEqual({ id: 's1', title: 'Sub', done: true })
  })
})

describe('diffTrackerSnapshot', () => {
  const AT = '2026-01-01T00:00:00.000Z'

  it('reports a brand-new project (and its subtasks) as added when there is no prior snapshot', () => {
    const entries = diffTrackerSnapshot(undefined, [
      { id: 't1', title: 'New', status: 'not_started', subtasks: [{ id: 's1', title: 'Sub', done: false }] },
    ], AT)
    expect(entries).toEqual([
      { at: AT, side: 'tracker', entity: 'project', id: 't1', action: 'added', after: { title: 'New', status: 'not_started' } },
      { at: AT, side: 'tracker', entity: 'subtask', id: 's1', action: 'added', after: { title: 'Sub', done: false } },
    ])
  })

  it('reports a project title/status change with only the changed fields', () => {
    const old: TrackerSnapshotDoc = { projects: [{ id: 't1', title: 'Old', status: 'not_started', subtasks: [] }] }
    const entries = diffTrackerSnapshot(old, [{ id: 't1', title: 'Old', status: 'in_progress', subtasks: [] }], AT)
    expect(entries).toEqual([
      { at: AT, side: 'tracker', entity: 'project', id: 't1', action: 'updated', before: { status: 'not_started' }, after: { status: 'in_progress' } },
    ])
  })

  it('reports a removed project', () => {
    const old: TrackerSnapshotDoc = { projects: [{ id: 't1', title: 'Gone', status: 'not_started', subtasks: [] }] }
    const entries = diffTrackerSnapshot(old, [], AT)
    expect(entries).toEqual([
      { at: AT, side: 'tracker', entity: 'project', id: 't1', action: 'removed', before: { title: 'Gone', status: 'not_started' } },
    ])
  })

  it('reports subtask added/removed/updated, including for unlinked subtasks', () => {
    const old: TrackerSnapshotDoc = {
      projects: [{
        id: 't1',
        title: 'P',
        status: 'not_started',
        subtasks: [
          { id: 's1', title: 'Keep but toggle', done: false },
          { id: 's2', title: 'Will be removed', done: false },
        ],
      }],
    }
    const entries = diffTrackerSnapshot(old, [{
      id: 't1',
      title: 'P',
      status: 'not_started',
      subtasks: [
        { id: 's1', title: 'Keep but toggle', done: true },
        { id: 's3', title: 'Brand new', done: false },
      ],
    }], AT)

    expect(entries).toContainEqual({ at: AT, side: 'tracker', entity: 'subtask', id: 's1', action: 'updated', before: { done: false }, after: { done: true } })
    expect(entries).toContainEqual({ at: AT, side: 'tracker', entity: 'subtask', id: 's3', action: 'added', after: { title: 'Brand new', done: false } })
    expect(entries).toContainEqual({ at: AT, side: 'tracker', entity: 'subtask', id: 's2', action: 'removed', before: { title: 'Will be removed', done: false } })
  })

  it('reports nothing when the tracker state matches the snapshot exactly', () => {
    const snapshot: TrackerSnapshotDoc = {
      projects: [{ id: 't1', title: 'P', status: 'not_started', subtasks: [{ id: 's1', title: 'Sub', done: false }] }],
    }
    const entries = diffTrackerSnapshot(snapshot, snapshot.projects, AT)
    expect(entries).toEqual([])
  })

  it('reports a vandaagTaskId being stamped onto a subtask as an update', () => {
    const old: TrackerSnapshotDoc = { projects: [{ id: 't1', title: 'P', status: 'not_started', subtasks: [{ id: 's1', title: 'Sub', done: false }] }] }
    const entries = diffTrackerSnapshot(old, [
      { id: 't1', title: 'P', status: 'not_started', subtasks: [{ id: 's1', title: 'Sub', done: false, vandaagTaskId: 'task-1' }] },
    ], AT)
    expect(entries).toEqual([
      { at: AT, side: 'tracker', entity: 'subtask', id: 's1', action: 'updated', after: { vandaagTaskId: 'task-1' } },
    ])
  })
})

/**
 * Minimal fake scoped to exactly what `listChanges` queries: a single `changes` collection
 * supporting `where`/`orderBy`/`limit`/`startAfter`/`get` — enough to exercise real
 * multi-page pagination (unlike a tiny fixture, which would never span a page boundary).
 */
function makeFakeChangesDb(entries: Array<ChangeEntry & { id: string }>) {
  const stored = entries.map(e => [e.id, e] as [string, ChangeEntry])

  function makeQuery(
    filters: Array<(d: ChangeEntry) => boolean>,
    order?: { field: string; dir: 'asc' | 'desc' },
    limitN?: number,
    cursorAfterId?: string,
  ) {
    function matching(): Array<[string, ChangeEntry]> {
      let list = stored.filter(([, d]) => filters.every(f => f(d)))
      if (order) {
        list = [...list].sort((a, b) => {
          const av = (a[1] as unknown as Record<string, string>)[order.field]
          const bv = (b[1] as unknown as Record<string, string>)[order.field]
          const cmp = av < bv ? -1 : av > bv ? 1 : 0
          return order.dir === 'desc' ? -cmp : cmp
        })
      }
      if (cursorAfterId !== undefined) {
        const idx = list.findIndex(([id]) => id === cursorAfterId)
        list = idx === -1 ? [] : list.slice(idx + 1)
      }
      if (limitN !== undefined) list = list.slice(0, limitN)
      return list
    }
    return {
      where: (field: string, op: '==' | '<' | '>=', value: unknown) =>
        makeQuery(
          [
            ...filters,
            (d: ChangeEntry) => {
              const v = (d as unknown as Record<string, string>)[field]
              if (op === '==') return v === value
              if (op === '<') return v < (value as string)
              return v >= (value as string)
            },
          ],
          order,
          limitN,
          cursorAfterId,
        ),
      orderBy: (field: string, dir: 'asc' | 'desc' = 'asc') => makeQuery(filters, { field, dir }, limitN, cursorAfterId),
      limit: (n: number) => makeQuery(filters, order, n, cursorAfterId),
      startAfter: (doc: { id: string }) => makeQuery(filters, order, limitN, doc.id),
      get: async () => {
        const docs = matching().map(([id, d]) => ({ id, data: () => d }))
        return { docs, empty: docs.length === 0 }
      },
    }
  }

  const changesQuery = makeQuery([])
  return {
    collection: () => ({ doc: () => ({ collection: () => changesQuery }) }),
  } as never
}

function entryAt(id: string, at: string, overrides: Partial<ChangeEntry> = {}): ChangeEntry & { id: string } {
  return { id, at, side: 'vandaag', entity: 'project', action: 'test', ...overrides }
}

describe('listChanges', () => {
  it('rejects a non-ISO since value', async () => {
    await expect(listChanges(makeFakeChangesDb([]) as never, 'uid1', { since: 'not a date' })).rejects.toThrow(AgentOpError)
  })

  it('accepts a date-only since value', async () => {
    const db = makeFakeChangesDb([entryAt('d1', '2026-01-02T00:00:00.000Z')])
    const result = await listChanges(db as never, 'uid1', { since: '2026-01-01' })
    expect(result).toHaveLength(1)
  })

  it('rejects an invalid side/entity/limit', async () => {
    const db = makeFakeChangesDb([])
    await expect(listChanges(db as never, 'uid1', { side: 'bogus' })).rejects.toThrow(AgentOpError)
    await expect(listChanges(db as never, 'uid1', { entity: 'bogus' })).rejects.toThrow(AgentOpError)
    await expect(listChanges(db as never, 'uid1', { limit: -1 })).rejects.toThrow(AgentOpError)
  })

  it('returns newest first and respects limit', async () => {
    const db = makeFakeChangesDb([
      entryAt('d1', '1000000000'),
      entryAt('d2', '1000000002'),
      entryAt('d3', '1000000001'),
    ])
    const result = await listChanges(db as never, 'uid1', { limit: 2 })
    expect(result.map(e => e.at)).toEqual(['1000000002', '1000000001'])
  })

  it('filters by side/entity across a page boundary without skipping same-timestamp entries', async () => {
    // Construct the sorted-descending order explicitly: 199 entries with strictly
    // decreasing `at` values occupy positions 0..198 (all of page 1 but one slot), a tied
    // pair sharing one `at` value occupies positions 199 and 200 — straddling the
    // LIST_CHANGES_PAGE_SIZE (200) page split — and 4 more entries with smaller values
    // trail after. A naive `where('at', '<', lastAt)` pagination cursor would silently
    // drop the second entry of the tied pair (it's not "<" the first one's value); this
    // uses a real document cursor (`startAfter`), so it must not.
    const entries: Array<ChangeEntry & { id: string }> = []
    for (let i = 0; i < LIST_CHANGES_PAGE_SIZE - 1; i++) {
      entries.push(entryAt(`head${i}`, String(9_000_000_000 - i).padStart(10, '0')))
    }
    const boundaryAt = String(9_000_000_000 - (LIST_CHANGES_PAGE_SIZE - 1)).padStart(10, '0')
    entries.push(entryAt('boundary-page1', boundaryAt)) // last entry of page 1
    entries.push(entryAt('boundary-page2', boundaryAt, { side: 'agent' })) // first entry of page 2 — the one we're filtering for
    for (let i = 0; i < 4; i++) {
      entries.push(entryAt(`tail${i}`, String(8_000_000_000 - i).padStart(10, '0')))
    }

    const db = makeFakeChangesDb(entries)
    const result = await listChanges(db as never, 'uid1', { side: 'agent', limit: 10 })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ at: boundaryAt, side: 'agent' })
  })

  it('stops scanning at LIST_CHANGES_SCAN_CAP even if the filter never matches', async () => {
    const entries = Array.from({ length: LIST_CHANGES_PAGE_SIZE + 5 }, (_, i) =>
      entryAt(`d${i}`, String(1_000_000_000 + i).padStart(10, '0'), { side: 'tracker' }),
    )
    const db = makeFakeChangesDb(entries)
    const result = await listChanges(db as never, 'uid1', { side: 'agent', limit: 10 })
    expect(result).toEqual([])
  })
})
