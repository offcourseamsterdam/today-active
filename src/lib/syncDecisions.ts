/**
 * Pure decision logic for useFirestoreSync.ts, pulled out so the tricky bits
 * (what to do with the very first snapshot, whether an incoming snapshot is
 * our own write echoing back) are testable without React or Firestore.
 */
import type { SyncData } from './firestore'

export type FirstSnapshotDecision =
  | { action: 'apply-remote'; base: SyncData }
  | { action: 'push-local'; base: SyncData | null; hasLocalChanges: boolean }

/**
 * Login-time decision: cloud newer than what this browser last synced →
 * adopt it. Otherwise push local up — but if a remote doc exists (even one
 * older than local), it becomes the merge base and local is treated as
 * having pending changes, so the upcoming save does a real transaction
 * compare instead of blindly overwriting whatever is actually there by the
 * time it commits. `base: null` only happens when there's no remote doc at
 * all (true first login).
 */
export function decideFirstSnapshot(remote: SyncData | null, localSyncedAt: string): FirstSnapshotDecision {
  if (remote && remote.syncedAt > localSyncedAt) {
    return { action: 'apply-remote', base: remote }
  }
  return { action: 'push-local', base: remote, hasLocalChanges: remote !== null }
}

/**
 * True when an incoming snapshot should be ignored because it's not a
 * genuine external change: either it matches the merge base we already have
 * (a no-op/already-applied snapshot), or its syncedAt is one this client
 * itself just wrote — the server-ack snapshot for our own write can arrive
 * before the write's own promise resolves (and thus before `base` gets
 * updated), so the base comparison alone isn't always enough.
 */
export function isOwnSnapshot(
  remoteSyncedAt: string,
  baseSyncedAt: string | undefined,
  recentOwnWrites: ReadonlySet<string>,
): boolean {
  if (baseSyncedAt !== undefined && remoteSyncedAt === baseSyncedAt) return true
  return recentOwnWrites.has(remoteSyncedAt)
}

export interface PersistOutcome {
  /** Safe to mark "no pending local changes" — nothing changed while the save was in flight. */
  clearLocalChanges: boolean
  /** A local edit landed while the save was in flight — run persistOnce again before settling. */
  rerunNeeded: boolean
  /**
   * What to apply to the store, if anything:
   * - 'none': nothing to apply (no merge happened, or nothing in `written`
   *   isn't already reflected locally).
   * - 'written': apply the save's merge result as-is — safe because nothing
   *   local changed since this save captured its snapshot.
   * - 'merge-with-newer-local': a merge happened AND a newer local edit
   *   landed mid-save, so `written` alone would be missing that edit, while
   *   applying it directly would make the *next* save look like the newer
   *   edit was a local deletion of whatever `written` merged in (e.g. an
   *   agent-added task) — base would become `written` but local (the
   *   store, untouched) wouldn't have the agent's addition. The caller must
   *   instead fold `written` into the current store via
   *   `mergeSyncData(sent, current, written)` — sent as base, current
   *   store as local, `written` as remote — so both the remote-merged
   *   content and the newer local edit survive.
   */
  applyToStore: 'none' | 'written' | 'merge-with-newer-local'
}

/**
 * What to do after a save transaction resolves, given whether the store
 * changed again while it was in flight (tracked via a version counter bumped
 * on every local edit). `extractSyncData()` is called synchronously before
 * the `await`, so if the version is still the same afterwards, nothing new
 * happened and the save fully captured the current state; if it moved, a
 * newer edit exists that this save never saw — it must not be marked synced,
 * and a rerun is needed so it gets saved against `written` as the new base.
 */
export function decidePersistOutcome(params: {
  merged: boolean
  versionAtStart: number
  currentVersion: number
}): PersistOutcome {
  const versionChanged = params.currentVersion !== params.versionAtStart
  return {
    clearLocalChanges: !versionChanged,
    rerunNeeded: versionChanged,
    applyToStore: !params.merged ? 'none' : versionChanged ? 'merge-with-newer-local' : 'written',
  }
}
