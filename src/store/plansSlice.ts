import { v4 as uuid } from 'uuid'
import type { DailyPlan, Task, PlanItem } from '../types'
import type { StoreSet, StoreGet } from './types'
import { ensureTodayPlan, ensureTomorrowPlan, getTodayString, makePlanActions } from './helpers'
import { deriveItemOrder, deriveBlockOrder } from '../lib/planOrder'

function rolloverTasks(
  plan: DailyPlan,
  allTasks: readonly { id: string; status: string }[],
): { shortTasks: string[]; maintenanceTasks: string[]; shortProjects: string[]; maintenanceProjects: string[]; deepProjectId: string; pinnedItemIds: string[] } {
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

export function makeDailyPlanActions(set: StoreSet, get: StoreGet) {
  const todayActions = makePlanActions(
    ensureTodayPlan,
    (plan: DailyPlan) => set({ dailyPlan: plan }),
    get,
  )
  const tomorrowActions = makePlanActions(
    ensureTomorrowPlan,
    (plan: DailyPlan) => set({ tomorrowPlan: plan }),
    get,
  )

  return {
    // Today plan
    setDailyPlan: (plan: DailyPlan) => set({ dailyPlan: plan }),
    setDeepBlock: todayActions.setDeepBlock,
    clearDeepBlock: todayActions.clearDeepBlock,
    completeDeepBlock: todayActions.completeDeepBlock,
    setBlockOrder: todayActions.setBlockOrder,
    setItemOrder: todayActions.setItemOrder,
    addShortTask: todayActions.addShortTask,
    removeShortTask: todayActions.removeShortTask,
    addMaintenanceTask: todayActions.addMaintenanceTask,
    removeMaintenanceTask: todayActions.removeMaintenanceTask,
    addShortProject: todayActions.addShortProject,
    removeShortProject: todayActions.removeShortProject,
    addMaintenanceProject: todayActions.addMaintenanceProject,
    removeMaintenanceProject: todayActions.removeMaintenanceProject,
    addMeetingToPlan: todayActions.addMeeting,
    removeMeetingFromPlan: todayActions.removeMeeting,
    setDeepMeeting: todayActions.setDeepMeeting,
    addShortMeeting: todayActions.addShortMeeting,
    removeShortMeeting: todayActions.removeShortMeeting,
    addMaintenanceMeeting: todayActions.addMaintenanceMeeting,
    removeMaintenanceMeeting: todayActions.removeMaintenanceMeeting,

    addQuickMaintenanceTask: (title: string): string => {
      const id = uuid()
      const task: Task = {
        id,
        title,
        status: 'vandaag',
        isRecurring: false,
        isUncomfortable: false,
        createdAt: new Date().toISOString(),
      }
      const state = get()
      const plan = ensureTodayPlan(state)
      set({
        orphanTasks: [...state.orphanTasks, task],
        dailyPlan: { ...plan, maintenanceTasks: [...plan.maintenanceTasks, id] },
      })
      return id
    },

    // Meetings aren't handled by this action — use setDeepMeeting/addShortMeeting/
    // addMaintenanceMeeting (and their remove* counterparts) for those instead.
    addToTodayPlan: (id: string, type: 'project' | 'task', tier: 'deep' | 'short' | 'maintenance') => {
      if (tier === 'deep' && type !== 'project') return

      const state = get()
      const plan = ensureTodayPlan(state)
      const order = plan.itemOrder ?? deriveItemOrder(plan)
      if (order.some(i => i.id === id)) return

      let updated: DailyPlan = plan
      let newOrder: PlanItem[]
      if (tier === 'deep' && type === 'project') {
        updated = { ...updated, deepBlock: { projectId: id } }
        const hasExistingDeepProject = order.some(i => i.tier === 'deep' && i.type === 'project')
        newOrder = hasExistingDeepProject
          ? order.map(i => (i.tier === 'deep' && i.type === 'project') ? { id, type, tier } : i)
          : [...order, { id, type, tier }]
      } else if (tier === 'short') {
        updated = type === 'project'
          ? { ...updated, shortProjects: [...updated.shortProjects, id] }
          : { ...updated, shortTasks: [...updated.shortTasks, id] }
        newOrder = [...order, { id, type, tier }]
      } else {
        updated = type === 'project'
          ? { ...updated, maintenanceProjects: [...updated.maintenanceProjects, id] }
          : { ...updated, maintenanceTasks: [...updated.maintenanceTasks, id] }
        newOrder = [...order, { id, type, tier }]
      }

      set({
        dailyPlan: { ...updated, itemOrder: newOrder, blockOrder: deriveBlockOrder(newOrder) },
      })
    },

    removeFromTodayPlan: (id: string) => {
      const state = get()
      const plan = state.dailyPlan
      if (!plan) return
      const order = (plan.itemOrder ?? deriveItemOrder(plan)).filter(i => i.id !== id)
      set({
        dailyPlan: {
          ...plan,
          deepBlock: plan.deepBlock.projectId === id ? { projectId: '' } : plan.deepBlock,
          shortTasks: plan.shortTasks.filter(t => t !== id),
          shortProjects: plan.shortProjects.filter(p => p !== id),
          maintenanceTasks: plan.maintenanceTasks.filter(t => t !== id),
          maintenanceProjects: plan.maintenanceProjects.filter(p => p !== id),
          completedItemIds: (plan.completedItemIds ?? []).filter(cid => cid !== id),
          pinnedItemIds: (plan.pinnedItemIds ?? []).filter(pid => pid !== id),
          itemOrder: order,
          blockOrder: deriveBlockOrder(order),
        },
      })
    },

    reorderTodayItems: (newOrder: PlanItem[]) => {
      const plan = get().dailyPlan
      if (!plan) return
      set({ dailyPlan: { ...plan, itemOrder: newOrder, blockOrder: deriveBlockOrder(newOrder) } })
    },

    completeDailyPlan: () => {
      const state = get()
      if (!state.dailyPlan) return
      set({
        dailyPlan: {
          ...state.dailyPlan,
          isComplete: true,
          completedAt: new Date().toISOString(),
        },
      })
    },

    getTodayPlan: (): DailyPlan | null => {
      const state = get()
      const today = getTodayString()
      if (state.dailyPlan && state.dailyPlan.date === today) {
        return state.dailyPlan
      }
      return null
    },

    isDayComplete: (): boolean => {
      const state = get()
      const plan = state.dailyPlan
      if (!plan || plan.date !== getTodayString()) return false
      return plan.isComplete
    },

    // Tomorrow plan
    setTomorrowDeepBlock: tomorrowActions.setDeepBlock,
    clearTomorrowDeepBlock: tomorrowActions.clearDeepBlock,
    addTomorrowShortTask: tomorrowActions.addShortTask,
    removeTomorrowShortTask: tomorrowActions.removeShortTask,
    addTomorrowMaintenanceTask: tomorrowActions.addMaintenanceTask,
    removeTomorrowMaintenanceTask: tomorrowActions.removeMaintenanceTask,
    addTomorrowShortProject: tomorrowActions.addShortProject,
    removeTomorrowShortProject: tomorrowActions.removeShortProject,
    addTomorrowMaintenanceProject: tomorrowActions.addMaintenanceProject,
    removeTomorrowMaintenanceProject: tomorrowActions.removeMaintenanceProject,
    addTomorrowMeeting: tomorrowActions.addMeeting,
    removeTomorrowMeeting: tomorrowActions.removeMeeting,
    setTomorrowDeepMeeting: tomorrowActions.setDeepMeeting,
    addTomorrowShortMeeting: tomorrowActions.addShortMeeting,
    removeTomorrowShortMeeting: tomorrowActions.removeShortMeeting,
    addTomorrowMaintenanceMeeting: tomorrowActions.addMaintenanceMeeting,
    removeTomorrowMaintenanceMeeting: tomorrowActions.removeMaintenanceMeeting,
    setTomorrowBlockOrder: tomorrowActions.setBlockOrder,
    setTomorrowItemOrder: tomorrowActions.setItemOrder,

    lockInTomorrow: () => {
      const state = get()
      const plan = ensureTomorrowPlan(state)
      set({ tomorrowPlan: { ...plan, isComplete: true, completedAt: new Date().toISOString() } })
    },

    lockInPlan: (target: 'today' | 'tomorrow', payload: {
      deepProjectId: string
      intention?: string
      deepMeetingId?: string
      shortTasks: string[]
      shortProjects: string[]
      shortMeetingIds: string[]
      maintenanceTasks: string[]
      maintenanceProjects: string[]
      maintenanceMeetingIds: string[]
      blockOrder: Array<'deep' | 'short' | 'maintenance'>
      itemOrder: PlanItem[]
    }) => {
      const state = get()
      const plan = target === 'today' ? ensureTodayPlan(state) : ensureTomorrowPlan(state)
      const newPlan: DailyPlan = {
        ...plan,
        deepBlock: { projectId: payload.deepProjectId, intention: payload.intention },
        deepMeetingId: payload.deepMeetingId,
        shortTasks: payload.shortTasks,
        shortProjects: payload.shortProjects,
        shortMeetingIds: payload.shortMeetingIds,
        maintenanceTasks: payload.maintenanceTasks,
        maintenanceProjects: payload.maintenanceProjects,
        maintenanceMeetingIds: payload.maintenanceMeetingIds,
        blockOrder: payload.blockOrder,
        itemOrder: payload.itemOrder,
      }
      if (target === 'today') {
        set({ dailyPlan: newPlan })
      } else {
        set({ tomorrowPlan: { ...newPlan, isComplete: true, completedAt: new Date().toISOString() } })
      }
    },

    clearTomorrowPlan: () => {
      set({ tomorrowPlan: null })
    },

    togglePlanItemCompletion: (itemId: string) => {
      const plan = get().dailyPlan
      if (!plan) return
      const completed = plan.completedItemIds ?? []
      const isCompleted = completed.includes(itemId)
      set({
        dailyPlan: {
          ...plan,
          completedItemIds: isCompleted
            ? completed.filter(id => id !== itemId)
            : [...completed, itemId],
        },
      })
    },

    togglePlanItemPinned: (itemId: string) => {
      const plan = get().dailyPlan
      if (!plan) return
      const pinned = plan.pinnedItemIds ?? []
      const isPinned = pinned.includes(itemId)
      set({
        dailyPlan: {
          ...plan,
          pinnedItemIds: isPinned
            ? pinned.filter(id => id !== itemId)
            : [...pinned, itemId],
        },
      })
    },

    loadTomorrowPlanIfReady: (): boolean => {
      const state = get()
      const today = getTodayString()
      if (state.tomorrowPlan && state.tomorrowPlan.date === today) {
        set({
          dailyPlan: { ...state.tomorrowPlan, isComplete: false, completedAt: undefined },
          tomorrowPlan: null,
        })
        return true
      }
      if (state.tomorrowPlan && state.tomorrowPlan.date < today) {
        set({ tomorrowPlan: null })
      }
      return false
    },

    refreshDailyPlan: () => {
      const state = get()
      const today = getTodayString()
      const allTasks = [...(state.orphanTasks ?? []), ...(state.recurringTasks ?? [])]

      // 1. Try to promote tomorrow's plan first
      if (state.tomorrowPlan && state.tomorrowPlan.date === today) {
        if (state.dailyPlan && state.dailyPlan.date !== today) {
          set({ planHistory: { ...state.planHistory, [state.dailyPlan.date]: state.dailyPlan } })
        }
        set({
          dailyPlan: { ...state.tomorrowPlan, isComplete: false, completedAt: undefined },
          tomorrowPlan: null,
        })
        return
      }

      // 2. Clear stale tomorrow plan
      if (state.tomorrowPlan && state.tomorrowPlan.date < today) {
        set({ tomorrowPlan: null })
      }

      // 3. Archive + rollover stale daily plan
      if (state.dailyPlan && state.dailyPlan.date !== today) {
        const stale = state.dailyPlan
        const carried = rolloverTasks(stale, allTasks)
        const hasCarry = carried.shortTasks.length > 0
          || carried.maintenanceTasks.length > 0
          || carried.shortProjects.length > 0
          || carried.maintenanceProjects.length > 0
          || carried.deepProjectId !== ''

        const todayPlan: DailyPlan | null = hasCarry ? {
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

        set({
          planHistory: { ...state.planHistory, [stale.date]: stale },
          dailyPlan: todayPlan,
        })
      }
    },
  }
}
