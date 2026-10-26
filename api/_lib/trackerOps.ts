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
