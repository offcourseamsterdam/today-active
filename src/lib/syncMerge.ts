/**
 * Three-way merge for the Firestore sync doc: given the last-seen common
 * ancestor (`base`), the current in-memory store (`local`), and whatever is
 * currently in Firestore (`remote`), produces a single merged snapshot.
 *
 * Rule of thumb everywhere: if only one side changed a value relative to
 * `base`, take that side's value; if neither changed it, either value is
 * fine; if both changed it, local wins — except for entity arrays (projects,
 * tasks, orphanTasks, recurringTasks, goals, meetings, writeAway), which are
 * merged id-by-id (added-on-either-side entries are kept, not discarded),
 * and plan id-lists (shortTasks, maintenanceTasks, ...), which are unioned
 * instead of one side clobbering the other.
 */
import type { SyncData } from './firestore'
import type { Project, DailyPlan } from '../types'

function isNullish(v: unknown): boolean {
  return v === null || v === undefined
}

/**
 * `undefined`, `null`, and a missing key are all the same "no value" here —
 * the client store leaves optional fields absent, deepClean() turns
 * `undefined` into `null` before writing, and the agent API strips
 * `undefined` entirely. Without this, every entity with an unset optional
 * field would look "changed" on whichever side didn't happen to carry the
 * same representation, even though nothing actually changed.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (isNullish(a) && isNullish(b)) return true
  if (isNullish(a) || isNullish(b)) return false
  if (typeof a !== typeof b) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false
    if (a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, b[i]))
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ao = a as Record<string, unknown>
    const bo = b as Record<string, unknown>
    const keys = new Set([...Object.keys(ao), ...Object.keys(bo)])
    for (const k of keys) {
      if (!deepEqual(ao[k], bo[k])) return false
    }
    return true
  }
  return false
}

/**
 * Generic "only-one-side-changed wins, both-changed favors local" rule for a
 * single field or whole object. Uses the same nullish-aware deepEqual for
 * the base comparison as for the local/remote comparison — so e.g. a field
 * that's `undefined` in base and still `undefined` locally reads as
 * "unchanged locally" rather than "no base to compare against, assume
 * changed", which would otherwise make every untouched-but-unset optional
 * field look like a local conflict and silently win over a real remote change.
 */
export function mergeField<T>(base: T | undefined, local: T, remote: T): T {
  if (deepEqual(local, remote)) return local
  const localChanged = !deepEqual(base, local)
  const remoteChanged = !deepEqual(base, remote)
  if (!localChanged && remoteChanged) return remote
  if (localChanged && !remoteChanged) return local
  return local
}

function hasStringId(v: unknown): v is { id: string } {
  return !!v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string'
}

/**
 * Generic per-key three-way merge for a plain object — the default for
 * resolving "same id, both sides changed it" in mergeEntityArray. Each key
 * is resolved independently via mergeField, so an edit to one field (e.g.
 * nextAction) survives even though a different field (e.g. status) was
 * edited on the other side — the whole entity isn't clobbered by picking
 * one side wholesale. A key whose value looks like an array of `{id}`
 * entities (e.g. a task's `subtasks`) is merged id-by-id instead, via the
 * same rule recursively; anything else (including non-id arrays) is
 * resolved with mergeField.
 */
export function mergeObjectFields<T extends object>(base: T | undefined, local: T, remote: T): T {
  const lo = local as unknown as Record<string, unknown>
  const ro = remote as unknown as Record<string, unknown>
  const bo = base as unknown as Record<string, unknown> | undefined
  const keys = new Set([...Object.keys(lo), ...Object.keys(ro)])
  const result: Record<string, unknown> = {}

  for (const key of keys) {
    const lv = lo[key]
    const rv = ro[key]
    const bv = bo ? bo[key] : undefined

    if (Array.isArray(lv) && Array.isArray(rv)) {
      const sample = lv[0] ?? rv[0] ?? (Array.isArray(bv) ? bv[0] : undefined)
      if (hasStringId(sample)) {
        result[key] = mergeEntityArray(
          Array.isArray(bv) ? (bv as Array<{ id: string }>) : undefined,
          lv as Array<{ id: string }>,
          rv as Array<{ id: string }>,
        )
        continue
      }
    }
    result[key] = mergeField(bv, lv, rv)
  }

  return result as T
}

/**
 * Id-level merge for an entity array. `mergeOne` resolves what happens when
 * the same id differs between local and remote (default: mergeObjectFields —
 * per-key merge, so edits to different fields on each side both survive).
 * Deletions: if one side removed an id and the other left it untouched since
 * `base`, the removal is honored; if the other side also edited it, the edit
 * (local, on conflict) wins and the entity survives.
 */
export function mergeEntityArray<T extends { id: string }>(
  base: T[] | undefined,
  local: T[],
  remote: T[],
  mergeOne: (base: T | undefined, local: T, remote: T) => T = (b, l, r) => mergeObjectFields(b, l, r),
): T[] {
  const baseMap = new Map((base ?? []).map(e => [e.id, e]))
  const localMap = new Map(local.map(e => [e.id, e]))
  const remoteMap = new Map(remote.map(e => [e.id, e]))
  const ids = new Set([...baseMap.keys(), ...localMap.keys(), ...remoteMap.keys()])
  const order = [...local.map(e => e.id), ...remote.map(e => e.id).filter(id => !localMap.has(id))]

  const result: T[] = []
  for (const id of order) {
    if (!ids.has(id)) continue
    ids.delete(id)
    const b = baseMap.get(id)
    const l = localMap.get(id)
    const r = remoteMap.get(id)

    if (l && r) {
      result.push(deepEqual(l, r) ? l : mergeOne(b, l, r))
    } else if (l && !r) {
      // Missing remotely: keep if it's new locally, or if local edited it since base
      // (edit-vs-delete conflict — local wins). Otherwise remote's deletion is honored.
      if (!b || !deepEqual(b, l)) result.push(l)
    } else if (r && !l) {
      // Missing locally: keep only if it's brand new on the remote side (base never had it).
      // Otherwise local deleted it — local wins — so it stays dropped.
      if (!b) result.push(r)
    }
  }
  return result
}

/**
 * Project merge, via the generic per-key merge: scalar/object fields use
 * mergeField, and `tasks` (and each task's `subtasks`) merge id-by-id since
 * their elements carry string ids — so e.g. an agent completing one task
 * survives alongside a locally-edited title on the same project.
 */
function mergeProjectEntity(base: Project | undefined, local: Project, remote: Project): Project {
  return mergeObjectFields(base, local, remote)
}

function unionIds(a: string[] = [], b: string[] = []): string[] {
  return Array.from(new Set([...a, ...b]))
}

/** DailyPlan merge: on conflict, id-lists are unioned instead of one side winning outright. */
function mergePlanField(
  base: DailyPlan | null | undefined,
  local: DailyPlan | null,
  remote: DailyPlan | null,
): DailyPlan | null {
  if (deepEqual(local, remote)) return local
  const localChanged = !deepEqual(base, local)
  const remoteChanged = !deepEqual(base, remote)
  if (!localChanged && remoteChanged) return remote
  if (localChanged && !remoteChanged) return local
  // Both changed.
  if (!local || !remote) return local
  return {
    ...local,
    shortTasks: unionIds(local.shortTasks, remote.shortTasks),
    shortProjects: unionIds(local.shortProjects, remote.shortProjects),
    maintenanceTasks: unionIds(local.maintenanceTasks, remote.maintenanceTasks),
    maintenanceProjects: unionIds(local.maintenanceProjects, remote.maintenanceProjects),
    meetings: unionIds(local.meetings, remote.meetings),
    shortMeetingIds: unionIds(local.shortMeetingIds, remote.shortMeetingIds),
    maintenanceMeetingIds: unionIds(local.maintenanceMeetingIds, remote.maintenanceMeetingIds),
    completedItemIds: unionIds(local.completedItemIds, remote.completedItemIds),
    pinnedItemIds: unionIds(local.pinnedItemIds, remote.pinnedItemIds),
  }
}

export function mergeSyncData(base: SyncData, local: SyncData, remote: SyncData): SyncData {
  return {
    projects: mergeEntityArray(base.projects, local.projects, remote.projects, mergeProjectEntity),
    orphanTasks: mergeEntityArray(base.orphanTasks, local.orphanTasks, remote.orphanTasks),
    recurringTasks: mergeEntityArray(base.recurringTasks, local.recurringTasks, remote.recurringTasks),
    meetings: mergeEntityArray(base.meetings, local.meetings, remote.meetings),
    recurringMeetings: mergeEntityArray(base.recurringMeetings, local.recurringMeetings, remote.recurringMeetings),
    goals: mergeEntityArray(base.goals, local.goals, remote.goals),
    writeAway: mergeEntityArray(base.writeAway, local.writeAway, remote.writeAway),
    settings: mergeField(base.settings, local.settings, remote.settings),
    dailyPlan: mergePlanField(base.dailyPlan, local.dailyPlan, remote.dailyPlan),
    tomorrowPlan: mergePlanField(base.tomorrowPlan, local.tomorrowPlan, remote.tomorrowPlan),
    planHistory: mergeField(base.planHistory, local.planHistory, remote.planHistory),
    weekSlots: mergeField(base.weekSlots, local.weekSlots, remote.weekSlots),
    personalRules: mergeField(base.personalRules, local.personalRules, remote.personalRules),
    syncedAt: local.syncedAt,
  }
}
