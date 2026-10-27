/**
 * Audit trail for the agent API: `users/{uid}/changes/{autoId}`. A subcollection, not a
 * field on the main user doc — like `deepBlockLog`, that sidesteps the whole-doc-overwrite
 * hazard (`useFirestoreSync` writes the entire doc from a client-known `SyncData` shape on
 * every save; any field it doesn't know about would be silently dropped).
 *
 * Two kinds of entries get logged:
 *  - every agent-API write (`side: 'agent'`), appended inside the *same* transaction as the
 *    write itself — so a logged change and the write it describes can never disagree about
 *    whether the other happened.
 *  - tracker-app drift (`side: 'tracker'`): on each tracker sync/report call, the current
 *    tracker state is diffed against the last-seen snapshot (`users/{uid}/meta/trackerSnapshot`)
 *    to find changes the *tracker app itself* made since last time — explicitly excluding
 *    whatever the agent's own call is about to write, by diffing against the pre-write
 *    tracker state and saving the post-write state as the new snapshot baseline.
 *
 * Per the task's "logging must never break the main operation" rule: anything here that
 * runs *outside* the core write transaction (tracker-drift diff/log/snapshot, batched
 * appends, pruning) is best-effort — failures are `console.error`'d and swallowed. Entries
 * appended *inside* the core transaction are not separately try/caught: they're small,
 * well-formed, `stripUndefined`-cleaned docs, so a failure there is exceptionally unlikely,
 * and if the transaction does fail for some other reason, the whole write (including the
 * thing the log entry would have described) is rolled back together, which is correct.
 */
import type { Firestore, QueryDocumentSnapshot, Transaction } from 'firebase-admin/firestore'
import { AgentOpError, stripUndefined } from './agentOps.js'
import type { TrackerProjectSummary } from './trackerOps.js'

export type ChangeSide = 'vandaag' | 'tracker' | 'agent'
export type ChangeEntity = 'project' | 'task' | 'subtask' | 'deepBlock'

export interface ChangeEntry {
  at: string
  side: ChangeSide
  entity: ChangeEntity
  id: string
  action: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
}

type Params = Record<string, unknown>

export const CHANGE_RETENTION_DAYS = 90
export const CHANGE_MAX_ENTRIES = 2000
const PRUNE_BATCH_LIMIT = 50
export const LIST_CHANGES_DEFAULT_LIMIT = 50
export const LIST_CHANGES_MAX_LIMIT = 500

export function changesCollection(db: Firestore, uid: string) {
  return db.collection('users').doc(uid).collection('changes')
}

function trackerSnapshotRef(db: Firestore, uid: string) {
  return db.collection('users').doc(uid).collection('meta').doc('trackerSnapshot')
}

function deepBlockLogCollection(db: Firestore, uid: string) {
  return db.collection('users').doc(uid).collection('deepBlockLog')
}

/**
 * Pure: compares `keys` between `before` and `after`, returning only the keys that actually
 * changed. `before === undefined` means "didn't exist yet" (a create) — every key present
 * on `after` is reported, none on `before`. A key that's the same value (including both
 * sides being absent/undefined) on both sides is omitted entirely, per "keep before/after
 * small: only changed fields".
 */
export function diffEntityFields<T extends object>(
  before: T | undefined,
  after: T,
  keys: readonly (keyof T & string)[],
): { before?: Partial<T>; after?: Partial<T> } {
  const beforeOut: Partial<T> = {}
  const afterOut: Partial<T> = {}
  for (const key of keys) {
    const b = before?.[key]
    const a = after[key]
    const changed = before === undefined ? a !== undefined : !deepEqualSimple(b, a)
    if (!changed) continue
    if (before !== undefined && b !== undefined) beforeOut[key] = b
    if (a !== undefined) afterOut[key] = a
  }
  return {
    ...(Object.keys(beforeOut).length > 0 ? { before: beforeOut } : {}),
    ...(Object.keys(afterOut).length > 0 ? { after: afterOut } : {}),
  }
}

function deepEqualSimple(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === undefined || b === undefined) return false
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

export function buildChangeEntry(opts: {
  at: string
  side: ChangeSide
  entity: ChangeEntity
  id: string
  action: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
}): ChangeEntry {
  return {
    at: opts.at,
    side: opts.side,
    entity: opts.entity,
    id: opts.id,
    action: opts.action,
    ...(opts.before && Object.keys(opts.before).length > 0 ? { before: opts.before } : {}),
    ...(opts.after && Object.keys(opts.after).length > 0 ? { after: opts.after } : {}),
  }
}

/** Appends change entries inside an already-open transaction — one `tx.set` per entry, each at its own auto-id doc. */
export function appendChangesInTransaction(tx: Transaction, db: Firestore, uid: string, entries: ChangeEntry[]): void {
  if (entries.length === 0) return
  const col = changesCollection(db, uid)
  for (const entry of entries) {
    tx.set(col.doc(), stripUndefined(entry))
  }
}

/** Standalone best-effort batched append, for logging that happens outside the core write transaction (tracker drift). */
export async function appendChangesBestEffort(db: Firestore, uid: string, entries: ChangeEntry[]): Promise<void> {
  if (entries.length === 0) return
  try {
    const col = changesCollection(db, uid)
    const batch = db.batch()
    for (const entry of entries) batch.set(col.doc(), stripUndefined(entry))
    await batch.commit()
  } catch (err) {
    console.error('[agent] failed to append change log entries:', err)
  }
}

/**
 * Opportunistic retention: deletes entries older than `CHANGE_RETENTION_DAYS` and, if the
 * collection is over `CHANGE_MAX_ENTRIES`, the oldest excess beyond the cap — each bounded
 * to a small batch per call so a single write never pays for a large cleanup. Best-effort:
 * failures are logged and swallowed, never surfaced to the caller.
 */
export async function pruneChangesBestEffort(db: Firestore, uid: string, nowIso: string): Promise<void> {
  try {
    const col = changesCollection(db, uid)
    const cutoff = new Date(new Date(nowIso).getTime() - CHANGE_RETENTION_DAYS * 86_400_000).toISOString()
    const [staleSnap, countSnap] = await Promise.all([
      col.where('at', '<', cutoff).orderBy('at').limit(PRUNE_BATCH_LIMIT).get(),
      col.count().get(),
    ])
    const toDelete = new Map(staleSnap.docs.map(d => [d.id, d.ref]))

    const overCap = countSnap.data().count - CHANGE_MAX_ENTRIES
    if (overCap > 0) {
      const overCapSnap = await col.orderBy('at').limit(Math.min(overCap, PRUNE_BATCH_LIMIT)).get()
      overCapSnap.docs.forEach(d => toDelete.set(d.id, d.ref))
    }

    if (toDelete.size === 0) return
    const batch = db.batch()
    toDelete.forEach(ref => batch.delete(ref))
    await batch.commit()
  } catch (err) {
    console.error('[agent] failed to prune change log:', err)
  }
}

const CHANGE_SIDES: ChangeSide[] = ['vandaag', 'tracker', 'agent']
const CHANGE_ENTITIES: ChangeEntity[] = ['project', 'task', 'subtask', 'deepBlock']
export const LIST_CHANGES_PAGE_SIZE = 200
/** Upper bound on how many docs one `list_changes` call will scan while filtering by side/entity in memory — matches the retention cap, so a call can never need to read more than the collection is ever allowed to hold. */
export const LIST_CHANGES_SCAN_CAP = CHANGE_MAX_ENTRIES

function badRequest(message: string): never {
  throw new AgentOpError(400, message)
}

const ISO_DATE_OR_DATETIME_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/

function isValidIsoDateOrDateTime(v: string): boolean {
  return ISO_DATE_OR_DATETIME_RE.test(v) && !Number.isNaN(new Date(v).getTime())
}

/**
 * Entry point for `list_changes`: newest first, optionally filtered by `side`/`entity`.
 *
 * The query only ever orders/filters on `at` — a single-field index, which Firestore creates
 * automatically. Combining that `orderBy` with equality `where`s on `side`/`entity` would be
 * a composite query that needs a composite index Firestore does **not** create automatically;
 * the first production call with such a filter would fail outright with
 * `FAILED_PRECONDITION` rather than just being slow. Instead, `side`/`entity` are applied by
 * paging through `at`-ordered results (`LIST_CHANGES_PAGE_SIZE` at a time, via a document
 * cursor so same-timestamp entries — common, since many entries from one call share the
 * same `at` — are never skipped or duplicated) and filtering in memory, stopping once
 * `limit` matches are found or `LIST_CHANGES_SCAN_CAP` documents have been scanned (a filter
 * that matches rarely could otherwise scan the entire collection on every call).
 */
export async function listChanges(db: Firestore, uid: string, params: Params): Promise<ChangeEntry[]> {
  const since = params.since
  if (since !== undefined && (typeof since !== 'string' || !isValidIsoDateOrDateTime(since))) {
    badRequest('since must be an ISO date (YYYY-MM-DD) or datetime string')
  }
  const side = params.side
  if (side !== undefined && !CHANGE_SIDES.includes(side as ChangeSide)) {
    badRequest(`side must be one of: ${CHANGE_SIDES.join(', ')}`)
  }
  const entity = params.entity
  if (entity !== undefined && !CHANGE_ENTITIES.includes(entity as ChangeEntity)) {
    badRequest(`entity must be one of: ${CHANGE_ENTITIES.join(', ')}`)
  }
  const rawLimit = params.limit
  if (rawLimit !== undefined && (typeof rawLimit !== 'number' || !Number.isInteger(rawLimit) || rawLimit < 1)) {
    badRequest('limit must be a positive integer')
  }
  const limit = Math.min((rawLimit as number | undefined) ?? LIST_CHANGES_DEFAULT_LIMIT, LIST_CHANGES_MAX_LIMIT)

  const col = changesCollection(db, uid)
  let baseQuery = col.orderBy('at', 'desc')
  if (since !== undefined) baseQuery = baseQuery.where('at', '>=', since)

  const results: ChangeEntry[] = []
  let cursor: QueryDocumentSnapshot | undefined
  let scanned = 0

  while (results.length < limit && scanned < LIST_CHANGES_SCAN_CAP) {
    const pageSize = Math.min(LIST_CHANGES_PAGE_SIZE, LIST_CHANGES_SCAN_CAP - scanned)
    const pageQuery = (cursor ? baseQuery.startAfter(cursor) : baseQuery).limit(pageSize)
    const snap = await pageQuery.get()
    if (snap.empty) break

    for (const doc of snap.docs) {
      scanned++
      const data = doc.data() as ChangeEntry
      if (side !== undefined && data.side !== side) continue
      if (entity !== undefined && data.entity !== entity) continue
      results.push(data)
      if (results.length >= limit) break
    }

    cursor = snap.docs[snap.docs.length - 1]
    if (snap.docs.length < pageSize) break // last page
  }

  return results.slice(0, limit)
}

// ── tracker drift snapshot ─────────────────────────────────────────────

export interface TrackerSnapshotSubtask {
  id: string
  title: string
  done: boolean
  vandaagTaskId?: string
}

export interface TrackerSnapshotProject {
  id: string
  title: string
  status: string
  subtasks: TrackerSnapshotSubtask[]
}

export interface TrackerSnapshotDoc {
  projects: TrackerSnapshotProject[]
}

/** Reduces `TrackerProjectSummary[]` (trackerOps.ts) to the minimal shape persisted as the sync baseline. */
export function toTrackerSnapshot(trackerProjects: readonly TrackerProjectSummary[]): TrackerSnapshotDoc {
  return {
    projects: trackerProjects.map(p => ({
      id: p.id,
      title: p.title,
      status: p.status,
      subtasks: p.subtasks
        .filter((s): s is TrackerProjectSummary['subtasks'][number] & { id: string } => typeof s.id === 'string')
        .map(s => ({ id: s.id as string, title: s.title, done: s.done, ...(s.vandaagTaskId ? { vandaagTaskId: s.vandaagTaskId } : {}) })),
    })),
  }
}

export async function readTrackerSnapshot(db: Firestore, uid: string): Promise<TrackerSnapshotDoc | undefined> {
  const snap = await trackerSnapshotRef(db, uid).get()
  return snap.exists ? (snap.data() as TrackerSnapshotDoc) : undefined
}

async function writeTrackerSnapshot(db: Firestore, uid: string, snapshot: TrackerSnapshotDoc): Promise<void> {
  await trackerSnapshotRef(db, uid).set(stripUndefined(snapshot))
}

const SUBTASK_KEYS: readonly (keyof TrackerSnapshotSubtask & string)[] = ['title', 'done', 'vandaagTaskId']
const PROJECT_KEYS: readonly (keyof TrackerSnapshotProject & string)[] = ['title', 'status']

/**
 * Pure diff: last-seen tracker snapshot vs. the tracker's current state, as `side: 'tracker'`
 * change entries. Covers project add/remove/title/status, and subtask add/remove/title/done/
 * vandaagTaskId — for *every* subtask, linked or not, since a tracker-side edit to an
 * unlinked subtask is still a real tracker-side change worth recording (sync_tracker_tasks
 * just never writes to those itself).
 */
export function diffTrackerSnapshot(
  oldSnapshot: TrackerSnapshotDoc | undefined,
  current: TrackerSnapshotProject[],
  at: string,
): ChangeEntry[] {
  const entries: ChangeEntry[] = []
  const oldById = new Map((oldSnapshot?.projects ?? []).map(p => [p.id, p]))
  const currentIds = new Set(current.map(p => p.id))

  for (const project of current) {
    const old = oldById.get(project.id)
    const { before, after } = diffEntityFields(old, project, PROJECT_KEYS)
    if (old === undefined) {
      entries.push(buildChangeEntry({ at, side: 'tracker', entity: 'project', id: project.id, action: 'added', after: { title: project.title, status: project.status } }))
    } else if (after) {
      entries.push(buildChangeEntry({ at, side: 'tracker', entity: 'project', id: project.id, action: 'updated', before, after }))
    }

    const oldSubtasksById = new Map((old?.subtasks ?? []).map(s => [s.id, s]))
    const currentSubtaskIds = new Set(project.subtasks.map(s => s.id))
    for (const subtask of project.subtasks) {
      const oldSubtask = oldSubtasksById.get(subtask.id)
      const { before: sBefore, after: sAfter } = diffEntityFields(oldSubtask, subtask, SUBTASK_KEYS)
      if (oldSubtask === undefined) {
        entries.push(buildChangeEntry({ at, side: 'tracker', entity: 'subtask', id: subtask.id, action: 'added', after: sAfter }))
      } else if (sAfter) {
        entries.push(buildChangeEntry({ at, side: 'tracker', entity: 'subtask', id: subtask.id, action: 'updated', before: sBefore, after: sAfter }))
      }
    }
    for (const oldSubtask of old?.subtasks ?? []) {
      if (!currentSubtaskIds.has(oldSubtask.id)) {
        entries.push(buildChangeEntry({ at, side: 'tracker', entity: 'subtask', id: oldSubtask.id, action: 'removed', before: { title: oldSubtask.title, done: oldSubtask.done } }))
      }
    }
  }

  for (const old of oldSnapshot?.projects ?? []) {
    if (!currentIds.has(old.id)) {
      entries.push(buildChangeEntry({ at, side: 'tracker', entity: 'project', id: old.id, action: 'removed', before: { title: old.title, status: old.status } }))
    }
  }

  return entries
}

/**
 * IO entry point used by every tracker sync/report tool: diffs `before` (the tracker state
 * as read at the start of this call, i.e. prior to any writes this call is about to make)
 * against the last-seen snapshot, logs the drift as `side: 'tracker'`, then saves `after`
 * (the tracker state once this call's own writes, if any, have been applied) as the new
 * baseline — so the agent's own imminent writes are never mistaken for tracker-app drift on
 * the *next* call. Entirely best-effort: never throws, never blocks the tool's own result.
 */
export async function recordTrackerDriftBestEffort(
  db: Firestore,
  uid: string,
  before: readonly TrackerProjectSummary[],
  after: readonly TrackerProjectSummary[],
  nowIso: string,
): Promise<void> {
  try {
    const oldSnapshot = await readTrackerSnapshot(db, uid)
    const entries = diffTrackerSnapshot(oldSnapshot, toTrackerSnapshot(before).projects, nowIso)
    await appendChangesBestEffort(db, uid, entries)
    await writeTrackerSnapshot(db, uid, toTrackerSnapshot(after))
  } catch (err) {
    console.error('[agent] failed to record tracker drift:', err)
  }
}

/**
 * Incremental snapshot patch for a single project, used right after any one-off agent
 * tracker write (`update_tracker_project`, or a best-effort per-task tracker push) so the
 * *next* full drift diff doesn't misattribute the agent's own write to the tracker app.
 * Best-effort — never throws.
 */
export async function patchTrackerSnapshotProjectBestEffort(
  db: Firestore,
  uid: string,
  project: TrackerProjectSummary,
): Promise<void> {
  return patchTrackerSnapshotProjectsBestEffort(db, uid, [project])
}

/** Same as `patchTrackerSnapshotProjectBestEffort`, for multiple projects at once (e.g. after a `sync_tracker_tasks` write that touched several linked projects). */
export async function patchTrackerSnapshotProjectsBestEffort(
  db: Firestore,
  uid: string,
  projects: readonly TrackerProjectSummary[],
): Promise<void> {
  if (projects.length === 0) return
  try {
    const existing = (await readTrackerSnapshot(db, uid)) ?? { projects: [] }
    const entries = toTrackerSnapshot(projects).projects
    const entriesById = new Map(entries.map(e => [e.id, e]))
    const merged = existing.projects.map(p => entriesById.get(p.id) ?? p)
    for (const [id, entry] of entriesById) {
      if (!merged.some(p => p.id === id)) merged.push(entry)
    }
    await writeTrackerSnapshot(db, uid, { projects: merged })
  } catch (err) {
    console.error('[agent] failed to update tracker snapshot:', err)
  }
}

export async function readDeepBlockLog(db: Firestore, uid: string, limitDocs = 1000): Promise<import('./deepBlock.js').DeepBlockLogEntry[]> {
  const snap = await deepBlockLogCollection(db, uid).orderBy('date', 'desc').limit(limitDocs).get()
  return snap.docs.map(d => d.data() as import('./deepBlock.js').DeepBlockLogEntry)
}

export function deepBlockLogDocRef(db: Firestore, uid: string, date: string) {
  return deepBlockLogCollection(db, uid).doc(date)
}
