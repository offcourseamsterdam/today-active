import { differenceInDays, format } from 'date-fns'
import type { WaitingOn } from '../types'

export function daysSince(dateString: string): number {
  return differenceInDays(new Date(), new Date(dateString))
}

export function formatDate(dateString: string): string {
  return format(new Date(dateString), 'MMM d, yyyy')
}

export function getWaitingStatus(dayCount: number): 'normal' | 'amber' | 'red' {
  if (dayCount >= 14) return 'red'
  if (dayCount >= 7) return 'amber'
  return 'normal'
}

export function getWaitingLabel(dayCount: number): string {
  if (dayCount >= 14) return `${dayCount} days — time to act`
  if (dayCount >= 7) return `${dayCount} days — follow up?`
  return `${dayCount} days`
}

export function normalizeWaitingOn(raw: unknown): WaitingOn[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw as WaitingOn[]
  const obj = raw as WaitingOn
  if (obj.person && obj.since) return [obj]
  return []
}

export function isWaitingSnoozed(entry: WaitingOn, today: Date = new Date()): boolean {
  if (!entry.snoozedUntil) return false
  return new Date(entry.snoozedUntil) > today
}

/** Strip undefined values — Firestore does not accept undefined */
export function deepClean<T>(val: T): T {
  return JSON.parse(JSON.stringify(val, (_, v) => (v === undefined ? null : v)))
}
