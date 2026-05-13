import { v4 as uuid } from 'uuid'
import { format, addDays } from 'date-fns'
import type { Task, Subtask, RecurrenceRule } from '../types'
import type { StoreSet, StoreGet } from './types'
import { isDueToday } from '../lib/recurrence'

/** Factory that builds a Task with sensible defaults. Spread overrides last. */
function createTask(overrides: Partial<Task> & { id: string; title: string }): Task {
  return {
    status: 'backlog',
    isRecurring: false,
    isUncomfortable: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

export function makeTaskActions(set: StoreSet, get: StoreGet) {
  return {
    // Task actions (within projects)
    addTask: (title: string, projectId?: string): string => {
      const id = uuid()
      const task = createTask({ id, title, projectId })
      if (projectId) {
        set(state => ({
          projects: state.projects.map(p =>
            p.id === projectId
              ? { ...p, tasks: [task, ...p.tasks], updatedAt: new Date().toISOString() }
              : p
          ),
        }))
      }
      return id
    },

    updateTask: (taskId: string, projectId: string | undefined, updates: Partial<Omit<Task, 'id'>>) => {
      if (projectId) {
        set(state => ({
          projects: state.projects.map(p =>
            p.id === projectId
              ? {
                  ...p,
                  tasks: p.tasks.map(t => (t.id === taskId ? { ...t, ...updates } : t)),
                  updatedAt: new Date().toISOString(),
                }
              : p
          ),
        }))
      }
    },

    reorderProjectTasks: (projectId: string, taskIds: string[]) => {
      set(state => ({
        projects: state.projects.map(p =>
          p.id !== projectId ? p : {
            ...p,
            tasks: taskIds.map(id => p.tasks.find(t => t.id === id)!).filter(Boolean),
            updatedAt: new Date().toISOString(),
          }
        ),
      }))
    },

    deleteTask: (taskId: string, projectId?: string) => {
      if (projectId) {
        set(state => ({
          projects: state.projects.map(p =>
            p.id === projectId
              ? { ...p, tasks: p.tasks.filter(t => t.id !== taskId), updatedAt: new Date().toISOString() }
              : p
          ),
        }))
      }
    },

    // ── Subtask actions ───────────────────────────────────────────
    addSubtask: (projectId: string, taskId: string, title: string): string => {
      const id = uuid()
      const subtask: Subtask = { id, title, done: false }
      set(state => ({
        projects: state.projects.map(p =>
          p.id === projectId
            ? {
                ...p,
                tasks: p.tasks.map(t =>
                  t.id === taskId ? { ...t, subtasks: [...(t.subtasks ?? []), subtask] } : t
                ),
                updatedAt: new Date().toISOString(),
              }
            : p
        ),
      }))
      return id
    },

    toggleSubtask: (projectId: string, taskId: string, subtaskId: string) => {
      set(state => ({
        projects: state.projects.map(p =>
          p.id === projectId
            ? {
                ...p,
                tasks: p.tasks.map(t =>
                  t.id === taskId
                    ? { ...t, subtasks: (t.subtasks ?? []).map(s => s.id === subtaskId ? { ...s, done: !s.done } : s) }
                    : t
                ),
                updatedAt: new Date().toISOString(),
              }
            : p
        ),
      }))
    },

    deleteSubtask: (projectId: string, taskId: string, subtaskId: string) => {
      set(state => ({
        projects: state.projects.map(p =>
          p.id === projectId
            ? {
                ...p,
                tasks: p.tasks.map(t =>
                  t.id === taskId
                    ? { ...t, subtasks: (t.subtasks ?? []).filter(s => s.id !== subtaskId) }
                    : t
                ),
                updatedAt: new Date().toISOString(),
              }
            : p
        ),
      }))
    },

    addOrphanTask: (title: string): string => {
      const id = uuid()
      const task = createTask({ id, title })
      set(state => ({ orphanTasks: [...state.orphanTasks, task] }))
      return id
    },

    updateOrphanTask: (taskId: string, updates: Partial<Omit<Task, 'id'>>) => {
      set(state => ({
        orphanTasks: state.orphanTasks.map(t =>
          t.id === taskId ? { ...t, ...updates } : t
        ),
      }))
    },

    deleteOrphanTask: (taskId: string) => {
      set(state => ({ orphanTasks: state.orphanTasks.filter(t => t.id !== taskId) }))
    },

    restoreOrphanTask: (task: Task) => {
      set(state => ({ orphanTasks: [...state.orphanTasks, task] }))
    },

    moveOrphanTaskToProject: (taskId: string, projectId: string) => {
      const state = get()
      const task = state.orphanTasks.find(t => t.id === taskId)
      if (!task) return
      const updatedTask = { ...task, projectId }
      set(s => ({
        orphanTasks: s.orphanTasks.filter(t => t.id !== taskId),
        projects: s.projects.map(p =>
          p.id === projectId
            ? { ...p, tasks: [...p.tasks, updatedTask], updatedAt: new Date().toISOString() }
            : p
        ),
      }))
    },

    // Recurring tasks
    addRecurringTask: (title: string, rule: RecurrenceRule, projectId?: string): string => {
      const id = uuid()
      const task = createTask({ id, title, projectId, isRecurring: true, recurrenceRule: rule })
      set(state => ({ recurringTasks: [...state.recurringTasks, task] }))
      return id
    },

    updateRecurringTask: (taskId: string, updates: Partial<Omit<Task, 'id'>>) => {
      set(state => ({
        recurringTasks: state.recurringTasks.map(t =>
          t.id === taskId ? { ...t, ...updates } : t
        ),
      }))
    },

    deleteRecurringTask: (taskId: string) => {
      set(state => ({ recurringTasks: state.recurringTasks.filter(t => t.id !== taskId) }))
    },

    getTodayRecurringTasks: (): Task[] => {
      return get().recurringTasks.filter(t => t.recurrenceRule && isDueToday(t.recurrenceRule))
    },

    getTomorrowRecurringTasks: (): Task[] => {
      const tomorrow = addDays(new Date(), 1)
      return get().recurringTasks.filter(t => t.recurrenceRule && isDueToday(t.recurrenceRule, tomorrow))
    },

    // Checkbox-task sync
    syncCheckboxTasks: (projectId: string, checkboxTexts: string[]) => {
      set(state => ({
        projects: state.projects.map(p => {
          if (p.id !== projectId) return p

          // Separate editor-managed tasks from manual tasks
          const editorTasks = p.tasks.filter(t => t.fromEditor)
          const manualTasks = p.tasks.filter(t => !t.fromEditor)

          // Build lookup maps for matching
          const editorByTitle = new Map(editorTasks.map(t => [t.title, t]))
          const manualByTitle = new Map(manualTasks.map(t => [t.title, t]))

          // Build new editor task list from current checkbox texts
          const newEditorTasks: Task[] = checkboxTexts.map(text => {
            // Exact match in existing editor tasks → keep (preserves status, id, etc.)
            const existingEditor = editorByTitle.get(text)
            if (existingEditor) return existingEditor

            // Exact match in manual tasks → tag it as fromEditor (migration path)
            const existingManual = manualByTitle.get(text)
            if (existingManual) return { ...existingManual, fromEditor: true }

            // New checkbox → create new task
            return createTask({ id: uuid(), title: text, projectId, fromEditor: true })
          })

          // Remove manual tasks that got promoted to editor tasks (to avoid duplicates)
          const promotedTitles = new Set(
            newEditorTasks.filter(t => manualByTitle.has(t.title)).map(t => t.title)
          )
          const remainingManualTasks = manualTasks.filter(t => !promotedTitles.has(t.title))

          // Check if anything actually changed before updating
          const combined = [...remainingManualTasks, ...newEditorTasks]
          if (
            combined.length === p.tasks.length &&
            combined.every((t, i) => t === p.tasks[i])
          ) return p

          return { ...p, tasks: combined, updatedAt: new Date().toISOString() }
        }),
      }))
    },

    // Progress tracking
    recordDayWorked: (projectId: string) => {
      const today = format(new Date(), 'yyyy-MM-dd')
      set(state => ({
        projects: state.projects.map(p => {
          if (p.id !== projectId || !p.trackProgress) return p
          if (p.daysWorkedLog.includes(today)) return p
          return {
            ...p,
            daysWorked: p.daysWorked + 1,
            daysWorkedLog: [...p.daysWorkedLog, today],
            updatedAt: new Date().toISOString(),
          }
        }),
      }))
    },
  }
}
