import { doc, onSnapshot, runTransaction, type Unsubscribe } from 'firebase/firestore'
import { db } from './firebase'
import { deepClean } from './utils'
import { mergeSyncData } from './syncMerge'
import type { Project, Task, Meeting, Settings, DailyPlan, WriteAwayEntry, Goal } from '../types'

export interface SyncData {
  projects: Project[]
  orphanTasks: Task[]
  recurringTasks: Task[]
  meetings: Meeting[]
  recurringMeetings: Meeting[]
  settings: Settings
  dailyPlan: DailyPlan | null
  tomorrowPlan: DailyPlan | null
  planHistory: Record<string, DailyPlan>
  weekSlots: Record<string, string[]>
  goals: Goal[]
  personalRules: string[]
  writeAway: WriteAwayEntry[]
  syncedAt: string
}

export function subscribeToUserData(
  uid: string,
  onChange: (data: SyncData | null, meta: { hasPendingWrites: boolean }) => void,
): Unsubscribe {
  return onSnapshot(doc(db, 'users', uid), { includeMetadataChanges: true }, snap => {
    onChange(snap.exists() ? (snap.data() as SyncData) : null, { hasPendingWrites: snap.metadata.hasPendingWrites })
  })
}

/**
 * Transaction-guarded save — the fix for the "stale tab overwrites a fresh
 * agent-API write" problem. Reads the current remote doc inside the
 * transaction: if it hasn't moved since `base` (the last snapshot this
 * client saw/wrote), writes `local` as-is; otherwise three-way merges
 * (base, local, remote) and writes that instead. Returns the written data so
 * the caller can re-apply it to the store when a merge pulled in remote-only
 * changes.
 *
 * `onBeforeCommit` fires synchronously inside the transaction, before
 * `tx.set` — i.e. before this function's promise resolves. The caller uses
 * it to record the syncedAt it's about to write: the realtime listener's
 * server-acked snapshot for this exact write can otherwise arrive (and get
 * mistaken for an external change) before the `await` below returns.
 */
export async function saveUserDataGuarded(
  uid: string,
  base: SyncData | null,
  local: SyncData,
  onBeforeCommit?: (written: SyncData) => void,
): Promise<{ written: SyncData; merged: boolean }> {
  const ref = doc(db, 'users', uid)
  let written!: SyncData
  let merged = false
  await runTransaction(db, async tx => {
    const snap = await tx.get(ref)
    const remote = snap.exists() ? (snap.data() as SyncData) : null
    if (!remote || !base || remote.syncedAt === base.syncedAt) {
      merged = false
      written = { ...local, syncedAt: new Date().toISOString() }
    } else {
      merged = true
      written = { ...mergeSyncData(base, local, remote), syncedAt: new Date().toISOString() }
    }
    onBeforeCommit?.(written)
    tx.set(ref, deepClean(written))
  })
  return { written, merged }
}
