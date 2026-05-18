import { format, addDays } from 'date-fns'
import type { Settings, DailyPlan, PlanItem } from '../types'
import type { VandaagState, StoreGet } from './types'

export const defaultSettings: Settings = {
  inProgressLimit: 5,
  planningTime: 'evening',
  contexts: [],
  inProgressLimitChangeLog: [],
}

export function getTodayString(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

export function getTomorrowString(): string {
  return format(addDays(new Date(), 1), 'yyyy-MM-dd')
}

function ensurePlan(
  existing: DailyPlan | null,
  date: string,
  isToday: boolean,
): DailyPlan {
  if (existing && existing.date === date) {
    return {
      ...existing,
      shortProjects: existing.shortProjects ?? [],
      maintenanceProjects: existing.maintenanceProjects ?? [],
      meetings: existing.meetings ?? [],
      shortMeetingIds: existing.shortMeetingIds ?? [],
      maintenanceMeetingIds: existing.maintenanceMeetingIds ?? [],
      ...(isToday ? { blockOrder: existing.blockOrder ?? ['deep', 'short', 'maintenance'] } : {}),
    }
  }
  return {
    date,
    deepBlock: { projectId: '' },
    shortTasks: [],
    shortProjects: [],
    maintenanceTasks: [],
    maintenanceProjects: [],
    meetings: [],
    shortMeetingIds: [],
    maintenanceMeetingIds: [],
    isComplete: false,
  }
}

export function ensureTodayPlan(state: VandaagState): DailyPlan {
  return ensurePlan(state.dailyPlan, getTodayString(), true)
}

export function ensureTomorrowPlan(state: VandaagState): DailyPlan {
  return ensurePlan(state.tomorrowPlan, getTomorrowString(), false)
}

type PlanSetter = (plan: DailyPlan) => void

export function makePlanActions(
  ensurePlan: (state: VandaagState) => DailyPlan,
  setPlan: PlanSetter,
  get: StoreGet,
) {
  return {
    setDeepBlock: (projectId: string, intention?: string) => {
      setPlan({ ...ensurePlan(get()), deepBlock: { projectId, intention } })
    },
    clearDeepBlock: () => {
      setPlan({ ...ensurePlan(get()), deepBlock: { projectId: '' } })
    },
    completeDeepBlock: (projectTitle: string) => {
      const plan = ensurePlan(get())
      setPlan({
        ...plan,
        deepBlock: {
          ...plan.deepBlock,
          projectId: '',
          completedProjectTitle: projectTitle,
          completedAt: new Date().toISOString(),
        },
      })
    },
    addShortTask: (taskId: string) => {
      const plan = ensurePlan(get())
      if (plan.shortTasks.includes(taskId)) return
      setPlan({ ...plan, shortTasks: [...plan.shortTasks, taskId] })
    },
    removeShortTask: (taskId: string) => {
      const plan = ensurePlan(get())
      setPlan({ ...plan, shortTasks: plan.shortTasks.filter(id => id !== taskId) })
    },
    addMaintenanceTask: (taskId: string) => {
      const plan = ensurePlan(get())
      if (plan.maintenanceTasks.includes(taskId)) return
      setPlan({ ...plan, maintenanceTasks: [...plan.maintenanceTasks, taskId] })
    },
    removeMaintenanceTask: (taskId: string) => {
      const plan = ensurePlan(get())
      setPlan({ ...plan, maintenanceTasks: plan.maintenanceTasks.filter(id => id !== taskId) })
    },
    addShortProject: (projectId: string) => {
      const plan = ensurePlan(get())
      if (plan.shortProjects.includes(projectId)) return
      setPlan({ ...plan, shortProjects: [...plan.shortProjects, projectId] })
    },
    removeShortProject: (projectId: string) => {
      const plan = ensurePlan(get())
      setPlan({ ...plan, shortProjects: plan.shortProjects.filter(id => id !== projectId) })
    },
    addMaintenanceProject: (projectId: string) => {
      const plan = ensurePlan(get())
      if (plan.maintenanceProjects.includes(projectId)) return
      setPlan({ ...plan, maintenanceProjects: [...plan.maintenanceProjects, projectId] })
    },
    removeMaintenanceProject: (projectId: string) => {
      const plan = ensurePlan(get())
      setPlan({ ...plan, maintenanceProjects: plan.maintenanceProjects.filter(id => id !== projectId) })
    },
    addMeeting: (meetingId: string) => {
      const plan = ensurePlan(get())
      if (plan.meetings.includes(meetingId)) return
      setPlan({ ...plan, meetings: [...plan.meetings, meetingId] })
    },
    removeMeeting: (meetingId: string) => {
      const plan = ensurePlan(get())
      setPlan({ ...plan, meetings: plan.meetings.filter(id => id !== meetingId) })
    },
    // Tier-aware meeting assignment
    setDeepMeeting: (meetingId: string | undefined) => {
      setPlan({ ...ensurePlan(get()), deepMeetingId: meetingId })
    },
    addShortMeeting: (meetingId: string) => {
      const plan = ensurePlan(get())
      const ids = plan.shortMeetingIds ?? []
      if (ids.includes(meetingId)) return
      setPlan({ ...plan, shortMeetingIds: [...ids, meetingId] })
    },
    removeShortMeeting: (meetingId: string) => {
      const plan = ensurePlan(get())
      setPlan({ ...plan, shortMeetingIds: (plan.shortMeetingIds ?? []).filter(id => id !== meetingId) })
    },
    addMaintenanceMeeting: (meetingId: string) => {
      const plan = ensurePlan(get())
      const ids = plan.maintenanceMeetingIds ?? []
      if (ids.includes(meetingId)) return
      setPlan({ ...plan, maintenanceMeetingIds: [...ids, meetingId] })
    },
    removeMaintenanceMeeting: (meetingId: string) => {
      const plan = ensurePlan(get())
      setPlan({ ...plan, maintenanceMeetingIds: (plan.maintenanceMeetingIds ?? []).filter(id => id !== meetingId) })
    },
    setBlockOrder: (order: Array<'deep' | 'short' | 'maintenance'>) => {
      setPlan({ ...ensurePlan(get()), blockOrder: order })
    },
    setItemOrder: (items: PlanItem[]) => {
      setPlan({ ...ensurePlan(get()), itemOrder: items })
    },
  }
}
