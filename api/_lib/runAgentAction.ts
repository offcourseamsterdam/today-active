import { getDb, getAgentUid } from './firebaseAdmin.js'
import {
  AgentOpError,
  isAgentAction,
  normalizeSyncData,
  runAgentOperation,
  stripUndefined,
  type AgentProjectSummary,
  type SyncData,
} from './agentOps.js'
import type { ProjectStatus } from '../../src/types/index.js'
import { listTrackerProjects, updateTrackerProject } from './trackerOps.js'
import { applyTrackerStatusChanges, buildTrackerSyncReport, computeTrackerStatusChanges, VANDAAG_TO_TRACKER_STATUS } from './trackerSync.js'

type TrackerSyncOutcome =
  | { updated: true; previousStatus: string; status: string }
  | { skipped: string }
  | { error: string }

/**
 * Calls `update_tracker_project` with the mapped status after a Vandaag `update_project`
 * write that asked for `syncStatus: true`. Runs strictly after the Vandaag transaction has
 * already committed — a tracker failure here is reported back, never rolled back into the
 * Vandaag write (there is nothing to roll back; the Vandaag write already happened).
 */
async function attachTrackerSync(
  project: AgentProjectSummary,
  previousStatus: ProjectStatus | undefined,
  params: Record<string, unknown>,
): Promise<{ project: AgentProjectSummary; tracker?: TrackerSyncOutcome }> {
  if (params.syncStatus !== true) return { project }
  if (!project.trackerProjectId) {
    return { project, tracker: { skipped: 'Project is not linked to a tracker project' } }
  }
  if (previousStatus === undefined || previousStatus === project.status) {
    return { project, tracker: { skipped: 'Status did not change' } }
  }

  const trackerStatus = VANDAAG_TO_TRACKER_STATUS[project.status]
  try {
    const { previousStatus: trackerPreviousStatus } = await updateTrackerProject({
      projectId: project.trackerProjectId,
      status: trackerStatus,
    })
    return { project, tracker: { updated: true, previousStatus: trackerPreviousStatus, status: trackerStatus } }
  } catch (err) {
    console.error('[agent] tracker sync after update_project failed:', err)
    return { project, tracker: { error: 'Failed to sync status to the tracker' } }
  }
}

/**
 * Shared by api/agent.ts (plain HTTP) and api/mcp.ts (MCP tools/call): reads the
 * user doc inside a transaction, applies the pure op, and writes back only the
 * changed top-level fields plus a fresh syncedAt — so a stale client tab's
 * onSnapshot listener picks up the write instead of silently losing it.
 */
export async function executeAgentAction(action: string, params: Record<string, unknown>): Promise<unknown> {
  // Tracker-only actions: read/write a separate Firebase project's doc, not the Vandaag user
  // doc below, so they bypass the isAgentAction/transaction machinery entirely.
  if (action === 'list_tracker_projects') {
    return listTrackerProjects(params)
  }
  if (action === 'update_tracker_project') {
    return updateTrackerProject(params)
  }

  if (action === 'tracker_sync_report' || action === 'sync_tracker_status') {
    const uid = getAgentUid()
    if (!uid) throw new AgentOpError(503, 'Agent API is not configured')
    const db = getDb()
    const docRef = db.collection('users').doc(uid)

    if (action === 'tracker_sync_report') {
      // Read-only: a plain get() suffices, no transaction needed.
      const [snap, tracker] = await Promise.all([docRef.get(), listTrackerProjects({})])
      if (!snap.exists) throw new AgentOpError(404, 'User document not found')
      const data = normalizeSyncData(snap.data())
      return buildTrackerSyncReport(data.projects, tracker.projects, params)
    }

    // sync_tracker_status: read the tracker first, then diff+apply inside the Vandaag
    // transaction (dryRun just skips the tx.update at the end).
    const dryRun = params.dryRun !== false
    const tracker = await listTrackerProjects({})
    return db.runTransaction(async tx => {
      const snap = await tx.get(docRef)
      if (!snap.exists) throw new AgentOpError(404, 'User document not found')
      const data = normalizeSyncData(snap.data())
      const changes = computeTrackerStatusChanges(data.projects, tracker.projects, params)
      if (!dryRun && changes.length > 0) {
        const patch = applyTrackerStatusChanges(data, changes)
        tx.update(docRef, stripUndefined({ ...patch, syncedAt: new Date().toISOString() }))
      }
      return { dryRun, changes }
    })
  }

  if (!isAgentAction(action)) {
    throw new AgentOpError(400, `Unknown action: ${action}`)
  }

  const uid = getAgentUid()
  if (!uid) throw new AgentOpError(503, 'Agent API is not configured')

  const db = getDb()
  const docRef = db.collection('users').doc(uid)

  let previousProjectStatus: ProjectStatus | undefined
  const result = await db.runTransaction(async tx => {
    const snap = await tx.get(docRef)
    if (!snap.exists) {
      throw new AgentOpError(404, 'User document not found')
    }
    const data: SyncData = normalizeSyncData(snap.data())
    if (action === 'update_project' && typeof params.projectId === 'string') {
      previousProjectStatus = data.projects.find(p => p.id === params.projectId)?.status
    }
    const { patch, result } = runAgentOperation(action, data, params)
    if (Object.keys(patch).length > 0) {
      tx.update(docRef, stripUndefined({ ...patch, syncedAt: new Date().toISOString() }))
    }
    return result
  })

  if (action === 'update_project') {
    return attachTrackerSync(result as AgentProjectSummary, previousProjectStatus, params)
  }
  return result
}
