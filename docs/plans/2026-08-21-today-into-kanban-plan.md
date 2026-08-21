# Today-into-Kanban Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the standalone Today view and move its functionality (today's focus list, tiers, planning) into the Kanban board as a new Today column plus a three-dot card menu.

**Architecture:** Add a `pinnedItemIds` field and two atomic today-plan actions (`addToTodayPlan`/`removeFromTodayPlan`) to the existing `DailyPlan` store slice; build a self-contained `CardMenu` (Mantine `Menu`) that reads/writes the store directly; build a `TodayColumn` that reuses the existing tier-grouped, sortable-list rendering (`SortableVandaagItem`) but lives inside `KanbanBoard`'s single `DndContext` instead of its own; then retire `VandaagView`/`PlanningModal` and the old nav tabs once the board fully replaces them.

**Tech Stack:** React 19, TypeScript strict, Zustand, `@dnd-kit/core` + `@dnd-kit/sortable`, Mantine `@mantine/core` (Menu — newly adopted), Tailwind v4.

**Note on verification steps:** This repo has no test runner (`npm run lint` and `tsc -b` via `npm run build` are the only automated checks — confirmed via `package.json`, no vitest/jest config or `*.test.*` files exist). Per this project's own `CLAUDE.md` ("For UI or frontend changes, start the dev server and use the feature in a browser before reporting the task as complete"), each task below replaces the usual "write failing test" TDD steps with: implement → typecheck → manual browser verification via the dev server. Do not introduce a test framework as part of this plan — out of scope.

---

## Part A — Data model: pinning + atomic today-plan actions

### Task 1: Add `pinnedItemIds` to `DailyPlan`

**Files:**
- Modify: `src/types/index.ts:196` (inside `DailyPlan` interface, next to `completedItemIds`)
- Modify: `src/store/helpers.ts:20-48` (`ensurePlan`)

**Step 1: Add the field**

In `src/types/index.ts`, in the `DailyPlan` interface, right after line 196 (`completedItemIds?: string[]  // plan item IDs marked "done for the day" (visual only)`), add:

```ts
  pinnedItemIds?: string[]    // plan item IDs that survive the nightly rollover instead of clearing
```

**Step 2: Default it when reconciling an existing plan**

In `src/store/helpers.ts`, in `ensurePlan` (the `existing && existing.date === date` branch, lines 26-34), add `pinnedItemIds: existing.pinnedItemIds ?? [],` alongside the other `?? []` defaults:

```ts
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
```

**Step 3: Typecheck**

Run: `npm run build`
Expected: no new TypeScript errors (this is an additive optional field, nothing else references it yet).

**Step 4: Commit**

```bash
git add src/types/index.ts src/store/helpers.ts
git commit -m "feat(daily-plan): add pinnedItemIds field to DailyPlan"
```

---

### Task 2: Add `togglePlanItemPinned` action

**Files:**
- Modify: `src/store/plansSlice.ts` (add near `togglePlanItemCompletion`, line 170-183)
- Modify: `src/store/types.ts:65` (add to `VandaagState` interface, next to `togglePlanItemCompletion`)

**Step 1: Add the action**

In `src/store/plansSlice.ts`, immediately after `togglePlanItemCompletion` (ends line 183), add:

```ts
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
```

**Step 2: Register in the store type and the slice's return object**

In `src/store/types.ts:65`, change:
```ts
  // Plan item completion
  togglePlanItemCompletion: (itemId: string) => void
```
to:
```ts
  // Plan item completion / pinning
  togglePlanItemCompletion: (itemId: string) => void
  togglePlanItemPinned: (itemId: string) => void
```

The new action is already part of the object literal returned by `makeDailyPlanActions` (Task 2 Step 1 added it inline), so no separate export wiring is needed — confirm `src/store/index.ts` spreads `makeDailyPlanActions(set, get)` into the store (it already does for `togglePlanItemCompletion`, same mechanism applies).

**Step 3: Typecheck**

Run: `npm run build`
Expected: passes (new action matches the interface addition).

**Step 4: Commit**

```bash
git add src/store/plansSlice.ts src/store/types.ts
git commit -m "feat(daily-plan): add togglePlanItemPinned action"
```

---

### Task 3: Add atomic `addToTodayPlan` / `removeFromTodayPlan` actions

**Why:** Existing per-tier actions (`addShortProject`, `addMaintenanceTask`, etc.) only touch the per-tier ID arrays, not `itemOrder`. `itemOrder` is what `DailyPlanList`/the new `TodayColumn` actually render from, and once it's been set once (e.g. by the planning wizard) it no longer self-heals from the tier arrays. Any UI that adds/removes a single item to today's plan (the new `CardMenu`, the new drag-into-Today handler) must keep `itemOrder` in sync in the same atomic update, or the item won't visually appear/disappear. These two actions are the one correct place that does both.

**Files:**
- Modify: `src/store/plansSlice.ts` (add near the top, using `deriveItemOrder`/`deriveBlockOrder` from `src/lib/planOrder.ts`)
- Modify: `src/store/types.ts` (add to `VandaagState`)

**Step 1: Import the derive helpers**

In `src/store/plansSlice.ts`, update the import on line 4:
```ts
import { ensureTodayPlan, ensureTomorrowPlan, getTodayString, makePlanActions } from './helpers'
```
to:
```ts
import { ensureTodayPlan, ensureTomorrowPlan, getTodayString, makePlanActions } from './helpers'
import { deriveItemOrder, deriveBlockOrder } from '../lib/planOrder'
```

**Step 2: Add the actions**

Add inside the returned object of `makeDailyPlanActions`, right after `addQuickMaintenanceTask` (after line 74):

```ts
    addToTodayPlan: (id: string, type: PlanItem['type'], tier: 'deep' | 'short' | 'maintenance') => {
      const state = get()
      const plan = ensureTodayPlan(state)
      const order = plan.itemOrder ?? deriveItemOrder(plan)
      if (order.some(i => i.id === id)) return

      let updated: DailyPlan = plan
      if (tier === 'deep' && type === 'project') {
        updated = { ...updated, deepBlock: { projectId: id } }
      } else if (tier === 'short') {
        updated = type === 'project'
          ? { ...updated, shortProjects: [...updated.shortProjects, id] }
          : { ...updated, shortTasks: [...updated.shortTasks, id] }
      } else if (tier === 'maintenance') {
        updated = type === 'project'
          ? { ...updated, maintenanceProjects: [...updated.maintenanceProjects, id] }
          : { ...updated, maintenanceTasks: [...updated.maintenanceTasks, id] }
      }

      const newOrder = [...order, { id, type, tier }]
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
```

**Step 3: Register in `VandaagState`**

In `src/store/types.ts`, after `addQuickMaintenanceTask: (title: string) => string` (line 201), add:

```ts
  addToTodayPlan: (id: string, type: PlanItem['type'], tier: 'deep' | 'short' | 'maintenance') => void
  removeFromTodayPlan: (id: string) => void
  reorderTodayItems: (newOrder: PlanItem[]) => void
```

**Step 4: Typecheck**

Run: `npm run build`
Expected: passes.

**Step 5: Manual verification**

Run: `npm run dev`, open the app, open the browser devtools console, and run:
```js
useStore.getState().addToTodayPlan('test-id', 'task', 'short')
useStore.getState().dailyPlan.itemOrder
```
Expected: the returned array includes `{ id: 'test-id', type: 'task', tier: 'short' }`, and `useStore.getState().dailyPlan.shortTasks` includes `'test-id'`. Then run `useStore.getState().removeFromTodayPlan('test-id')` and confirm both are gone. (`useStore` needs to be reachable from the console — if it isn't already exposed on `window`, temporarily add `// @ts-expect-error debug` `window.useStore = useStore` at the bottom of `src/store/index.ts`, verify, then remove it before committing.)

**Step 6: Commit**

```bash
git add src/store/plansSlice.ts src/store/types.ts
git commit -m "feat(daily-plan): add atomic addToTodayPlan/removeFromTodayPlan/reorderTodayItems actions"
```

---

### Task 4: Carry pinned items forward through the nightly rollover

**Files:**
- Modify: `src/store/plansSlice.ts:6-19` (`rolloverTasks`) and `:224-247` (`refreshDailyPlan`'s rollover branch)

**Step 1: Update `rolloverTasks` to respect pins**

Replace the whole `rolloverTasks` function (lines 6-19) with:

```ts
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
```

(Pinned items are kept regardless of done/completed status — pinning wins. A pinned deep-block project is carried forward as tomorrow's deep block too, overriding the normal "deep resets daily" behavior.)

**Step 2: Update the rollover branch in `refreshDailyPlan`**

In `refreshDailyPlan` (around line 224-247), replace:

```ts
      // 3. Archive + rollover stale daily plan
      if (state.dailyPlan && state.dailyPlan.date !== today) {
        const stale = state.dailyPlan
        const carried = rolloverTasks(stale, allTasks)
        const hasCarry = carried.shortTasks.length > 0
          || carried.maintenanceTasks.length > 0
          || carried.shortProjects.length > 0
          || carried.maintenanceProjects.length > 0

        const todayPlan: DailyPlan | null = hasCarry ? {
          date: today,
          deepBlock: { projectId: '' },
          shortTasks: carried.shortTasks,
          shortProjects: carried.shortProjects,
          maintenanceTasks: carried.maintenanceTasks,
          maintenanceProjects: carried.maintenanceProjects,
          meetings: [],
          isComplete: false,
        } : null

        set({
          planHistory: { ...state.planHistory, [stale.date]: stale },
          dailyPlan: todayPlan,
        })
      }
```

with:

```ts
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
```

Note `completedItemIds` and `itemOrder` are intentionally omitted from the new `todayPlan` — completion resets each day (a pinned item shows as not-done tomorrow), and `itemOrder` is rebuilt on demand via `deriveItemOrder` (unaffected by pinning, since pin data now lives in `pinnedItemIds`, not on the `PlanItem`).

**Step 3: Typecheck**

Run: `npm run build`
Expected: passes.

**Step 4: Manual verification**

In the dev server console: set `dailyPlan.date` to yesterday and `pinnedItemIds` to include a task/project id (e.g. via `useStore.setState(s => ({ dailyPlan: { ...s.dailyPlan, date: '2020-01-01', pinnedItemIds: [someTaskId] } }))`), then call `useStore.getState().refreshDailyPlan()` and confirm the new `dailyPlan.date` is today and `someTaskId` is present in the relevant tier array and `pinnedItemIds`.

**Step 5: Commit**

```bash
git add src/store/plansSlice.ts
git commit -m "feat(daily-plan): carry pinned items through the nightly rollover"
```

---

## Part B — Shared `CardMenu` (the three-dot menu)

### Task 5: Install and verify Mantine's `Menu` renders

**Files:**
- Create: `src/components/kanban/CardMenu.tsx` (skeleton only in this task)

**Step 1: Confirm Mantine provider setup**

Mantine components need `MantineProvider` somewhere in the tree to pick up CSS variables. Search for it:

Run: `grep -rn "MantineProvider" src`

If it's not found (likely, since the research found zero `@mantine/core` imports anywhere), Mantine's default theme CSS also needs importing. Add both in `src/main.tsx` (read the file first to see the current provider tree):
```ts
import '@mantine/core/styles.css'
import { MantineProvider } from '@mantine/core'
```
and wrap the app's root render with `<MantineProvider>...</MantineProvider>`.

**Step 2: Skeleton `CardMenu`**

```tsx
import { Menu } from '@mantine/core'
import { MoreHorizontal } from 'lucide-react'

interface CardMenuProps {
  id: string
  type: 'project' | 'task'
}

export function CardMenu({ id, type }: CardMenuProps) {
  return (
    <Menu shadow="md" width={200} position="bottom-end">
      <Menu.Target>
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          className="opacity-0 group-hover:opacity-50 hover:!opacity-100 text-stone transition-all"
        >
          <MoreHorizontal size={14} />
        </button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item disabled>{id} / {type}</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}
```

**Step 3: Temporarily render it in `ProjectCard.tsx`**

Add `<CardMenu id={project.id} type="project" />` somewhere visible in the card body, just to confirm it renders and opens without console errors.

**Step 4: Manual verification**

Run `npm run dev`, open the Kanban board, hover/click a project card's new "..." button, confirm the dropdown opens showing the id/type placeholder, no console errors, styling doesn't look broken (Mantine's default theme CSS loaded).

**Step 5: Commit**

```bash
git add src/main.tsx src/components/kanban/CardMenu.tsx src/components/kanban/ProjectCard.tsx
git commit -m "feat(kanban): add Mantine provider and CardMenu skeleton"
```

---

### Task 6: Implement the full `CardMenu` logic

**Files:**
- Modify: `src/components/kanban/CardMenu.tsx`
- Reference: `src/lib/taskLookup.ts` (`findTaskById`) for resolving a task id to its owning project (needed for "mark finished" on project-child tasks)

**Step 1: Read `findTaskById`'s signature**

Run: `grep -n "export function findTaskById" -A 15 src/lib/taskLookup.ts` to confirm its exact return shape before wiring against it (expected: something like `{ task: Task; projectId?: string; projectTitle?: string } | null`, based on its usage in `SortableVandaagItem.tsx:43` and `NewDayScreen.tsx:34`).

**Step 2: Full implementation**

```tsx
import { Menu } from '@mantine/core'
import { MoreHorizontal, Pin, PinOff, Sunrise, CheckCircle2 } from 'lucide-react'
import { useStore } from '../../store'
import { findTaskById } from '../../lib/taskLookup'
import type { Tier } from '../../types'

interface CardMenuProps {
  id: string
  type: 'project' | 'task'
}

const TIER_LABELS: Record<Tier, string> = { deep: 'Deep Work', short: 'Short Task', maintenance: 'Maintenance' }

export function CardMenu({ id, type }: CardMenuProps) {
  const dailyPlan = useStore(s => s.dailyPlan)
  const projects = useStore(s => s.projects)
  const orphanTasks = useStore(s => s.orphanTasks)
  const recurringTasks = useStore(s => s.recurringTasks)
  const addToTodayPlan = useStore(s => s.addToTodayPlan)
  const removeFromTodayPlan = useStore(s => s.removeFromTodayPlan)
  const togglePlanItemCompletion = useStore(s => s.togglePlanItemCompletion)
  const togglePlanItemPinned = useStore(s => s.togglePlanItemPinned)
  const addTomorrowShortTask = useStore(s => s.addTomorrowShortTask)
  const addTomorrowMaintenanceTask = useStore(s => s.addTomorrowMaintenanceTask)
  const addTomorrowShortProject = useStore(s => s.addTomorrowShortProject)
  const addTomorrowMaintenanceProject = useStore(s => s.addTomorrowMaintenanceProject)
  const setTomorrowDeepBlock = useStore(s => s.setTomorrowDeepBlock)
  const moveProject = useStore(s => s.moveProject)
  const updateOrphanTask = useStore(s => s.updateOrphanTask)
  const updateTask = useStore(s => s.updateTask)

  const itemOrder = dailyPlan?.itemOrder ?? []
  const planItem = itemOrder.find(i => i.id === id)
  const inToday = !!planItem
  const isPinned = (dailyPlan?.pinnedItemIds ?? []).includes(id)
  const isFinishedForToday = (dailyPlan?.completedItemIds ?? []).includes(id)

  function snoozeToTomorrow() {
    const tier = planItem?.tier ?? 'maintenance'
    if (inToday) removeFromTodayPlan(id)
    if (type === 'project') {
      if (tier === 'deep') setTomorrowDeepBlock(id)
      else if (tier === 'short') addTomorrowShortProject(id)
      else addTomorrowMaintenanceProject(id)
    } else {
      if (tier === 'short') addTomorrowShortTask(id)
      else addTomorrowMaintenanceTask(id)
    }
  }

  function markFinished() {
    if (type === 'project') {
      moveProject(id, 'done')
      return
    }
    const result = findTaskById(id, projects, orphanTasks, recurringTasks)
    if (!result) return
    if (result.projectId) {
      updateTask(id, result.projectId, { status: 'done', completedAt: new Date().toISOString() })
    } else {
      updateOrphanTask(id, { status: 'done', completedAt: new Date().toISOString() })
    }
  }

  return (
    <Menu shadow="md" width={220} position="bottom-end">
      <Menu.Target>
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          className="opacity-0 group-hover:opacity-50 hover:!opacity-100 text-stone transition-all"
        >
          <MoreHorizontal size={14} />
        </button>
      </Menu.Target>
      <Menu.Dropdown onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
        {!inToday && (
          <Menu.Sub>
            <Menu.Sub.Target>
              <Menu.Sub.Item>Add to Today</Menu.Sub.Item>
            </Menu.Sub.Target>
            <Menu.Sub.Dropdown>
              {(type === 'project' ? (['deep', 'short', 'maintenance'] as const) : (['short', 'maintenance'] as const))
                .map(tier => (
                  <Menu.Item key={tier} onClick={() => addToTodayPlan(id, type, tier)}>
                    {TIER_LABELS[tier]}
                  </Menu.Item>
                ))}
            </Menu.Sub.Dropdown>
          </Menu.Sub>
        )}

        {inToday && (
          <>
            <Menu.Sub>
              <Menu.Sub.Target>
                <Menu.Sub.Item>Change tier</Menu.Sub.Item>
              </Menu.Sub.Target>
              <Menu.Sub.Dropdown>
                {(type === 'project' ? (['deep', 'short', 'maintenance'] as const) : (['short', 'maintenance'] as const))
                  .filter(tier => tier !== planItem!.tier)
                  .map(tier => (
                    <Menu.Item key={tier} onClick={() => { removeFromTodayPlan(id); addToTodayPlan(id, type, tier) }}>
                      {TIER_LABELS[tier]}
                    </Menu.Item>
                  ))}
              </Menu.Sub.Dropdown>
            </Menu.Sub>
            <Menu.Item onClick={() => removeFromTodayPlan(id)}>Remove from Today</Menu.Item>
            {type === 'project' && (
              <Menu.Item
                leftSection={<CheckCircle2 size={13} />}
                onClick={() => togglePlanItemCompletion(id)}
              >
                {isFinishedForToday ? "Undo finish for today" : "Finish for today"}
              </Menu.Item>
            )}
            <Menu.Item
              leftSection={isPinned ? <PinOff size={13} /> : <Pin size={13} />}
              onClick={() => togglePlanItemPinned(id)}
            >
              {isPinned ? 'Unpin from Today' : 'Pin to Today'}
            </Menu.Item>
          </>
        )}

        <Menu.Item leftSection={<Sunrise size={13} />} onClick={snoozeToTomorrow}>
          Snooze to tomorrow
        </Menu.Item>

        <Menu.Divider />
        <Menu.Item onClick={markFinished}>
          {type === 'project' ? 'Mark project finished' : 'Mark task done'}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}
```

Notes for whoever implements this:
- `Menu.Sub` is Mantine v7's nested-submenu API — confirm the installed `@mantine/core` version supports it (`grep '"@mantine/core"' package.json`); if the installed version predates `Menu.Sub`, fall back to a flat list of "Add to Today — Deep" / "Add to Today — Short" / "Add to Today — Maintenance" items instead of a submenu.
- "Finish for today" is intentionally project-only (see the design doc's distinction table) — tasks use real completion (`markFinished`) for both "done today" and "done forever," matching how `SortableVandaagItem`'s checkbox already behaves for tasks vs. projects.
- `onClick`/`onPointerDown` stoppropagation on the `Menu.Target` button and `Menu.Dropdown` prevents clicks from also triggering the card's own `onClick` (open project modal) or starting a drag (dnd-kit's `PointerSensor` listens on the card wrapper).

**Step 3: Typecheck**

Run: `npm run build`
Expected: passes. If `Menu.Sub` doesn't exist on the installed Mantine version, this will fail with a clear type error — apply the flat-list fallback described above.

**Step 4: Commit**

```bash
git add src/components/kanban/CardMenu.tsx
git commit -m "feat(kanban): implement CardMenu today/tier/pin/snooze/finish actions"
```

---

### Task 7: Wire `CardMenu` into `ProjectCard` and `StandaloneTaskCard`

**Files:**
- Modify: `src/components/kanban/ProjectCard.tsx`
- Modify: `src/components/kanban/StandaloneTaskCard.tsx`

**Step 1: `ProjectCard.tsx`**

Add the import (`import { CardMenu } from './CardMenu'`) and render it in the title row, e.g. right after the title `<div>` (line 130):

```tsx
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="text-[14px] font-medium text-charcoal leading-snug">{project.title}</div>
          {!isDragOverlay && <CardMenu id={project.id} type="project" />}
        </div>
```
(replacing the standalone `<div className="text-[14px] font-medium text-charcoal mb-1 leading-snug">{project.title}</div>` — remove the temporary placeholder rendering from Task 5 Step 3 if it wasn't already replaced by this.)

Add `className="group"` to the outer card `<div>` (line 59-67) if it isn't already a hover group — check first with `grep -n "className=" src/components/kanban/ProjectCard.tsx | head -5`; the opacity-0/group-hover classes in `CardMenu` depend on an ancestor `.group`.

**Step 2: `StandaloneTaskCard.tsx`**

Add the import and render next to the existing delete `×` button (around line 185), inside the same flex row, before or after the assign-to-project picker:

```tsx
      <CardMenu id={task.id} type="task" />
```

The outer wrapper already has `className="... group ..."` (line 74-77), so hover-reveal will work without further changes.

**Step 3: Manual verification**

`npm run dev` → open the Kanban board → confirm the "..." button appears on hover for both a project card (Backlog/In Progress/Waiting) and a standalone task card, opens the dropdown, and none of the menu actions throw console errors when clicked (some actions will silently no-op until Part C's Today column exists to visualize the effect — that's expected at this point).

**Step 4: Commit**

```bash
git add src/components/kanban/ProjectCard.tsx src/components/kanban/StandaloneTaskCard.tsx
git commit -m "feat(kanban): wire CardMenu into ProjectCard and StandaloneTaskCard"
```

---

### Task 8: Add pin/snooze/finish to `SortableVandaagItem` + finish-for-today exit animation

**Files:**
- Modify: `src/components/vandaag/SortableVandaagItem.tsx`

**Step 1: Add `CardMenu` next to the existing remove button**

`SortableVandaagItem` already covers tier-change (`TierBadge`), remove-from-today (`X` button), and completion (checkbox). Add `CardMenu` for the two actions it doesn't have yet — pin and snooze — reusing the same component built in Task 6 (it already conditionally hides "Add to Today"/"Change tier" duplication isn't a concern since both can coexist; simplest is to just render the full menu here too, tier-change duplication is harmless).

Import `CardMenu` and render it next to the `X` button (around line 158-165):

```tsx
        <CardMenu id={item.id} type={item.type === 'project' ? 'project' : 'task'} />
        {/* Remove button */}
        <button onClick={() => onRemove(item.id)} ... >
```

(`item.type === 'meeting'` items don't have a `CardMenu` concept in this design — skip rendering it for meetings: wrap in `{item.type !== 'meeting' && <CardMenu .../>}`.)

**Step 2: Finish-for-today exit animation**

On the outer wrapper `<div>` (line 57-67), add a transition that collapses the row when `isItemCompleted` is true (projects only, matching where `togglePlanItemCompletion` is actually used):

```tsx
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={`rounded-[8px] border transition-all duration-500 group
        ${isDragging ? 'shadow-lg scale-[1.02] z-10 opacity-80' : ''}
        ${item.type === 'project' && isItemCompleted ? 'opacity-0 max-h-0 scale-95 -mt-2 overflow-hidden pointer-events-none' : 'opacity-100 max-h-[200px]'}
        ${dark
          ? 'bg-citadel-text/[0.03] border-citadel-text/8'
          : `bg-card border-border/50 ${isDeep ? 'border-charcoal/15' : ''}`
        }`}
    >
```

This keeps the item in the DOM/array (so the underlying data and drag-sortable indices stay stable) but visually sweeps it away via `max-h-0`/`opacity-0`/`scale-95`. It naturally comes back tomorrow if not actually removed, or stays gone once the nightly rollover drops completed, unpinned items.

**Step 3: Manual verification**

`npm run dev` → open the app on the current `VandaagView` (still live at this point, not yet removed) → toggle a project's checkbox in the Today list → confirm it animates away smoothly instead of just getting a strikethrough. Open the pin/snooze menu items and confirm no console errors.

**Step 4: Commit**

```bash
git add src/components/vandaag/SortableVandaagItem.tsx
git commit -m "feat(vandaag): add CardMenu and finish-for-today exit animation to SortableVandaagItem"
```

---

## Part C — Today column on the Kanban board

### Task 9: Create `TodayColumn.tsx`

**Files:**
- Create: `src/components/kanban/TodayColumn.tsx`

This mirrors `DailyPlanList.tsx`'s tier-grouped rendering (reusing `TierSectionHeader` + `SortableVandaagItem` + `deriveItemOrder`), but:
- Has **no own `DndContext`** — it will be rendered inside `KanbanBoard`'s existing one (Task 10).
- Provides **three `useDroppable` tier zones** (`today-deep`, `today-short`, `today-maintenance`) so `KanbanBoard`'s drag handlers can detect "dropped into Today, this tier."
- Reads `dailyPlan` directly from the store (no local `orderedItems` state/sync-effect needed now that `itemOrder` is always kept correct by `addToTodayPlan`/`removeFromTodayPlan`/`reorderTodayItems` — this removes the staleness workaround `DailyPlanList` needed).

```tsx
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useStore } from '../../store'
import { useTaskToggle } from '../../hooks/useTaskToggle'
import { deriveItemOrder } from '../../lib/planOrder'
import type { Tier, PlanItem, TaskType } from '../../types'
import { SortableVandaagItem } from '../vandaag/SortableVandaagItem'
import { TierSectionHeader } from '../vandaag/TierSectionHeader'

const TIER_ORDER: Tier[] = ['deep', 'short', 'maintenance']
const TIER_SLOT_MAX: Record<Tier, number | undefined> = { deep: 1, short: 3, maintenance: undefined }

function TierDropZone({ tier, items, onOpenMeetings, onTierChange, onRemove, toggleTask }: {
  tier: Tier
  items: PlanItem[]
  onOpenMeetings: () => void
  onTierChange: (id: string, t: TaskType) => void
  onRemove: (id: string) => void
  toggleTask: (id: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `today-${tier}` })
  const meetings = useStore(s => s.meetings)
  const recurringMeetings = useStore(s => s.recurringMeetings)

  const slotCount = items.reduce((sum, i) => {
    if (i.type === 'meeting') {
      const m = [...meetings, ...recurringMeetings].find(m => m.id === i.id)
      return sum + Math.ceil((m?.durationMinutes ?? 60) / 60)
    }
    return sum + 1
  }, 0)

  return (
    <div ref={setNodeRef} className={`rounded-[8px] p-1.5 transition-colors ${isOver ? 'bg-border-light' : ''}`}>
      <TierSectionHeader tier={tier} slotCount={slotCount} slotMax={TIER_SLOT_MAX[tier]} />
      <SortableContext items={items.map(i => `plan-${i.id}`)} strategy={verticalListSortingStrategy}>
        <div className="space-y-1.5">
          {items.map(item => (
            <SortableVandaagItem
              key={item.id}
              item={item}
              onOpenMeetings={onOpenMeetings}
              onRemove={onRemove}
              onTierChange={onTierChange}
              toggleTask={toggleTask}
            />
          ))}
        </div>
        {items.length === 0 && (
          <div className="text-center text-stone/30 text-[11px] py-3 italic">Drop here</div>
        )}
      </SortableContext>
    </div>
  )
}

interface TodayColumnProps {
  onOpenMeetings: () => void
}

export function TodayColumn({ onOpenMeetings }: TodayColumnProps) {
  const dailyPlan = useStore(s => s.dailyPlan)
  const removeFromTodayPlan = useStore(s => s.removeFromTodayPlan)
  const addToTodayPlan = useStore(s => s.addToTodayPlan)
  const toggleTask = useTaskToggle()

  const items = dailyPlan ? (dailyPlan.itemOrder ?? deriveItemOrder(dailyPlan)) : []
  const byTier = (t: Tier) => items.filter(i => i.tier === t)

  function handleTierChange(id: string, newTaskType: TaskType) {
    const tier: Tier = newTaskType === 'reminder' ? 'maintenance' : newTaskType
    const item = items.find(i => i.id === id)
    if (!item) return
    removeFromTodayPlan(id)
    addToTodayPlan(id, item.type, tier)
  }

  return (
    <div className="bg-border-light/60 rounded-[10px] p-4 min-h-[300px]">
      <div className="flex justify-between items-center mb-4 pb-3 border-b border-border">
        <span className="text-[13px] font-semibold text-stone tracking-[0.01em]">Today</span>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-border text-stone">{items.length}</span>
      </div>
      {TIER_ORDER.map(tier => (
        <TierDropZone
          key={tier}
          tier={tier}
          items={byTier(tier)}
          onOpenMeetings={onOpenMeetings}
          onTierChange={handleTierChange}
          onRemove={removeFromTodayPlan}
          toggleTask={toggleTask}
        />
      ))}
    </div>
  )
}
```

**Step 1: Typecheck**

Run: `npm run build`
Expected: passes (component isn't rendered anywhere yet, but should compile standalone — check for unused-import lint issues too with `npm run lint`).

**Step 2: Commit**

```bash
git add src/components/kanban/TodayColumn.tsx
git commit -m "feat(kanban): add TodayColumn component"
```

---

### Task 10: Wire `TodayColumn` into `KanbanBoard`

**Files:**
- Modify: `src/components/kanban/KanbanBoard.tsx`

**Step 1: Imports and new store bindings**

Add near the top:
```ts
import { TodayColumn } from './TodayColumn'
import { deriveItemOrder } from '../../lib/planOrder'
import { arrayMove } from '@dnd-kit/sortable'
import type { PlanItem } from '../../types'
```

Add store bindings alongside the existing ones (after line 78):
```tsx
  const dailyPlan = useStore(s => s.dailyPlan)
  const addToTodayPlan = useStore(s => s.addToTodayPlan)
  const reorderTodayItems = useStore(s => s.reorderTodayItems)
```

Add local state for tracking a Today-item drag, alongside `activeProject`/`activeOrphanTask` (after line 82):
```tsx
  const [activePlanItem, setActivePlanItem] = useState<PlanItem | null>(null)
```

Add a derived `orderedTodayItems`, alongside `visibleProjects` (after line 111):
```tsx
  const orderedTodayItems = dailyPlan ? (dailyPlan.itemOrder ?? deriveItemOrder(dailyPlan)) : []
```

**Step 2: `handleDragStart`** — detect a `plan-`-prefixed drag first

Replace lines 134-145 with:
```tsx
  function handleDragStart(event: DragStartEvent) {
    const id = event.active.id as string
    const h = event.active.rect.current.initial?.height ?? 80
    setDragHeight(h)
    if (id.startsWith('plan-')) {
      const planId = id.slice('plan-'.length)
      const item = orderedTodayItems.find(i => i.id === planId)
      if (item) setActivePlanItem(item)
      return
    }
    const orphan = orphanTasks.find(t => t.id === id)
    if (orphan) {
      setActiveOrphanTask(orphan)
      return
    }
    const project = projects.find(p => p.id === id)
    if (project) setActiveProject(project)
  }
```

**Step 3: `handleDragEnd`** — new branches at the top, before the existing "Orphan task drag" branch

Replace the start of `handleDragEnd` (lines 211-224) with:
```tsx
  function handleDragEnd(event: DragEndEvent) {
    const wasOrphan = !!activeOrphanTask
    const wasPlanItem = !!activePlanItem
    setDragPreview(null)
    setBacklogDragPreview(null)
    setActiveProject(null)
    setActiveOrphanTask(null)
    setActivePlanItem(null)

    const { active, over } = event
    if (!over) return

    const activeId = active.id as string
    const overId = over.id as string
    if (activeId === overId) return

    // --- Reorder within Today ---
    if (wasPlanItem) {
      if (!overId.startsWith('plan-')) return
      const oldIndex = orderedTodayItems.findIndex(i => `plan-${i.id}` === activeId)
      const newIndex = orderedTodayItems.findIndex(i => `plan-${i.id}` === overId)
      if (oldIndex === -1 || newIndex === -1) return
      reorderTodayItems(arrayMove(orderedTodayItems, oldIndex, newIndex))
      return
    }

    // --- Drop a project/orphan task into a Today tier zone ---
    const todayTier = overId === 'today-deep' ? 'deep' : overId === 'today-short' ? 'short' : overId === 'today-maintenance' ? 'maintenance' : null
    if (todayTier) {
      if (wasOrphan) {
        if (todayTier !== 'deep') addToTodayPlan(activeId, 'task', todayTier)
      } else {
        addToTodayPlan(activeId, 'project', todayTier)
      }
      return
    }

    // --- Orphan task drag ---
    if (wasOrphan) {
```
(the rest of the existing function body — the `if (wasOrphan) { ... }` block onward — is unchanged, just now reached only when neither of the two new branches matched).

**Step 4: `handleDragOver`** — bail out early for plan-item / today-zone drags (they don't need the ghost-preview logic built for kanban columns)

At the top of `handleDragOver` (after line 152's `if (activeId === overId) return`), add:
```tsx
    if (activeId.startsWith('plan-') || overId.startsWith('today-')) {
      setDragPreview(null)
      setBacklogDragPreview(null)
      return
    }
```

**Step 5: Layout — insert `TodayColumn` between In Progress and Waiting, make the row horizontally scrollable**

Replace the grid wrapper (lines 409-445):
```tsx
          <div className="sm:grid sm:grid-cols-4 sm:gap-4 flex flex-col gap-3">
            <div className={mobileCol !== 'backlog' ? 'hidden sm:block' : ''}>
              <BacklogColumn ... />
            </div>
            {KANBAN_COLUMNS.filter(col => col.id !== 'backlog').map(col => { ... })}
            <div className={mobileCol !== 'done' ? 'hidden sm:block' : ''}>
              <DoneListColumn />
            </div>
          </div>
```
with an explicit, horizontally-scrollable 5-column row (Backlog, In Progress, Today, Waiting, Done — Done allowed to scroll out of view first since it's last):
```tsx
          <div className="sm:flex sm:gap-4 sm:overflow-x-auto sm:pb-2 flex flex-col gap-3">
            <div className={`${mobileCol !== 'backlog' ? 'hidden sm:block' : ''} sm:w-[300px] sm:flex-shrink-0`}>
              <BacklogColumn
                projects={getProjectsByStatus('backlog')}
                orphanTasks={getOrphansByColumn('backlog')}
                onProjectClick={handleProjectClick}
                backlogDragPreview={backlogDragPreview ?? undefined}
                {...orphanHandlers}
              />
            </div>
            {(() => {
              const inProgressCol = KANBAN_COLUMNS.find(c => c.id === 'in_progress')!
              return (
                <div className={`${mobileCol !== 'in_progress' ? 'hidden sm:block' : ''} sm:w-[300px] sm:flex-shrink-0`}>
                  <KanbanColumn
                    id={inProgressCol.id}
                    title={inProgressCol.title}
                    limit={inProgressLimit}
                    combinedCount={getWipCount()}
                    projects={getProjectsByStatus('in_progress')}
                    orphanTasks={getOrphansByColumn('in_progress')}
                    onProjectClick={handleProjectClick}
                    dragPreview={
                      dragPreview?.targetCol === 'in_progress'
                        ? { activeId: dragPreview.activeId, afterItemId: dragPreview.afterItemId, height: dragPreview.height, beforeFirst: dragPreview.beforeFirst }
                        : undefined
                    }
                    {...orphanHandlers}
                  />
                </div>
              )
            })()}
            <div className={`${mobileCol !== 'today' ? 'hidden sm:block' : ''} sm:w-[300px] sm:flex-shrink-0`}>
              <TodayColumn onOpenMeetings={() => {}} />
            </div>
            {(() => {
              const waitingCol = KANBAN_COLUMNS.find(c => c.id === 'waiting')!
              return (
                <div className={`${mobileCol !== 'waiting' ? 'hidden sm:block' : ''} sm:w-[300px] sm:flex-shrink-0`}>
                  <KanbanColumn
                    id={waitingCol.id}
                    title={waitingCol.title}
                    limit={inProgressLimit}
                    combinedCount={getWipCount()}
                    projects={getProjectsByStatus('waiting')}
                    orphanTasks={getOrphansByColumn('waiting')}
                    crossListedProjects={crossListedInWaiting}
                    onProjectClick={handleProjectClick}
                    dragPreview={
                      dragPreview?.targetCol === 'waiting'
                        ? { activeId: dragPreview.activeId, afterItemId: dragPreview.afterItemId, height: dragPreview.height, beforeFirst: dragPreview.beforeFirst }
                        : undefined
                    }
                    {...orphanHandlers}
                  />
                </div>
              )
            })()}
            <div className={`${mobileCol !== 'done' ? 'hidden sm:block' : ''} sm:w-[300px] sm:flex-shrink-0`}>
              <DoneListColumn />
            </div>
          </div>
```

**Step 6: Mobile column tabs** — add a "Today" tab

In the mobile tabs array (lines 382-387), add a `today` entry between `in_progress`/`Active` and `waiting`/`Waiting`:
```tsx
          {[
            { id: 'backlog', label: 'Backlog' },
            { id: 'in_progress', label: 'Active' },
            { id: 'today', label: 'Today' },
            { id: 'waiting', label: 'Waiting' },
            { id: 'done', label: 'Done' },
          ].map(tab => (
```

**Step 7: `onOpenMeetings` prop**

`TodayColumn` needs a real `onOpenMeetings` handler (used when expanding a meeting inline card) — `KanbanBoard` doesn't currently have one. Add an `onOpenMeetings?: () => void` prop to `KanbanBoardProps` and thread it through from `App.tsx` (Part D will pass `() => setActiveView('meetings')`, mirroring what `VandaagView` received before). Until Part D is done, pass `() => {}` as a placeholder (already shown above) and revisit in Task 11.

**Step 8: Typecheck**

Run: `npm run build`
Expected: passes.

**Step 9: Manual verification**

`npm run dev` → open the Kanban board (still rendered alongside the old `VandaagView` at this point) → confirm:
- A "Today" column appears between In Progress and Waiting, with Deep/Short/Maintenance sub-headers.
- Dragging a project card from Backlog onto the Today column's Short zone adds it there (and it also still shows in its original Backlog/In Progress column — dual membership).
- Dragging a standalone task onto Today's Maintenance zone works the same way.
- Reordering within the Today column via drag works.
- The row scrolls horizontally if the viewport is too narrow for all 5 columns, with Done scrolling off first.
- No console errors during any of the above.

**Step 10: Commit**

```bash
git add src/components/kanban/KanbanBoard.tsx
git commit -m "feat(kanban): wire TodayColumn into KanbanBoard's DndContext and layout"
```

---

## Part D — Ritual screens + nav cleanup

### Task 11: Make the Kanban board the home view; remove `vandaag`/`planning` nav tabs

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/store/types.ts:25` (`ActiveView` union)

**Step 1: Shrink `ActiveView`**

In `src/store/types.ts:25`, change:
```ts
export type ActiveView = 'vandaag' | 'kanban' | 'planning' | 'philosophy' | 'meetings' | 'review' | 'write-away' | 'week'
```
to:
```ts
export type ActiveView = 'kanban' | 'philosophy' | 'meetings' | 'review' | 'write-away' | 'week'
```

**Step 2: Update `App.tsx`'s nav bar**

Remove the "Vandaag" nav button (lines 164-172). The remaining buttons (Meetings/Review/Week/Write Away) stay as-is; add nothing new for Kanban since it's now the fallback/default branch of the view switch (matches the existing pattern where `'vandaag'` had no explicit nav-active styling of its own beyond the removed button).

**Step 3: Update the view switch**

Replace lines 276-306:
```tsx
        {activeView === 'philosophy' ? (
          <Suspense fallback={null}><PhilosophyPage onBack={() => setActiveView('vandaag')} /></Suspense>
        ) : activeView === 'planning' ? (
          <PlanningMode onExit={() => setActiveView('vandaag')} day={planningDay} />
        ) : activeView === 'meetings' ? (
          <Suspense fallback={null}><MeetingsPage /></Suspense>
        ) : activeView === 'review' ? (
          <Suspense fallback={null}><WeeklyReviewPage /></Suspense>
        ) : activeView === 'week' ? (
          <Suspense fallback={null}><WeekPlannerView /></Suspense>
        ) : activeView === 'write-away' ? (
          <WriteAwayPage />
        ) : (
          <>
            <VandaagView
              onOpenMeetings={() => setActiveView('meetings')}
              onDayDone={() => setShowEnough(true)}
              collapsed={vandaagCollapsed}
              onToggleCollapse={() => setVandaagCollapsed(v => !v)}
              onPeekTomorrow={() => setShowTomorrowPeek(true)}
            />
            <KanbanBoard
              collapsed={kanbanCollapsed}
              onToggleCollapse={() => setKanbanCollapsed(v => !v)}
              externalAddTask={showAddTaskModal}
              onExternalAddTaskClose={() => setShowAddTaskModal(false)}
              externalAddProject={showAddProjectModal}
              onExternalAddProjectClose={() => setShowAddProjectModal(false)}
            />
          </>
        )}
```
with:
```tsx
        {activeView === 'philosophy' ? (
          <Suspense fallback={null}><PhilosophyPage onBack={() => setActiveView('kanban')} /></Suspense>
        ) : activeView === 'meetings' ? (
          <Suspense fallback={null}><MeetingsPage /></Suspense>
        ) : activeView === 'review' ? (
          <Suspense fallback={null}><WeeklyReviewPage /></Suspense>
        ) : activeView === 'week' ? (
          <Suspense fallback={null}><WeekPlannerView /></Suspense>
        ) : activeView === 'write-away' ? (
          <WriteAwayPage />
        ) : (
          <KanbanBoard
            onOpenMeetings={() => setActiveView('meetings')}
            externalAddTask={showAddTaskModal}
            onExternalAddTaskClose={() => setShowAddTaskModal(false)}
            externalAddProject={showAddProjectModal}
            onExternalAddProjectClose={() => setShowAddProjectModal(false)}
          />
        )}
```
(dropping `collapsed`/`onToggleCollapse` — the board is now the whole page, collapsing it no longer makes sense as a concept; drop `vandaagCollapsed`/`kanbanCollapsed` state (lines 57-58) accordingly, and remove the now-dead "Projects & tasks" collapse toggle header inside `KanbanBoard.tsx` itself — read `KanbanBoard.tsx:335-349` and simplify once `collapsed`/`onToggleCollapse` props are dropped from `KanbanBoardProps`.)

**Step 4: Fix other `setActiveView('vandaag')` call sites**

Run: `grep -rn "setActiveView('vandaag')" src`
Update each to `setActiveView('kanban')`. Also check `WeeklyReviewPage.tsx:163` specifically (flagged by earlier research).

**Step 5: Typecheck**

Run: `npm run build`
Expected: will fail until Task 12/13 also stop importing `VandaagView`/`PlanningMode` (they're still imported at the top of `App.tsx`, lines 9-10, but no longer referenced in JSX — TS will flag unused imports if `noUnusedLocals` is on, check `tsconfig.json`). Remove those two imports now since nothing in `App.tsx` uses them after Step 3.

**Step 6: Manual verification**

`npm run dev` → confirm the app opens directly onto the Kanban board (no separate Vandaag tab), the remaining nav tabs (Meetings/Review/Week/Write Away) work, and `Philosophy`'s back button returns to the board.

**Step 7: Commit**

```bash
git add src/App.tsx src/store/types.ts
git commit -m "feat(nav): make Kanban board the home view, remove vandaag/planning tabs"
```

---

### Task 12: `NewDayScreen`'s "Plan mijn dag" dismisses straight to the board

**Files:**
- Modify: `src/App.tsx:114-122` (the `showNewDay` early return)

**Step 1: Simplify the `onPlan` handler**

Replace:
```tsx
  if (showNewDay) {
    return (
      <NewDayScreen
        onStart={() => setGreetedDate(todayStr)}
        onPlan={() => { setGreetedDate(todayStr); setPlanningDay('today'); setActiveView('planning') }}
      />
    )
  }
```
with:
```tsx
  if (showNewDay) {
    return (
      <NewDayScreen
        onStart={() => setGreetedDate(todayStr)}
        onPlan={() => setGreetedDate(todayStr)}
      />
    )
  }
```
(`onStart` and `onPlan` are now identical — both just dismiss the gate. Keep both props on `NewDayScreen` for now since its internal copy differs by button ["Begin de dag" vs "Plan mijn dag"/"Sla over"] — don't collapse the component's UI in this task, just its App-level wiring. `planningDay` state and the `setPlanningDay`/`'today'` call are no longer needed here — leave `planningDay` state itself alone for now, `TomorrowPeek`'s edit button still uses it in Task 13.)

**Step 2: Typecheck**

Run: `npm run build`
Expected: passes (no more references to `'planning'` as an `ActiveView` anywhere at this point, confirmed by Task 11's typecheck already having caught any stragglers).

**Step 3: Manual verification**

`npm run dev` → force `showNewDay` to true (temporarily: in the console, `useStore.getState().setGreetedDate('2000-01-01')` then reload) → confirm the morning gate shows, and clicking either "Plan mijn dag" (if no plan exists yet) or "Begin de dag" (if one does) dismisses straight to the Kanban board with the Today column visible.

**Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(daily-gate): Plan mijn dag dismisses to the board instead of opening the planning wizard"
```

---

### Task 13: Re-verify `EnoughScreen` / `TomorrowPeek` / `WindDownBanner` against the board-as-home flow

**Files:** none expected to change — this is a verification-only task, but check each:

**Step 1: `EnoughScreen`**

Already renders as a full-screen early return in `App.tsx` (lines 125-135), independent of `activeView` — unaffected by Task 11's changes. Confirm by reading `App.tsx` current state: the `if (showEnough)` block should still sit above the nav/board render, unchanged.

**Step 2: `TomorrowPeek`**

Its `onEdit` callback (`App.tsx:229`) still does `setPlanningDay('tomorrow'); setActiveView('planning')` — but `'planning'` no longer exists as an `ActiveView` after Task 11. This needs a real fix, not just a leftover: replace the drawer's "Bewerk planning →" action. Simplest option consistent with this whole redesign (planning happens by directly manipulating the board, not a wizard): change `onEdit` to close the drawer and rely on the Today column already being directly editable — i.e. drop the "edit tomorrow's plan" wizard-jump entirely: 
```tsx
          <TomorrowPeek
            onClose={() => setShowTomorrowPeek(false)}
          />
```
and remove the `onEdit` prop from `TomorrowPeek`'s interface if nothing else calls it (check `TomorrowPeek.tsx` for other usages first — read the file, it wasn't part of this plan's earlier research beyond confirming its existence).

Note: `TomorrowPeek` currently only shows tomorrow's plan read-only via a drawer — since there's no "tomorrow" version of the Kanban Today column in this plan's scope (only today's board has a Today column), there is genuinely no equivalent inline surface to jump to yet. Keep `TomorrowPeek` exactly as a read-only preview per the approved design ("keep a simple tomorrow preview") — just remove the broken edit-jump.

**Step 3: `WindDownBanner`**

`App.tsx:235-237` — `hour >= 16 && !meetingSession && !dailyPlan?.isComplete` — unrelated to `activeView`, unaffected.

**Step 4: Typecheck + manual verification**

Run: `npm run build`, then `npm run dev` and click through: open `TomorrowPeek` via the "Morgen →" affordance (find it — was previously inside `VandaagView`, now needs a new trigger point since `VandaagView` is gone; check whether `SmartFab`'s `onPlanTomorrow` (`App.tsx:245`) already opens something suitable, or whether `TomorrowPeek`'s trigger needs to move onto `KanbanBoard` — read `SmartFab.tsx` to see what `onPlanTomorrow` currently does before deciding; likely it should now call `setShowTomorrowPeek(true)` instead of the retired `setActiveView('planning')`).

**Step 5: Fix `SmartFab`'s `onPlanTomorrow` wiring if needed**

In `App.tsx:245`, if it currently reads:
```tsx
        onPlanTomorrow={() => { setPlanningDay('tomorrow'); setActiveView('planning') }}
```
change to:
```tsx
        onPlanTomorrow={() => setShowTomorrowPeek(true)}
```
(dropping the now-dead `planningDay` state entirely if nothing else references it after this — grep to confirm: `grep -n "planningDay" src/App.tsx`.)

**Step 6: Commit**

```bash
git add src/App.tsx src/components/vandaag/TomorrowPeek.tsx
git commit -m "fix(daily-gate): repoint TomorrowPeek/SmartFab triggers now that the planning wizard is gone"
```

---

## Part E — Cleanup

### Task 14: Delete dead view files

**Files to delete** (confirm each is unreferenced with `grep -rn "from.*ComponentName" src` before deleting):
- `src/components/vandaag/VandaagView.tsx`
- `src/components/vandaag/DeepBlock.tsx` (already dead per Explore research)
- `src/components/vandaag/MaintenanceTier.tsx` (already dead)
- `src/components/vandaag/ShortTasks.tsx` (already dead)
- `src/components/vandaag/PlanningMode.tsx`
- `src/components/vandaag/DailyPlanList.tsx` (superseded by `TodayColumn`)
- `src/components/planning/PlanningModal.tsx` and any components solely used by it (e.g. an `InventoryPanel` — grep for its usages first: `grep -rln "InventoryPanel" src`; delete only if `PlanningModal.tsx` is its only importer)

**Step 1: Confirm each is truly unreferenced**

Run for each filename:
```bash
grep -rn "VandaagView\|DeepBlock\|MaintenanceTier\|ShortTasks\|PlanningMode\b\|DailyPlanList\|PlanningModal" src --include="*.tsx" --include="*.ts" | grep -v "src/components/vandaag/VandaagView.tsx:\|src/components/vandaag/DeepBlock.tsx:\|src/components/vandaag/MaintenanceTier.tsx:\|src/components/vandaag/ShortTasks.tsx:\|src/components/vandaag/PlanningMode.tsx:\|src/components/vandaag/DailyPlanList.tsx:\|src/components/planning/PlanningModal.tsx:"
```
Expected: no remaining import sites (App.tsx's imports were already dropped in Task 11).

**Step 2: Delete**

```bash
git rm src/components/vandaag/VandaagView.tsx \
  src/components/vandaag/DeepBlock.tsx \
  src/components/vandaag/MaintenanceTier.tsx \
  src/components/vandaag/ShortTasks.tsx \
  src/components/vandaag/PlanningMode.tsx \
  src/components/vandaag/DailyPlanList.tsx \
  src/components/planning/PlanningModal.tsx
```
(add any solely-used `InventoryPanel`-style helper files found in Step 1.)

**Step 3: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: both pass — confirms nothing else was still importing the deleted files.

**Step 4: Commit**

```bash
git commit -m "chore: remove VandaagView, PlanningModal, and superseded planning components"
```

---

### Task 15: Reconcile `Task.status === 'vandaag'`

**Files:**
- Modify: `src/types/index.ts:5` (`TaskStatus` union)
- Modify: `src/store/plansSlice.ts` (`addQuickMaintenanceTask`)
- Modify: `src/components/kanban/KanbanBoard.tsx:51-55` (`getOrphanColumn`)

**Step 1: `addQuickMaintenanceTask` uses `addToTodayPlan` instead of the status flag**

Replace (current lines 57-74):
```ts
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
```
with:
```ts
    addQuickMaintenanceTask: (title: string): string => {
      const id = uuid()
      const task: Task = {
        id,
        title,
        status: 'backlog',
        isRecurring: false,
        isUncomfortable: false,
        createdAt: new Date().toISOString(),
      }
      set(state => ({ orphanTasks: [...state.orphanTasks, task] }))
      get().addToTodayPlan(id, 'task', 'maintenance')
      return id
    },
```

**Step 2: Drop `'vandaag'` from `TaskStatus`**

In `src/types/index.ts:5`:
```ts
export type TaskStatus = 'backlog' | 'done' | 'dropped'
```

**Step 3: Simplify `getOrphanColumn`**

In `src/components/kanban/KanbanBoard.tsx:51-55`, remove the now-impossible branch:
```ts
function getOrphanColumn(task: Task): ProjectStatus {
  if (task.kanbanColumn) return task.kanbanColumn
  return 'backlog'
}
```
(Previously, a quick-maintenance task with `status: 'vandaag'` and no `kanbanColumn` landed in `in_progress` by default — now that Today membership is tracked purely via `dailyPlan`, decide whether that placement still matters: since these are quick tasks meant to be worked on today, set `kanbanColumn: 'in_progress'` explicitly in Task 1's `addQuickMaintenanceTask` instead of relying on the removed status branch, to preserve the existing placement behavior:)
```ts
      const task: Task = {
        id,
        title,
        status: 'backlog',
        kanbanColumn: 'in_progress',
        isRecurring: false,
        isUncomfortable: false,
        createdAt: new Date().toISOString(),
      }
```

**Step 4: Typecheck**

Run: `npm run build`
Expected: TypeScript will flag any other place still comparing against `'vandaag'` (e.g. `OrphanTaskModal.tsx:31` per the earlier research) — fix each flagged site by reading it in context; most likely they can just be deleted (dead branch) since the value can no longer occur.

**Step 5: Manual verification**

`npm run dev` → use the Write Away / quick-maintenance-task entry point (whichever UI calls `addQuickMaintenanceTask` — check `WriteAwayModal.tsx`/`SmartFab.tsx`) → confirm the new task lands in the In Progress kanban column AND in the Today column's Maintenance tier.

**Step 6: Commit**

```bash
git add src/types/index.ts src/store/plansSlice.ts src/components/kanban/KanbanBoard.tsx
git commit -m "refactor: remove redundant Task.status 'vandaag', drive Today membership solely from dailyPlan"
```

(If Step 4 turned up other call sites, include those files in this commit too.)

---

### Task 16: Full verification pass

**Step 1: Typecheck + lint**

```bash
npm run build
npm run lint
```
Expected: both clean.

**Step 2: Full manual smoke test in the browser**

`npm run dev`, then walk through the whole flow:
1. Morning gate (`NewDayScreen`) appears once, dismisses to the board.
2. Kanban board is the only/home view; Today column sits between In Progress and Waiting.
3. Drag a project into Today's Deep zone — appears in both places (dual membership); Deep zone caps at 1.
4. Drag a task into Today's Short zone; add another via the "..." menu's "Add to Today"; confirm the 3-slot cap is respected (matches existing `TierBadge`/`DailyPlanList` constraint logic ported into `TodayColumn`/`handleTierChange` — re-check this constraint was actually carried over; if Task 9's `TodayColumn` didn't port the short-tier 3-slot cap check from `DailyPlanList.handleTierChange` (lines 118-132 in the original), add it now to `addToTodayPlan` or to `CardMenu`'s tier-picker before calling it).
5. "Finish for today" on a project in Today — animates out, project stays open elsewhere on the board.
6. Pin a task, refresh the page / manually trigger `refreshDailyPlan()` with a backdated `dailyPlan.date` — pinned task survives into the "new" day, unpinned/uncompleted-but-undone tasks also carry over per existing rollover behavior, completed-and-unpinned tasks don't.
7. Snooze a task to tomorrow — disappears from Today, appears in `TomorrowPeek`'s drawer.
8. "Mark project finished" / "Mark task done" from the menu — moves the project to Done / marks the task done, same as the existing drag-to-Done / checkbox behavior elsewhere.
9. Evening: trigger `WindDownBanner` (after 4pm, or temporarily fake `hour` state) → `EnoughScreen` → "Close the day" completes the plan.
10. No console errors at any point above.

**Step 3: Final commit (only if Step 2 surfaced fixes)**

If the smoke test required any fixes, commit them individually with descriptive messages as you go, following the same pattern as the tasks above — don't bundle unrelated fixes into one commit.
