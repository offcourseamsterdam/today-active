# Today-into-Kanban — Design

**Datum:** 2026-08-21
**Status:** Approved

## Doel

Remove the standalone "Today" view (`VandaagView` and the daily-planning wizard) and integrate its functionality directly into the Kanban board:

1. A **Today column** on the board where projects/tasks can be dragged in to mark them as today's focus.
2. A **three-dot menu** on cards for deciding what's worked on today without dragging.

The goal is one workspace (the board) instead of two (Today view + Kanban), while keeping the daily-planning ritual (morning/evening gates) that already works.

Out of scope for this design: integrating with week-planning (`weekSlots`/`WeekPlannerView`) — planning which *projects* to work on across a week, including how pinned/fixed items show up there. That's a related but separate feature the user wants to design next.

---

## Architecture

- **Kanban board becomes the home view.** The `vandaag` and `planning` nav tabs and `VandaagView` are removed; the board (currently always co-rendered with `VandaagView`) becomes what the app opens to.
- **New Today column**, positioned in column order: Backlog → In Progress → **Today** → Waiting → Done. If horizontal space is tight, Done is the column allowed to scroll out of view first — no special vertical treatment, just last priority in the layout order.
- **Today is orthogonal to kanban status (dual-membership).** A project can be `in_progress` *and* in Today at the same time — it renders as two card instances (one in its status column, one in the Today column), both reading from the same store state. This matches how `dailyPlan` was always separate from `Task.status`/project kanban status in the existing data model — no new sync logic needed.
- **Morning/evening gates stay, as overlays on the board:**
  - `NewDayScreen` still gates the day. "Plan mijn dag" now just dismisses the gate straight to the board (Today column ready to receive drags) instead of opening the planning wizard.
  - `EnoughScreen` (evening wind-down / close-the-day) stays as-is, layered over the board instead of `VandaagView`.
  - `TomorrowPeek` stays as a lightweight drawer preview of what's queued for tomorrow (via the new "snooze to tomorrow" menu action).
  - `PlanningModal` (the inventory-panel wizard) is **retired** — dragging/menu actions directly on the board replace it.
- **Data model stays almost entirely as-is.** `DailyPlan` (tiers, `itemOrder`, `completedItemIds`, `tomorrowPlan`) already models today/tomorrow, tiers, and per-day completion. This is a UI relocation, not a data rebuild — no Firestore schema migration.

---

## Components

### `TodayColumn.tsx` (new, `src/components/kanban/`)

- Sibling to `KanbanColumn`/`BacklogColumn`, rendered inside the same `DndContext` as the rest of the board, as a `useDroppable` zone (same `pointerWithin` → `closestCorners` collision pattern already used by `KanbanBoard` and the old `PlanningModal`).
- Sub-grouped by tier, same caps as today: Deep Work (max 1), Short Tasks (max ~3), Maintenance (uncapped). Tier headers styled after the existing `TierSectionHeader`.
- Renders both `ProjectCard` (compact variant — the full card is too dense for a tiered stacked column) and individual task rows for orphan tasks dragged in directly. Sortable within/between tiers via `dailyPlan.itemOrder`, same as `DailyPlanList`'s existing single-list drag logic today.

### Three-dot menu (new, on `ProjectCard` and task rows)

Uses Mantine's `Menu` component. It's an existing dependency (`@mantine/core`) that's currently unused anywhere in the app — the rest of the codebase's dropdowns are a hand-rolled `useState` + `useClickOutside` pattern, but this menu has enough items that Mantine's `Menu` cuts real boilerplate, so it's worth introducing net-new here.

Menu items:
- **Add to Today / Remove from Today** — toggle.
- **Assign tier** (Deep / Short / Maintenance) — picking a tier implies "add to Today."
- **Finish for today** — today's work on this item is done. Distinct from full completion (see below). Reuses the existing `completedItemIds` / `togglePlanItemCompletion` plumbing; the new part is the card's exit animation as it leaves the Today column.
- **Pin / Unpin** — new `pinned` flag. A pinned item survives `refreshDailyPlan`'s nightly clear-out instead of rolling off, staying in Today every day until unpinned.
- **Snooze to tomorrow** — moves the item from `dailyPlan` into `tomorrowPlan`'s matching tier (existing plumbing, just newly exposed here).
- **Mark project finished** — the project is actually done, moves to the `Done` kanban column. This is the *existing* completion flow (unrelated to `dailyPlan`), exposed here as a convenience shortcut alongside the Today-specific actions.

**The two "done" markings are intentionally distinct and must not be conflated in implementation:**

| Action | Meaning | Effect | Data touched |
|---|---|---|---|
| Finish for today | Today's session on this item is over | Card animates out of Today; project/task stays open, reappears another day | `completedItemIds` (existing) |
| Mark project finished | The project itself is complete | Card moves to `Done` kanban column, same as today's existing completion flow | project `status` (existing, untouched) |

### Data model additions (small, additive)

- `PlanItem` (`src/types/index.ts`) gets a `pinned?: boolean` field — chosen over a separate `pinnedItemIds` array because it travels naturally with the item through `itemOrder` reorders.
- `refreshDailyPlan` (`plansSlice.ts`): pinned items are copied forward into the new day's plan instead of being cleared/archived. Their `completedItemIds` entry is reset each morning (pin carries the item forward, but "finished for today" doesn't persist across days).
- No new actions needed for snooze / tier-assign / finish-for-day — these reuse existing `plansSlice.ts` actions (`addShortTask`/`addMaintenanceTask`/etc. against `tomorrowPlan`, `togglePlanItemCompletion`).

### Cleanup flagged for the implementation plan

Not design decisions, just noted so they aren't lost:
- `Task.status === 'vandaag'` becomes fully redundant once Today membership is driven only by `dailyPlan` — the `addQuickMaintenanceTask` flow that sets it should instead add directly to `dailyPlan`'s maintenance tier.
- `DeepBlock.tsx`, `MaintenanceTier.tsx`, `ShortTasks.tsx` in `src/components/vandaag/` are already dead code (unused, superseded by `DailyPlanList`) — delete during this work rather than migrate.

---

## Edge cases

- **Dual-membership rendering**: no new sync logic — both the status-column instance and the Today-column instance of a card read from the same Zustand store, so they stay consistent automatically.
- **Pinned + Deep tier cap**: a pinned item in the Deep tier (max 1) permanently occupies that slot. Needs a visible pin icon on the card so it's clear why Deep is "full" and not just stale.
- **Standalone/orphan tasks**: `StandaloneTaskCard` gets the same three-dot menu; no project wrapper needed since it already renders directly in kanban columns.

---

## Rollout

This removes a whole view (`VandaagView`, `PlanningModal`) and is one-directional. Build the Today column + three-dot menu fully, verify it in the browser against the existing board, *then* remove `VandaagView`/`PlanningModal`/the old nav tabs in a final cleanup pass — rather than tearing out the old view before the new one is proven.
