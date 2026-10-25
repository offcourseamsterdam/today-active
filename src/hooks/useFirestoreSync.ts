import { useEffect, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import { useStore } from '../store'
import { subscribeToUserData, saveUserDataGuarded, type SyncData } from '../lib/firestore'
import { decideFirstSnapshot, isOwnSnapshot, decidePersistOutcome } from '../lib/syncDecisions'
import { mergeSyncData } from '../lib/syncMerge'
import { publishSharedProjectWithMerge } from '../lib/shareProject'

// Key used to track when we last successfully wrote to Firestore
const LOCAL_SYNC_KEY = 'vandaag-synced-at'
const RETRY_BASE_DELAY_MS = 10_000
const RETRY_MAX_DELAY_MS = 60_000
const OWN_WRITES_TRACKED = 5

function extractSyncData(): SyncData {
  const s = useStore.getState()
  return {
    projects: s.projects,
    orphanTasks: s.orphanTasks,
    recurringTasks: s.recurringTasks,
    meetings: s.meetings,
    recurringMeetings: s.recurringMeetings,
    settings: s.settings,
    dailyPlan: s.dailyPlan,
    tomorrowPlan: s.tomorrowPlan,
    planHistory: s.planHistory,
    weekSlots: s.weekSlots,
    goals: s.goals,
    personalRules: s.personalRules,
    writeAway: s.writeAwayEntries,
    syncedAt: new Date().toISOString(),
  }
}

function applyToStore(data: SyncData) {
  useStore.setState({
    projects: data.projects ?? [],
    orphanTasks: data.orphanTasks ?? [],
    recurringTasks: data.recurringTasks ?? [],
    meetings: data.meetings ?? [],
    recurringMeetings: data.recurringMeetings ?? [],
    settings: { ...useStore.getState().settings, ...data.settings },
    dailyPlan: data.dailyPlan ?? null,
    tomorrowPlan: data.tomorrowPlan ?? null,
    planHistory: data.planHistory ?? {},
    weekSlots: data.weekSlots ?? {},
    goals: data.goals ?? [],
    personalRules: data.personalRules ?? [],
    writeAwayEntries: data.writeAway ?? [],
  })
}

/** Best-effort update of all publicly shared project docs (fire & forget) */
function syncSharedProjects(displayName?: string) {
  const s = useStore.getState()
  const allMeetings = [...s.meetings, ...s.recurringMeetings]
  for (const project of s.projects) {
    if (!project.shareId) continue
    const projectMeetings = allMeetings.filter(m => m.projectId === project.id)
    publishSharedProjectWithMerge(project, projectMeetings, displayName).catch(() => {
      // silent — best-effort background sync
    })
  }
}

export type SyncStatus = 'idle' | 'loading' | 'saving' | 'synced' | 'error'

/**
 * Firestore sync, overwrite-safe.
 *
 * `baseRef` holds the last snapshot this client has seen-or-written — the
 * common ancestor for three-way merges. Every write goes through
 * saveUserDataGuarded, which re-reads Firestore inside a transaction: if
 * nothing has moved since `baseRef` it writes the local store as-is,
 * otherwise it merges (base, local, remote) via src/lib/syncMerge.ts so a
 * concurrent write from elsewhere (the agent API, another tab) is merged in
 * rather than clobbered. An onSnapshot listener keeps `baseRef` current and
 * applies remote-only changes straight to the store when there's nothing
 * local to protect; when local edits are pending, it triggers an immediate
 * guarded save (which performs the merge) instead of waiting for the next
 * change or the debounce timer.
 *
 * Saves are serialized through `requestSave` (never two transactions in
 * flight at once; at most one rerun is coalesced if a save is requested
 * mid-flight), retried with backoff on failure (e.g. offline — unlike the
 * old blind `setDoc`, a transaction doesn't queue while offline), and
 * retried immediately when the browser comes back online.
 *
 * `localVersionRef` guards the remaining race: a save's transaction is async,
 * so an edit can land in the store after `extractSyncData()` already
 * captured a snapshot for it but before it resolves. persistOnce captures
 * the version up front and compares it after — if it moved, the save result
 * is not marked synced and not applied over the store (see
 * decidePersistOutcome), and a rerun is queued instead.
 */
export function useFirestoreSync(user: User | null): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>('idle')
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryDelayRef = useRef(RETRY_BASE_DELAY_MS)
  // Last snapshot seen-or-written — the merge base for the next save.
  const baseRef = useRef<SyncData | null>(null)
  // True from the moment the store changes locally (or a save fails) until the next successful save.
  const hasLocalChangesRef = useRef(false)
  // Prevents the store subscription from treating a programmatic applyToStore
  // call (remote data flowing in) as a local edit that needs saving.
  const isApplyingRemoteRef = useRef(false)
  const isFirstSnapshotRef = useRef(true)
  // Serializes requestSave(): true while a transaction is in flight.
  const isSavingRef = useRef(false)
  // Set when requestSave() is called again while one is already in flight —
  // causes exactly one more run after the current one finishes.
  const rerunRequestedRef = useRef(false)
  // syncedAt values this client just wrote, recognized even if the server-ack
  // snapshot arrives before saveUserDataGuarded's own promise resolves.
  const recentOwnWritesRef = useRef<Set<string>>(new Set())
  // Bumped on every real local edit — lets persistOnce detect whether the
  // store changed again while its save was in flight.
  const localVersionRef = useRef(0)

  useEffect(() => {
    if (!user) return

    const uid = user.uid
    const displayName = user.displayName ?? undefined
    baseRef.current = null
    hasLocalChangesRef.current = false
    isFirstSnapshotRef.current = true
    isSavingRef.current = false
    rerunRequestedRef.current = false
    retryDelayRef.current = RETRY_BASE_DELAY_MS
    recentOwnWritesRef.current = new Set()
    localVersionRef.current = 0

    const rememberOwnWrite = (syncedAt: string) => {
      const set = recentOwnWritesRef.current
      set.add(syncedAt)
      if (set.size > OWN_WRITES_TRACKED) {
        const oldest = set.values().next().value
        if (oldest !== undefined) set.delete(oldest)
      }
    }

    const scheduleRetry = () => {
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current)
      const delay = retryDelayRef.current
      retryTimeoutRef.current = setTimeout(() => {
        retryTimeoutRef.current = null
        void requestSave()
      }, delay)
      retryDelayRef.current = Math.min(delay * 2, RETRY_MAX_DELAY_MS)
    }

    const persistOnce = async (): Promise<void> => {
      if (!hasLocalChangesRef.current && baseRef.current) return

      setStatus('saving')
      // Captured synchronously alongside extractSyncData() below — if this is
      // still the version by the time the save resolves, nothing edited the
      // store while the (async) transaction was in flight.
      const versionAtStart = localVersionRef.current
      try {
        const sent = extractSyncData()
        const { written, merged } = await saveUserDataGuarded(uid, baseRef.current, sent, w =>
          rememberOwnWrite(w.syncedAt),
        )
        baseRef.current = written
        localStorage.setItem(LOCAL_SYNC_KEY, written.syncedAt)

        const outcome = decidePersistOutcome({
          merged,
          versionAtStart,
          currentVersion: localVersionRef.current,
        })
        if (outcome.clearLocalChanges) {
          hasLocalChangesRef.current = false
        } else {
          // A local edit landed while this save was in flight — rerun once
          // more (requestSave's loop) so it gets saved against `written` as
          // the new base.
          hasLocalChangesRef.current = true
          rerunRequestedRef.current = true
        }

        if (outcome.applyToStore === 'written') {
          isApplyingRemoteRef.current = true
          applyToStore(written)
          isApplyingRemoteRef.current = false
        } else if (outcome.applyToStore === 'merge-with-newer-local') {
          // `written` merged in remote-only changes (e.g. an agent addition)
          // relative to `sent`, but the store has since moved past `sent` too.
          // Applying `written` as-is would stamp over the newer edit; applying
          // nothing would leave the store without what `written` merged in, so
          // the *next* save (base=written, local=store) would see that as a
          // local deletion. Fold instead: sent is the common ancestor, the
          // current store is "local", `written` is "remote".
          const current = extractSyncData()
          const folded = mergeSyncData(sent, current, written)
          isApplyingRemoteRef.current = true
          applyToStore(folded)
          isApplyingRemoteRef.current = false
        }

        syncSharedProjects(displayName)
        retryDelayRef.current = RETRY_BASE_DELAY_MS
        if (retryTimeoutRef.current) {
          clearTimeout(retryTimeoutRef.current)
          retryTimeoutRef.current = null
        }
        setStatus('synced')
      } catch (err) {
        console.error('[Firestore] save failed:', err)
        // Keep (or restore) the pending-changes flag so nothing is lost, and
        // retry — a Firestore transaction fails outright while offline
        // rather than queuing like the old setDoc used to.
        hasLocalChangesRef.current = true
        setStatus('error')
        scheduleRetry()
      }
    }

    const requestSave = async (): Promise<void> => {
      if (isSavingRef.current) {
        rerunRequestedRef.current = true
        return
      }
      isSavingRef.current = true
      try {
        do {
          rerunRequestedRef.current = false
          await persistOnce()
        } while (rerunRequestedRef.current)
      } finally {
        isSavingRef.current = false
      }
    }

    // ── 1. Live subscription — doubles as the initial load on its first emission ──
    const unsubscribeSnapshot = subscribeToUserData(uid, (remote, meta) => {
      // Our own optimistic write — wait for the server-acked copy below.
      if (meta.hasPendingWrites) return

      if (isFirstSnapshotRef.current) {
        isFirstSnapshotRef.current = false
        void (async () => {
          setStatus('loading')
          const localSyncedAt = localStorage.getItem(LOCAL_SYNC_KEY) ?? ''
          const decision = decideFirstSnapshot(remote, localSyncedAt)

          if (decision.action === 'apply-remote') {
            isApplyingRemoteRef.current = true
            applyToStore(decision.base)
            isApplyingRemoteRef.current = false
            baseRef.current = decision.base
            localStorage.setItem(LOCAL_SYNC_KEY, decision.base.syncedAt)
            setStatus('synced')
          } else {
            // Local is newer (or there's no cloud doc yet) — push it up. If a
            // remote doc exists, use it as the merge base (and mark local as
            // having pending changes) so the save below does a real transaction
            // compare instead of blindly overwriting whatever is actually
            // there by the time it commits.
            baseRef.current = decision.base
            hasLocalChangesRef.current = decision.hasLocalChanges
            await requestSave()
          }
        })()
        return
      }

      if (!remote) return
      if (isOwnSnapshot(remote.syncedAt, baseRef.current?.syncedAt, recentOwnWritesRef.current)) return

      if (!hasLocalChangesRef.current) {
        isApplyingRemoteRef.current = true
        applyToStore(remote)
        isApplyingRemoteRef.current = false
        baseRef.current = remote
        localStorage.setItem(LOCAL_SYNC_KEY, remote.syncedAt)
        setStatus('synced')
      } else {
        // Local edits are pending — merge them with this remote change right away
        // instead of letting the debounce timer fire a save that would ignore it.
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
        void requestSave()
      }
    })

    // ── 2. Debounced save on every store change ───────────────────────────────
    const unsubscribeStore = useStore.subscribe(() => {
      if (isApplyingRemoteRef.current) return
      hasLocalChangesRef.current = true
      localVersionRef.current += 1

      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      setStatus('saving')
      saveTimeoutRef.current = setTimeout(() => void requestSave(), 3000)
    })

    // ── 3. Retry promptly once the browser comes back online ──────────────────
    const handleOnline = () => {
      if (hasLocalChangesRef.current) void requestSave()
    }
    window.addEventListener('online', handleOnline)

    // ── 4. Final save when user logs out or tab closes ────────────────────────
    const handleUnload = () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      if (hasLocalChangesRef.current) void requestSave() // best-effort async; guarded, never blind-overwrites
    }
    window.addEventListener('beforeunload', handleUnload)

    return () => {
      unsubscribeSnapshot()
      unsubscribeStore()
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current)
      window.removeEventListener('beforeunload', handleUnload)
      window.removeEventListener('online', handleOnline)
      if (hasLocalChangesRef.current) void requestSave()
    }
  }, [user])

  return user ? status : 'idle'
}
