# Objectives (Goals) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the "Week" tab into "Objectives" — let the user write down goals with a target date and optional effort target, assign projects to them, see automatic progress (completion + days-worked pace), and get an on-demand AI SMART review of a goal draft.

**Architecture:** Additive Zustand slice (`goalsSlice.ts`) holding a new `goals: Goal[]` array, synced through the existing Firestore pattern. Progress is computed on read from existing `Project.daysWorked`/`daysWorkedLog` and `status` — no new tracking mechanism. UI lives entirely inside the existing `src/components/week/` tree: a new goals strip and two new components (`GoalChip`, `GoalForm`) sit alongside the existing 7-day grid, and the existing sidebar/day-card components gain goal awareness. One new stateless AI endpoint (`api/goal-review.ts`) follows the exact pattern of `api/done-reflection.ts`.

**Tech Stack:** React 19 + TypeScript, Zustand, `@dnd-kit/core` (existing drag-and-drop), Tailwind v4, `date-fns`, OpenAI `gpt-4o` via Vercel serverless function.

**Note on testing:** this project has no test runner configured (no vitest/jest, no `*.test.*` files anywhere). Each task below ends with a manual verification step (TypeScript check and/or browser check) instead of an automated test — that matches how the rest of the codebase is verified (see `ProjectModal`, `WeekPlannerView`, etc., none of which have tests).

Design reference: `docs/plans/2026-08-22-objectives-design.md`.

---

### Task 1: Data model — `Goal` type, color palette, `Project.goalId`

**Files:**
- Modify: `src/types/index.ts`

**Step 1: Add `goalId` to `Project`**

Find the `Project` interface (currently around line 26) and add one field right after `missionCritical?: boolean`:

```typescript
export interface Project {
  id: string
  title: string
  category: Category
  status: ProjectStatus
  backlogSection?: 'soon' | 'not_yet' | 'someday'
  contextIds?: string[]
  coverImageUrl?: string
  coverImageTitle?: string
  coverImagePosition?: { x: number; y: number }
  bodyContent: string
  tasks: Task[]
  trackProgress: boolean
  missionCritical?: boolean
  goalId?: string          // links this project to one Objective — one goal per project
  daysWorked: number
  daysWorkedLog: string[]
  waitingOn?: WaitingOn[]
  shareId?: string
  createdAt: string
  updatedAt: string
}
```

**Step 2: Add the `Goal` type and color palette**

Add this new block right after the `WorkContext` interface (right before `export interface Settings`):

```typescript
export const GOAL_COLORS = ['#3B7A6E', '#B8863A', '#4A6FA5', '#7E5BA5', '#A5635E', '#8B8680'] as const

export interface Goal {
  id: string
  title: string               // what you want to achieve
  description?: string        // the "why" — what business outcome this drives
  startDate: string            // YYYY-MM-DD
  targetDate: string           // YYYY-MM-DD
  targetDaysWorked?: number    // optional effort target
  color: string                 // one of GOAL_COLORS
  createdAt: string
  updatedAt: string
}
```

**Step 3: Verify**

```bash
npx tsc -b --noEmit
```
Expected: no errors (nothing consumes the new fields yet, so this only checks the types themselves are well-formed).

**Step 4: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(goals): add Goal type, color palette, Project.goalId"
```

---

### Task 2: `goalsSlice.ts` — state + CRUD actions

**Files:**
- Create: `src/store/goalsSlice.ts`
- Modify: `src/store/types.ts`
- Modify: `src/store/index.ts`

**Step 1: Create the slice**

```typescript
// src/store/goalsSlice.ts
import { v4 as uuid } from 'uuid'
import type { Goal } from '../types'
import type { StoreSet, StoreGet } from './types'

export function makeGoalActions(set: StoreSet, _get: StoreGet) {
  return {
    addGoal: (goal: Omit<Goal, 'id' | 'createdAt' | 'updatedAt'>) => {
      const now = new Date().toISOString()
      const id = uuid()
      set(state => ({
        goals: [...state.goals, { ...goal, id, createdAt: now, updatedAt: now }],
      }))
      return id
    },

    updateGoal: (id: string, patch: Partial<Omit<Goal, 'id' | 'createdAt'>>) => {
      set(state => ({
        goals: state.goals.map(g =>
          g.id === id ? { ...g, ...patch, updatedAt: new Date().toISOString() } : g
        ),
      }))
    },

    deleteGoal: (id: string) => {
      set(state => ({
        goals: state.goals.filter(g => g.id !== id),
        projects: state.projects.map(p =>
          p.goalId === id ? { ...p, goalId: undefined } : p
        ),
      }))
    },

    assignProjectToGoal: (projectId: string, goalId: string | null) => {
      set(state => ({
        projects: state.projects.map(p =>
          p.id === projectId ? { ...p, goalId: goalId ?? undefined } : p
        ),
      }))
    },
  }
}
```

**Step 2: Add to `VandaagState` in `src/store/types.ts`**

Add `Goal` to the type-only import at the top of the file (it currently imports `Project, Task, Meeting, ...` — add `Goal` to that list).

Add `goals: Goal[]` to the state fields (near `planHistory`/`weekSlots`, around line 38):

```typescript
  planHistory: Record<string, DailyPlan>
  weekSlots: Record<string, string[]>
  goals: Goal[]
  personalRules: string[]
```

Add the action signatures (near the "Week slots" group, around line 246):

```typescript
  // Goals
  addGoal: (goal: Omit<Goal, 'id' | 'createdAt' | 'updatedAt'>) => string
  updateGoal: (id: string, patch: Partial<Omit<Goal, 'id' | 'createdAt'>>) => void
  deleteGoal: (id: string) => void
  assignProjectToGoal: (projectId: string, goalId: string | null) => void
```

**Step 3: Wire into `src/store/index.ts`**

Add the import near the other slice imports:
```typescript
import { makeGoalActions } from './goalsSlice'
```

Add initial state next to `weekSlots: {},`:
```typescript
      weekSlots: {},
      goals: [],
```

Add the slice spread next to the other `...make*Actions(set, get)` calls:
```typescript
      ...makeWriteAwayActions(set, get),
      ...makeGoalActions(set, get),
```

Add `goals: state.goals,` to the `partialize` object, next to `weekSlots: state.weekSlots,`.

**Step 4: Verify**

```bash
npx tsc -b --noEmit
```
Expected: no errors.

**Step 5: Commit**

```bash
git add src/store/goalsSlice.ts src/store/types.ts src/store/index.ts
git commit -m "feat(goals): add goals store slice with CRUD actions"
```

---

### Task 3: Sync `goals` through Firestore

**Files:**
- Modify: `src/lib/firestore.ts`
- Modify: `src/hooks/useFirestoreSync.ts`

**Step 1: Add `goals` to `SyncData`**

In `src/lib/firestore.ts`, add `Goal` to the type-only import, and add the field to `SyncData`:

```typescript
import type { Project, Task, Meeting, Settings, DailyPlan, WriteAwayEntry, Goal } from '../types'

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
```

**Step 2: Add `goals` to both directions of sync in `useFirestoreSync.ts`**

In `extractSyncData()`, add `goals: s.goals,` next to `weekSlots: s.weekSlots,`.

In the "Cloud is newer" `useStore.setState({...})` block, add `goals: remote.goals ?? [],` next to `weekSlots: remote.weekSlots ?? {},`.

**Step 3: Verify**

```bash
npx tsc -b --noEmit
```
Expected: no errors.

**Step 4: Commit**

```bash
git add src/lib/firestore.ts src/hooks/useFirestoreSync.ts
git commit -m "feat(goals): sync goals through Firestore"
```

---

### Task 4: Progress helper functions

**Files:**
- Create: `src/lib/goals.ts`

**Step 1: Write the helpers**

```typescript
import type { Goal, Project } from '../types'

export function getGoalProjects(goal: Goal, projects: Project[]): Project[] {
  return projects.filter(p => p.goalId === goal.id)
}

export function getGoalCompletion(goal: Goal, projects: Project[]): { done: number; total: number } {
  const linked = getGoalProjects(goal, projects)
  return { done: linked.filter(p => p.status === 'done').length, total: linked.length }
}

/** Sum of daysWorkedLog entries across linked projects, clamped to the goal's active window. */
export function getGoalDaysWorked(goal: Goal, projects: Project[]): number {
  const linked = getGoalProjects(goal, projects)
  const today = new Date().toISOString().slice(0, 10)
  const end = goal.targetDate < today ? goal.targetDate : today
  let count = 0
  for (const project of linked) {
    for (const date of project.daysWorkedLog ?? []) {
      if (date >= goal.startDate && date <= end) count++
    }
  }
  return count
}

/** A goal is active until its target date has passed. */
export function isGoalActive(goal: Goal): boolean {
  const today = new Date().toISOString().slice(0, 10)
  return goal.targetDate >= today
}
```

**Step 2: Verify**

```bash
npx tsc -b --noEmit
```
Expected: no errors.

**Step 3: Commit**

```bash
git add src/lib/goals.ts
git commit -m "feat(goals): add progress computation helpers"
```

---

### Task 5: `GoalChip` component

**Files:**
- Create: `src/components/week/GoalChip.tsx`

**Step 1: Write the component**

```typescript
import { format } from 'date-fns'
import { nl } from 'date-fns/locale'
import { getGoalCompletion, getGoalDaysWorked } from '../../lib/goals'
import type { Goal, Project } from '../../types'

interface Props {
  goal: Goal
  projects: Project[]
  onClick: () => void
}

export function GoalChip({ goal, projects, onClick }: Props) {
  const { done, total } = getGoalCompletion(goal, projects)
  const daysWorked = getGoalDaysWorked(goal, projects)
  const completionPct = total > 0 ? Math.round((done / total) * 100) : 0
  const targetLabel = format(new Date(goal.targetDate), 'd MMM', { locale: nl })

  return (
    <button
      onClick={onClick}
      className="flex flex-col gap-1 px-3 py-2 rounded-[8px] border border-border bg-canvas text-left
        min-w-[180px] shrink-0 hover:border-stone/30 transition-colors"
    >
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: goal.color }} />
        <span className="text-[12px] font-medium text-charcoal truncate">{goal.title}</span>
      </div>
      <div className="text-[10px] text-stone/60">
        {total > 0 ? `${done}/${total} projecten` : 'nog geen projecten'} · doel {targetLabel}
      </div>
      <div className="h-1 rounded-full bg-border overflow-hidden">
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${completionPct}%`, backgroundColor: goal.color }}
        />
      </div>
      {goal.targetDaysWorked && (
        <div className="text-[10px] text-stone/50">
          {daysWorked}/{goal.targetDaysWorked} dagen gewerkt
        </div>
      )}
    </button>
  )
}
```

**Step 2: Verify**

```bash
npx tsc -b --noEmit
```
Expected: no errors. (Not yet rendered anywhere — that's Task 7.)

**Step 3: Commit**

```bash
git add src/components/week/GoalChip.tsx
git commit -m "feat(goals): add GoalChip component"
```

---

### Task 6: `GoalForm` component (create/edit, no AI review yet)

**Files:**
- Create: `src/components/week/GoalForm.tsx`

**Step 1: Write the component**

```typescript
import { useState } from 'react'
import { useStore } from '../../store'
import { GOAL_COLORS, type Goal } from '../../types'

interface Props {
  goal: Goal | null   // null = creating a new goal
  onClose: () => void
}

export function GoalForm({ goal, onClose }: Props) {
  const addGoal = useStore(s => s.addGoal)
  const updateGoal = useStore(s => s.updateGoal)
  const deleteGoal = useStore(s => s.deleteGoal)

  const [title, setTitle] = useState(goal?.title ?? '')
  const [description, setDescription] = useState(goal?.description ?? '')
  const [startDate, setStartDate] = useState(goal?.startDate ?? new Date().toISOString().slice(0, 10))
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? '')
  const [targetDaysWorked, setTargetDaysWorked] = useState(
    goal?.targetDaysWorked ? String(goal.targetDaysWorked) : ''
  )
  const [color, setColor] = useState<string>(goal?.color ?? GOAL_COLORS[0])

  const canSave = title.trim().length > 0 && targetDate.length > 0

  function handleSave() {
    if (!canSave) return
    const payload = {
      title: title.trim(),
      description: description.trim() || undefined,
      startDate,
      targetDate,
      targetDaysWorked: targetDaysWorked ? Number(targetDaysWorked) : undefined,
      color,
    }
    if (goal) {
      updateGoal(goal.id, payload)
    } else {
      addGoal(payload)
    }
    onClose()
  }

  function handleDelete() {
    if (!goal) return
    deleteGoal(goal.id)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-charcoal/20 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-[420px] max-h-[85vh] overflow-y-auto bg-canvas rounded-t-[16px]
          sm:rounded-[12px] border border-border shadow-2xl p-5 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="font-serif text-[17px] text-charcoal">
          {goal ? 'Objective bewerken' : 'Nieuw objective'}
        </h3>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] uppercase tracking-[0.05em] text-stone/50 font-medium">Titel</label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Wat wil je bereiken?"
            className="px-2.5 py-1.5 rounded-[6px] border border-border bg-card text-[13px] text-charcoal
              focus:outline-none focus:border-stone/40"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] uppercase tracking-[0.05em] text-stone/50 font-medium">
            Waarom — wat levert dit de business op?
          </label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={3}
            className="px-2.5 py-1.5 rounded-[6px] border border-border bg-card text-[13px] text-charcoal
              focus:outline-none focus:border-stone/40 resize-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] uppercase tracking-[0.05em] text-stone/50 font-medium">Start</label>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="px-2.5 py-1.5 rounded-[6px] border border-border bg-card text-[13px] text-charcoal"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] uppercase tracking-[0.05em] text-stone/50 font-medium">Doeldatum</label>
            <input
              type="date"
              value={targetDate}
              onChange={e => setTargetDate(e.target.value)}
              className="px-2.5 py-1.5 rounded-[6px] border border-border bg-card text-[13px] text-charcoal"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] uppercase tracking-[0.05em] text-stone/50 font-medium">
            Target dagen gewerkt (optioneel)
          </label>
          <input
            type="number"
            min={1}
            value={targetDaysWorked}
            onChange={e => setTargetDaysWorked(e.target.value)}
            placeholder="bv. 20"
            className="px-2.5 py-1.5 rounded-[6px] border border-border bg-card text-[13px] text-charcoal w-24"
          />
        </div>

        <div className="flex items-center gap-2">
          {GOAL_COLORS.map(c => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`w-6 h-6 rounded-full transition-transform ${
                color === c ? 'ring-2 ring-offset-2 ring-charcoal scale-105' : ''
              }`}
              style={{ backgroundColor: c }}
              aria-label={`Kies kleur ${c}`}
            />
          ))}
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-border">
          {goal ? (
            <button onClick={handleDelete} className="text-[12px] text-red hover:opacity-70">
              Verwijder
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-[12px] rounded-[6px] text-stone/60 hover:bg-border-light"
            >
              Annuleer
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave}
              className="px-3 py-1.5 text-[12px] rounded-[6px] bg-charcoal text-[#FAF9F7] disabled:opacity-40"
            >
              Opslaan
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

**Step 2: Verify**

```bash
npx tsc -b --noEmit
```
Expected: no errors.

**Step 3: Commit**

```bash
git add src/components/week/GoalForm.tsx
git commit -m "feat(goals): add GoalForm create/edit modal"
```

---

### Task 7: Wire the goals strip into `WeekPlannerView`

**Files:**
- Modify: `src/components/week/WeekPlannerView.tsx`

**Step 1: Replace the file**

This adds: goals from the store, the strip (active goal chips + "+ Nieuw objective" + collapsed past objectives), `GoalForm` open/close state, and extends `onDragEnd` to handle dropping a project onto a goal-section header (added by Task 8) via a new `assignGoalId` drop-target field. The 7-day grid itself is unchanged.

```typescript
import { useState, useCallback } from 'react'
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { startOfWeek, addDays, format } from 'date-fns'
import { nl } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, ChevronDown, Plus } from 'lucide-react'
import { useStore } from '../../store'
import { isGoalActive } from '../../lib/goals'
import type { Goal } from '../../types'
import { WeekDayColumn } from './WeekDayColumn'
import { WeekProjectSidebar } from './WeekProjectSidebar'
import { GoalChip } from './GoalChip'
import { GoalForm } from './GoalForm'

export function WeekPlannerView() {
  const projects = useStore(s => s.projects)
  const weekSlots = useStore(s => s.weekSlots)
  const planHistory = useStore(s => s.planHistory)
  const dailyPlan = useStore(s => s.dailyPlan)
  const tomorrowPlan = useStore(s => s.tomorrowPlan)
  const goals = useStore(s => s.goals)
  const addProjectToSlot = useStore(s => s.addProjectToSlot)
  const removeProjectFromSlot = useStore(s => s.removeProjectFromSlot)
  const setWeekSlot = useStore(s => s.setWeekSlot)
  const assignProjectToGoal = useStore(s => s.assignProjectToGoal)

  const [weekOffset, setWeekOffset] = useState(0)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [goalFormOpen, setGoalFormOpen] = useState(false)
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null)
  const [showPastGoals, setShowPastGoals] = useState(false)

  const activeGoals = goals.filter(isGoalActive)
  const pastGoals = goals.filter(g => !isGoalActive(g))

  const weekStart = startOfWeek(addDays(new Date(), weekOffset * 7), { weekStartsOn: 1 })
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  const weekLabel = (() => {
    const start = format(weekStart, 'd MMM', { locale: nl })
    const end = format(addDays(weekStart, 6), 'd MMM', { locale: nl })
    const year = format(weekStart, 'yyyy')
    return `${start} – ${end} ${year}`
  })()

  const getPlanForDate = useCallback((date: Date) => {
    const key = format(date, 'yyyy-MM-dd')
    if (dailyPlan?.date === key) return dailyPlan
    if (tomorrowPlan?.date === key) return tomorrowPlan
    return planHistory[key] ?? null
  }, [dailyPlan, tomorrowPlan, planHistory])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  function onDragStart({ active }: DragStartEvent) {
    setActiveId(active.id as string)
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    setActiveId(null)
    if (!over) return

    const assignGoalId = over.data.current?.assignGoalId as string | null | undefined
    if (assignGoalId !== undefined) {
      const projectId = active.data.current?.projectId as string
      assignProjectToGoal(projectId, assignGoalId)
      return
    }

    const toDate = over.data.current?.toDate as string | undefined
    if (!toDate) return

    const projectId = active.data.current?.projectId as string
    const fromDate = active.data.current?.fromDate as string | null

    if (fromDate) {
      const current = weekSlots[fromDate] ?? []
      setWeekSlot(fromDate, current.filter(id => id !== projectId))
    }

    addProjectToSlot(toDate, projectId)
  }

  const activeProjectId = activeId
    ? (activeId.startsWith('sidebar::')
        ? activeId.replace('sidebar::', '')
        : activeId.split('::')[1])
    : null
  const activeProject = activeProjectId ? projects.find(p => p.id === activeProjectId) : null

  function openNewGoal() {
    setEditingGoal(null)
    setGoalFormOpen(true)
  }

  function openEditGoal(goal: Goal) {
    setEditingGoal(goal)
    setGoalFormOpen(true)
  }

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-serif text-[20px] font-normal text-charcoal tracking-[-0.01em]">
            Objectives
          </h2>
          <p className="text-[13px] text-stone/60 mt-0.5">{weekLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekOffset(w => w - 1)}
            className="p-1.5 rounded-[6px] text-stone/50 hover:text-charcoal hover:bg-border-light transition-colors"
            aria-label="Vorige week"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => setWeekOffset(0)}
            className="px-3 py-1 text-[12px] rounded-[6px] text-stone/60 hover:text-charcoal hover:bg-border-light transition-colors"
          >
            Deze week
          </button>
          <button
            onClick={() => setWeekOffset(w => w + 1)}
            className="p-1.5 rounded-[6px] text-stone/50 hover:text-charcoal hover:bg-border-light transition-colors"
            aria-label="Volgende week"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Objectives strip */}
      <div className="flex items-stretch gap-2 overflow-x-auto pb-4 mb-2">
        {activeGoals.map(goal => (
          <GoalChip key={goal.id} goal={goal} projects={projects} onClick={() => openEditGoal(goal)} />
        ))}
        <button
          onClick={openNewGoal}
          className="flex items-center gap-1.5 px-3 py-2 rounded-[8px] border border-dashed border-border
            text-[12px] text-stone/50 hover:text-charcoal hover:border-stone/40 transition-colors shrink-0"
        >
          <Plus size={14} />
          Nieuw objective
        </button>
      </div>

      {pastGoals.length > 0 && (
        <div className="mb-4">
          <button
            onClick={() => setShowPastGoals(v => !v)}
            className="flex items-center gap-1 text-[11px] text-stone/40 hover:text-stone/60 transition-colors"
          >
            <ChevronDown size={12} className={`transition-transform ${showPastGoals ? 'rotate-180' : ''}`} />
            Eerdere objectives ({pastGoals.length})
          </button>
          {showPastGoals && (
            <div className="flex items-stretch gap-2 overflow-x-auto pt-2">
              {pastGoals.map(goal => (
                <GoalChip key={goal.id} goal={goal} projects={projects} onClick={() => openEditGoal(goal)} />
              ))}
            </div>
          )}
        </div>
      )}

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex gap-4">
          <WeekProjectSidebar projects={projects} goals={activeGoals} onEditGoal={openEditGoal} />
          <div className="flex-1 grid grid-cols-7 gap-3 min-w-0">
            {days.map(date => {
              const key = format(date, 'yyyy-MM-dd')
              const historyPlan = getPlanForDate(date)
              const slotIds = weekSlots[key] ?? []
              return (
                <WeekDayColumn
                  key={key}
                  date={date}
                  projectIds={slotIds}
                  historyPlan={historyPlan}
                  projects={projects}
                  goals={goals}
                  onRemove={projectId => removeProjectFromSlot(key, projectId)}
                />
              )
            })}
          </div>
        </div>

        <DragOverlay>
          {activeProject && (
            <div className="px-2 py-1.5 rounded-[6px] border border-border bg-canvas text-[12px] font-medium text-charcoal shadow-md opacity-90">
              {activeProject.title}
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {goalFormOpen && <GoalForm goal={editingGoal} onClose={() => setGoalFormOpen(false)} />}
    </div>
  )
}
```

Note: this passes `goals={activeGoals}` to `WeekProjectSidebar` and `goals={goals}` to `WeekDayColumn` — both props don't exist on those components yet. That's expected; Tasks 8 and 9 add them. **This task alone will not compile** — that's fine, verify at the end of Task 9 instead (see Task 9's verify step). Do Tasks 7, 8, and 9 back-to-back before running a TypeScript check.

**Step 2: Commit**

```bash
git add src/components/week/WeekPlannerView.tsx
git commit -m "feat(goals): wire objectives strip and goal-form into WeekPlannerView"
```

(No verify step here — see note above. Proceed directly to Task 8.)

---

### Task 8: Regroup `WeekProjectSidebar` by goal

**Files:**
- Modify: `src/components/week/WeekProjectSidebar.tsx`

**Step 1: Replace the file**

Replaces the status-based grouping (Actief/Backlog) with goal-based grouping. Each goal section is a `useDroppable` zone (`id: goalHeader::<goalId>`, `data: { assignGoalId: goal.id }`) so `WeekPlannerView`'s `onDragEnd` (Task 7) can assign a dropped project to that goal. An "Unassigned" section (`data: { assignGoalId: null }`) is also droppable, so dragging a project there clears its `goalId`.

```typescript
import { useDraggable, useDroppable } from '@dnd-kit/core'
import type { Goal, Project } from '../../types'
import { getGoalCompletion } from '../../lib/goals'

interface Props {
  projects: Project[]
  goals: Goal[]           // active goals only — caller filters
  onEditGoal: (goal: Goal) => void
}

function SidebarCard({ project }: { project: Project }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `sidebar::${project.id}`,
    data: { projectId: project.id, fromDate: null },
  })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`px-2 py-1.5 rounded-[6px] border border-border bg-canvas text-[12px]
        font-medium text-charcoal cursor-grab active:cursor-grabbing select-none
        transition-opacity ${isDragging ? 'opacity-40' : 'hover:bg-border-light'}`}
    >
      {project.title}
    </div>
  )
}

function GoalSection({ goal, projects, onEditGoal }: {
  goal: Goal
  projects: Project[]
  onEditGoal: (goal: Goal) => void
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `goalHeader::${goal.id}`,
    data: { assignGoalId: goal.id },
  })
  const { done, total } = getGoalCompletion(goal, projects)

  return (
    <div className="flex flex-col gap-1">
      <button
        ref={setNodeRef}
        onClick={() => onEditGoal(goal)}
        className={`flex items-center gap-1.5 text-left rounded-[6px] px-1 py-0.5 -mx-1 transition-colors
          ${isOver ? 'bg-charcoal/5 ring-1 ring-charcoal/20' : 'hover:bg-border-light'}`}
      >
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: goal.color }} />
        <span className="text-[10px] uppercase tracking-[0.05em] text-stone/60 font-medium truncate">
          {goal.title}
        </span>
        <span className="text-[9px] text-stone/40 shrink-0 ml-auto">{done}/{total}</span>
      </button>
      {projects.map(p => <SidebarCard key={p.id} project={p} />)}
    </div>
  )
}

export function WeekProjectSidebar({ projects, goals, onEditGoal }: Props) {
  const workable = projects.filter(p => p.status !== 'done')
  const unassigned = workable.filter(
    p => !p.goalId || !goals.some(g => g.id === p.goalId)
  )

  const { setNodeRef: setUnassignedRef, isOver: isOverUnassigned } = useDroppable({
    id: 'goalHeader::unassigned',
    data: { assignGoalId: null },
  })

  return (
    <div className="flex flex-col gap-3 w-[180px] shrink-0">
      <div className="text-[11px] uppercase tracking-[0.06em] text-stone/50 font-medium">Projecten</div>

      {goals.map(goal => (
        <GoalSection
          key={goal.id}
          goal={goal}
          projects={workable.filter(p => p.goalId === goal.id)}
          onEditGoal={onEditGoal}
        />
      ))}

      <div className="flex flex-col gap-1">
        <div
          ref={setUnassignedRef}
          className={`text-[10px] uppercase tracking-[0.05em] text-stone/40 mb-0.5 rounded-[6px]
            px-1 py-0.5 -mx-1 transition-colors ${isOverUnassigned ? 'bg-charcoal/5 ring-1 ring-charcoal/20' : ''}`}
        >
          Unassigned
        </div>
        {unassigned.map(p => <SidebarCard key={p.id} project={p} />)}
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add src/components/week/WeekProjectSidebar.tsx
git commit -m "feat(goals): regroup week sidebar by goal, drag-to-assign"
```

(Still don't run the TS check yet — `WeekDayColumn` doesn't accept the `goals` prop passed to it in Task 7 until Task 9. Proceed directly.)

---

### Task 9: Goal-color indicator on the day-grid cards

**Files:**
- Modify: `src/components/week/WeekDayColumn.tsx`
- Modify: `src/components/week/WeekProjectCard.tsx`

**Step 1: Add `goals` prop and goal-color lookup to `WeekDayColumn`**

In `src/components/week/WeekDayColumn.tsx`, add `Goal` to the type-only import and add a `goals` prop:

```typescript
import { useDroppable } from '@dnd-kit/core'
import { format, isToday, isPast, startOfDay } from 'date-fns'
import { nl } from 'date-fns/locale'
import type { Project, DailyPlan, Goal } from '../../types'
import { WeekProjectCard } from './WeekProjectCard'

interface Props {
  date: Date
  projectIds: string[]
  historyPlan: DailyPlan | null
  projects: Project[]
  goals: Goal[]
  onRemove: (projectId: string) => void
}
```

Update the function signature to destructure `goals`:

```typescript
export function WeekDayColumn({ date, projectIds, historyPlan, projects, goals, onRemove }: Props) {
```

In the render loop (`displayProjects.map(...)`), pass the matching goal's color to each card:

```typescript
        {displayProjects.map(project => (
          <WeekProjectCard
            key={project.id}
            project={project}
            dateKey={dateKey}
            isReadOnly={!isEditable}
            onRemove={isEditable ? () => onRemove(project.id) : undefined}
            goalColor={goals.find(g => g.id === project.goalId)?.color}
          />
        ))}
```

**Step 2: Render the indicator in `WeekProjectCard`**

In `src/components/week/WeekProjectCard.tsx`, add the prop and render a small dot before the title:

```typescript
interface Props {
  project: Project
  dateKey: string
  isReadOnly?: boolean
  onRemove?: () => void
  goalColor?: string
}

export function WeekProjectCard({ project, dateKey, isReadOnly, onRemove, goalColor }: Props) {
```

Inside the returned `<div>`, right before `<span className="truncate">{project.title}</span>`:

```typescript
      {goalColor && (
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: goalColor }} />
      )}
      <span className="truncate">{project.title}</span>
```

**Step 3: Verify**

This is the first point where `WeekPlannerView`, `WeekProjectSidebar`, `WeekDayColumn`, and `WeekProjectCard` are all consistent — run the full check now:

```bash
npx tsc -b --noEmit
```
Expected: no errors.

Then start the dev server and check visually:
```bash
npm run dev
```
Open the app, go to the Week tab (still labeled "Week" until Task 10), create a goal via "+ Nieuw objective", assign a project to it by dragging a sidebar card onto the goal's header, then drag that project onto a future day. Confirm: the goal chip's progress updates, the sidebar shows the project under the goal section, and the day-grid card shows a small colored dot matching the goal's color.

**Step 4: Commit**

```bash
git add src/components/week/WeekDayColumn.tsx src/components/week/WeekProjectCard.tsx
git commit -m "feat(goals): show goal-color indicator on week day-grid cards"
```

---

### Task 10: Rename the nav tab to "Objectives"

**Files:**
- Modify: `src/App.tsx`

**Step 1: Change the button label**

Find the nav button that calls `setActiveView('week')` (currently around line 187-196) and change its label text from `Week` to `Objectives`. Leave the `activeView === 'week'` id and `onClick={() => setActiveView('week')}` unchanged — only the visible text changes:

```typescript
        <button
          onClick={() => setActiveView('week')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] text-[12px] font-medium tracking-[0.02em] transition-colors
            ${activeView === 'week'
              ? 'bg-charcoal text-[#FAF9F7]'
              : 'text-stone/60 hover:text-charcoal hover:bg-border-light'}`}
        >
          <CalendarDays size={13} />
          Objectives
        </button>
```

**Step 2: Verify**

```bash
npm run dev
```
Open the app, confirm the nav bar shows "Objectives" instead of "Week", and that clicking it still opens the same view.

**Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(goals): rename Week nav tab to Objectives"
```

---

### Task 11: `api/goal-review.ts` — AI SMART-review endpoint

**Files:**
- Create: `api/goal-review.ts`

**Step 1: Write the endpoint**

Follows the exact pattern of `api/done-reflection.ts` and `api/project-decisions.ts` (stateless POST, `gpt-4o`, JSON response format).

```typescript
import type { VercelRequest, VercelResponse } from '@vercel/node'
import OpenAI from 'openai'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: 'OPENAI_API_KEY not configured' })
    return
  }

  try {
    const {
      title, description, startDate, targetDate, targetDaysWorked,
      linkedProjectTitles, otherActiveGoalTitles, personalRules,
    } = req.body as {
      title: string
      description?: string
      startDate: string
      targetDate: string
      targetDaysWorked?: number
      linkedProjectTitles: string[]
      otherActiveGoalTitles: string[]
      personalRules: string[]
    }

    if (!title || !targetDate) {
      res.status(400).json({ error: 'title and targetDate are required' })
      return
    }

    const lines: string[] = [
      `Goal title: ${title}`,
      `Description: ${description || '(none provided)'}`,
      `Start date: ${startDate}`,
      `Target date: ${targetDate}`,
      `Target days worked: ${targetDaysWorked ?? '(none set)'}`,
      `Linked projects: ${linkedProjectTitles.length > 0 ? linkedProjectTitles.join(', ') : '(none linked yet)'}`,
      `Other active goals: ${otherActiveGoalTitles.length > 0 ? otherActiveGoalTitles.join(', ') : '(none)'}`,
      `User's personal rules: ${personalRules.length > 0 ? personalRules.join('; ') : '(none)'}`,
    ]

    const openai = new OpenAI({ apiKey })
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a sharp, direct business strategy reviewer. You evaluate a single goal against the SMART framework (Specific, Measurable, Achievable, Relevant, Time-bound).

You have no knowledge of this person's business beyond what's given to you. For "Relevant," judge whether the goal's own description explains what business outcome it drives — if it doesn't, say so plainly and ask for it, rather than assuming relevance or fabricating a business rationale you don't have.

Rules:
- Each of the five criteria gets a boolean "pass" and one concise sentence "note".
- If pass is true, the note briefly confirms why.
- If pass is false, the note says exactly what's missing and how to fix it — concrete, not generic ("add a number, e.g. '20 bookings'" not "make it more measurable").
- Specific: is this a concrete outcome, not a vague aspiration or a restated activity?
- Measurable: is there a number or clear threshold to know when it's hit?
- Achievable: given the target date and (if set) target days worked, is the pace realistic? Flag if the timeline looks too tight or suspiciously loose.
- Relevant: does the description explain the business impact? Does it overlap or conflict with the other active goals listed?
- Time-bound: it will always have a target date by construction — flag only if the date seems arbitrary or the description never references the deadline.
- Be brief. No preamble, no encouragement, no exclamation marks.

Return a JSON object with exactly these keys, each an object with "pass" (boolean) and "note" (string):
"specific", "measurable", "achievable", "relevant", "timeBound"`,
        },
        {
          role: 'user',
          content: lines.join('\n'),
        },
      ],
    })

    const content = completion.choices[0]?.message?.content
    if (!content) {
      res.status(500).json({ error: 'No response from model' })
      return
    }

    const parsed = JSON.parse(content)
    res.status(200).json({
      specific: parsed.specific ?? { pass: false, note: '' },
      measurable: parsed.measurable ?? { pass: false, note: '' },
      achievable: parsed.achievable ?? { pass: false, note: '' },
      relevant: parsed.relevant ?? { pass: false, note: '' },
      timeBound: parsed.timeBound ?? { pass: false, note: '' },
    })
  } catch (err) {
    console.error('Goal review error:', err)
    res.status(500).json({ error: 'Goal review failed' })
  }
}
```

**Step 2: Verify**

```bash
npm run dev
```
In another terminal, with the dev server running (the `devApiPlugin` proxies `/api/*` and loads `OPENAI_API_KEY` from `.env`):

```bash
curl -X POST http://localhost:5173/api/goal-review \
  -H "Content-Type: application/json" \
  -d '{"title":"Grow charter bookings","description":"","startDate":"2026-08-22","targetDate":"2026-11-01","linkedProjectTitles":[],"otherActiveGoalTitles":[],"personalRules":[]}'
```
Expected: HTTP 200 with a JSON body containing `specific`, `measurable`, `achievable`, `relevant`, `timeBound`, each `{ pass, note }`. With an empty description, expect `relevant.pass` to be `false` and its note to ask for the business-impact explanation.

**Step 3: Commit**

```bash
git add api/goal-review.ts
git commit -m "feat(goals): add AI SMART-review endpoint"
```

---

### Task 12: Wire the "Review objective" button into `GoalForm`

**Files:**
- Modify: `src/components/week/GoalForm.tsx`

**Step 1: Add review state and the fetch call**

Add these imports and store reads near the top of the component:

```typescript
import { useState } from 'react'
import { useStore } from '../../store'
import { GOAL_COLORS, type Goal } from '../../types'
import { isGoalActive } from '../../lib/goals'
```

Inside `GoalForm`, alongside the existing `useStore` calls, add:

```typescript
  const allGoals = useStore(s => s.goals)
  const projects = useStore(s => s.projects)
  const personalRules = useStore(s => s.personalRules)
```

Add review state next to the other `useState` calls:

```typescript
  const [review, setReview] = useState<GoalReviewResult | null>(null)
  const [reviewLoading, setReviewLoading] = useState(false)
```

Add this type above the component (outside it, near the top of the file):

```typescript
interface SmartCheck {
  pass: boolean
  note: string
}

interface GoalReviewResult {
  specific: SmartCheck
  measurable: SmartCheck
  achievable: SmartCheck
  relevant: SmartCheck
  timeBound: SmartCheck
}
```

Add the handler function inside the component, near `handleSave`:

```typescript
  async function handleReview() {
    setReviewLoading(true)
    setReview(null)
    try {
      const linkedProjectTitles = goal
        ? projects.filter(p => p.goalId === goal.id).map(p => p.title)
        : []
      const otherActiveGoalTitles = allGoals
        .filter(g => g.id !== goal?.id && isGoalActive(g))
        .map(g => g.title)

      const res = await fetch('/api/goal-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
          startDate,
          targetDate,
          targetDaysWorked: targetDaysWorked ? Number(targetDaysWorked) : undefined,
          linkedProjectTitles,
          otherActiveGoalTitles,
          personalRules,
        }),
      })

      if (!res.ok) {
        console.error('goal-review API error:', res.status)
        return
      }
      const data = await res.json()
      setReview(data)
    } catch (err) {
      console.error('goal-review failed:', err)
    } finally {
      setReviewLoading(false)
    }
  }
```

**Step 2: Add the button and checklist to the JSX**

Right after the color-picker `<div>` (the row of `GOAL_COLORS` buttons) and before the final `pt-2 border-t` actions row, add:

```typescript
        <div className="flex flex-col gap-2">
          <button
            onClick={handleReview}
            disabled={!canSave || reviewLoading}
            className="self-start px-3 py-1.5 text-[12px] rounded-[6px] border border-border text-stone/70
              hover:text-charcoal hover:border-stone/40 transition-colors disabled:opacity-40"
          >
            {reviewLoading ? 'Beoordelen…' : 'Review objective'}
          </button>

          {review && (
            <div className="flex flex-col gap-1.5 rounded-[8px] border border-border bg-border-light/40 p-3">
              {(
                [
                  ['specific', 'Specific'],
                  ['measurable', 'Measurable'],
                  ['achievable', 'Achievable'],
                  ['relevant', 'Relevant'],
                  ['timeBound', 'Time-bound'],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="flex gap-2 text-[11px]">
                  <span className={review[key].pass ? 'text-green' : 'text-red'}>
                    {review[key].pass ? '✓' : '✗'}
                  </span>
                  <span>
                    <span className="font-medium text-charcoal">{label}:</span>{' '}
                    <span className="text-stone/70">{review[key].note}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
```

**Step 3: Verify**

```bash
npx tsc -b --noEmit
```
Expected: no errors.

```bash
npm run dev
```
Open the app, go to Objectives, click "+ Nieuw objective", fill in a title and target date, click "Review objective". Confirm a loading state shows briefly, then a 5-line checklist appears. Try it with and without filling in the description — confirm the "Relevant" line's note changes accordingly.

**Step 4: Commit**

```bash
git add src/components/week/GoalForm.tsx
git commit -m "feat(goals): wire AI SMART-review into GoalForm"
```

---

### Task 13: Full manual walkthrough

**Files:** none — verification only.

**Step 1: Run the golden path**

```bash
npm run dev
```

1. Open the app, click "Objectives" in the nav.
2. Click "+ Nieuw objective". Create a goal: title, a description explaining the business impact, start date = today, target date = ~4 weeks out, target days worked = 10, pick a color. Save.
3. Confirm the goal chip appears in the strip with `0/0 projecten` and an empty progress bar.
4. Drag a project from the "Unassigned" sidebar section onto the new goal's header. Confirm it moves into that goal's section and the chip updates to `0/1 projecten`.
5. Drag that same project (now under the goal, still in the sidebar) onto a day a few days out in the grid. Confirm the card appears on that day with a small dot in the goal's color.
6. Open the project via its kanban card elsewhere, mark a day worked (however `recordDayWorked` is triggered in the existing UI), come back to Objectives — confirm the goal chip's "dagen gewerkt" count increased.
7. Mark the project `done` (via its status). Confirm the goal chip now shows `1/1 projecten` and a full progress bar.
8. Drag the project onto "Unassigned" in the sidebar. Confirm it leaves the goal section and the goal chip drops back to `0/0`.
9. Click the goal chip to reopen `GoalForm`, click "Review objective", confirm the SMART checklist renders.
10. Create a second goal with a target date in the past (e.g. yesterday). Confirm it does **not** appear in the main strip, but does appear under the collapsed "Eerdere objectives" toggle.
11. Delete a goal via the form's "Verwijder" button. Confirm any project that was linked to it moves to "Unassigned".

**Step 2: Run the full build**

```bash
npm run build
npm run lint
```
Expected: both exit 0.

**Step 3: Commit** (only if the walkthrough surfaced fixes — otherwise nothing to commit)

If any step above required a code fix, commit it with a message describing what was wrong, e.g.:
```bash
git add -A
git commit -m "fix(goals): <describe the bug found during walkthrough>"
```
