import { describe, it, expect } from 'vitest'
import { decideFirstSnapshot, isOwnSnapshot, decidePersistOutcome } from './syncDecisions'
import type { SyncData } from './firestore'

function sync(syncedAt: string): SyncData {
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
    syncedAt,
  }
}

describe('decideFirstSnapshot', () => {
  it('adopts remote when it is newer than what this browser last synced', () => {
    const remote = sync('2026-02-01T00:00:00.000Z')
    const decision = decideFirstSnapshot(remote, '2026-01-01T00:00:00.000Z')
    expect(decision).toEqual({ action: 'apply-remote', base: remote })
  })

  it('pushes local up with base=null when there is no remote doc at all', () => {
    const decision = decideFirstSnapshot(null, '2026-01-01T00:00:00.000Z')
    expect(decision).toEqual({ action: 'push-local', base: null, hasLocalChanges: false })
  })

  it('pushes local up but uses the (older) remote as the merge base when one exists', () => {
    const remote = sync('2026-01-01T00:00:00.000Z')
    const decision = decideFirstSnapshot(remote, '2026-02-01T00:00:00.000Z')
    expect(decision).toEqual({ action: 'push-local', base: remote, hasLocalChanges: true })
  })

  it('pushes local up when syncedAt ties (equal is not "newer")', () => {
    const remote = sync('2026-01-01T00:00:00.000Z')
    const decision = decideFirstSnapshot(remote, '2026-01-01T00:00:00.000Z')
    expect(decision.action).toBe('push-local')
    expect(decision).toMatchObject({ base: remote, hasLocalChanges: true })
  })
})

describe('isOwnSnapshot', () => {
  it('recognizes a snapshot matching the current base as a no-op/echo', () => {
    expect(isOwnSnapshot('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', new Set())).toBe(true)
  })

  it('recognizes a snapshot matching a recently-written syncedAt even if base has not been updated yet', () => {
    // Simulates the server-ack snapshot arriving before saveUserDataGuarded's
    // own promise (and thus baseRef) resolves.
    const recentOwnWrites = new Set(['2026-03-01T00:00:00.000Z'])
    expect(isOwnSnapshot('2026-03-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', recentOwnWrites)).toBe(true)
  })

  it('treats a genuinely new remote syncedAt as external', () => {
    expect(isOwnSnapshot('2026-04-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', new Set())).toBe(false)
  })

  it('treats an undefined base as "no known base" rather than a match', () => {
    expect(isOwnSnapshot('2026-01-01T00:00:00.000Z', undefined, new Set())).toBe(false)
  })
})

describe('decidePersistOutcome', () => {
  it('clears local changes and applies the merge result as-is when nothing edited the store during the save', () => {
    expect(decidePersistOutcome({ merged: true, versionAtStart: 3, currentVersion: 3 })).toEqual({
      clearLocalChanges: true,
      rerunNeeded: false,
      applyToStore: 'written',
    })
  })

  it('clears local changes without touching the store when the save was a plain (unmerged) write', () => {
    expect(decidePersistOutcome({ merged: false, versionAtStart: 3, currentVersion: 3 })).toEqual({
      clearLocalChanges: true,
      rerunNeeded: false,
      applyToStore: 'none',
    })
  })

  it('REGRESSION: a newer local edit during a merged save must fold `written` in, not apply it as-is', () => {
    // The store changed (version bumped) while saveUserDataGuarded was in flight.
    // Applying `written` directly would stamp over the newer edit; applying nothing
    // would mean the *next* save (base=written, local=current store) treats whatever
    // `written` merged in (e.g. an agent-added task) as a local deletion, since the
    // store never actually received it. Must fold instead — see syncMerge.test.ts.
    expect(decidePersistOutcome({ merged: true, versionAtStart: 3, currentVersion: 4 })).toEqual({
      clearLocalChanges: false,
      rerunNeeded: true,
      applyToStore: 'merge-with-newer-local',
    })
  })

  it('a local edit during an unmerged save keeps changes pending and reruns, with nothing to apply', () => {
    expect(decidePersistOutcome({ merged: false, versionAtStart: 3, currentVersion: 4 })).toEqual({
      clearLocalChanges: false,
      rerunNeeded: true,
      applyToStore: 'none',
    })
  })
})
