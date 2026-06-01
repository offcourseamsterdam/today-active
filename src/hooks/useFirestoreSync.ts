import { useEffect, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import { useStore } from '../store'
import { loadUserData, saveUserData, type SyncData } from '../lib/firestore'
import { publishSharedProjectWithMerge } from '../lib/shareProject'

// Key used to track when we last successfully wrote to Firestore
const LOCAL_SYNC_KEY = 'vandaag-synced-at'

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
    personalRules: s.personalRules,
    writeAway: s.writeAwayEntries,
    syncedAt: new Date().toISOString(),
  }
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

export function useFirestoreSync(user: User | null): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>('idle')
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Prevents store subscription from triggering a Firestore write
  // while we're loading Firestore data into the store
  const isSyncingRef = useRef(false)

  useEffect(() => {
    if (!user) {
      setStatus('idle')
      return
    }

    const uid = user.uid

    // ── 1. Load from Firestore on login ──────────────────────────────────────
    ;(async () => {
      isSyncingRef.current = true
      setStatus('loading')

      try {
        const remote = await loadUserData(uid)

        if (remote) {
          const localSyncedAt = localStorage.getItem(LOCAL_SYNC_KEY) ?? ''

          if (remote.syncedAt > localSyncedAt) {
            // Cloud is newer → apply remote data to store
            useStore.setState({
              projects: remote.projects ?? [],
              orphanTasks: remote.orphanTasks ?? [],
              recurringTasks: remote.recurringTasks ?? [],
              meetings: remote.meetings ?? [],
              recurringMeetings: remote.recurringMeetings ?? [],
              settings: { ...useStore.getState().settings, ...remote.settings },
              dailyPlan: remote.dailyPlan ?? null,
              tomorrowPlan: remote.tomorrowPlan ?? null,
              personalRules: remote.personalRules ?? [],
              writeAwayEntries: remote.writeAway ?? [],
            })
          } else {
            // Local is newer (or same) → push local up to cloud
            const local = extractSyncData()
            await saveUserData(uid, local)
            localStorage.setItem(LOCAL_SYNC_KEY, local.syncedAt)
          }
        } else {
          // No cloud data yet → first login, push everything up
          const local = extractSyncData()
          await saveUserData(uid, local)
          localStorage.setItem(LOCAL_SYNC_KEY, local.syncedAt)
        }

        setStatus('synced')
      } catch (err) {
        console.error('[Firestore] sync failed:', err)
        setStatus('error')
      } finally {
        // Always release the sync lock so debounced saves can proceed
        isSyncingRef.current = false
      }
    })()

    // ── 2. Debounced save on every store change ───────────────────────────────
    const unsub = useStore.subscribe(() => {
      if (isSyncingRef.current) return

      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      setStatus('saving')

      saveTimeoutRef.current = setTimeout(async () => {
        const data = extractSyncData()
        await saveUserData(uid, data)
        localStorage.setItem(LOCAL_SYNC_KEY, data.syncedAt)
        // Auto-update any publicly shared project docs
        syncSharedProjects(user.displayName ?? undefined)
        setStatus('synced')
      }, 3000)
    })

    // ── 3. Final save when user logs out or tab closes ────────────────────────
    const handleUnload = () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      const data = extractSyncData()
      saveUserData(uid, data) // best-effort async
    }
    window.addEventListener('beforeunload', handleUnload)

    return () => {
      unsub()
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      window.removeEventListener('beforeunload', handleUnload)
      // Final save on effect cleanup (user logs out)
      saveUserData(uid, extractSyncData())
    }
  }, [user])

  return status
}
