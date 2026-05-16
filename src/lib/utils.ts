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

/** Extract plain text from BlockNote JSON bodyContent string */
export function extractBlockNoteText(bodyContent: string, maxChars = 2000): string {
  if (!bodyContent) return ''
  try {
    const blocks = JSON.parse(bodyContent) as unknown[]
    return extractBlocks(blocks).trim().slice(0, maxChars)
  } catch {
    return ''
  }
}

function extractBlocks(blocks: unknown[]): string {
  if (!Array.isArray(blocks)) return ''
  return blocks.map(block => {
    if (!block || typeof block !== 'object') return ''
    const b = block as Record<string, unknown>
    const inline = Array.isArray(b.content)
      ? (b.content as unknown[]).map(c => {
          if (!c || typeof c !== 'object') return ''
          const item = c as Record<string, unknown>
          return item.type === 'text' ? String(item.text ?? '') : ''
        }).join('')
      : ''
    const children = Array.isArray(b.children) ? extractBlocks(b.children as unknown[]) : ''
    return [inline, children].filter(Boolean).join('\n')
  }).filter(Boolean).join('\n')
}
