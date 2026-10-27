/**
 * Pure, framework-free two-way sync between Vandaag project tasks and Off Course Project
 * Tracker subtasks. No Firestore, no HTTP — the caller (`runAgentAction.ts`) supplies the
 * raw tracker doc (so unknown per-subtask fields survive untouched, same discipline as
 * `trackerOps.ts`'s `applyTrackerProjectUpdate`) and the last-seen tracker snapshot
 * (`changeLog.ts`), and applies the resulting patches inside its own transactions.
 *
 * Design:
 *  - Linking is one-directional storage: a tracker subtask carries `vandaagTaskId` pointing
 *    at the Vandaag task it mirrors. Vandaag's own `Task` type is untouched — no new field,
 *    no migration risk. Matching is always by `vandaagTaskId === task.id`, never by title,
 *    so nothing is ever duplicated.
 *  - Conflict resolution reuses the tracker-drift snapshot already kept for the change log
 *    (`users/{uid}/meta/trackerSnapshot`) instead of inventing a second "last-seen Vandaag"
 *    snapshot. A linked pair only needs resolving when its *current* title/done actually
 *    disagree; when they do, the snapshot's last-synced subtask value says which side(s)
 *    moved since then:
 *      - only the tracker moved -> tracker wins (pulled into the Vandaag task, including
 *        un-completing it if the tracker went from done back to open)
 *      - only Vandaag moved     -> Vandaag wins (pushed to the subtask)
 *      - both moved, or there's no snapshot entry yet (first-ever sync for this pair)
 *        -> title: Vandaag wins; done: true wins over false (completion is sticky — it
 *        never gets un-synced back to open by this "both changed" branch; an explicit
 *        tracker-only un-complete, the case above, still works)
 *  - A dropped Vandaag task removes its linked subtask (never a hard delete on the Vandaag
 *    side — the task itself still exists with `status: 'dropped'`, same as everywhere else
 *    in this API; only the tracker-side mirror goes away).
 *  - A task moved to a different *linked* project removes the old subtask and creates a
 *    fresh one in the new project, rather than "transferring" the raw object — the two
 *    projects' subtask lists are otherwise independent, and a new subtask is simpler and no
 *    less correct (it still carries the same `vandaagTaskId`, so matching is unaffected).
 *  - Tracker subtasks without a `vandaagTaskId` are never written to — only reported
 *    (`unlinkedSubtasks`) — unless `importUnlinked` creates a Vandaag task for them and
 *    stamps the link onto the subtask afterward.
 */
import { v4 as uuid } from 'uuid'
import { AgentOpError, type SyncData } from './agentOps.js'
import type { Project, Task } from '../../src/types/index.js'
import { toArray, toObject, toStr, type TrackerDoc } from './trackerOps.js'
import type { TrackerSnapshotDoc } from './changeLog.js'

type Params = Record<string, unknown>
type RawSubtask = Record<string, unknown> & { id: string; title: string; done: boolean }

function badRequest(message: string): never {
  throw new AgentOpError(400, message)
}

/** Same id scheme as the live tracker app's own `addSubtask` (8-char base36). */
function generateTrackerSubtaskId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function normalizeRawSubtask(raw: unknown): RawSubtask | undefined {
  const obj = toObject(raw)
  const id = obj && toStr(obj.id)
  if (!obj || !id) return undefined
  return { ...obj, id, title: toStr(obj.title) ?? toStr(obj.name) ?? '', done: !!obj.done }
}

/** Shared by `planTrackerTaskSync` and `planSingleTaskMirror`: raw per-project objects, and a mutable id-keyed map of their subtasks. */
function loadWorkingSubtasks(trackerDoc: TrackerDoc | undefined) {
  const rawTrackerProjects = toArray(trackerDoc?.projects)
    .map(toObject)
    .filter((o): o is Record<string, unknown> => !!o && typeof toStr(o.id) === 'string')

  const workingSubtasks = new Map<string, Map<string, RawSubtask>>()
  for (const raw of rawTrackerProjects) {
    const id = toStr(raw.id)!
    const map = new Map<string, RawSubtask>()
    for (const rawSubtask of toArray(raw.subtasks)) {
      const normalized = normalizeRawSubtask(rawSubtask)
      if (normalized) map.set(normalized.id, normalized)
    }
    workingSubtasks.set(id, map)
  }
  return { rawTrackerProjects, workingSubtasks }
}

function rebuildTrackerProjects(rawTrackerProjects: Record<string, unknown>[], workingSubtasks: Map<string, Map<string, RawSubtask>>, dirty: Set<string>): unknown[] {
  return rawTrackerProjects.map(raw => {
    const id = toStr(raw.id)!
    if (!dirty.has(id)) return raw
    return { ...raw, subtasks: [...workingSubtasks.get(id)!.values()] }
  })
}

export type TaskSyncAction = 'create_subtask' | 'remove_subtask' | 'pull_from_tracker' | 'push_to_tracker' | 'move_subtask'

export interface TaskSyncChange {
  action: TaskSyncAction
  vandaagProjectId: string
  trackerProjectId: string
  taskId?: string
  subtaskId?: string
  fromTrackerProjectId?: string // only for 'move_subtask'
  before?: Record<string, unknown>
  after?: Record<string, unknown>
}

export interface TaskSyncUnlinkedSubtask {
  trackerProjectId: string
  subtaskId: string
  title: string
  done: boolean
}

export interface TaskSyncImportedTask {
  trackerProjectId: string
  subtaskId: string
  vandaagProjectId: string
  taskId: string
  title: string
}

export interface TaskSyncPlan {
  changes: TaskSyncChange[]
  unlinkedSubtasks: TaskSyncUnlinkedSubtask[]
  importedTasks: TaskSyncImportedTask[]
  /** Only set when there's something to write (new/updated tasks from pulls or imports). */
  vandaagPatch: Partial<SyncData>
  /** Full `projects` array for the tracker doc, with only touched projects' subtasks rewritten — everything else (including unknown fields) preserved verbatim. */
  trackerProjects: unknown[]
  trackerChanged: boolean
}

function parseProjectIdsParam(params: Params): Set<string> | undefined {
  const raw = params.projectIds
  if (raw === undefined) return undefined
  if (!Array.isArray(raw) || !raw.every(id => typeof id === 'string')) {
    badRequest('projectIds must be an array of strings')
  }
  return new Set(raw as string[])
}

/**
 * Builds the full sync plan. Always computes the plan regardless of `dryRun` — that's the
 * caller's (`runAgentAction.ts`) concern, since whether to *apply* `vandaagPatch`/
 * `trackerProjects` is an IO decision, not a planning one. `importUnlinked`, by contrast,
 * changes the plan itself (whether unlinked subtasks turn into new Vandaag tasks), so it's
 * read here.
 */
export function planTrackerTaskSync(
  vandaagProjects: Project[],
  trackerDoc: TrackerDoc | undefined,
  trackerSnapshot: TrackerSnapshotDoc | undefined,
  params: Params,
  now: string,
): TaskSyncPlan {
  const importUnlinked = params.importUnlinked === true
  const projectIdFilter = parseProjectIdsParam(params)

  const { rawTrackerProjects, workingSubtasks } = loadWorkingSubtasks(trackerDoc)
  const snapshotProjectById = new Map((trackerSnapshot?.projects ?? []).map(p => [p.id, p]))

  // Global index across every tracker project (not just targeted ones) — needed to detect
  // a task that's linked to a *different* project than where it currently lives in Vandaag.
  const linkIndex = new Map<string, { trackerProjectId: string; subtaskId: string }>()
  for (const [trackerProjectId, subtasks] of workingSubtasks) {
    for (const subtask of subtasks.values()) {
      const vandaagTaskId = toStr(subtask.vandaagTaskId)
      if (vandaagTaskId) linkIndex.set(vandaagTaskId, { trackerProjectId, subtaskId: subtask.id })
    }
  }

  const targetProjects = vandaagProjects.filter(
    p => p.trackerProjectId && workingSubtasks.has(p.trackerProjectId) && (!projectIdFilter || projectIdFilter.has(p.id)),
  )
  const targetVandaagProjectIds = new Set(targetProjects.map(p => p.id))

  const changes: TaskSyncChange[] = []
  const vandaagTaskPatchesById = new Map<string, Partial<Task>>()
  const dirtyTrackerProjectIds = new Set<string>()

  for (const vp of targetProjects) {
    const trackerProjectId = vp.trackerProjectId!
    const subtasks = workingSubtasks.get(trackerProjectId)!
    const snapshotSubtaskById = new Map((snapshotProjectById.get(trackerProjectId)?.subtasks ?? []).map(s => [s.id, s]))

    for (const task of vp.tasks) {
      const link = linkIndex.get(task.id)

      if (task.status === 'dropped') {
        if (link) {
          const subtask = workingSubtasks.get(link.trackerProjectId)!.get(link.subtaskId)!
          workingSubtasks.get(link.trackerProjectId)!.delete(link.subtaskId)
          dirtyTrackerProjectIds.add(link.trackerProjectId)
          changes.push({
            action: 'remove_subtask',
            vandaagProjectId: vp.id,
            trackerProjectId: link.trackerProjectId,
            taskId: task.id,
            subtaskId: link.subtaskId,
            before: { title: subtask.title, done: subtask.done },
          })
        }
        continue
      }

      const vandaagDone = task.status === 'done'

      if (!link) {
        const newId = generateTrackerSubtaskId()
        subtasks.set(newId, { id: newId, title: task.title, done: vandaagDone, vandaagTaskId: task.id })
        dirtyTrackerProjectIds.add(trackerProjectId)
        changes.push({
          action: 'create_subtask',
          vandaagProjectId: vp.id,
          trackerProjectId,
          taskId: task.id,
          subtaskId: newId,
          after: { title: task.title, done: vandaagDone },
        })
        continue
      }

      if (link.trackerProjectId !== trackerProjectId) {
        workingSubtasks.get(link.trackerProjectId)!.delete(link.subtaskId)
        dirtyTrackerProjectIds.add(link.trackerProjectId)
        const newId = generateTrackerSubtaskId()
        subtasks.set(newId, { id: newId, title: task.title, done: vandaagDone, vandaagTaskId: task.id })
        dirtyTrackerProjectIds.add(trackerProjectId)
        changes.push({
          action: 'move_subtask',
          vandaagProjectId: vp.id,
          trackerProjectId,
          fromTrackerProjectId: link.trackerProjectId,
          taskId: task.id,
          subtaskId: newId,
          after: { title: task.title, done: vandaagDone },
        })
        continue
      }

      // Already linked within this same project — resolve any disagreement.
      const subtask = subtasks.get(link.subtaskId)!
      const titleDiffers = task.title !== subtask.title
      const doneDiffers = vandaagDone !== subtask.done
      if (!titleDiffers && !doneDiffers) continue

      const snapshotSubtask = snapshotSubtaskById.get(subtask.id)
      const trackerMoved = !snapshotSubtask || snapshotSubtask.title !== subtask.title || snapshotSubtask.done !== subtask.done
      const vandaagMoved = !snapshotSubtask || snapshotSubtask.title !== task.title || snapshotSubtask.done !== vandaagDone

      if (trackerMoved && !vandaagMoved) {
        const patch: Partial<Task> = {}
        if (titleDiffers) patch.title = subtask.title
        if (doneDiffers) patch.status = subtask.done ? 'done' : 'backlog'
        vandaagTaskPatchesById.set(task.id, patch)
        changes.push({
          action: 'pull_from_tracker',
          vandaagProjectId: vp.id,
          trackerProjectId,
          taskId: task.id,
          subtaskId: subtask.id,
          before: { title: task.title, done: vandaagDone },
          after: { title: subtask.title, done: subtask.done },
        })
      } else if (!trackerMoved && vandaagMoved) {
        subtasks.set(subtask.id, { ...subtask, title: task.title, done: vandaagDone })
        dirtyTrackerProjectIds.add(trackerProjectId)
        changes.push({
          action: 'push_to_tracker',
          vandaagProjectId: vp.id,
          trackerProjectId,
          taskId: task.id,
          subtaskId: subtask.id,
          before: { title: subtask.title, done: subtask.done },
          after: { title: task.title, done: vandaagDone },
        })
      } else {
        // Both moved since the snapshot (or there's no snapshot yet): title always follows
        // Vandaag; done is sticky-true (never un-completed by this branch).
        const resolvedDone = vandaagDone || subtask.done
        subtasks.set(subtask.id, { ...subtask, title: task.title, done: resolvedDone })
        dirtyTrackerProjectIds.add(trackerProjectId)
        if (resolvedDone !== vandaagDone) vandaagTaskPatchesById.set(task.id, { status: 'done' })
        changes.push({
          action: 'push_to_tracker',
          vandaagProjectId: vp.id,
          trackerProjectId,
          taskId: task.id,
          subtaskId: subtask.id,
          before: { title: subtask.title, done: subtask.done },
          after: { title: task.title, done: resolvedDone },
        })
      }
    }
  }

  const unlinkedSubtasks: TaskSyncUnlinkedSubtask[] = []
  const importedTasks: TaskSyncImportedTask[] = []
  const importedVandaagTasks: Task[] = []

  for (const vp of targetProjects) {
    const trackerProjectId = vp.trackerProjectId!
    const subtasks = workingSubtasks.get(trackerProjectId)!
    for (const subtask of [...subtasks.values()]) {
      if (toStr(subtask.vandaagTaskId)) continue
      if (importUnlinked) {
        const newTask: Task = {
          id: uuid(),
          title: subtask.title || '(untitled)',
          status: subtask.done ? 'done' : 'backlog',
          isRecurring: false,
          isUncomfortable: false,
          createdAt: now,
          projectId: vp.id,
        }
        importedVandaagTasks.push(newTask)
        subtasks.set(subtask.id, { ...subtask, vandaagTaskId: newTask.id })
        dirtyTrackerProjectIds.add(trackerProjectId)
        importedTasks.push({ trackerProjectId, subtaskId: subtask.id, vandaagProjectId: vp.id, taskId: newTask.id, title: newTask.title })
      } else {
        unlinkedSubtasks.push({ trackerProjectId, subtaskId: subtask.id, title: subtask.title, done: subtask.done })
      }
    }
  }

  let vandaagPatch: Partial<SyncData> = {}
  if (vandaagTaskPatchesById.size > 0 || importedVandaagTasks.length > 0) {
    const projects = vandaagProjects.map(p => {
      if (!targetVandaagProjectIds.has(p.id)) return p
      const tasks = p.tasks.map(t => {
        const patch = vandaagTaskPatchesById.get(t.id)
        return patch ? { ...t, ...patch } : t
      })
      const newTasks = importedVandaagTasks.filter(t => t.projectId === p.id)
      if (newTasks.length === 0 && tasks === p.tasks) return p
      return { ...p, tasks: newTasks.length > 0 ? [...tasks, ...newTasks] : tasks }
    })
    if (projects.some((p, i) => p !== vandaagProjects[i])) vandaagPatch = { projects }
  }

  const trackerProjects = rebuildTrackerProjects(rawTrackerProjects, workingSubtasks, dirtyTrackerProjectIds)

  return { changes, unlinkedSubtasks, importedTasks, vandaagPatch, trackerProjects, trackerChanged: dirtyTrackerProjectIds.size > 0 }
}

// ── single-task best-effort mirror (add_task/update_task/complete_task/drop_task) ───────

export interface SingleTaskMirrorInput {
  taskId: string
  title: string
  done: boolean
  dropped: boolean
  /** The Vandaag project this task currently belongs to (for the change-log entry only). */
  vandaagProjectId: string
  /** trackerProjectId the task's project is linked to *after* this write (undefined if unlinked/orphan). */
  newTrackerProjectId?: string
}

export interface SingleTaskMirrorPlan {
  trackerProjects: unknown[]
  trackerChanged: boolean
  change?: TaskSyncChange
}

/**
 * Focused counterpart to `planTrackerTaskSync`, for the best-effort single-task push that
 * runs immediately after `add_task`/`update_task`/`complete_task`/`drop_task` commits on a
 * linked project. Always pushes Vandaag's just-written state — there's no conflict to
 * resolve here (no snapshot lookup), since this *is* the change the snapshot would need to
 * reconcile against next time, not a case of two sides having drifted independently.
 */
export function planSingleTaskMirror(input: SingleTaskMirrorInput, trackerDoc: TrackerDoc | undefined): SingleTaskMirrorPlan {
  const { rawTrackerProjects, workingSubtasks } = loadWorkingSubtasks(trackerDoc)
  const dirty = new Set<string>()

  let link: { trackerProjectId: string; subtaskId: string } | undefined
  for (const [trackerProjectId, subtasks] of workingSubtasks) {
    for (const subtask of subtasks.values()) {
      if (toStr(subtask.vandaagTaskId) === input.taskId) {
        link = { trackerProjectId, subtaskId: subtask.id }
        break
      }
    }
    if (link) break
  }

  const noop: SingleTaskMirrorPlan = { trackerProjects: rawTrackerProjects, trackerChanged: false }

  if (input.dropped) {
    if (!link) return noop
    const subtask = workingSubtasks.get(link.trackerProjectId)!.get(link.subtaskId)!
    workingSubtasks.get(link.trackerProjectId)!.delete(link.subtaskId)
    dirty.add(link.trackerProjectId)
    return {
      trackerProjects: rebuildTrackerProjects(rawTrackerProjects, workingSubtasks, dirty),
      trackerChanged: true,
      change: { action: 'remove_subtask', vandaagProjectId: input.vandaagProjectId, trackerProjectId: link.trackerProjectId, taskId: input.taskId, subtaskId: link.subtaskId, before: { title: subtask.title, done: subtask.done } },
    }
  }

  const target = input.newTrackerProjectId
  if (!target) {
    // No longer (or never) in a linked project — drop any stale link, nothing to create.
    if (!link) return noop
    const subtask = workingSubtasks.get(link.trackerProjectId)!.get(link.subtaskId)!
    workingSubtasks.get(link.trackerProjectId)!.delete(link.subtaskId)
    dirty.add(link.trackerProjectId)
    return {
      trackerProjects: rebuildTrackerProjects(rawTrackerProjects, workingSubtasks, dirty),
      trackerChanged: true,
      change: { action: 'remove_subtask', vandaagProjectId: input.vandaagProjectId, trackerProjectId: link.trackerProjectId, taskId: input.taskId, subtaskId: link.subtaskId, before: { title: subtask.title, done: subtask.done } },
    }
  }
  if (!workingSubtasks.has(target)) return noop // target tracker project doesn't actually exist — nothing sensible to do

  if (!link) {
    const newId = generateTrackerSubtaskId()
    workingSubtasks.get(target)!.set(newId, { id: newId, title: input.title, done: input.done, vandaagTaskId: input.taskId })
    dirty.add(target)
    return {
      trackerProjects: rebuildTrackerProjects(rawTrackerProjects, workingSubtasks, dirty),
      trackerChanged: true,
      change: { action: 'create_subtask', vandaagProjectId: input.vandaagProjectId, trackerProjectId: target, taskId: input.taskId, subtaskId: newId, after: { title: input.title, done: input.done } },
    }
  }

  if (link.trackerProjectId !== target) {
    workingSubtasks.get(link.trackerProjectId)!.delete(link.subtaskId)
    dirty.add(link.trackerProjectId)
    const newId = generateTrackerSubtaskId()
    workingSubtasks.get(target)!.set(newId, { id: newId, title: input.title, done: input.done, vandaagTaskId: input.taskId })
    dirty.add(target)
    return {
      trackerProjects: rebuildTrackerProjects(rawTrackerProjects, workingSubtasks, dirty),
      trackerChanged: true,
      change: { action: 'move_subtask', vandaagProjectId: input.vandaagProjectId, trackerProjectId: target, fromTrackerProjectId: link.trackerProjectId, taskId: input.taskId, subtaskId: newId, after: { title: input.title, done: input.done } },
    }
  }

  const subtask = workingSubtasks.get(target)!.get(link.subtaskId)!
  if (subtask.title === input.title && subtask.done === input.done) return noop
  const before = { title: subtask.title, done: subtask.done }
  workingSubtasks.get(target)!.set(link.subtaskId, { ...subtask, title: input.title, done: input.done })
  dirty.add(target)
  return {
    trackerProjects: rebuildTrackerProjects(rawTrackerProjects, workingSubtasks, dirty),
    trackerChanged: true,
    change: { action: 'push_to_tracker', vandaagProjectId: input.vandaagProjectId, trackerProjectId: target, taskId: input.taskId, subtaskId: link.subtaskId, before, after: { title: input.title, done: input.done } },
  }
}
