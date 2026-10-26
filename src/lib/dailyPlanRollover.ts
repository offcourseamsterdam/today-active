/**
 * Pure logic for turning a stale `dailyPlan`/`tomorrowPlan` pair into today's plan:
 * promote tomorrow's locked-in plan if it's dated today (carrying over any
 * still-unfinished tasks from a stale dailyPlan into it), otherwise roll over a
 * stale dailyPlan's unfinished tasks into a fresh one for today — archiving
 * whichever plan gets replaced into planHistory.
 *
 * Shared between the client store (src/store/plansSlice.ts's `refreshDailyPlan`)
 * and the agent API (api/_lib/agentOps.ts's `addToToday` path) so the two can't
 * drift: a stale plan must always be archived + rolled over the same way,
 * whether the day changes while the app is open or while an agent writes to it.
 */
import type { DailyPlan } from '../types'

export interface RolledOverTasks {
  shortTasks: string[]
  maintenanceTasks: string[]
  shortProjects: string[]
  maintenanceProjects: string[]
  deepProjectId: string
  pinnedItemIds: string[]
}

export function rolloverTasks(
  plan: DailyPlan,
  allTasks: readonly { id: string; status: string }[],
): RolledOverTasks {
  const done = new Set(plan.completedItemIds ?? [])
  const pinned = new Set(plan.pinnedItemIds ?? [])
  const taskDone = (id: string) => done.has(id) || allTasks.find(t => t.id === id)?.status === 'done'
  const keepTask = (id: string) => pinned.has(id) || !taskDone(id)
  const keepProject = (id: string) => pinned.has(id) || !done.has(id)

  return {
    shortTasks: plan.shortTasks.filter(keepTask),
    maintenanceTasks: plan.maintenanceTasks.filter(keepTask),
    shortProjects: plan.shortProjects.filter(keepProject),
    maintenanceProjects: plan.maintenanceProjects.filter(keepProject),
    deepProjectId: pinned.has(plan.deepBlock.projectId) ? plan.deepBlock.projectId : '',
    pinnedItemIds: plan.pinnedItemIds ?? [],
  }
}

export interface DailyPlanRefreshInput {
  dailyPlan: DailyPlan | null
  tomorrowPlan: DailyPlan | null
  planHistory: Record<string, DailyPlan>
  allTasks: readonly { id: string; status: string }[]
  today: string // yyyy-MM-dd, in whichever calendar the caller considers authoritative
}

export interface DailyPlanRefreshResult {
  dailyPlan: DailyPlan | null
  tomorrowPlan: DailyPlan | null
  planHistory: Record<string, DailyPlan>
  /** True if dailyPlan, tomorrowPlan, or planHistory actually changed from the input. */
  changed: boolean
}

/** Mirrors the store's `refreshDailyPlan` action, as a pure function of its inputs. */
export function computeDailyPlanRefresh(input: DailyPlanRefreshInput): DailyPlanRefreshResult {
  const { allTasks, today } = input
  let dailyPlan = input.dailyPlan
  let tomorrowPlan = input.tomorrowPlan
  let planHistory = input.planHistory

  // 1. Try to promote tomorrow's plan first.
  if (tomorrowPlan && tomorrowPlan.date === today) {
    let promoted = tomorrowPlan
    if (dailyPlan && dailyPlan.date !== today) {
      const stale = dailyPlan
      const carried = rolloverTasks(stale, allTasks)
      const deepConflict = promoted.deepBlock.projectId !== '' && carried.deepProjectId !== ''
        && promoted.deepBlock.projectId !== carried.deepProjectId
      const mergedPinnedIds = new Set([...(carried.pinnedItemIds ?? []), ...(promoted.pinnedItemIds ?? [])])
      if (deepConflict) mergedPinnedIds.delete(carried.deepProjectId)
      promoted = {
        ...promoted,
        shortTasks: Array.from(new Set([...promoted.shortTasks, ...carried.shortTasks])),
        shortProjects: Array.from(new Set([...promoted.shortProjects, ...carried.shortProjects])),
        maintenanceTasks: Array.from(new Set([...promoted.maintenanceTasks, ...carried.maintenanceTasks])),
        maintenanceProjects: Array.from(new Set([...promoted.maintenanceProjects, ...carried.maintenanceProjects])),
        deepBlock: promoted.deepBlock.projectId
          ? promoted.deepBlock
          : (carried.deepProjectId ? { projectId: carried.deepProjectId } : promoted.deepBlock),
        pinnedItemIds: Array.from(mergedPinnedIds),
        itemOrder: undefined,
        blockOrder: undefined,
      }
      planHistory = { ...planHistory, [stale.date]: stale }
    }
    return {
      dailyPlan: { ...promoted, isComplete: false, completedAt: undefined },
      tomorrowPlan: null,
      planHistory,
      changed: true,
    }
  }

  let changed = false

  // 2. Clear a stale tomorrow plan (nothing to promote or archive — it's just expired).
  if (tomorrowPlan && tomorrowPlan.date < today) {
    tomorrowPlan = null
    changed = true
  }

  // 3. Archive + roll over a stale daily plan.
  if (dailyPlan && dailyPlan.date !== today) {
    const stale = dailyPlan
    const carried = rolloverTasks(stale, allTasks)
    const hasCarry = carried.shortTasks.length > 0
      || carried.maintenanceTasks.length > 0
      || carried.shortProjects.length > 0
      || carried.maintenanceProjects.length > 0
      || carried.deepProjectId !== ''

    dailyPlan = hasCarry ? {
      date: today,
      deepBlock: { projectId: carried.deepProjectId },
      shortTasks: carried.shortTasks,
      shortProjects: carried.shortProjects,
      maintenanceTasks: carried.maintenanceTasks,
      maintenanceProjects: carried.maintenanceProjects,
      meetings: [],
      pinnedItemIds: carried.pinnedItemIds,
      isComplete: false,
    } : null

    planHistory = { ...planHistory, [stale.date]: stale }
    changed = true
  }

  return { dailyPlan, tomorrowPlan, planHistory, changed }
}
