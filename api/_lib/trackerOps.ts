/**
 * Read-only bridge into the "Off Course — Project Tracker" app's Firestore doc
 * (`workspaces/{workspaceId}/tracker/state`, a separate Firebase project from
 * Vandaag's own). The doc shape isn't ours to control, so every field is read
 * defensively — missing fields, subtasks as strings or `{title, done}` objects,
 * etc. all degrade gracefully rather than throwing.
 */
import type { Firestore } from 'firebase-admin/firestore'
import { AgentOpError } from './agentOps.js'
import { getTrackerConfigError, getTrackerDb, getTrackerUserUid, getTrackerWorkspaceId } from './firebaseAdmin.js'

type Params = Record<string, unknown>

export interface TrackerPersonRef {
  id: string
  name: string
}

export interface TrackerSubtask {
  title: string
  done: boolean
}

export interface TrackerLinkedEntity {
  id: string
  title: string
}

export interface TrackerProjectSummary {
  id: string
  title: string
  status: string
  urgency?: unknown
  domain?: unknown
  subtasks: TrackerSubtask[]
  assigneeIds: string[]
  assignees: string[]
  goal?: TrackerLinkedEntity
  frame?: TrackerLinkedEntity
}

export type TrackerDoc = Record<string, unknown>
export type ReadTrackerDoc = (workspaceId: string) => Promise<TrackerDoc | undefined>

function toArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function toStr(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function toObject(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
}

function normalizePerson(raw: unknown): TrackerPersonRef | null {
  const obj = toObject(raw)
  const id = obj && toStr(obj.id)
  if (!id) return null
  return { id, name: toStr(obj!.name) ?? id }
}

function normalizeSubtask(raw: unknown): TrackerSubtask | null {
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    return trimmed ? { title: trimmed, done: false } : null
  }
  const obj = toObject(raw)
  if (!obj) return null
  const t = toStr(obj.title) ?? toStr(obj.name)
  if (!t) return null
  return { title: t, done: !!obj.done }
}

function findLinkedEntity(list: unknown[], id: unknown): TrackerLinkedEntity | undefined {
  const targetId = toStr(id)
  if (!targetId) return undefined
  const found = list.map(toObject).find(obj => obj && toStr(obj.id) === targetId)
  if (!found) return undefined
  return { id: targetId, title: toStr(found.title) ?? toStr(found.name) ?? targetId }
}

function normalizeProject(
  raw: unknown,
  peopleById: Map<string, string>,
  goals: unknown[],
  frames: unknown[],
): TrackerProjectSummary | null {
  const obj = toObject(raw)
  const id = obj && toStr(obj.id)
  if (!id) return null

  const assigneeIds = toArray(obj!.assigneeIds).filter((v): v is string => typeof v === 'string')
  const assignees = assigneeIds.map(pid => peopleById.get(pid)).filter((name): name is string => !!name)
  const subtasks = toArray(obj!.subtasks)
    .map(normalizeSubtask)
    .filter((s): s is TrackerSubtask => s !== null)
  const goal = findLinkedEntity(goals, obj!.goalId)
  const frame = findLinkedEntity(frames, obj!.frameId)

  return {
    id,
    title: toStr(obj!.title) ?? '(untitled)',
    status: toStr(obj!.status) ?? 'not_started',
    urgency: obj!.urgency,
    domain: obj!.domain,
    subtasks,
    assigneeIds,
    assignees,
    ...(goal ? { goal } : {}),
    ...(frame ? { frame } : {}),
  }
}

/**
 * Pure transform: raw tracker doc + filter params -> normalized project list.
 * `status` filters to one or more statuses (string or array). `includeCompleted`
 * defaults to true — set false to hide status "completed" projects.
 */
export function summarizeTrackerProjects(doc: TrackerDoc | undefined, params: Params = {}): TrackerProjectSummary[] {
  const people = toArray(doc?.people)
    .map(normalizePerson)
    .filter((p): p is TrackerPersonRef => p !== null)
  const peopleById = new Map(people.map(p => [p.id, p.name]))
  const goals = toArray(doc?.goals)
  const frames = toArray(doc?.frames)

  const projects = toArray(doc?.projects)
    .map(raw => normalizeProject(raw, peopleById, goals, frames))
    .filter((p): p is TrackerProjectSummary => p !== null)

  const rawStatus = params.status
  const statusFilter = typeof rawStatus === 'string'
    ? [rawStatus]
    : Array.isArray(rawStatus)
      ? rawStatus.filter((s): s is string => typeof s === 'string')
      : undefined
  const includeCompleted = typeof params.includeCompleted === 'boolean' ? params.includeCompleted : true

  return projects.filter(p => {
    if (statusFilter && !statusFilter.includes(p.status)) return false
    if (!includeCompleted && p.status === 'completed') return false
    return true
  })
}

/**
 * `getTrackerDb()` can throw mid-initialization — e.g. a malformed
 * `TRACKER_FIREBASE_SERVICE_ACCOUNT` fails `JSON.parse` with an error message that
 * includes a snippet of the secret itself. That error must never reach a response
 * or a log line, so every call site goes through this wrapper instead of the raw
 * `getTrackerDb()`, converting ANY failure (parse, cert(), initializeApp(), ...)
 * into the same generic, secret-free error the rest of this module already uses.
 */
function getTrackerDbSafe(): Firestore {
  try {
    return getTrackerDb()
  } catch {
    throw new AgentOpError(503, 'Tracker is not configured')
  }
}

async function defaultReadTrackerDoc(workspaceId: string): Promise<TrackerDoc | undefined> {
  const db = getTrackerDbSafe()
  const snap = await db.collection('workspaces').doc(workspaceId).collection('tracker').doc('state').get()
  return snap.exists ? (snap.data() as TrackerDoc) : undefined
}

export type ReadTrackerUserWorkspaceId = (userUid: string) => Promise<string | undefined>

/** Reads `users/{userUid}.workspaceId` from the tracker app's own Firestore — used when
 *  TRACKER_WORKSPACE_ID is unset but TRACKER_USER_UID is set. */
async function defaultReadTrackerUserWorkspaceId(userUid: string): Promise<string | undefined> {
  const db = getTrackerDbSafe()
  const snap = await db.collection('users').doc(userUid).get()
  if (!snap.exists) return undefined
  return toStr((snap.data() as Record<string, unknown> | undefined)?.workspaceId)
}

/** TRACKER_WORKSPACE_ID wins if set; otherwise resolves it via TRACKER_USER_UID's user doc. */
async function resolveWorkspaceId(readUserWorkspaceId: ReadTrackerUserWorkspaceId): Promise<string> {
  const configured = getTrackerWorkspaceId()
  if (configured) return configured

  const userUid = getTrackerUserUid()
  if (!userUid) throw new AgentOpError(503, 'Tracker is not configured')

  const workspaceId = await readUserWorkspaceId(userUid)
  if (!workspaceId) throw new AgentOpError(503, 'Tracker is not configured')
  return workspaceId
}

export interface TrackerProjectsResult {
  workspaceId: string
  projects: TrackerProjectSummary[]
}

function badRequest(message: string): never {
  throw new AgentOpError(400, message)
}

const TRACKER_STATUSES = ['not_started', 'in_progress', 'paused', 'completed'] as const
type TrackerProjectStatus = (typeof TRACKER_STATUSES)[number]

function isTrackerStatus(v: unknown): v is TrackerProjectStatus {
  return typeof v === 'string' && (TRACKER_STATUSES as readonly string[]).includes(v)
}

/** Builds a `TrackerProjectSummary` for one raw project object using the rest of `doc` (people/goals/frames) for context. */
function projectSummaryFromDoc(doc: TrackerDoc | undefined, rawProject: unknown): TrackerProjectSummary {
  const people = toArray(doc?.people)
    .map(normalizePerson)
    .filter((p): p is TrackerPersonRef => p !== null)
  const peopleById = new Map(people.map(p => [p.id, p.name]))
  const goals = toArray(doc?.goals)
  const frames = toArray(doc?.frames)
  // rawProject always has an `id` at this point (the caller already located it by id), so this can't return null.
  return normalizeProject(rawProject, peopleById, goals, frames)!
}

export interface TrackerProjectUpdateResult {
  project: TrackerProjectSummary
  previousStatus: string
}

/**
 * Pure: applies a validated update to one project inside a raw tracker doc. Returns the
 * full `projects` array with only that project's raw object replaced — every other project,
 * and every unknown field on the target project itself, is preserved verbatim (we spread the
 * raw object rather than rebuilding it) — plus the updated summary and its previous status.
 *
 * Status-transition timestamps mirror the tracker app's own zustand actions, read directly out
 * of its live bundle (startProject/pauseProject/resumeProject/completeProject in useAppStore.js):
 *  - -> in_progress: `startedAt = existing ?? now` (both startProject and resumeProject use this —
 *    resumeProject doesn't touch it at all, which has the same effect since it's already set)
 *  - -> completed: `completedAt = now`, unconditionally (completeProject always stamps "now")
 *  - -> paused: no timestamp side effects (pauseProject only flips `status`)
 *  - leaving `completed` for any other status: `completedAt` is cleared. The live bundle has no
 *    "uncomplete" action to observe this from, so this is our own choice (not something mirrored
 *    from the app) — made to avoid a stale completion timestamp surviving on a project that's
 *    active again. `startedAt` is never cleared by any transition, including back to not_started,
 *    since nothing in the app does that either.
 *
 * `urgency` is passed through as-is (string or number): the live bundle has no `urgency` field
 * anywhere in its project shape or UI strings (only an unrelated `domainStatus` enum for "domain"
 * kind entries), so there's no enum to validate against — we accept either primitive type rather
 * than inventing one.
 */
export function applyTrackerProjectUpdate(
  doc: TrackerDoc | undefined,
  params: Params,
): { projects: unknown[]; result: TrackerProjectUpdateResult } {
  const rawId = params.projectId
  if (typeof rawId !== 'string' || !rawId) badRequest('projectId is required')
  const projectId = rawId

  const status = params.status
  if (status !== undefined && !isTrackerStatus(status)) {
    badRequest(`status must be one of: ${TRACKER_STATUSES.join(', ')}`)
  }

  let newTitle: string | undefined
  if (params.title !== undefined) {
    if (typeof params.title !== 'string') badRequest('title must be a string')
    newTitle = params.title.trim()
    if (!newTitle) badRequest('title must not be empty')
  }

  const urgency = params.urgency
  if (urgency !== undefined && typeof urgency !== 'string' && typeof urgency !== 'number') {
    badRequest('urgency must be a string or number')
  }

  if (status === undefined && newTitle === undefined && urgency === undefined) {
    badRequest('At least one of status, title, urgency is required')
  }

  const rawProjects = toArray(doc?.projects)
  const index = rawProjects.findIndex(raw => toObject(raw)?.id === projectId)
  if (index === -1) throw new AgentOpError(404, `Tracker project not found: ${projectId}`)
  const current = toObject(rawProjects[index])!
  const previousStatus = toStr(current.status) ?? 'not_started'

  const updated: Record<string, unknown> = { ...current }
  if (newTitle !== undefined) updated.title = newTitle
  if (urgency !== undefined) updated.urgency = urgency
  if (status !== undefined) {
    updated.status = status
    if (status === 'in_progress') {
      updated.startedAt = current.startedAt ?? new Date().toISOString()
    } else if (status === 'completed') {
      updated.completedAt = new Date().toISOString()
    } else if (previousStatus === 'completed') {
      updated.completedAt = null
    }
  }

  const projects = rawProjects.map((raw, i) => (i === index ? updated : raw))
  return { projects, result: { project: projectSummaryFromDoc(doc, updated), previousStatus } }
}

export type RunTrackerProjectUpdate = (
  workspaceId: string,
  mutate: (doc: TrackerDoc | undefined) => { projects: unknown[]; result: TrackerProjectUpdateResult },
) => Promise<TrackerProjectUpdateResult>

async function defaultRunTrackerProjectUpdate(
  workspaceId: string,
  mutate: (doc: TrackerDoc | undefined) => { projects: unknown[]; result: TrackerProjectUpdateResult },
): Promise<TrackerProjectUpdateResult> {
  const db = getTrackerDbSafe()
  const ref = db.collection('workspaces').doc(workspaceId).collection('tracker').doc('state')
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    const doc = snap.exists ? (snap.data() as TrackerDoc) : undefined
    const { projects, result } = mutate(doc)
    tx.update(ref, { projects })
    return result
  })
}

/**
 * Entry point for the `update_tracker_project` action. Writes only the `projects` field of the
 * tracker doc (via a transaction, so a concurrent edit can't be silently lost) — every other
 * top-level field, and every other project, is left completely untouched.
 */
export async function updateTrackerProject(
  params: Params = {},
  readUserWorkspaceId: ReadTrackerUserWorkspaceId = defaultReadTrackerUserWorkspaceId,
  runUpdate: RunTrackerProjectUpdate = defaultRunTrackerProjectUpdate,
): Promise<TrackerProjectUpdateResult> {
  const configError = getTrackerConfigError()
  if (configError) throw new AgentOpError(503, configError)

  const workspaceId = await resolveWorkspaceId(readUserWorkspaceId)
  return runUpdate(workspaceId, doc => applyTrackerProjectUpdate(doc, params))
}

/**
 * Entry point for the `list_tracker_projects` action. `readTrackerDoc` and
 * `readUserWorkspaceId` are injected so tests can exercise this without touching
 * Firestore (both default to the real reads).
 */
export async function listTrackerProjects(
  params: Params = {},
  readTrackerDoc: ReadTrackerDoc = defaultReadTrackerDoc,
  readUserWorkspaceId: ReadTrackerUserWorkspaceId = defaultReadTrackerUserWorkspaceId,
): Promise<TrackerProjectsResult> {
  const configError = getTrackerConfigError()
  if (configError) throw new AgentOpError(503, configError)

  const workspaceId = await resolveWorkspaceId(readUserWorkspaceId)
  const doc = await readTrackerDoc(workspaceId)
  return { workspaceId, projects: summarizeTrackerProjects(doc, params) }
}
