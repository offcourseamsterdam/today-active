/**
 * Pure logic for the deep-block counter: marking a deep block "done" for a
 * given date (mirroring the client's `completeDeepBlock`, src/store/helpers.ts)
 * and computing weekly/streak stats from the durable completion log.
 *
 * The log itself (`users/{uid}/deepBlockLog/{date}`) is a Firestore
 * subcollection, not a field on the main user doc — `dailyPlan.deepBlock`
 * only ever reflects *today*, and once a deep block is completed its
 * `projectId` is cleared (so its category can't be re-derived later), so
 * there is no durable place on the existing doc to recover category/history
 * from. A subcollection also sidesteps the whole-doc-overwrite hazard
 * documented in docs/plans/agent-api-and-data-model.md: `useFirestoreSync`
 * writes the *entire* `users/{uid}` doc on every save using a `SyncData`
 * shape the client doesn't know about this field, so a field there would be
 * silently dropped by the next client-side save.
 */
import type { SyncData } from './agentOps.js'
import { AgentOpError, amsterdamDateString, ensureTodayPlanForWrite } from './agentOps.js'
import type { Category, DailyPlan, Project } from '../../src/types/index.js'

export type DeepBlockLogCategory = 'marketing' | 'other'

export interface DeepBlockLogEntry {
  date: string // YYYY-MM-DD
  category: DeepBlockLogCategory
  projectId?: string
  projectTitle?: string
  completedAt: string // ISO
}

type Params = Record<string, unknown>

function badRequest(message: string): never {
  throw new AgentOpError(400, message)
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isValidDateString(v: string): boolean {
  if (!DATE_RE.test(v)) return false
  return !Number.isNaN(new Date(`${v}T00:00:00.000Z`).getTime())
}

/**
 * Marketing -> marketing; everything else (ops/admin/finance/product/personal) -> other.
 * The live tracker/app bundles have no "sales" category or signal anywhere (checked
 * CATEGORY_CONFIG and the tracker's own domain/status strings), so there's nothing to map
 * to a dedicated "sales" bucket — only the one category name happens to double as a
 * deep-block bucket name.
 */
export function categoryToDeepBlockBucket(category: Category): DeepBlockLogCategory {
  return category === 'marketing' ? 'marketing' : 'other'
}

/** Validates/defaults the `weeks` param shared by `deep_block_stats`. */
export function parseWeeksParam(params: Params): number {
  const v = params.weeks
  if (v === undefined) return 8
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 52) {
    badRequest('weeks must be an integer between 1 and 52')
  }
  return v
}

export interface DeepBlockCompletionPlan {
  patch: Partial<SyncData>
  entry: DeepBlockLogEntry
}

/**
 * Pure core of `complete_deep_block`. `date` defaults to today (Europe/Amsterdam).
 * When `date` is today, this also mirrors the client's `completeDeepBlock`: clears
 * `dailyPlan.deepBlock.projectId`, stamps `completedProjectTitle`/`completedAt` — rolling
 * over a stale `dailyPlan` first (same as `addToToday`), so the agent can call this at any
 * time of day. Idempotent: calling it again for a date whose deep block is already
 * completed is a no-op on `dailyPlan` (there's nothing left to clear) but still
 * (re)confirms the log entry for that date. For any other date, nothing in `dailyPlan` is
 * touched — only the log entry is produced, so a category must be supplied explicitly.
 */
export function buildDeepBlockCompletion(data: SyncData, params: Params, nowIso: string): DeepBlockCompletionPlan {
  const rawDate = params.date
  if (rawDate !== undefined && typeof rawDate !== 'string') badRequest('date must be a string')
  const date = (rawDate as string | undefined) ?? amsterdamDateString(0)
  if (!isValidDateString(date)) badRequest('date must be a YYYY-MM-DD date string')

  const rawCategory = params.category
  if (rawCategory !== undefined && rawCategory !== 'marketing' && rawCategory !== 'other') {
    badRequest('category must be one of: marketing, other')
  }
  const categoryParam = rawCategory as DeepBlockLogCategory | undefined

  const isToday = date === amsterdamDateString(0)
  const patch: Partial<SyncData> = {}
  let project: Project | undefined
  let completedProjectTitle: string | undefined

  if (isToday) {
    const { plan, patch: rolloverPatch } = ensureTodayPlanForWrite(data)
    Object.assign(patch, rolloverPatch)

    if (plan.deepBlock.projectId) {
      project = data.projects.find(p => p.id === plan.deepBlock.projectId)
      completedProjectTitle = project?.title ?? plan.deepBlock.completedProjectTitle
      patch.dailyPlan = {
        ...plan,
        deepBlock: {
          ...plan.deepBlock,
          projectId: '',
          completedProjectTitle,
          completedAt: nowIso,
        },
      }
    } else if (plan.deepBlock.completedProjectTitle) {
      // Already completed today — idempotent no-op on dailyPlan itself.
      completedProjectTitle = plan.deepBlock.completedProjectTitle
    } else {
      badRequest('No deep block set for today')
    }
  }

  const category = categoryParam ?? (project ? categoryToDeepBlockBucket(project.category) : undefined)
  if (category === undefined) {
    badRequest('category is required (no active deep block project to derive it from)')
  }

  const entry: DeepBlockLogEntry = {
    date,
    category,
    ...(project ? { projectId: project.id } : {}),
    ...(completedProjectTitle ? { projectTitle: completedProjectTitle } : {}),
    completedAt: nowIso,
  }

  return { patch, entry }
}

// ── deriving history entries for stats ─────────────────────────────────

function normalizeTitleForMatch(s: string): string {
  return s.trim().toLowerCase()
}

/**
 * Category for a completed deep block whose `projectId` has already been cleared (the
 * normal post-completion state — see the module doc comment): prefers an exact `projectId`
 * match against current Vandaag projects (defensive — nothing clears it today, but nothing
 * guarantees it never will), falling back to a case/whitespace-insensitive title match
 * against `completedProjectTitle`. `'other'` if neither resolves (project renamed/gone, or
 * no title was recorded).
 */
function deriveCategoryForCompletedDeepBlock(
  deepBlock: DailyPlan['deepBlock'],
  projects: readonly Project[],
): DeepBlockLogCategory {
  if (deepBlock.projectId) {
    const byId = projects.find(p => p.id === deepBlock.projectId)
    if (byId) return categoryToDeepBlockBucket(byId.category)
  }
  if (deepBlock.completedProjectTitle) {
    const normalized = normalizeTitleForMatch(deepBlock.completedProjectTitle)
    const byTitle = projects.find(p => normalizeTitleForMatch(p.title) === normalized)
    if (byTitle) return categoryToDeepBlockBucket(byTitle.category)
  }
  return 'other'
}

function deepBlockEntryFromPlan(
  date: string,
  deepBlock: DailyPlan['deepBlock'],
  projects: readonly Project[],
): DeepBlockLogEntry | undefined {
  if (!deepBlock.completedAt) return undefined
  return {
    date,
    category: deriveCategoryForCompletedDeepBlock(deepBlock, projects),
    ...(deepBlock.projectId ? { projectId: deepBlock.projectId } : {}),
    ...(deepBlock.completedProjectTitle ? { projectTitle: deepBlock.completedProjectTitle } : {}),
    completedAt: deepBlock.completedAt,
  }
}

/**
 * Derives `DeepBlockLogEntry`s from data the app already keeps, for dates with no explicit
 * `deepBlockLog` entry (e.g. a deep block completed purely through the UI, with no agent
 * call): every archived `planHistory[date]` with a completed deep block, plus today's live
 * `dailyPlan` if its deep block is already completed. Each plan's own `date` field (already
 * an Europe/Amsterdam date string, same convention used everywhere else in this module) is
 * the entry's date. Category is derived per `deriveCategoryForCompletedDeepBlock` since the
 * project id is normally already cleared by the time a plan is archived.
 */
export function deriveDeepBlockEntriesFromHistory(
  planHistory: Record<string, DailyPlan>,
  dailyPlan: DailyPlan | null,
  projects: readonly Project[],
): DeepBlockLogEntry[] {
  const entries: DeepBlockLogEntry[] = []
  for (const plan of Object.values(planHistory)) {
    const entry = deepBlockEntryFromPlan(plan.date, plan.deepBlock, projects)
    if (entry) entries.push(entry)
  }
  if (dailyPlan) {
    const entry = deepBlockEntryFromPlan(dailyPlan.date, dailyPlan.deepBlock, projects)
    if (entry) entries.push(entry)
  }
  return entries
}

/**
 * Merges the explicit `deepBlockLog` with history-derived entries, deduped by `date` — the
 * explicit log always wins for a date it covers (it carries an agent-supplied category
 * rather than a derived guess), so `primary` entries are applied last/on top.
 */
export function mergeDeepBlockEntries(primary: readonly DeepBlockLogEntry[], derived: readonly DeepBlockLogEntry[]): DeepBlockLogEntry[] {
  const byDate = new Map<string, DeepBlockLogEntry>()
  for (const entry of derived) byDate.set(entry.date, entry)
  for (const entry of primary) byDate.set(entry.date, entry)
  return [...byDate.values()]
}

// ── stats ───────────────────────────────────────────────────────────────

export interface DeepBlockWeekStat {
  isoWeek: string // e.g. "2026-W05"
  total: number
  byCategory: Record<DeepBlockLogCategory, number>
}

export interface DeepBlockStats {
  weeks: DeepBlockWeekStat[] // oldest -> newest
  total: number
  byCategory: Record<DeepBlockLogCategory, number>
  currentStreak: number
  longestStreak: number
}

function parseDateUTC(date: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function formatDateUTC(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDaysUTC(date: string, days: number): string {
  const d = parseDateUTC(date)
  d.setUTCDate(d.getUTCDate() + days)
  return formatDateUTC(d)
}

/** 0 = Monday .. 6 = Sunday (ISO weekday order), for a YYYY-MM-DD date string. */
function isoWeekday(date: string): number {
  const jsDay = parseDateUTC(date).getUTCDay() // 0 = Sunday .. 6 = Saturday
  return (jsDay + 6) % 7
}

function isWeekend(date: string): boolean {
  const wd = isoWeekday(date)
  return wd === 5 || wd === 6 // Sat, Sun
}

/**
 * Standard ISO-8601 week key ("YYYY-Www"): Monday-start weeks, the Thursday of a week
 * decides its ISO week-year. ISO week 1 of a year is, by definition, the week containing
 * that year's January 4th (equivalently: the week containing the year's first Thursday) —
 * anchoring on January 1st instead is wrong whenever Jan 1 falls on Fri/Sat/Sun, since then
 * the week containing Jan 1 actually belongs to the *previous* ISO year.
 */
export function isoWeekKey(date: string): string {
  const d = parseDateUTC(date)
  const weekday = isoWeekday(date) // 0 = Monday
  // Move to this week's Thursday — its calendar year is this week's ISO week-year.
  const thursday = new Date(d)
  thursday.setUTCDate(d.getUTCDate() - weekday + 3)
  const isoYear = thursday.getUTCFullYear()

  const jan4 = new Date(Date.UTC(isoYear, 0, 4))
  const jan4Weekday = (jan4.getUTCDay() + 6) % 7
  const firstThursday = new Date(jan4)
  firstThursday.setUTCDate(jan4.getUTCDate() - jan4Weekday + 3)

  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86_400_000))
  return `${isoYear}-W${String(week).padStart(2, '0')}`
}

function emptyByCategory(): Record<DeepBlockLogCategory, number> {
  return { marketing: 0, other: 0 }
}

/**
 * Pure core of `deep_block_stats`. `weeks` (default 8) selects the trailing N distinct ISO
 * weeks ending with the week containing `today` — stepping back 7 days at a time from
 * `today` always lands in a distinct earlier ISO week, so this works across year/week-year
 * boundaries without separate week-number arithmetic.
 *
 * Streaks count **workdays (Mon-Fri)** with at least one completion of any category;
 * weekends are transparent — they neither break nor extend a streak, but a weekend
 * completion still counts toward that week's totals. `currentStreak` gives "today" a grace
 * day: if today is a workday with no completion yet, that alone doesn't break the streak
 * (the day isn't over), but any *earlier* missed workday does. `longestStreak` is the max of
 * the longest fully-elapsed run and the (graced) current streak.
 */
export function computeDeepBlockStats(entries: readonly DeepBlockLogEntry[], today: string, weeks = 8): DeepBlockStats {
  const hasCompletion = new Map<string, DeepBlockLogEntry[]>()
  for (const entry of entries) {
    hasCompletion.set(entry.date, [...(hasCompletion.get(entry.date) ?? []), entry])
  }

  const weekKeys: string[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    weekKeys.push(isoWeekKey(addDaysUTC(today, -7 * i)))
  }
  const weekIndex = new Map(weekKeys.map((k, i) => [k, i]))
  const weekStats: DeepBlockWeekStat[] = weekKeys.map(isoWeek => ({ isoWeek, total: 0, byCategory: emptyByCategory() }))

  for (const [date, dayEntries] of hasCompletion) {
    const idx = weekIndex.get(isoWeekKey(date))
    if (idx === undefined) continue
    for (const entry of dayEntries) {
      weekStats[idx].total++
      weekStats[idx].byCategory[entry.category]++
    }
  }

  const total = weekStats.reduce((sum, w) => sum + w.total, 0)
  const byCategory = weekStats.reduce(
    (acc, w) => ({ marketing: acc.marketing + w.byCategory.marketing, other: acc.other + w.byCategory.other }),
    emptyByCategory(),
  )

  // Current streak: walk backward from today, skipping weekends, with a grace day for today.
  let currentStreak = 0
  let cursor = today
  let isFirst = true
  // Bound the walk so a sparse/empty log can't loop forever.
  for (let i = 0; i < 10_000; i++) {
    if (isWeekend(cursor)) {
      cursor = addDaysUTC(cursor, -1)
      continue
    }
    if (hasCompletion.has(cursor)) {
      currentStreak++
      cursor = addDaysUTC(cursor, -1)
      isFirst = false
      continue
    }
    if (isFirst) {
      cursor = addDaysUTC(cursor, -1)
      isFirst = false
      continue
    }
    break
  }

  // Longest streak: scan forward from the earliest entry (or today, if there is none) to
  // today, resetting on every missed workday (no grace — these days are all fully elapsed).
  const dates = [...hasCompletion.keys()].sort()
  let longestStreak = currentStreak
  if (dates.length > 0) {
    let run = 0
    let d = dates[0]
    while (d <= today) {
      if (isWeekend(d)) {
        // transparent
      } else if (hasCompletion.has(d)) {
        run++
        longestStreak = Math.max(longestStreak, run)
      } else {
        run = 0
      }
      d = addDaysUTC(d, 1)
    }
  }

  return { weeks: weekStats, total, byCategory, currentStreak, longestStreak }
}
