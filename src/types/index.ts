export type Category = 'marketing' | 'ops' | 'admin' | 'finance' | 'product' | 'personal'

export type ProjectStatus = 'backlog' | 'in_progress' | 'waiting' | 'done'

export type TaskStatus = 'backlog' | 'vandaag' | 'done' | 'dropped'

export type RecurrenceFrequency = 'daily' | 'weekdays' | 'weekly' | 'monthly_date' | 'monthly_weekday' | 'custom' | 'annual_dates'

export interface RecurrenceRule {
  frequency: RecurrenceFrequency
  customDays?: number[]          // 0=Sun..6=Sat — for 'custom' multi-day and 'weekly' single-day
  monthlyDate?: number           // 1–31 — for 'monthly_date' (e.g. 1st of month)
  monthlyWeekday?: {             // for 'monthly_weekday' (e.g. 2nd Monday)
    week: number                 // 1–5
    day: number                  // 0=Sun..6=Sat
  }
  annualDates?: { month: number; day: number }[]  // for 'annual_dates' (e.g. Apr 1, Oct 1)
}

export interface WaitingOn {
  person: string
  since: string // ISO date
  snoozedUntil?: string // ISO date — hide from follow-up panel until this date
}

export interface Project {
  id: string
  title: string
  category: Category
  status: ProjectStatus
  backlogSection?: 'soon' | 'not_yet' | 'someday'  // only relevant when status === 'backlog'
  contextIds?: string[]
  coverImageUrl?: string
  coverImageTitle?: string
  coverImagePosition?: { x: number; y: number } // percentage 0–100, default 50 50
  bodyContent: string // Rich text (BlockNote JSON)
  tasks: Task[]
  trackProgress: boolean
  missionCritical?: boolean
  daysWorked: number
  daysWorkedLog: string[] // Array of date strings (YYYY-MM-DD)
  waitingOn?: WaitingOn[]
  shareId?: string // stable share ID for public URL
  createdAt: string
  updatedAt: string
}

export interface SharedProjectSnapshot {
  project: Project
  meetings: Meeting[]
  sharedAt: string
  sharedBy?: string // user display name or email
}

export interface Subtask {
  id: string
  title: string
  done: boolean
}

export interface Task {
  id: string
  projectId?: string
  title: string
  status: TaskStatus
  isRecurring: boolean
  recurrenceRule?: RecurrenceRule
  taskType?: TaskType
  isUncomfortable: boolean
  fromEditor?: boolean  // true = created/managed by notes editor checkboxes
  bodyContent?: string  // BlockNote JSON — rich text notes for standalone tasks
  kanbanColumn?: ProjectStatus  // which kanban column this orphan task appears in
  waitingOn?: WaitingOn[]       // waiting-on entries (same as Project)
  nextAction?: string           // the immediate next physical action to move this forward
  actionableChannel?: string    // AI-suggested channel: 'Slack' | 'Gmail' | 'Boat Local admin' | 'phone' | ...
  actionableDraft?: string      // AI-suggested concept-message ready to copy-paste
  subtasks?: Subtask[]
  createdAt: string
  completedAt?: string
  lastCompletedDate?: string  // YYYY-MM-DD — last date this recurring task was checked off
}

// AI "Make Actionable" feedback log entry
export interface AIFeedbackEntry {
  id: string
  taskId: string
  projectId?: string
  original: string             // original task title
  suggested: string            // AI's suggested rewrite (concrete title or first subtask)
  channel?: string             // AI's suggested channel
  outcome: 'accepted' | 'edited' | 'rejected'
  userVersion?: string         // if edited: the final user-kept text
  createdAt: string            // ISO
}

export interface AgendaItem {
  id: string
  title: string
  description?: string  // optional context: what will be discussed
  durationMinutes?: number
  recurring?: boolean  // appears in every instance of a recurring meeting
  owner?: string       // responsible person / name
}

export interface MeetingActionItem {
  description: string
  assignee?: string
  dueDate?: string
}

export type MeetingOutcome = 'productive' | 'inconclusive' | 'needs-followup'

export interface AgendaItemNotes {
  agendaItemId: string
  agendaItemTitle: string
  summary: string
  decisions: string[]
  actionItems: MeetingActionItem[]
  openQuestions: string[]
  generatedAt: string
}

export interface MeetingNotes {
  transcript: string
  summary: string
  actionItems: MeetingActionItem[]
  decisions: string[]
  openQuestions: string[]
  outcome: MeetingOutcome
  generatedAt: string
  agendaItemNotes?: AgendaItemNotes[]
}

export interface Meeting {
  id: string
  title: string
  date?: string              // YYYY-MM-DD — if set, only appears on that day
  time: string               // "HH:mm" 24h format
  durationMinutes: number    // 15, 30, 45, 60, 90, etc.
  location?: string          // physical address or video link
  agendaItems?: AgendaItem[] // structured agenda items
  context?: string           // free-form context for AI notes (who's attending, background, etc.)
  projectId?: string         // linked project — its tasks/notes feed into AI note generation
  language?: 'auto' | 'nl' | 'en'
  meetingNotes?: MeetingNotes
  isRecurring: boolean
  recurrenceRule?: RecurrenceRule
  lastCompletedDate?: string // for recurring meetings (YYYY-MM-DD)
  recurringMeetingId?: string // if set, this is a concrete occurrence of a recurring template
  createdAt: string
}

export interface MeetingSession {
  meetingId: string
  currentItemIndex: number
  completedItemIds: string[]
  secondsLeft: number | null   // null = this item has no duration
  isRunning: boolean
  hasStarted: boolean
  startedAt: string
  lastTickAt: string
  isRecording: boolean
  recordingError?: string
  processingItemIds: string[]  // agenda item IDs currently being summarized
}

export interface DailyPlan {
  date: string // YYYY-MM-DD
  deepBlock: {
    projectId: string
    intention?: string
    calendarEventId?: string
    completedProjectTitle?: string  // set when user clicks Done
    completedAt?: string            // ISO timestamp of completion
  }
  shortTasks: string[] // Task IDs (up to ~3)
  shortProjects: string[] // Project IDs added to short tasks tier
  maintenanceTasks: string[] // Task IDs (from recurring + manual)
  maintenanceProjects: string[] // Project IDs added to maintenance tier
  meetings: string[] // Meeting IDs (legacy, kept for backward compat)
  deepMeetingId?: string           // meeting assigned to the deep block
  shortMeetingIds?: string[]       // meetings assigned to short three
  maintenanceMeetingIds?: string[] // meetings assigned to maintenance
  calendarEvents?: AssignedCalendarEvent[]
  blockOrder?: Array<'deep' | 'short' | 'maintenance'>
  itemOrder?: PlanItem[]
  completedItemIds?: string[]  // plan item IDs marked "done for the day" (visual only)
  isComplete: boolean
  completedAt?: string
}

// Calendar integration
export interface CalendarEvent {
  id: string
  title: string
  start: string        // ISO datetime
  end: string          // ISO datetime
  durationMinutes: number
  isAllDay: boolean
}

export type Tier = 'deep' | 'short' | 'maintenance'
export type TaskType = Tier | 'reminder'
export type TierAssignment = Tier | 'unassigned'

export interface AssignedCalendarEvent {
  event: CalendarEvent
  tier: TierAssignment
  suggestedTier: TierAssignment
}

// Free-order plan items
export interface PlanItem {
  id: string
  type: 'project' | 'task' | 'meeting'
  tier: 'deep' | 'short' | 'maintenance'
}

export interface LifeWeeks {
  birthDate: string
  weeksLived: number
  weeksRemaining: number
  currentWeekNumber: number
}

export interface WorkContext {
  id: string
  name: string
}

export interface Settings {
  inProgressLimit: number
  birthDate?: string
  planningTime: 'evening' | 'morning'
  contexts: WorkContext[]
  inProgressLimitChangeLog: string[] // ISO dates of each limit change (for friction UI)
  userTools?: string[]               // channels the AI can suggest: Slack / Gmail / Boat Local admin / phone / ...
}

/** Default list of channels used by the "Make Actionable" AI when settings.userTools is empty. */
export const DEFAULT_USER_TOOLS: string[] = ['Slack', 'Gmail', 'Boat Local admin', 'phone']

// Kanban column definitions (done projects live in DoneListColumn, not a drag column)
// Note: in_progress and waiting share a combined WIP limit from settings.inProgressLimit
export const KANBAN_COLUMNS = [
  { id: 'backlog' as ProjectStatus, title: 'Backlog', limit: null },
  { id: 'in_progress' as ProjectStatus, title: 'In Progress', limit: null },
  { id: 'waiting' as ProjectStatus, title: 'Waiting For', limit: null },
] as const

// Category display config
export const CATEGORY_CONFIG: Record<Category, { label: string; color: string; bg: string }> = {
  marketing: { label: 'Marketing', color: 'var(--color-cat-marketing)', bg: 'var(--color-cat-marketing-bg)' },
  ops: { label: 'Ops', color: 'var(--color-cat-ops)', bg: 'var(--color-cat-ops-bg)' },
  admin: { label: 'Admin', color: 'var(--color-cat-admin)', bg: 'var(--color-cat-admin-bg)' },
  finance: { label: 'Finance', color: 'var(--color-cat-finance)', bg: 'var(--color-cat-finance-bg)' },
  product: { label: 'Product', color: 'var(--color-cat-product)', bg: 'var(--color-cat-product-bg)' },
  personal: { label: 'Personal', color: 'var(--color-cat-personal)', bg: 'var(--color-cat-personal-bg)' },
}
