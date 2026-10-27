import { getDb, getAgentUid } from './firebaseAdmin.js'
import {
  AgentOpError,
  amsterdamDateString,
  isAgentAction,
  locateTask,
  normalizeSyncData,
  runAgentOperation,
  stripUndefined,
  type AgentAction,
  type AgentProjectSummary,
  type AgentTaskSummary,
  type SyncData,
} from './agentOps.js'
import type { Project, ProjectStatus, Task } from '../../src/types/index.js'
import {
  listTrackerProjects,
  readRawTrackerDoc,
  runTrackerDocMutation,
  summarizeTrackerProjects,
  updateTrackerProject,
} from './trackerOps.js'
import { applyTrackerStatusChanges, buildTrackerSyncReport, computeTrackerStatusChanges, VANDAAG_TO_TRACKER_STATUS } from './trackerSync.js'
import { planSingleTaskMirror, planTrackerTaskSync, type SingleTaskMirrorInput, type TaskSyncChange } from './trackerTasks.js'
import {
  appendChangesBestEffort,
  appendChangesInTransaction,
  buildChangeEntry,
  deepBlockLogDocRef,
  diffEntityFields,
  listChanges as listChangesIo,
  patchTrackerSnapshotProjectsBestEffort,
  pruneChangesBestEffort,
  readDeepBlockLog,
  readTrackerSnapshot,
  recordTrackerDriftBestEffort,
  type ChangeEntry,
} from './changeLog.js'
import { buildDeepBlockCompletion, computeDeepBlockStats, deriveDeepBlockEntriesFromHistory, mergeDeepBlockEntries, parseWeeksParam } from './deepBlock.js'

type TrackerSyncOutcome =
  | { updated: true; previousStatus: string; status: string }
  | { skipped: string }
  | { error: string }

type TaskTrackerOutcome = { updated: true } | { skipped: string } | { error: string }

const TASK_LOG_KEYS = ['title', 'status', 'projectId', 'taskType', 'nextAction', 'kanbanColumn'] as const
const PROJECT_LOG_KEYS = ['title', 'status', 'category', 'trackerProjectId', 'marketingCode', 'marketingPeriod'] as const
const TASK_ACTIONS = new Set<AgentAction>(['add_task', 'update_task', 'complete_task', 'drop_task'])
const PROJECT_ACTIONS = new Set<AgentAction>(['add_project', 'rename_project', 'update_project'])

function taskLogFields(t: Task): Record<string, unknown> {
  return {
    title: t.title,
    status: t.status,
    projectId: t.projectId,
    taskType: t.taskType,
    nextAction: t.nextAction,
    kanbanColumn: t.kanbanColumn,
  }
}

function projectLogFields(p: Project): Record<string, unknown> {
  return {
    title: p.title,
    status: p.status,
    category: p.category,
    trackerProjectId: p.trackerProjectId,
    marketingCode: p.marketingCode,
    marketingPeriod: p.marketingPeriod,
  }
}

/** Finds a task's current field values for the "before" half of a change-log entry, without throwing if it's missing (the write itself already validates existence). */
function findTaskFieldsLoose(data: SyncData, taskId: string): Record<string, unknown> | undefined {
  for (const project of data.projects) {
    const task = project.tasks.find(t => t.id === taskId)
    if (task) return taskLogFields(task)
  }
  const orphan = data.orphanTasks.find(t => t.id === taskId)
  if (orphan) return taskLogFields(orphan)
  const recurring = data.recurringTasks.find(t => t.id === taskId)
  return recurring ? taskLogFields(recurring) : undefined
}

/** Builds the `side: 'agent'` change entry for one write-action result, or undefined for actions this module doesn't log (none currently — every WRITE_ACTION is a task or project op). */
function buildAgentChangeEntry(action: AgentAction, result: unknown, before: Record<string, unknown> | undefined, at: string): ChangeEntry | undefined {
  if (TASK_ACTIONS.has(action)) {
    const r = result as AgentTaskSummary
    const { before: b, after: a } = diffEntityFields(before, r as unknown as Record<string, unknown>, TASK_LOG_KEYS)
    return buildChangeEntry({ at, side: 'agent', entity: 'task', id: r.id, action, before: b, after: a })
  }
  if (PROJECT_ACTIONS.has(action)) {
    const r = result as AgentProjectSummary
    const { before: b, after: a } = diffEntityFields(before, r as unknown as Record<string, unknown>, PROJECT_LOG_KEYS)
    return buildChangeEntry({ at, side: 'agent', entity: 'project', id: r.id, action, before: b, after: a })
  }
  return undefined
}

/**
 * Figures out whether a just-written task action is worth mirroring into the tracker: only
 * when the task's project (old and/or new, for a move) is actually linked. Recurring tasks
 * are excluded — `planTrackerTaskSync` only ever looks at `project.tasks`, never
 * `recurringTasks`, so mirroring one here would create a tracker-side link the general sync
 * can never see or clean up.
 */
function computeTaskMirrorInput(action: AgentAction, params: Record<string, unknown>, data: SyncData, result: AgentTaskSummary): SingleTaskMirrorInput | undefined {
  if (!TASK_ACTIONS.has(action)) return undefined

  let oldProjectId: string | undefined
  if (action !== 'add_task' && typeof params.taskId === 'string') {
    const loc = locateTask(data, params.taskId)
    if (loc.kind === 'recurring') return undefined
    oldProjectId = loc.kind === 'project' ? loc.project.id : undefined
  }

  const newProjectId = result.projectId
  const oldTrackerProjectId = oldProjectId ? data.projects.find(p => p.id === oldProjectId)?.trackerProjectId : undefined
  const newTrackerProjectId = newProjectId ? data.projects.find(p => p.id === newProjectId)?.trackerProjectId : undefined
  if (!oldTrackerProjectId && !newTrackerProjectId) return undefined

  return {
    taskId: result.id,
    title: result.title,
    done: result.status === 'done',
    dropped: result.status === 'dropped',
    vandaagProjectId: newProjectId ?? oldProjectId ?? '',
    newTrackerProjectId,
  }
}

/** Entity/id pair for logging one `TaskSyncChange` — `pull_from_tracker` touched a Vandaag task, everything else touched a tracker subtask. */
function taskSyncChangeToEntry(c: TaskSyncChange, action: string, at: string): ChangeEntry {
  const isTaskSide = c.action === 'pull_from_tracker'
  return buildChangeEntry({
    at,
    side: 'agent',
    entity: isTaskSide ? 'task' : 'subtask',
    id: (isTaskSide ? c.taskId : c.subtaskId) ?? '',
    action,
    before: c.before,
    after: c.after,
  })
}

/**
 * Calls `update_tracker_project` with the mapped status after a Vandaag `update_project`
 * write that asked for `syncStatus: true`. Runs strictly after the Vandaag transaction has
 * already committed — a tracker failure here is reported back, never rolled back into the
 * Vandaag write (there is nothing to roll back; the Vandaag write already happened).
 */
async function attachTrackerSync(
  db: ReturnType<typeof getDb>,
  uid: string,
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
    const { project: trackerProject, previousStatus: trackerPreviousStatus } = await updateTrackerProject({
      projectId: project.trackerProjectId,
      status: trackerStatus,
    })
    const now = new Date().toISOString()
    await Promise.all([
      appendChangesBestEffortEntry(db, uid, {
        at: now,
        side: 'agent',
        entity: 'project',
        id: project.trackerProjectId,
        action: 'update_tracker_project',
        before: { status: trackerPreviousStatus },
        after: { status: trackerStatus },
      }),
      patchTrackerSnapshotProjectsBestEffort(db, uid, [trackerProject]),
    ])
    return { project, tracker: { updated: true, previousStatus: trackerPreviousStatus, status: trackerStatus } }
  } catch (err) {
    console.error('[agent] tracker sync after update_project failed:', err)
    return { project, tracker: { error: 'Failed to sync status to the tracker' } }
  }
}

/**
 * Best-effort single-task tracker push after `add_task`/`update_task`/`complete_task`/
 * `drop_task` commits on a project linked to the tracker (or moved into/out of one). Unlike
 * `update_project`'s `syncStatus`, this only adds a `tracker` field to the result when a
 * mirror was actually attempted — an unlinked task's result is returned completely
 * untouched, so this is purely additive for the (overwhelmingly common) unlinked case.
 */
async function attachTaskTrackerMirror(
  db: ReturnType<typeof getDb>,
  uid: string,
  task: AgentTaskSummary,
  input: SingleTaskMirrorInput,
): Promise<AgentTaskSummary & { tracker?: TaskTrackerOutcome }> {
  try {
    const written = await runTrackerDocMutation(freshDoc => {
      const plan = planSingleTaskMirror(input, freshDoc)
      return { projects: plan.trackerProjects, result: plan }
    })
    if (!written.trackerChanged || !written.change) {
      return { ...task, tracker: { skipped: 'No tracker-side change needed' } }
    }

    const now = new Date().toISOString()
    const change = written.change
    const touchedIds = [change.trackerProjectId, ...(change.fromTrackerProjectId ? [change.fromTrackerProjectId] : [])]
    const summaries = summarizeTrackerProjects({ projects: written.trackerProjects }, {}).filter(p => touchedIds.includes(p.id))
    await Promise.all([
      appendChangesBestEffortEntry(db, uid, taskSyncChangeToEntry(change, `task_tracker_mirror:${change.action}`, now)),
      patchTrackerSnapshotProjectsBestEffort(db, uid, summaries),
    ])
    return { ...task, tracker: { updated: true } }
  } catch (err) {
    console.error('[agent] best-effort task tracker mirror failed:', err)
    return { ...task, tracker: { error: 'Failed to sync to the tracker' } }
  }
}

async function appendChangesBestEffortEntry(db: ReturnType<typeof getDb>, uid: string, entry: ChangeEntry): Promise<void> {
  await appendChangesBestEffort(db, uid, [entry])
}

/** Builds the lightweight raw-doc shim `planTrackerTaskSync` expects, from already-fetched `TrackerProjectSummary[]` — used only for read-only reporting, where preserving unknown raw fields doesn't matter. */
function trackerProjectsAsRawDoc(trackerProjects: Awaited<ReturnType<typeof listTrackerProjects>>['projects']) {
  return { projects: trackerProjects.map(p => ({ id: p.id, title: p.title, status: p.status, subtasks: p.subtasks })) }
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
    const uid = getAgentUid()
    const result = await updateTrackerProject(params)
    if (uid) {
      const db = getDb()
      const now = new Date().toISOString()
      await Promise.all([
        appendChangesBestEffortEntry(db, uid, {
          at: now,
          side: 'agent',
          entity: 'project',
          id: result.project.id,
          action: 'update_tracker_project',
          before: { status: result.previousStatus },
          after: { status: result.project.status },
        }),
        patchTrackerSnapshotProjectsBestEffort(db, uid, [result.project]),
      ])
    }
    return result
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
      const now = new Date().toISOString()
      const [, trackerSnapshot] = await Promise.all([
        recordTrackerDriftBestEffort(db, uid, tracker.projects, tracker.projects, now),
        readTrackerSnapshot(db, uid),
      ])
      const report = buildTrackerSyncReport(data.projects, tracker.projects, params)
      const taskPlan = planTrackerTaskSync(data.projects, trackerProjectsAsRawDoc(tracker.projects), trackerSnapshot, { ...params, importUnlinked: false }, now)
      return {
        ...report,
        tasks: { pendingChanges: taskPlan.changes, unlinkedSubtasks: taskPlan.unlinkedSubtasks },
      }
    }

    // sync_tracker_status: read the tracker first, then diff+apply inside the Vandaag
    // transaction (dryRun just skips the tx.update at the end). Never writes to the
    // tracker itself, so the drift snapshot before/after are the same tracker read.
    const dryRun = params.dryRun !== false
    const tracker = await listTrackerProjects({})
    const now = new Date().toISOString()
    const result = await db.runTransaction(async tx => {
      const snap = await tx.get(docRef)
      if (!snap.exists) throw new AgentOpError(404, 'User document not found')
      const data = normalizeSyncData(snap.data())
      const changes = computeTrackerStatusChanges(data.projects, tracker.projects, params)
      if (!dryRun && changes.length > 0) {
        const patch = applyTrackerStatusChanges(data, changes)
        tx.update(docRef, stripUndefined({ ...patch, syncedAt: now }))
        const entries = changes.map(c =>
          buildChangeEntry({
            at: now,
            side: 'agent',
            entity: 'project',
            id: c.vandaagProjectId,
            action: 'sync_tracker_status',
            before: { status: c.from },
            after: { status: c.to },
          }),
        )
        appendChangesInTransaction(tx, db, uid, entries)
      }
      return { dryRun, changes }
    })
    await recordTrackerDriftBestEffort(db, uid, tracker.projects, tracker.projects, now)
    return result
  }

  if (action === 'sync_tracker_tasks') {
    const uid = getAgentUid()
    if (!uid) throw new AgentOpError(503, 'Agent API is not configured')
    const db = getDb()
    const docRef = db.collection('users').doc(uid)
    const dryRun = params.dryRun !== false
    const now = new Date().toISOString()

    const [{ doc: trackerDocBefore }, trackerSnapshot] = await Promise.all([readRawTrackerDoc(), readTrackerSnapshot(db, uid)])

    const { plan, vandaagProjectsAfter } = await db.runTransaction(async tx => {
      const snap = await tx.get(docRef)
      if (!snap.exists) throw new AgentOpError(404, 'User document not found')
      const data = normalizeSyncData(snap.data())
      const plan = planTrackerTaskSync(data.projects, trackerDocBefore, trackerSnapshot, params, now)
      if (!dryRun) {
        if (Object.keys(plan.vandaagPatch).length > 0) {
          tx.update(docRef, stripUndefined({ ...plan.vandaagPatch, syncedAt: now }))
        }
        if (plan.changes.length > 0) {
          appendChangesInTransaction(tx, db, uid, plan.changes.map(c => taskSyncChangeToEntry(c, `sync_tracker_tasks:${c.action}`, now)))
        }
      }
      return { plan, vandaagProjectsAfter: (plan.vandaagPatch.projects as Project[] | undefined) ?? data.projects }
    })

    let tracker: { updated: true } | { skipped: string } | { error: string } | undefined
    if (!dryRun) {
      if (!plan.trackerChanged) {
        tracker = { skipped: 'No tracker-side changes' }
      } else {
        try {
          const written = await runTrackerDocMutation(freshDoc => {
            const freshPlan = planTrackerTaskSync(vandaagProjectsAfter, freshDoc, trackerSnapshot, params, now)
            return { projects: freshPlan.trackerProjects, result: freshPlan }
          })
          const touchedIds = new Set(plan.changes.map(c => c.trackerProjectId))
          const summaries = summarizeTrackerProjects({ projects: written.trackerProjects }, {}).filter(p => touchedIds.has(p.id))
          await patchTrackerSnapshotProjectsBestEffort(db, uid, summaries)
          tracker = { updated: true }
        } catch (err) {
          console.error('[agent] sync_tracker_tasks tracker write failed:', err)
          tracker = { error: 'Failed to write changes to the tracker' }
        }
      }
      await pruneChangesBestEffort(db, uid, now)
    }

    return { dryRun, changes: plan.changes, unlinkedSubtasks: plan.unlinkedSubtasks, importedTasks: plan.importedTasks, tracker }
  }

  if (action === 'list_changes') {
    const uid = getAgentUid()
    if (!uid) throw new AgentOpError(503, 'Agent API is not configured')
    return listChangesIo(getDb(), uid, params)
  }

  if (action === 'complete_deep_block') {
    const uid = getAgentUid()
    if (!uid) throw new AgentOpError(503, 'Agent API is not configured')
    const db = getDb()
    const docRef = db.collection('users').doc(uid)
    const now = new Date().toISOString()
    const entry = await db.runTransaction(async tx => {
      const snap = await tx.get(docRef)
      if (!snap.exists) throw new AgentOpError(404, 'User document not found')
      const data = normalizeSyncData(snap.data())
      const { patch, entry } = buildDeepBlockCompletion(data, params, now)
      if (Object.keys(patch).length > 0) {
        tx.update(docRef, stripUndefined({ ...patch, syncedAt: now }))
      }
      tx.set(deepBlockLogDocRef(db, uid, entry.date), stripUndefined(entry))
      appendChangesInTransaction(tx, db, uid, [
        buildChangeEntry({ at: now, side: 'agent', entity: 'deepBlock', id: entry.date, action: 'complete_deep_block', after: entry as unknown as Record<string, unknown> }),
      ])
      return entry
    })
    await pruneChangesBestEffort(db, uid, now)
    return entry
  }

  if (action === 'deep_block_stats') {
    const uid = getAgentUid()
    if (!uid) throw new AgentOpError(503, 'Agent API is not configured')
    const db = getDb()
    const docRef = db.collection('users').doc(uid)
    const weeks = parseWeeksParam(params)
    const [logEntries, snap] = await Promise.all([readDeepBlockLog(db, uid), docRef.get()])
    if (!snap.exists) throw new AgentOpError(404, 'User document not found')
    const data = normalizeSyncData(snap.data())
    const derived = deriveDeepBlockEntriesFromHistory(data.planHistory, data.dailyPlan, data.projects)
    const entries = mergeDeepBlockEntries(logEntries, derived)
    return computeDeepBlockStats(entries, amsterdamDateString(0), weeks)
  }

  if (!isAgentAction(action)) {
    throw new AgentOpError(400, `Unknown action: ${action}`)
  }

  const uid = getAgentUid()
  if (!uid) throw new AgentOpError(503, 'Agent API is not configured')

  const db = getDb()
  const docRef = db.collection('users').doc(uid)

  let previousProjectStatus: ProjectStatus | undefined
  let taskMirror: SingleTaskMirrorInput | undefined
  const result = await db.runTransaction(async tx => {
    const snap = await tx.get(docRef)
    if (!snap.exists) {
      throw new AgentOpError(404, 'User document not found')
    }
    const data: SyncData = normalizeSyncData(snap.data())
    if (action === 'update_project' && typeof params.projectId === 'string') {
      previousProjectStatus = data.projects.find(p => p.id === params.projectId)?.status
    }

    let beforeFields: Record<string, unknown> | undefined
    if (TASK_ACTIONS.has(action) && action !== 'add_task' && typeof params.taskId === 'string') {
      beforeFields = findTaskFieldsLoose(data, params.taskId)
    } else if ((action === 'rename_project' || action === 'update_project') && typeof params.projectId === 'string') {
      const existing = data.projects.find(p => p.id === params.projectId)
      beforeFields = existing ? projectLogFields(existing) : undefined
    }

    const { patch, result } = runAgentOperation(action, data, params)
    const now = new Date().toISOString()
    if (Object.keys(patch).length > 0) {
      tx.update(docRef, stripUndefined({ ...patch, syncedAt: now }))
    }
    const entry = buildAgentChangeEntry(action, result, beforeFields, now)
    if (entry) appendChangesInTransaction(tx, db, uid, [entry])
    if (TASK_ACTIONS.has(action)) {
      taskMirror = computeTaskMirrorInput(action, params, data, result as AgentTaskSummary)
    }
    return result
  })

  await pruneChangesBestEffort(db, uid, new Date().toISOString())

  if (action === 'update_project') {
    return attachTrackerSync(db, uid, result as AgentProjectSummary, previousProjectStatus, params)
  }
  if (taskMirror) {
    return attachTaskTrackerMirror(db, uid, result as AgentTaskSummary, taskMirror)
  }
  return result
}
