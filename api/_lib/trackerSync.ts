/**
 * Pure, framework-free bridge between Vandaag projects and the Off Course Project Tracker's
 * projects — no Firestore, no HTTP. Both sides are plain data already read by the caller
 * (`api/_lib/runAgentAction.ts`): Vandaag's own `Project[]` and `trackerOps.ts`'s
 * `TrackerProjectSummary[]`.
 */
import { AgentOpError } from './agentOps.js'
import type { SyncData } from './agentOps.js'
import type { Project, ProjectStatus } from '../../src/types/index.js'
import type { TrackerProjectSummary } from './trackerOps.js'

type Params = Record<string, unknown>

/** Tracker status -> Vandaag status. */
export const TRACKER_TO_VANDAAG_STATUS: Record<string, ProjectStatus> = {
  not_started: 'backlog',
  in_progress: 'in_progress',
  paused: 'waiting',
  completed: 'done',
}

/** Vandaag status -> tracker status (inverse of the above). */
export const VANDAAG_TO_TRACKER_STATUS: Record<ProjectStatus, string> = {
  backlog: 'not_started',
  in_progress: 'in_progress',
  waiting: 'paused',
  done: 'completed',
}

const SIMILARITY_THRESHOLD = 0.8

function normalizeTitle(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') // strip punctuation
    .replace(/\s+/g, ' ')
    .trim()
}

function jaccard(a: string, b: string): number {
  const setA = new Set(a.split(' ').filter(Boolean))
  const setB = new Set(b.split(' ').filter(Boolean))
  if (setA.size === 0 || setB.size === 0) return 0
  let intersection = 0
  for (const token of setA) if (setB.has(token)) intersection++
  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1])
      prev = tmp
    }
  }
  return dp[n]
}

function levenshteinRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  return 1 - levenshteinDistance(a, b) / maxLen
}

/** Normalized-title similarity in [0, 1]: 1 for an exact match, 0.95 for containment, else the better of token-Jaccard and a Levenshtein ratio. */
function titleSimilarity(normA: string, normB: string): number {
  if (!normA || !normB) return 0
  if (normA === normB) return 1
  if (normA.includes(normB) || normB.includes(normA)) return 0.95
  return Math.max(jaccard(normA, normB), levenshteinRatio(normA, normB))
}

export interface TrackerSyncStatusMismatch {
  vandaag: { id: string; title: string; status: ProjectStatus }
  tracker: { id: string; title: string; status: string }
  expected: { vandaagStatus: ProjectStatus; trackerStatus: string }
}

export interface TrackerSyncBrokenLink {
  vandaagProjectId: string
  title: string
  trackerProjectId: string
}

export interface TrackerSyncSuggestion {
  trackerId: string
  title: string
  score: number
}

export interface TrackerSyncUnlinkedVandaagProject {
  id: string
  title: string
  status: ProjectStatus
  suggestions: TrackerSyncSuggestion[]
}

export interface TrackerSyncUnlinkedTrackerProject {
  id: string
  title: string
  status: string
}

export interface TrackerSyncDuplicateTrackerLink {
  trackerId: string
  vandaagProjects: Array<{ id: string; title: string }>
}

export interface TrackerSyncTitleDuplicate {
  a: { id: string; title: string }
  b: { id: string; title: string }
  score: number
}

export interface TrackerSyncReport {
  statusMismatches: TrackerSyncStatusMismatch[]
  brokenLinks: TrackerSyncBrokenLink[]
  unlinkedVandaagProjects: TrackerSyncUnlinkedVandaagProject[]
  unlinkedTrackerProjects: TrackerSyncUnlinkedTrackerProject[]
  duplicates: {
    sameTrackerLink: TrackerSyncDuplicateTrackerLink[]
    vandaagTitleDuplicates: TrackerSyncTitleDuplicate[]
    trackerTitleDuplicates: TrackerSyncTitleDuplicate[]
  }
}

function findTitleDuplicates(items: Array<{ id: string; title: string }>): TrackerSyncTitleDuplicate[] {
  const normalized = items.map(item => ({ ...item, norm: normalizeTitle(item.title) }))
  const duplicates: TrackerSyncTitleDuplicate[] = []
  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      const score = titleSimilarity(normalized[i].norm, normalized[j].norm)
      if (score >= SIMILARITY_THRESHOLD) {
        duplicates.push({
          a: { id: normalized[i].id, title: normalized[i].title },
          b: { id: normalized[j].id, title: normalized[j].title },
          score,
        })
      }
    }
  }
  return duplicates
}

/**
 * Pure core of `tracker_sync_report`. `includeDone` (default false) only narrows (c)
 * unlinked-Vandaag-project suggestions and (d) unlinked-tracker-project listing — status
 * mismatches (a) and duplicate detection (e) always consider every project, done/completed
 * included, since those are correctness checks rather than "things to act on."
 *
 * (c) suggestions are restricted to tracker projects not already linked from any Vandaag
 * project — a tracker project some other Vandaag project already points to isn't a useful
 * suggestion even if its title matches well.
 */
export function buildTrackerSyncReport(
  vandaagProjects: Project[],
  trackerProjects: TrackerProjectSummary[],
  params: Params = {},
): TrackerSyncReport {
  const includeDone = params.includeDone === true

  const trackerById = new Map(trackerProjects.map(t => [t.id, t]))
  const linkedTrackerIds = new Set<string>()

  const statusMismatches: TrackerSyncStatusMismatch[] = []
  const brokenLinks: TrackerSyncBrokenLink[] = []

  for (const vp of vandaagProjects) {
    if (!vp.trackerProjectId) continue
    const tracker = trackerById.get(vp.trackerProjectId)
    if (!tracker) {
      brokenLinks.push({ vandaagProjectId: vp.id, title: vp.title, trackerProjectId: vp.trackerProjectId })
      continue
    }
    linkedTrackerIds.add(tracker.id)

    const expectedVandaagStatus = TRACKER_TO_VANDAAG_STATUS[tracker.status]
    const expectedTrackerStatus = VANDAAG_TO_TRACKER_STATUS[vp.status]
    if (expectedVandaagStatus !== undefined && expectedVandaagStatus !== vp.status) {
      statusMismatches.push({
        vandaag: { id: vp.id, title: vp.title, status: vp.status },
        tracker: { id: tracker.id, title: tracker.title, status: tracker.status },
        expected: { vandaagStatus: expectedVandaagStatus, trackerStatus: expectedTrackerStatus },
      })
    }
  }

  const activeVandaagProjects = vandaagProjects.filter(p => includeDone || p.status !== 'done')
  const unlinkedVandaag = activeVandaagProjects.filter(p => !p.trackerProjectId)
  const unlinkedTrackerList = trackerProjects.filter(
    t => !linkedTrackerIds.has(t.id) && (includeDone || t.status !== 'completed'),
  )

  const unlinkedVandaagProjects: TrackerSyncUnlinkedVandaagProject[] = unlinkedVandaag.map(vp => {
    const normVandaag = normalizeTitle(vp.title)
    const suggestions = unlinkedTrackerList
      .map(tp => ({ trackerId: tp.id, title: tp.title, score: titleSimilarity(normVandaag, normalizeTitle(tp.title)) }))
      .filter(s => s.score >= SIMILARITY_THRESHOLD)
      .sort((a, b) => b.score - a.score)
    return { id: vp.id, title: vp.title, status: vp.status, suggestions }
  })

  const unlinkedTrackerProjects: TrackerSyncUnlinkedTrackerProject[] = unlinkedTrackerList.map(tp => ({
    id: tp.id,
    title: tp.title,
    status: tp.status,
  }))

  const byTrackerId = new Map<string, Project[]>()
  for (const vp of vandaagProjects) {
    if (!vp.trackerProjectId) continue
    byTrackerId.set(vp.trackerProjectId, [...(byTrackerId.get(vp.trackerProjectId) ?? []), vp])
  }
  const sameTrackerLink: TrackerSyncDuplicateTrackerLink[] = Array.from(byTrackerId.entries())
    .filter(([, projects]) => projects.length > 1)
    .map(([trackerId, projects]) => ({ trackerId, vandaagProjects: projects.map(p => ({ id: p.id, title: p.title })) }))

  return {
    statusMismatches,
    brokenLinks,
    unlinkedVandaagProjects,
    unlinkedTrackerProjects,
    duplicates: {
      sameTrackerLink,
      vandaagTitleDuplicates: findTitleDuplicates(vandaagProjects.map(p => ({ id: p.id, title: p.title }))),
      trackerTitleDuplicates: findTitleDuplicates(trackerProjects.map(t => ({ id: t.id, title: t.title }))),
    },
  }
}

export interface TrackerStatusChange {
  vandaagProjectId: string
  title: string
  from: ProjectStatus
  to: ProjectStatus
  trackerId: string
}

/**
 * Pure core of `sync_tracker_status`: diffs every linked Vandaag project's status against
 * its tracker project's status (mapped via `TRACKER_TO_VANDAAG_STATUS`), returning only the
 * ones that actually need to change. A broken link (no matching tracker project) is silently
 * skipped here — that's `tracker_sync_report`'s job to surface, not this one's to act on.
 */
export function computeTrackerStatusChanges(
  vandaagProjects: Project[],
  trackerProjects: TrackerProjectSummary[],
  params: Params = {},
): TrackerStatusChange[] {
  const rawIds = params.projectIds
  let idFilter: Set<string> | undefined
  if (rawIds !== undefined) {
    if (!Array.isArray(rawIds) || !rawIds.every(id => typeof id === 'string')) {
      throw new AgentOpError(400, 'projectIds must be an array of strings')
    }
    idFilter = new Set(rawIds)
  }

  const trackerById = new Map(trackerProjects.map(t => [t.id, t]))
  const changes: TrackerStatusChange[] = []
  for (const vp of vandaagProjects) {
    if (!vp.trackerProjectId) continue
    if (idFilter && !idFilter.has(vp.id)) continue
    const tracker = trackerById.get(vp.trackerProjectId)
    if (!tracker) continue
    const mapped = TRACKER_TO_VANDAAG_STATUS[tracker.status]
    if (mapped === undefined || mapped === vp.status) continue
    changes.push({ vandaagProjectId: vp.id, title: vp.title, from: vp.status, to: mapped, trackerId: tracker.id })
  }
  return changes
}

/**
 * Pure: turns `computeTrackerStatusChanges`' output into a `{ projects }` patch for the
 * Vandaag doc, mirroring `updateProject`'s (`agentOps.ts`) only status-change side effect —
 * `waitingOn` is cleared when the new status is `done`, preserved otherwise — plus a bumped
 * `updatedAt`. The caller (`runAgentAction.ts`) must still run this patch through
 * `stripUndefined` before `tx.update()`, exactly like every other write path, since a cleared
 * `waitingOn` is `undefined` here.
 */
export function applyTrackerStatusChanges(data: SyncData, changes: TrackerStatusChange[]): Partial<SyncData> {
  if (changes.length === 0) return {}
  const changeByProjectId = new Map(changes.map(c => [c.vandaagProjectId, c]))
  const now = new Date().toISOString()
  const projects = data.projects.map(p => {
    const change = changeByProjectId.get(p.id)
    if (!change) return p
    return { ...p, status: change.to, waitingOn: change.to === 'done' ? undefined : p.waitingOn, updatedAt: now }
  })
  return { projects }
}
