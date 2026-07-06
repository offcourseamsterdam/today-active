# Daglog + Weekplanner Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `planHistory` (per-day archive + auto-rollover) and `weekSlots` (per-day project assignments) with a new Week Kanban view.

**Architecture:** Two new store fields (`planHistory: Record<string, DailyPlan>` and `weekSlots: Record<string, string[]>`) are added to the Zustand store and Firestore sync. `refreshDailyPlan()` is extended to archive stale plans and roll over incomplete tasks. A new `WeekPlannerView` component renders a Mon–Sun Kanban board driven by `weekSlots` + `planHistory`.

**Tech Stack:** React 19, TypeScript strict, Zustand persist, Firestore (`users/{uid}` doc), @dnd-kit/core + @dnd-kit/sortable (already in project), date-fns (already in project), Tailwind v4.

---

## Task 1: Add types and store state

**Files:**
- Modify: `src/store/types.ts`
- Modify: `src/store/index.ts`

**Step 1: Add new fields to `VandaagState` in `src/store/types.ts`**

After the `tomorrowPlan: DailyPlan | null` line (line 36), add:

```typescript
  planHistory: Record<string, DailyPlan>   // YYYY-MM-DD → archived plan
  weekSlots: Record<string, string[]>       // YYYY-MM-DD → projectIds
```

After the daily plan actions section in `VandaagState`, add these action signatures (around line 230):

```typescript
  // Plan history + rollover
  archivePlan: (date: string, plan: DailyPlan) => void
  getPlanForDate: (date: string) => DailyPlan | null

  // Week slots
  setWeekSlot: (date: string, projectIds: string[]) => void
  addProjectToSlot: (date: string, projectId: string) => void
  removeProjectFromSlot: (date: string, projectId: string) => void
```

**Step 2: Initialize state in `src/store/index.ts`**

After `tomorrowPlan: null,` (line 79), add:

```typescript
      planHistory: {},
      weekSlots: {},
```

**Step 3: Add `planHistory` and `weekSlots` to the `partialize` list in `src/store/index.ts`**

In the `partialize` callback (around line 222), after `tomorrowPlan: state.tomorrowPlan,` add:

```typescript
        planHistory: state.planHistory,
        weekSlots: state.weekSlots,
```

**Step 4: Add `planHistory` and `weekSlots` to the `merge` function**

The existing `merge` callback just spreads `p` over `current` — the spread already handles the new fields. No extra change needed here.

**Step 5: Commit**

```bash
git add src/store/types.ts src/store/index.ts
git commit -m "feat(daglog): add planHistory + weekSlots state to store"
```

---

## Task 2: Extend `plansSlice.ts` — archive + rollover + week slot actions

**Files:**
- Modify: `src/store/plansSlice.ts`

**Step 1: Add rollover helper at the top of the file**

Below the imports, add:

```typescript
function rolloverTasks(
  plan: DailyPlan,
  allTasks: readonly { id: string; status: string }[],
): { shortTasks: string[]; maintenanceTasks: string[]; shortProjects: string[]; maintenanceProjects: string[] } {
  const done = new Set(plan.completedItemIds ?? [])
  const taskDone = (id: string) => done.has(id) || allTasks.find(t => t.id === id)?.status === 'done'

  return {
    shortTasks: plan.shortTasks.filter(id => !taskDone(id)),
    maintenanceTasks: plan.maintenanceTasks.filter(id => !taskDone(id)),
    shortProjects: plan.shortProjects.filter(id => !done.has(id)),
    maintenanceProjects: plan.maintenanceProjects.filter(id => !done.has(id)),
  }
}
```

**Step 2: Replace the `refreshDailyPlan` action** (lines 186–208) with the new version that archives and rolls over:

```typescript
    refreshDailyPlan: () => {
      const state = get()
      const today = getTodayString()
      const allTasks = [...state.orphanTasks, ...state.recurringTasks]

      // 1. Try to promote tomorrow's plan first
      if (state.tomorrowPlan && state.tomorrowPlan.date === today) {
        // Archive yesterday's stale plan before promoting tomorrow
        if (state.dailyPlan && state.dailyPlan.date !== today) {
          set({
            planHistory: { ...state.planHistory, [state.dailyPlan.date]: state.dailyPlan },
          })
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

        const todayPlan = hasCarry ? {
          date: today,
          deepBlock: { projectId: '' },
          shortTasks: carried.shortTasks,
          shortProjects: carried.shortProjects,
          maintenanceTasks: carried.maintenanceTasks,
          maintenanceProjects: carried.maintenanceProjects,
          meetings: [],
          isComplete: false,
        } satisfies DailyPlan : null

        set({
          planHistory: { ...state.planHistory, [stale.date]: stale },
          dailyPlan: todayPlan,
        })
      }
    },
```

**Step 3: Add the new actions at the bottom of the returned object** (before the closing `}` of the return):

```typescript
    // Plan history
    archivePlan: (date: string, plan: DailyPlan) => {
      set(s => ({ planHistory: { ...s.planHistory, [date]: plan } }))
    },

    getPlanForDate: (date: string): DailyPlan | null => {
      const state = get()
      if (state.dailyPlan?.date === date) return state.dailyPlan
      if (state.tomorrowPlan?.date === date) return state.tomorrowPlan
      return state.planHistory[date] ?? null
    },

    // Week slots
    setWeekSlot: (date: string, projectIds: string[]) => {
      set(s => ({ weekSlots: { ...s.weekSlots, [date]: projectIds } }))
    },

    addProjectToSlot: (date: string, projectId: string) => {
      set(s => {
        const existing = s.weekSlots[date] ?? []
        if (existing.includes(projectId)) return {}
        return { weekSlots: { ...s.weekSlots, [date]: [...existing, projectId] } }
      })
    },

    removeProjectFromSlot: (date: string, projectId: string) => {
      set(s => {
        const existing = s.weekSlots[date] ?? []
        return { weekSlots: { ...s.weekSlots, [date]: existing.filter(id => id !== projectId) } }
      })
    },
```

**Step 4: Verify the build compiles**

```bash
npm run build 2>&1 | head -40
```

Expected: no TypeScript errors.

**Step 5: Commit**

```bash
git add src/store/plansSlice.ts
git commit -m "feat(daglog): archive + rollover in refreshDailyPlan, add week slot actions"
```

---

## Task 3: Add `planHistory` + `weekSlots` to Firestore sync

**Files:**
- Modify: `src/lib/firestore.ts`
- Modify: `src/hooks/useFirestoreSync.ts`

**Step 1: Extend `SyncData` in `src/lib/firestore.ts`**

Add two fields to the interface:

```typescript
export interface SyncData {
  projects: Project[]
  orphanTasks: Task[]
  recurringTasks: Task[]
  meetings: Meeting[]
  recurringMeetings: Meeting[]
  settings: Settings
  dailyPlan: DailyPlan | null
  tomorrowPlan: DailyPlan | null
  planHistory: Record<string, DailyPlan>   // NEW
  weekSlots: Record<string, string[]>      // NEW
  personalRules: string[]
  writeAway: WriteAwayEntry[]
  syncedAt: string
}
```

**Step 2: Add the new fields to `extractSyncData` in `src/hooks/useFirestoreSync.ts`**

After `tomorrowPlan: s.tomorrowPlan,` add:

```typescript
    planHistory: s.planHistory,
    weekSlots: s.weekSlots,
```

**Step 3: Apply remote data when cloud is newer — extend the `useStore.setState` call** (around line 70 in `useFirestoreSync.ts`):

After `tomorrowPlan: remote.tomorrowPlan ?? null,` add:

```typescript
              planHistory: remote.planHistory ?? {},
              weekSlots: remote.weekSlots ?? {},
```

**Step 4: Verify the build compiles**

```bash
npm run build 2>&1 | head -40
```

**Step 5: Commit**

```bash
git add src/lib/firestore.ts src/hooks/useFirestoreSync.ts
git commit -m "feat(daglog): sync planHistory + weekSlots to Firestore"
```

---

## Task 4: Add `'week'` to `ActiveView` and nav tab

**Files:**
- Modify: `src/store/types.ts` (ActiveView type)
- Modify: `src/App.tsx` (nav button + render branch)

**Step 1: Add `'week'` to the `ActiveView` union in `src/store/types.ts`**

Change line 25:

```typescript
export type ActiveView = 'vandaag' | 'kanban' | 'planning' | 'philosophy' | 'meetings' | 'review' | 'write-away' | 'week'
```

**Step 2: Add a nav button in `src/App.tsx`**

After the "Review" nav button block (around line 191), add:

```tsx
        <button
          onClick={() => setActiveView('week')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] text-[12px] font-medium tracking-[0.02em] transition-colors
            ${activeView === 'week'
              ? 'bg-charcoal text-[#FAF9F7]'
              : 'text-stone/60 hover:text-charcoal hover:bg-border-light'}`}
        >
          Week
        </button>
```

**Step 3: Add the render branch in `src/App.tsx`**

The lazy import for `WeekPlannerView` (add with other lazy imports, around line 26):

```tsx
const WeekPlannerView = lazy(() => import('./components/week/WeekPlannerView').then(m => ({ default: m.WeekPlannerView })))
```

In the main content block, add a branch before the `write-away` branch:

```tsx
        ) : activeView === 'week' ? (
          <Suspense fallback={null}><WeekPlannerView /></Suspense>
```

**Step 4: Commit**

```bash
git add src/store/types.ts src/App.tsx
git commit -m "feat(week): add 'week' nav tab and ActiveView"
```

---

## Task 5: Build `WeekPlannerView` component

**Files:**
- Create: `src/components/week/WeekPlannerView.tsx`
- Create: `src/components/week/WeekDayColumn.tsx`
- Create: `src/components/week/WeekProjectCard.tsx`
- Create: `src/components/week/WeekProjectSidebar.tsx`

### Subcomponent: `WeekProjectCard`

**Step 1: Create `src/components/week/WeekProjectCard.tsx`**

```tsx
import { useDraggable } from '@dnd-kit/core'
import type { Project } from '../../types'

interface Props {
  project: Project
  dateKey: string  // which column this card is in (needed for remove)
  isReadOnly?: boolean
  onRemove?: () => void
}

const STATUS_COLORS: Record<string, string> = {
  in_progress: 'bg-amber-100 border-amber-200 text-amber-900',
  waiting: 'bg-blue-50 border-blue-200 text-blue-900',
  backlog: 'bg-stone-100 border-stone-200 text-stone-700',
}

export function WeekProjectCard({ project, dateKey, isReadOnly, onRemove }: Props) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${dateKey}::${project.id}`,
    data: { projectId: project.id, fromDate: dateKey },
    disabled: isReadOnly,
  })

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`
        flex items-center justify-between gap-1 px-2 py-1.5 rounded-[6px] border text-[12px] font-medium
        select-none cursor-grab active:cursor-grabbing transition-opacity
        ${STATUS_COLORS[project.status] ?? STATUS_COLORS.backlog}
        ${isDragging ? 'opacity-40' : ''}
        ${isReadOnly ? 'cursor-default' : ''}
      `}
    >
      <span className="truncate">{project.title}</span>
      {!isReadOnly && onRemove && (
        <button
          onClick={e => { e.stopPropagation(); onRemove() }}
          className="shrink-0 text-current opacity-40 hover:opacity-80 leading-none text-[14px]"
          aria-label="Verwijder"
        >×</button>
      )}
    </div>
  )
}
```

### Subcomponent: `WeekDayColumn`

**Step 2: Create `src/components/week/WeekDayColumn.tsx`**

```tsx
import { useDroppable } from '@dnd-kit/core'
import { format, isToday, isPast, startOfDay } from 'date-fns'
import { nl } from 'date-fns/locale'
import type { Project, DailyPlan } from '../../types'
import { WeekProjectCard } from './WeekProjectCard'

interface Props {
  date: Date
  projectIds: string[]          // from weekSlots (editable future days)
  historyPlan: DailyPlan | null // from planHistory / dailyPlan (read-only past/today)
  projects: Project[]
  onRemove: (projectId: string) => void
}

function getProjectsFromPlan(plan: DailyPlan, projects: Project[]): Project[] {
  const ids = new Set([
    ...(plan.shortProjects ?? []),
    ...(plan.maintenanceProjects ?? []),
    plan.deepBlock?.projectId,
  ].filter(Boolean) as string[])
  return projects.filter(p => ids.has(p.id))
}

export function WeekDayColumn({ date, projectIds, historyPlan, projects, onRemove }: Props) {
  const dateKey = format(date, 'yyyy-MM-dd')
  const isPastDay = isPast(startOfDay(date)) && !isToday(date)
  const isEditable = !isPastDay

  const { setNodeRef, isOver } = useDroppable({
    id: `col::${dateKey}`,
    data: { toDate: dateKey },
    disabled: !isEditable,
  })

  // Past/today: show plan data; future: show weekSlots
  const displayProjects = historyPlan
    ? getProjectsFromPlan(historyPlan, projects)
    : projects.filter(p => projectIds.includes(p.id))

  const dayLabel = format(date, 'EEE', { locale: nl })
  const dateLabel = format(date, 'd MMM', { locale: nl })

  return (
    <div className="flex flex-col gap-2 min-w-0">
      {/* Header */}
      <div className={`text-center pb-2 border-b border-border ${isToday(date) ? 'text-charcoal' : 'text-stone/60'}`}>
        <div className={`text-[11px] uppercase tracking-[0.06em] font-medium ${isToday(date) ? 'text-charcoal' : ''}`}>
          {dayLabel}
        </div>
        <div className={`text-[13px] mt-0.5 ${isToday(date) ? 'font-semibold' : ''}`}>
          {dateLabel}
        </div>
        {isToday(date) && (
          <div className="mt-1 w-1.5 h-1.5 rounded-full bg-charcoal mx-auto" />
        )}
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className={`
          flex flex-col gap-1.5 min-h-[120px] rounded-[8px] p-1.5 transition-colors
          ${isOver ? 'bg-charcoal/5 ring-1 ring-charcoal/20' : ''}
          ${isPastDay ? 'opacity-60' : ''}
        `}
      >
        {displayProjects.map(project => (
          <WeekProjectCard
            key={project.id}
            project={project}
            dateKey={dateKey}
            isReadOnly={!isEditable}
            onRemove={isEditable ? () => onRemove(project.id) : undefined}
          />
        ))}
        {displayProjects.length === 0 && isEditable && (
          <div className="text-[11px] text-stone/30 text-center pt-4 italic">
            sleep project hierheen
          </div>
        )}
      </div>
    </div>
  )
}
```

### Subcomponent: `WeekProjectSidebar`

**Step 3: Create `src/components/week/WeekProjectSidebar.tsx`**

```tsx
import { useDraggable } from '@dnd-kit/core'
import type { Project } from '../../types'

interface Props {
  projects: Project[]
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

export function WeekProjectSidebar({ projects }: Props) {
  const active = projects.filter(p => p.status === 'in_progress' || p.status === 'waiting')
  const backlog = projects.filter(p => p.status === 'backlog')

  return (
    <div className="flex flex-col gap-3 w-[160px] shrink-0">
      <div className="text-[11px] uppercase tracking-[0.06em] text-stone/50 font-medium">Projecten</div>
      {active.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-[10px] uppercase tracking-[0.05em] text-stone/40 mb-0.5">Actief</div>
          {active.map(p => <SidebarCard key={p.id} project={p} />)}
        </div>
      )}
      {backlog.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-[10px] uppercase tracking-[0.05em] text-stone/40 mb-0.5">Backlog</div>
          {backlog.map(p => <SidebarCard key={p.id} project={p} />)}
        </div>
      )}
    </div>
  )
}
```

### Main view: `WeekPlannerView`

**Step 4: Create `src/components/week/WeekPlannerView.tsx`**

```tsx
import { useState, useCallback } from 'react'
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { startOfWeek, addDays, format } from 'date-fns'
import { nl } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useStore } from '../../store'
import { WeekDayColumn } from './WeekDayColumn'
import { WeekProjectSidebar } from './WeekProjectSidebar'

export function WeekPlannerView() {
  const projects = useStore(s => s.projects)
  const weekSlots = useStore(s => s.weekSlots)
  const planHistory = useStore(s => s.planHistory)
  const dailyPlan = useStore(s => s.dailyPlan)
  const tomorrowPlan = useStore(s => s.tomorrowPlan)
  const addProjectToSlot = useStore(s => s.addProjectToSlot)
  const removeProjectFromSlot = useStore(s => s.removeProjectFromSlot)
  const setWeekSlot = useStore(s => s.setWeekSlot)

  const [weekOffset, setWeekOffset] = useState(0) // 0 = current week, -1 = last week, etc.
  const [activeId, setActiveId] = useState<string | null>(null)

  const weekStart = startOfWeek(
    addDays(new Date(), weekOffset * 7),
    { weekStartsOn: 1 } // Monday
  )

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

    const toDate = over.data.current?.toDate as string | undefined
    if (!toDate) return

    const projectId = active.data.current?.projectId as string
    const fromDate = active.data.current?.fromDate as string | null

    // Remove from source column if came from a slot (not sidebar)
    if (fromDate) {
      const current = weekSlots[fromDate] ?? []
      setWeekSlot(fromDate, current.filter(id => id !== projectId))
    }

    // Add to target column
    addProjectToSlot(toDate, projectId)
  }

  // Find the active project for the drag overlay
  const activeProjectId = activeId
    ? (activeId.startsWith('sidebar::')
        ? activeId.replace('sidebar::', '')
        : activeId.split('::')[1])
    : null
  const activeProject = activeProjectId ? projects.find(p => p.id === activeProjectId) : null

  return (
    <div className="max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-serif text-[20px] font-normal text-charcoal tracking-[-0.01em]">
            Weekplanner
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

      {/* Board */}
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex gap-4">
          {/* Sidebar */}
          <WeekProjectSidebar projects={projects} />

          {/* Columns */}
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
                  onRemove={projectId => removeProjectFromSlot(key, projectId)}
                />
              )
            })}
          </div>
        </div>

        {/* Drag overlay */}
        <DragOverlay>
          {activeProject && (
            <div className="px-2 py-1.5 rounded-[6px] border border-border bg-canvas text-[12px] font-medium text-charcoal shadow-md opacity-90">
              {activeProject.title}
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
```

**Step 5: Verify the build compiles**

```bash
npm run build 2>&1 | head -60
```

Expected: no TypeScript errors.

**Step 6: Commit**

```bash
git add src/components/week/
git commit -m "feat(week): WeekPlannerView, WeekDayColumn, WeekProjectCard, WeekProjectSidebar"
```

---

## Task 6: Wire `'week'` into `App.tsx` render branch

**Files:**
- Modify: `src/App.tsx`

In `src/App.tsx`, the nav button and lazy import were added in Task 4. Now add the render branch.

**Step 1: Verify the lazy import line exists** (from Task 4):

```tsx
const WeekPlannerView = lazy(() => import('./components/week/WeekPlannerView').then(m => ({ default: m.WeekPlannerView })))
```

**Step 2: Verify the render branch exists** (from Task 4) — it should already be in the conditional chain:

```tsx
        ) : activeView === 'week' ? (
          <Suspense fallback={null}><WeekPlannerView /></Suspense>
```

If it wasn't added yet, add it before the `write-away` branch.

**Step 3: Run the dev server and smoke-test**

```bash
npm run dev
```

- Open `http://localhost:5173`
- Click "Week" in the nav
- Verify the week board renders with 7 columns
- Verify sidebar shows projects
- Drag a project from sidebar to a future column
- Verify it appears and persists after reload (via localStorage)
- Navigate to previous week: verify columns show read-only past data

**Step 4: Commit if changes were needed**

```bash
git add src/App.tsx
git commit -m "feat(week): wire WeekPlannerView into App render branch"
```

---

## Task 7: Smoke-test rollover logic manually

**Step 1: Open dev console and simulate a stale plan**

In `http://localhost:5173` dev console:

```javascript
// Inject a stale plan (yesterday)
const yesterday = new Date()
yesterday.setDate(yesterday.getDate() - 1)
const yStr = yesterday.toISOString().split('T')[0]

// Get the store and inject a fake stale plan
const store = window.__vandaagStore // won't work in prod build
// Instead: use the app's localStorage directly
const raw = JSON.parse(localStorage.getItem('vandaag-storage'))
const state = raw.state
state.dailyPlan = {
  date: yStr,
  deepBlock: { projectId: '' },
  shortTasks: [], // add real task IDs here if available
  shortProjects: [],
  maintenanceTasks: [],
  maintenanceProjects: [],
  meetings: [],
  completedItemIds: [],
  isComplete: false,
}
raw.state = state
localStorage.setItem('vandaag-storage', JSON.stringify(raw))
location.reload()
```

**Step 2: After reload, verify:**

- The stale plan is now in `planHistory` (check localStorage `vandaag-storage` → `state.planHistory`)
- `dailyPlan` is either `null` (no carry items) or has the carried tasks

**Step 3: Commit any bugfixes found during testing**

---

## Task 8: Final cleanup + PR

**Step 1: Run full build + lint**

```bash
npm run build && npm run lint
```

Expected: 0 errors, 0 warnings (fix any that appear).

**Step 2: Final commit**

```bash
git add -A
git commit -m "chore: lint fixes after daglog + weekplanner"
```

**Step 3: Push the branch**

```bash
git push -u origin claude/elastic-greider-88ba04
```
