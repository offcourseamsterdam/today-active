import { v4 as uuid } from 'uuid'
import {
  collection,
  doc,
  setDoc,
  getDocs,
  query,
  orderBy,
  limit as fbLimit,
  where,
} from 'firebase/firestore'
import { db } from './firebase'
import { deepClean } from './utils'
import type { AIFeedbackEntry } from '../types'

const COLLECTION = 'aiFeedback'

/** Append a feedback entry. Silent on failure — never blocks the user. */
export async function writeAIFeedback(
  uid: string,
  entry: Omit<AIFeedbackEntry, 'id' | 'createdAt'> & { id?: string; createdAt?: string }
): Promise<void> {
  try {
    const id = entry.id ?? uuid()
    const createdAt = entry.createdAt ?? new Date().toISOString()
    const full: AIFeedbackEntry = { ...entry, id, createdAt }
    await setDoc(doc(db, 'users', uid, COLLECTION, id), deepClean(full))
  } catch (err) {
    console.error('[aiFeedback] write failed:', err)
  }
}

/**
 * Load the most recent accepted/edited feedback for few-shot prompting.
 * Returns up to `limit` entries sorted by createdAt desc.
 * Rejected entries are excluded.
 */
export async function loadRecentAIFeedback(
  uid: string,
  limit = 15
): Promise<AIFeedbackEntry[]> {
  try {
    const q = query(
      collection(db, 'users', uid, COLLECTION),
      where('outcome', 'in', ['accepted', 'edited']),
      orderBy('createdAt', 'desc'),
      fbLimit(limit)
    )
    const snap = await getDocs(q)
    return snap.docs.map(d => d.data() as AIFeedbackEntry)
  } catch (err) {
    console.error('[aiFeedback] load failed:', err)
    return []
  }
}
