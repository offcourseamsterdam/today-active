/**
 * Pure, framework-free transforms for the agent API / MCP endpoint.
 * No Firestore, no HTTP — takes a plain data snapshot and params, returns
 * either a read result or a `{ patch, result }` write (patch = only the
 * top-level SyncData fields that changed, for a minimal Firestore update()).
 */
import { v4 as uuid } from 'uuid'
import type {
  Project,
  Task,
  DailyPlan,
  Category,
  ProjectStatus,
  TaskStatus,
  TaskType,
  Goal,
  Meeting,
  Settings,
  WriteAwayEntry,
} from '../../src/types/index.js'
import { computeDailyPlanRefresh } from '../../src/lib/dailyPlanRollover.js'

// Mirrors src/lib/firestore.ts SyncData. Duplicated (not imported) so this
// module stays decoupled from the client Firebase SDK that firestore.ts pulls in.
export interface SyncData {
  projects: Project[]
  orphanTasks: Task[]
  recurringTasks: Task[]
  meetings: Meeting[]
  recurringMeetings: Meeting[]
  settings: Settings
  dailyPlan: DailyPlan | null
  tomorrowPlan: DailyPlan | null
  planHistory: Record<string, DailyPlan>
  weekSlots: Record<string, string[]>
  goals: Goal[]
  personalRules: string[]
  writeAway: WriteAwayEntry[]
  syncedAt: string
}

const DEFAULT_SETTINGS: Settings = {
  inProgressLimit: 5,
  planningTime: 'evening',
  contexts: [],
  inProgressLimitChangeLog: [],
}

export function normalizeSyncData(raw: Partial<SyncData> | undefined | null): SyncData {
  return {
    projects: raw?.projects ?? [],
    orphanTasks: raw?.orphanTasks ?? [],
    recurringTasks: raw?.recurringTasks ?? [],
    meetings: raw?.meetings ?? [],
    recurringMeetings: raw?.recurringMeetings ?? [],
    settings: raw?.settings ?? DEFAULT_SETTINGS,
    dailyPlan: raw?.dailyPlan ?? null,
    tomorrowPlan: raw?.tomorrowPlan ?? null,
    planHistory: raw?.planHistory ?? {},
    weekSlots: raw?.weekSlots ?? {},
    goals: raw?.goals ?? [],
    personalRules: raw?.personalRules ?? [],
    writeAway: raw?.writeAway ?? [],
    syncedAt: raw?.syncedAt ?? '',
  }
}

/** Strips `undefined` values (Firestore rejects them) — safe since these are plain-data snapshots. */
export function stripUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export class AgentOpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function badRequest(message: string): never {
  throw new AgentOpError(400, message)
}

function notFound(message: string): never {
  throw new AgentOpError(404, message)
}

/** yyyy-MM-dd for "today + offsetDays", in the Europe/Amsterdam calendar day — not the server's local TZ. */
export function amsterdamDateString(offsetDays = 0): string {
  const instant = new Date(Date.now() + offsetDays * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam' }).format(instant)
}

const PROJECT_STATUSES: ProjectStatus[] = ['backlog', 'in_progress', 'waiting', 'done']
const TASK_TYPES: TaskType[] = ['deep', 'short', 'maintenance', 'reminder']
// Mirrors the keys of src/types/index.ts's CATEGORY_CONFIG — copied (not imported) to avoid
// a runtime import just for this. (This module does have one runtime src/ import —
// computeDailyPlanRefresh from src/lib/dailyPlanRollover.js — which is safe to bundle into
// the Vercel function only because that module stays dependency-free apart from `import type`.)
const CATEGORIES: Category[] = ['marketing', 'ops', 'admin', 'finance', 'product', 'personal']

// ── param extraction helpers (params arrive as untyped JSON) ──────────────

type Params = Record<string, unknown>

function str(params: Params, key: string, opts: { required?: boolean } = {}): string | undefined {
  const v = params[key]
  if (v === undefined || v === null) {
    if (opts.required) badRequest(`${key} is required`)
    return undefined
  }
  if (typeof v !== 'string') badRequest(`${key} must be a string`)
  return v
}

function strOrNull(params: Params, key: string): string | null | undefined {
  const v = params[key]
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== 'string') badRequest(`${key} must be a string or null`)
  return v
}

function bool(params: Params, key: string): boolean | undefined {
  const v = params[key]
  if (v === undefined) return undefined
  if (typeof v !== 'boolean') badRequest(`${key} must be a boolean`)
  return v
}

function oneOf<T extends string>(params: Params, key: string, allowed: readonly T[]): T | undefined {
  const v = str(params, key)
  if (v === undefined) return undefined
  if (!allowed.includes(v as T)) badRequest(`${key} must be one of: ${allowed.join(', ')}`)
  return v as T
}

function title(params: Params, key = 'title'): string {
  const raw = str(params, key, { required: true })!
  const trimmed = raw.trim()
  if (!trimmed) badRequest(`${key} is required`)
  if (trimmed.length > 500) badRequest(`${key} must be at most 500 characters`)
  return trimmed
}

function nowIso(): string {
  return new Date().toISOString()
}

// ── lookups ─────────────────────────────────────────────────────────────

function findProject(data: SyncData, projectId: string): Project {
  const project = data.projects.find(p => p.id === projectId)
  if (!project) notFound(`Project not found: ${projectId}`)
  return project
}

type TaskLocation =
  | { kind: 'project'; project: Project; task: Task }
  | { kind: 'orphan'; task: Task }
  | { kind: 'recurring'; task: Task }

function locateTask(data: SyncData, taskId: string): TaskLocation {
  for (const project of data.projects) {
    const task = project.tasks.find(t => t.id === taskId)
    if (task) return { kind: 'project', project, task }
  }
  const orphan = data.orphanTasks.find(t => t.id === taskId)
  if (orphan) return { kind: 'orphan', task: orphan }
  const recurring = data.recurringTasks.find(t => t.id === taskId)
  if (recurring) return { kind: 'recurring', task: recurring }
  notFound(`Task not found: ${taskId}`)
}

function findTaskLoose(taskId: string, data: SyncData): { task: Task; projectTitle?: string } | null {
  for (const project of data.projects) {
    const task = project.tasks.find(t => t.id === taskId)
    if (task) return { task, projectTitle: project.title }
  }
  const orphan = data.orphanTasks.find(t => t.id === taskId)
  if (orphan) return { task: orphan }
  const recurring = data.recurringTasks.find(t => t.id === taskId)
  if (recurring) return { task: recurring }
  return null
}

// ── output shapes ───────────────────────────────────────────────────────

export interface AgentTaskSummary {
  id: string
  title: string
  status: TaskStatus
  projectId?: string
  taskType?: TaskType
  nextAction?: string
  kanbanColumn?: ProjectStatus
}

export interface AgentResolvedTask extends AgentTaskSummary {
  projectTitle?: string
}

export interface AgentProjectSummary {
  id: string
  title: string
  status: ProjectStatus
  category: Category
  trackerProjectId?: string
  tasks: AgentTaskSummary[]
}

export interface AgentResolvedProject {
  id: string
  title: string
  status: ProjectStatus
  category: Category
}

export interface AgentResolvedPlan {
  date: string
  deepBlock: { projectId: string; intention?: string; project: AgentResolvedProject | null }
  shortTasks: AgentResolvedTask[]
  shortProjects: AgentResolvedProject[]
  maintenanceTasks: AgentResolvedTask[]
  maintenanceProjects: AgentResolvedProject[]
  isComplete: boolean
}

function toTaskSummary(t: Task): AgentTaskSummary {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    projectId: t.projectId,
    taskType: t.taskType,
    nextAction: t.nextAction,
    kanbanColumn: t.kanbanColumn,
  }
}

function toProjectSummary(p: Project): AgentProjectSummary {
  return {
    id: p.id,
    title: p.title,
    status: p.status,
    category: p.category,
    ...(p.trackerProjectId ? { trackerProjectId: p.trackerProjectId } : {}),
    tasks: p.tasks.map(toTaskSummary),
  }
}

export interface WriteResult<T> {
  patch: Partial<SyncData>
  result: T
}

// ── reads ───────────────────────────────────────────────────────────────

export function listProjects(data: SyncData, params: Params = {}): AgentProjectSummary[] {
  const includeDone = bool(params, 'includeDone') ?? false
  return data.projects
    .filter(p => includeDone || p.status !== 'done')
    .map(p => ({
      ...toProjectSummary(p),
      tasks: p.tasks
        .filter(t => includeDone || (t.status !== 'done' && t.status !== 'dropped'))
        .map(toTaskSummary),
    }))
}

export function listOrphanTasks(data: SyncData): AgentTaskSummary[] {
  return data.orphanTasks.filter(t => t.status === 'backlog').map(toTaskSummary)
}

function resolveTaskIds(ids: string[], data: SyncData): AgentResolvedTask[] {
  return ids
    .map(id => findTaskLoose(id, data))
    .filter((found): found is { task: Task; projectTitle?: string } => found !== null)
    .map(({ task, projectTitle }) => ({ ...toTaskSummary(task), projectTitle }))
}

function resolveProjectIds(ids: string[], data: SyncData): AgentResolvedProject[] {
  return ids
    .map(id => data.projects.find(p => p.id === id))
    .filter((p): p is Project => !!p)
    .map(p => ({ id: p.id, title: p.title, status: p.status, category: p.category }))
}

function resolvePlan(plan: DailyPlan, data: SyncData): AgentResolvedPlan {
  const deepProject = plan.deepBlock.projectId
    ? data.projects.find(p => p.id === plan.deepBlock.projectId) ?? null
    : null
  return {
    date: plan.date,
    deepBlock: {
      projectId: plan.deepBlock.projectId,
      intention: plan.deepBlock.intention,
      project: deepProject
        ? { id: deepProject.id, title: deepProject.title, status: deepProject.status, category: deepProject.category }
        : null,
    },
    shortTasks: resolveTaskIds(plan.shortTasks, data),
    shortProjects: resolveProjectIds(plan.shortProjects, data),
    maintenanceTasks: resolveTaskIds(plan.maintenanceTasks, data),
    maintenanceProjects: resolveProjectIds(plan.maintenanceProjects, data),
    isComplete: plan.isComplete,
  }
}

/** Only resolves dailyPlan if its date is actually today in Europe/Amsterdam — mirrors useTodayPlan's staleness check. */
export function listToday(data: SyncData): AgentResolvedPlan | null {
  const plan = data.dailyPlan
  if (!plan || plan.date !== amsterdamDateString(0)) return null
  return resolvePlan(plan, data)
}

/** Only resolves tomorrowPlan if its date is actually tomorrow in Europe/Amsterdam. */
export function listTomorrow(data: SyncData): AgentResolvedPlan | null {
  const plan = data.tomorrowPlan
  if (!plan || plan.date !== amsterdamDateString(1)) return null
  return resolvePlan(plan, data)
}

// ── today/tomorrow-plan helper (mirrors store/helpers.ts ensurePlan) ─────

function ensurePlan(existing: DailyPlan | null, date: string, isToday: boolean): DailyPlan {
  if (existing && existing.date === date) {
    return {
      ...existing,
      shortProjects: existing.shortProjects ?? [],
      maintenanceProjects: existing.maintenanceProjects ?? [],
      meetings: existing.meetings ?? [],
      shortMeetingIds: existing.shortMeetingIds ?? [],
      maintenanceMeetingIds: existing.maintenanceMeetingIds ?? [],
      pinnedItemIds: existing.pinnedItemIds ?? [],
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

function ensureTodayPlan(data: SyncData): DailyPlan {
  return ensurePlan(data.dailyPlan, amsterdamDateString(0), true)
}

function ensureTomorrowPlan(data: SyncData): DailyPlan {
  return ensurePlan(data.tomorrowPlan, amsterdamDateString(1), false)
}

/**
 * Today-plan variant for writes that must not silently clobber a stale `dailyPlan`:
 * mirrors the client's `refreshDailyPlan` (src/lib/dailyPlanRollover.ts, shared) —
 * promotes a tomorrowPlan dated today (carrying over a stale dailyPlan's unfinished
 * tasks into it), or archives a stale dailyPlan into planHistory and rolls its
 * unfinished tasks into a fresh plan for today. Returns the plan to append onto,
 * plus any planHistory/tomorrowPlan/dailyPlan changes that must be persisted even
 * if the caller ends up not appending anything (e.g. a no-duplicate skip).
 */
function ensureTodayPlanForWrite(data: SyncData): { plan: DailyPlan; patch: Partial<SyncData> } {
  const today = amsterdamDateString(0)
  if (data.dailyPlan && data.dailyPlan.date === today) {
    return { plan: ensureTodayPlan(data), patch: {} }
  }

  const allTasks = [...data.orphanTasks, ...data.recurringTasks]
  const refreshed = computeDailyPlanRefresh({
    dailyPlan: data.dailyPlan,
    tomorrowPlan: data.tomorrowPlan,
    planHistory: data.planHistory,
    allTasks,
    today,
  })
  const plan = ensurePlan(refreshed.dailyPlan, today, true)
  const patch: Partial<SyncData> = refreshed.changed
    ? { dailyPlan: plan, planHistory: refreshed.planHistory, tomorrowPlan: refreshed.tomorrowPlan }
    : {}
  return { plan, patch }
}

/** Task-id tier ('shortTasks' or 'maintenanceTasks') a task should land in given its taskType. */
function taskTier(taskType: TaskType | undefined): 'shortTasks' | 'maintenanceTasks' {
  return taskType === 'maintenance' ? 'maintenanceTasks' : 'shortTasks'
}

/** True if taskId is already present in either task tier of the plan. */
function planHasTask(plan: DailyPlan, taskId: string): boolean {
  return plan.shortTasks.includes(taskId) || plan.maintenanceTasks.includes(taskId)
}

// ── writes ──────────────────────────────────────────────────────────────

export function addTask(data: SyncData, params: Params): WriteResult<AgentTaskSummary> {
  const taskTitle = title(params)
  const projectId = str(params, 'projectId')
  const taskType = oneOf(params, 'taskType', TASK_TYPES)
  const nextAction = str(params, 'nextAction')
  const kanbanColumn = oneOf(params, 'kanbanColumn', PROJECT_STATUSES)
  const addToToday = bool(params, 'addToToday') ?? false
  const addToTomorrow = bool(params, 'addToTomorrow') ?? false

  const project = projectId !== undefined ? findProject(data, projectId) : undefined

  const task: Task = {
    id: uuid(),
    title: taskTitle,
    status: 'backlog',
    isRecurring: false,
    isUncomfortable: false,
    createdAt: nowIso(),
    ...(project ? { projectId: project.id } : {}),
    ...(taskType !== undefined ? { taskType } : {}),
    ...(nextAction !== undefined ? { nextAction } : {}),
    ...(kanbanColumn !== undefined ? { kanbanColumn } : {}),
  }

  const patch: Partial<SyncData> = {}
  let nextProjects = data.projects
  let nextOrphanTasks = data.orphanTasks
  if (project) {
    nextProjects = data.projects.map(p =>
      p.id === project.id ? { ...p, tasks: [task, ...p.tasks], updatedAt: nowIso() } : p
    )
    patch.projects = nextProjects
  } else {
    nextOrphanTasks = [...data.orphanTasks, task]
    patch.orphanTasks = nextOrphanTasks
  }

  const nextData = { ...data, projects: nextProjects, orphanTasks: nextOrphanTasks }

  if (addToToday) {
    const { plan, patch: rolloverPatch } = ensureTodayPlanForWrite(nextData)
    Object.assign(patch, rolloverPatch)
    const tier = taskTier(taskType)
    patch.dailyPlan = plan[tier].includes(task.id) ? plan : { ...plan, [tier]: [...plan[tier], task.id] }
  }

  if (addToTomorrow) {
    const plan = ensureTomorrowPlan(nextData)
    const tier = taskTier(taskType)
    patch.tomorrowPlan = plan[tier].includes(task.id) ? plan : { ...plan, [tier]: [...plan[tier], task.id] }
  }

  return { patch, result: toTaskSummary(task) }
}

/** Builds `{ dailyPlan, tomorrowPlan }` patch entries that put an existing task on
 *  today's/tomorrow's plan, skipping it if it's already in either tier of that plan. */
function addExistingTaskToDayPlans(
  data: SyncData,
  taskId: string,
  taskType: TaskType | undefined,
  opts: { addToToday?: boolean; addToTomorrow?: boolean },
): Partial<SyncData> {
  const patch: Partial<SyncData> = {}
  const tier = taskTier(taskType)

  if (opts.addToToday) {
    const { plan, patch: rolloverPatch } = ensureTodayPlanForWrite(data)
    Object.assign(patch, rolloverPatch)
    if (!planHasTask(plan, taskId)) {
      patch.dailyPlan = { ...plan, [tier]: [...plan[tier], taskId] }
    }
  }

  if (opts.addToTomorrow) {
    const plan = ensureTomorrowPlan(data)
    if (!planHasTask(plan, taskId)) {
      patch.tomorrowPlan = { ...plan, [tier]: [...plan[tier], taskId] }
    }
  }

  return patch
}

export function updateTask(data: SyncData, params: Params): WriteResult<AgentTaskSummary> {
  const taskId = str(params, 'taskId', { required: true })!
  const loc = locateTask(data, taskId)

  const newTitle = params.title !== undefined ? title(params) : undefined
  const taskType = oneOf(params, 'taskType', TASK_TYPES)
  const nextAction = str(params, 'nextAction')
  const kanbanColumn = oneOf(params, 'kanbanColumn', PROJECT_STATUSES)
  const projectId = strOrNull(params, 'projectId')
  const addToToday = bool(params, 'addToToday') ?? false
  const addToTomorrow = bool(params, 'addToTomorrow') ?? false

  const fieldUpdates: Partial<Task> = {}
  if (newTitle !== undefined) fieldUpdates.title = newTitle
  if (taskType !== undefined) fieldUpdates.taskType = taskType
  if (nextAction !== undefined) fieldUpdates.nextAction = nextAction
  if (kanbanColumn !== undefined) fieldUpdates.kanbanColumn = kanbanColumn

  if (loc.kind === 'recurring') {
    if (projectId !== undefined) {
      if (projectId !== null) findProject(data, projectId)
      fieldUpdates.projectId = projectId === null ? undefined : projectId
    }
    const updated: Task = { ...loc.task, ...fieldUpdates }
    const dayPlanPatch = addExistingTaskToDayPlans(data, updated.id, updated.taskType, { addToToday, addToTomorrow })
    return {
      patch: { recurringTasks: data.recurringTasks.map(t => (t.id === updated.id ? updated : t)), ...dayPlanPatch },
      result: toTaskSummary(updated),
    }
  }

  const currentProjectId = loc.kind === 'project' ? loc.project.id : undefined
  const targetProjectId = projectId === undefined ? currentProjectId : projectId === null ? undefined : projectId
  if (targetProjectId !== undefined && targetProjectId !== currentProjectId) {
    findProject(data, targetProjectId)
  }

  const updatedTask: Task = { ...loc.task, ...fieldUpdates, projectId: targetProjectId }

  let projects = data.projects
  let orphanTasks = data.orphanTasks

  if (targetProjectId === currentProjectId) {
    if (loc.kind === 'project') {
      projects = data.projects.map(p =>
        p.id === loc.project.id
          ? { ...p, tasks: p.tasks.map(t => (t.id === updatedTask.id ? updatedTask : t)), updatedAt: nowIso() }
          : p
      )
    } else {
      orphanTasks = data.orphanTasks.map(t => (t.id === updatedTask.id ? updatedTask : t))
    }
  } else {
    if (loc.kind === 'project') {
      projects = data.projects.map(p =>
        p.id === loc.project.id
          ? { ...p, tasks: p.tasks.filter(t => t.id !== updatedTask.id), updatedAt: nowIso() }
          : p
      )
    } else {
      orphanTasks = data.orphanTasks.filter(t => t.id !== updatedTask.id)
    }
    if (targetProjectId !== undefined) {
      projects = projects.map(p =>
        p.id === targetProjectId ? { ...p, tasks: [...p.tasks, updatedTask], updatedAt: nowIso() } : p
      )
    } else {
      orphanTasks = [...orphanTasks, updatedTask]
    }
  }

  const patch: Partial<SyncData> = {}
  if (projects !== data.projects) patch.projects = projects
  if (orphanTasks !== data.orphanTasks) patch.orphanTasks = orphanTasks
  Object.assign(patch, addExistingTaskToDayPlans(data, updatedTask.id, updatedTask.taskType, { addToToday, addToTomorrow }))
  return { patch, result: toTaskSummary(updatedTask) }
}

export function completeTask(data: SyncData, params: Params): WriteResult<AgentTaskSummary> {
  const taskId = str(params, 'taskId', { required: true })!
  const loc = locateTask(data, taskId)
  if (loc.kind === 'recurring') {
    // Recurring completion is tracked via lastCompletedDate, not status/completedAt, and
    // the app itself doesn't currently wire that up from any UI toggle — rather than invent
    // behavior the app doesn't have, we reject so callers don't rely on undefined semantics.
    badRequest('Completing recurring tasks is not supported')
  }
  const updated: Task = { ...loc.task, status: 'done', completedAt: nowIso() }
  const patch: Partial<SyncData> =
    loc.kind === 'project'
      ? {
          projects: data.projects.map(p =>
            p.id === loc.project.id
              ? { ...p, tasks: p.tasks.map(t => (t.id === updated.id ? updated : t)), updatedAt: nowIso() }
              : p
          ),
        }
      : { orphanTasks: data.orphanTasks.map(t => (t.id === updated.id ? updated : t)) }
  return { patch, result: toTaskSummary(updated) }
}

export function dropTask(data: SyncData, params: Params): WriteResult<AgentTaskSummary> {
  const taskId = str(params, 'taskId', { required: true })!
  const loc = locateTask(data, taskId)
  const updated: Task = { ...loc.task, status: 'dropped' }
  let patch: Partial<SyncData>
  if (loc.kind === 'project') {
    patch = {
      projects: data.projects.map(p =>
        p.id === loc.project.id
          ? { ...p, tasks: p.tasks.map(t => (t.id === updated.id ? updated : t)), updatedAt: nowIso() }
          : p
      ),
    }
  } else if (loc.kind === 'orphan') {
    patch = { orphanTasks: data.orphanTasks.map(t => (t.id === updated.id ? updated : t)) }
  } else {
    patch = { recurringTasks: data.recurringTasks.map(t => (t.id === updated.id ? updated : t)) }
  }
  return { patch, result: toTaskSummary(updated) }
}

/** Reads `trackerProjectId`, treating `null` and `""` the same way — both mean "clear the link". */
function trackerProjectIdParam(params: Params): string | null | undefined {
  const v = strOrNull(params, 'trackerProjectId')
  if (v === undefined || v === null) return v
  const trimmed = v.trim()
  return trimmed === '' ? null : trimmed
}

export function addProject(data: SyncData, params: Params): WriteResult<AgentProjectSummary> {
  const projectTitle = title(params)
  const category = oneOf(params, 'category', CATEGORIES) ?? 'personal'
  const status = oneOf(params, 'status', PROJECT_STATUSES) ?? 'backlog'
  const trackerProjectId = trackerProjectIdParam(params)

  const now = nowIso()
  const project: Project = {
    id: uuid(),
    title: projectTitle,
    category,
    status,
    bodyContent: '',
    tasks: [],
    trackProgress: false,
    daysWorked: 0,
    daysWorkedLog: [],
    createdAt: now,
    updatedAt: now,
    ...(trackerProjectId ? { trackerProjectId } : {}),
  }
  return { patch: { projects: [...data.projects, project] }, result: toProjectSummary(project) }
}

/**
 * Updates status/title/category/trackerProjectId on an existing project. Mirrors
 * `moveProject`'s (`src/store/projectsSlice.ts`) only status-change side effect: `waitingOn`
 * is cleared when the new status is `done` (preserved for every other status). The WIP-limit
 * gate `moveProject` enforces when moving into `in_progress`/`waiting` is a client-only UX
 * guard (it pops a "swap" modal for the human to resolve) with no sensible server-side
 * resolution, so it is intentionally not enforced here.
 */
export function updateProject(data: SyncData, params: Params): WriteResult<AgentProjectSummary> {
  const projectId = str(params, 'projectId', { required: true })!
  const project = findProject(data, projectId)
  const newTitle = params.title !== undefined ? title(params) : undefined
  const status = oneOf(params, 'status', PROJECT_STATUSES)
  const category = oneOf(params, 'category', CATEGORIES)
  const trackerProjectId = trackerProjectIdParam(params)

  if (newTitle === undefined && status === undefined && category === undefined && trackerProjectId === undefined) {
    badRequest('At least one of title, status, category, trackerProjectId is required')
  }

  const updated: Project = {
    ...project,
    ...(newTitle !== undefined ? { title: newTitle } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(category !== undefined ? { category } : {}),
    trackerProjectId: trackerProjectId === undefined ? project.trackerProjectId : trackerProjectId === null ? undefined : trackerProjectId,
    waitingOn: status === 'done' ? undefined : project.waitingOn,
    updatedAt: nowIso(),
  }
  return {
    patch: { projects: data.projects.map(p => (p.id === updated.id ? updated : p)) },
    result: toProjectSummary(updated),
  }
}

export function renameProject(data: SyncData, params: Params): WriteResult<AgentProjectSummary> {
  const projectId = str(params, 'projectId', { required: true })!
  const project = findProject(data, projectId)
  const newTitle = params.title !== undefined ? title(params) : undefined
  const trackerProjectId = trackerProjectIdParam(params)

  if (newTitle === undefined && trackerProjectId === undefined) {
    badRequest('title or trackerProjectId is required')
  }

  const updated: Project = {
    ...project,
    ...(newTitle !== undefined ? { title: newTitle } : {}),
    trackerProjectId: trackerProjectId === undefined ? project.trackerProjectId : trackerProjectId === null ? undefined : trackerProjectId,
    updatedAt: nowIso(),
  }
  return {
    patch: { projects: data.projects.map(p => (p.id === updated.id ? updated : p)) },
    result: toProjectSummary(updated),
  }
}

// ── dispatch ────────────────────────────────────────────────────────────

export const READ_ACTIONS = ['list_projects', 'list_today', 'list_tomorrow', 'list_orphan_tasks'] as const
export const WRITE_ACTIONS = [
  'add_task',
  'update_task',
  'complete_task',
  'drop_task',
  'add_project',
  'rename_project',
  'update_project',
] as const
export const AGENT_ACTIONS = [...READ_ACTIONS, ...WRITE_ACTIONS] as const
export type AgentAction = (typeof AGENT_ACTIONS)[number]

export function isAgentAction(action: string): action is AgentAction {
  return (AGENT_ACTIONS as readonly string[]).includes(action)
}

/** Runs one named operation against a data snapshot. Read actions return an empty patch. */
export function runAgentOperation(action: AgentAction, data: SyncData, params: Params = {}): WriteResult<unknown> {
  switch (action) {
    case 'list_projects':
      return { patch: {}, result: listProjects(data, params) }
    case 'list_today':
      return { patch: {}, result: listToday(data) }
    case 'list_tomorrow':
      return { patch: {}, result: listTomorrow(data) }
    case 'list_orphan_tasks':
      return { patch: {}, result: listOrphanTasks(data) }
    case 'add_task':
      return addTask(data, params)
    case 'update_task':
      return updateTask(data, params)
    case 'complete_task':
      return completeTask(data, params)
    case 'drop_task':
      return dropTask(data, params)
    case 'add_project':
      return addProject(data, params)
    case 'rename_project':
      return renameProject(data, params)
    case 'update_project':
      return updateProject(data, params)
  }
}
