import type { StoreApi } from 'zustand'
import type { Project, Task, Meeting, MeetingNotes, AgendaItemNotes, AgendaItem, Settings, Category, ProjectStatus, DailyPlan, RecurrenceRule, CalendarEvent, MeetingSession, PlanItem } from '../types'

export interface ProjectDecision {
  decision: string
  responsible: string | null
  date: string
  meetingTitle: string
}

export interface ProjectDecisionsData {
  decisions: ProjectDecision[]
  themes: string[]
  generatedAt: string
  notesHash: string
}

export interface RecentMeetingSummaryData {
  summary: string
  commitments: Array<{ description: string; owner: string | null; fromMeeting: string }>
  generatedAt: string
  notesHash: string
}

export type ActiveView = 'vandaag' | 'kanban' | 'planning' | 'philosophy' | 'meetings' | 'review'

export interface VandaagState {
  // Data
  projects: Project[]
  orphanTasks: Task[]
  recurringTasks: Task[]
  meetings: Meeting[]
  recurringMeetings: Meeting[]
  settings: Settings
  dailyPlan: DailyPlan | null
  tomorrowPlan: DailyPlan | null
  personalRules: string[]

  // UI state
  openProjectId: string | null  // project modal open from any view
  toastProjectId: string | null  // project ID for update-reminder toast
  swapModalProjectId: string | null
  swapModalTargetStatus: 'in_progress' | 'waiting' | null  // destination for the incoming project
  waitingPromptProjectId: string | null  // triggers "Op wie wacht je?" modal
  openMeetingId: string | null  // null = closed, 'new' = create mode, uuid = edit mode
  justEndedMeetingId: string | null  // auto-expands this meeting in History after ending
  projectModalDefaultTab: string | null  // e.g. 'meetings' — consumed once by ProjectModal
  activeView: ActiveView
  greetedDate: string | null  // YYYY-MM-DD — last date the morning screen was dismissed
  artworkLoadingIds: string[]  // project IDs with in-flight artwork fetch (not persisted)

  // Meeting session state
  meetingSession: MeetingSession | null
  processingMeetingId: string | null
  processingPhase: 'transcribing' | 'summarizing' | null
  processingError: string | null
  processingItemPhases: Record<string, 'transcribing' | 'summarizing'>
  processingItemErrors: Record<string, string>
  isLiveMeetingOpen: boolean

  // Plan item completion
  togglePlanItemCompletion: (itemId: string) => void

  // Calendar state (non-persisted)
  calendarEvents: CalendarEvent[]
  calendarLoading: boolean
  calendarError: string | null

  // Done reflection (non-persisted)
  doneReflection: { text: string; headline: string; generatedAt: string } | null
  doneReflectionLoading: boolean

  // Project decisions cache (non-persisted)
  projectDecisionsCache: Record<string, ProjectDecisionsData>
  recentMeetingSummaryCache: Record<string, RecentMeetingSummaryData>

  // Navigation
  setOpenProjectId: (id: string | null) => void
  showToast: (projectId: string) => void
  dismissToast: () => void
  setActiveView: (view: ActiveView) => void
  setGreetedDate: (date: string) => void
  markArtworkLoading: (id: string) => void
  unmarkArtworkLoading: (id: string) => void

  // Project actions
  addProject: (title: string, category: Category) => string
  updateProject: (id: string, updates: Partial<Omit<Project, 'id'>>) => void
  deleteProject: (id: string) => void
  moveProject: (id: string, newStatus: ProjectStatus) => boolean
  reorderProjects: (activeId: string, overId: string) => void
  reorderProjectAfter: (activeId: string, afterId: string) => void
  reorderProjectToEnd: (activeId: string) => void
  reorderProjectToStart: (activeId: string) => void
  setSwapModalProjectId: (id: string | null) => void
  setWaitingPromptProjectId: (id: string | null) => void
  setProjectBacklogSection: (id: string, section: 'soon' | 'not_yet' | 'someday') => void
  clearProjectModalDefaultTab: () => void

  // Task actions
  addTask: (title: string, projectId?: string) => string
  updateTask: (taskId: string, projectId: string | undefined, updates: Partial<Omit<Task, 'id'>>) => void
  reorderProjectTasks: (projectId: string, taskIds: string[]) => void
  deleteTask: (taskId: string, projectId?: string) => void
  addSubtask: (projectId: string, taskId: string, title: string) => string
  toggleSubtask: (projectId: string, taskId: string, subtaskId: string) => void
  deleteSubtask: (projectId: string, taskId: string, subtaskId: string) => void
  addOrphanTask: (title: string) => string
  updateOrphanTask: (taskId: string, updates: Partial<Omit<Task, 'id'>>) => void
  deleteOrphanTask: (taskId: string) => void
  restoreOrphanTask: (task: Task) => void
  moveOrphanTaskToProject: (taskId: string, projectId: string) => void

  // Meeting actions
  addMeeting: (meeting: Omit<Meeting, 'id' | 'createdAt'>) => string
  updateMeeting: (id: string, updates: Partial<Omit<Meeting, 'id'>>) => void
  deleteMeeting: (id: string) => void
  addRecurringMeeting: (meeting: Omit<Meeting, 'id' | 'createdAt'>) => string
  updateRecurringMeeting: (id: string, updates: Partial<Omit<Meeting, 'id'>>) => void
  deleteRecurringMeeting: (id: string) => void
  getTodayRecurringMeetings: () => Meeting[]
  setOpenMeetingId: (id: string | null) => void
  spawnRecurringOccurrence: (templateId: string, date?: string) => string

  // Meeting session actions
  startMeetingSession: (meetingId: string) => void
  endMeetingSession: () => void
  endAndRedirectMeeting: (meetingId: string) => void
  clearJustEndedMeeting: () => void
  pauseMeetingSession: () => void
  resumeMeetingSession: () => void
  advanceMeetingItem: () => void
  tickMeetingSession: () => void
  setLiveMeetingOpen: (open: boolean) => void
  reorderLiveMeetingItems: (newItems: AgendaItem[]) => void

  // Recording processing
  setProcessingMeetingId: (id: string | null) => void
  setProcessingPhase: (phase: 'transcribing' | 'summarizing' | null) => void
  setProcessingError: (error: string | null) => void
  setProcessingItemPhase: (itemId: string, phase: 'transcribing' | 'summarizing' | null) => void
  setProcessingItemError: (itemId: string, error: string | null) => void
  saveMeetingNotes: (meetingId: string, notes: MeetingNotes) => void
  saveAgendaItemNotes: (meetingId: string, itemNotes: AgendaItemNotes) => void
  addProcessingItemId: (itemId: string) => void
  removeProcessingItemId: (itemId: string) => void

  // Done reflection
  setDoneReflection: (reflection: { text: string; headline: string; generatedAt: string }) => void
  setDoneReflectionLoading: (loading: boolean) => void
  clearDoneReflection: () => void

  // Project decisions cache
  setProjectDecisions: (projectId: string, data: ProjectDecisionsData) => void
  clearProjectDecisions: (projectId: string) => void

  // Recent meeting summary + agenda suggestions cache
  setRecentMeetingSummary: (projectId: string, data: RecentMeetingSummaryData) => void

  // Recurring tasks
  addRecurringTask: (title: string, rule: RecurrenceRule, projectId?: string) => string
  updateRecurringTask: (taskId: string, updates: Partial<Omit<Task, 'id'>>) => void
  deleteRecurringTask: (taskId: string) => void
  getTodayRecurringTasks: () => Task[]
  getTomorrowRecurringTasks: () => Task[]

  // Checkbox-task sync
  syncCheckboxTasks: (projectId: string, checkboxTexts: string[]) => void

  // Progress tracking
  recordDayWorked: (projectId: string) => void

  // Daily plan actions
  setDailyPlan: (plan: DailyPlan) => void
  setDeepBlock: (projectId: string, intention?: string) => void
  clearDeepBlock: () => void
  completeDeepBlock: (projectTitle: string) => void
  addShortTask: (taskId: string) => void
  removeShortTask: (taskId: string) => void
  addMaintenanceTask: (taskId: string) => void
  removeMaintenanceTask: (taskId: string) => void
  addShortProject: (projectId: string) => void
  removeShortProject: (projectId: string) => void
  addMaintenanceProject: (projectId: string) => void
  removeMaintenanceProject: (projectId: string) => void
  addMeetingToPlan: (meetingId: string) => void
  removeMeetingFromPlan: (meetingId: string) => void
  setDeepMeeting: (meetingId: string | undefined) => void
  addShortMeeting: (meetingId: string) => void
  removeShortMeeting: (meetingId: string) => void
  addMaintenanceMeeting: (meetingId: string) => void
  removeMaintenanceMeeting: (meetingId: string) => void
  setTomorrowDeepMeeting: (meetingId: string | undefined) => void
  addTomorrowShortMeeting: (meetingId: string) => void
  removeTomorrowShortMeeting: (meetingId: string) => void
  addTomorrowMaintenanceMeeting: (meetingId: string) => void
  removeTomorrowMaintenanceMeeting: (meetingId: string) => void
  addQuickMaintenanceTask: (title: string) => string
  setBlockOrder: (order: Array<'deep' | 'short' | 'maintenance'>) => void
  setItemOrder: (items: PlanItem[]) => void
  completeDailyPlan: () => void
  getTodayPlan: () => DailyPlan | null
  isDayComplete: () => boolean

  // Planning mode (tomorrow)
  setTomorrowDeepBlock: (projectId: string, intention?: string) => void
  clearTomorrowDeepBlock: () => void
  addTomorrowShortTask: (taskId: string) => void
  removeTomorrowShortTask: (taskId: string) => void
  addTomorrowMaintenanceTask: (taskId: string) => void
  removeTomorrowMaintenanceTask: (taskId: string) => void
  addTomorrowShortProject: (projectId: string) => void
  removeTomorrowShortProject: (projectId: string) => void
  addTomorrowMaintenanceProject: (projectId: string) => void
  removeTomorrowMaintenanceProject: (projectId: string) => void
  addTomorrowMeeting: (meetingId: string) => void
  removeTomorrowMeeting: (meetingId: string) => void
  setTomorrowBlockOrder: (order: Array<'deep' | 'short' | 'maintenance'>) => void
  setTomorrowItemOrder: (items: PlanItem[]) => void
  lockInTomorrow: () => void
  lockInPlan: (target: 'today' | 'tomorrow', payload: {
    deepProjectId: string; intention?: string; deepMeetingId?: string
    shortTasks: string[]; shortProjects: string[]; shortMeetingIds: string[]
    maintenanceTasks: string[]; maintenanceProjects: string[]; maintenanceMeetingIds: string[]
    blockOrder: Array<'deep' | 'short' | 'maintenance'>; itemOrder: PlanItem[]
  }) => void
  clearTomorrowPlan: () => void
  loadTomorrowPlanIfReady: () => boolean
  refreshDailyPlan: () => void

  // Calendar actions
  fetchCalendarEvents: (accessToken: string, date: string) => Promise<void>
  setCalendarEvents: (events: CalendarEvent[]) => void
  clearCalendarEvents: () => void

  // Personal rules
  addPersonalRule: (rule: string) => void
  updatePersonalRule: (index: number, rule: string) => void
  deletePersonalRule: (index: number) => void

  // Settings actions
  updateSettings: (updates: Partial<Settings>) => void
  updateSettingsWithLimitTracking: (limit: number) => void

  // Selectors
  getProjectsByStatus: (status: ProjectStatus) => Project[]
  getInProgressCount: () => number
  getWipCount: () => number  // in_progress + waiting combined
  getMissionCriticalStats: () => { missionCriticalDays: number; uncomfortableDone: number }
}

export type StoreSet = StoreApi<VandaagState>['setState']
export type StoreGet = StoreApi<VandaagState>['getState']
