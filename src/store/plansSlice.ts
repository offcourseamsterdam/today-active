import { v4 as uuid } from 'uuid'
import type { DailyPlan, Task, PlanItem } from '../types'
import type { StoreSet, StoreGet } from './types'
import { ensureTodayPlan, ensureTomorrowPlan, getTodayString, makePlanActions } from './helpers'

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

      // Try to promote tomorrow's plan first
      if (state.tomorrowPlan && state.tomorrowPlan.date === today) {
        set({
          dailyPlan: { ...state.tomorrowPlan, isComplete: false, completedAt: undefined },
          tomorrowPlan: null,
        })
        return
      }

      // Clear stale tomorrow plan
      if (state.tomorrowPlan && state.tomorrowPlan.date < today) {
        set({ tomorrowPlan: null })
      }

      // Clear stale daily plan (from yesterday or older)
      if (state.dailyPlan && state.dailyPlan.date !== today) {
        set({ dailyPlan: null })
      }
    },
  }
}
