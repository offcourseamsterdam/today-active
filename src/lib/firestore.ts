import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from './firebase'
import { deepClean } from './utils'
import type { Project, Task, Meeting, Settings, DailyPlan, WriteAwayEntry } from '../types'

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
  personalRules: string[]
  writeAway: WriteAwayEntry[]
  syncedAt: string
}

/**
 * Returns null when no document exists yet (first login).
 * Throws on network / permission errors so callers can distinguish the two cases.
 */
export async function loadUserData(uid: string): Promise<SyncData | null> {
  const snap = await getDoc(doc(db, 'users', uid))
  if (!snap.exists()) return null
  return snap.data() as SyncData
}

export async function saveUserData(uid: string, data: SyncData): Promise<void> {
  try {
    await setDoc(doc(db, 'users', uid), deepClean(data))
  } catch (err) {
    console.error('[Firestore] save failed:', err)
  }
}
