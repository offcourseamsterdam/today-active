# Objectives (Goals) — Design

**Datum:** 2026-08-22
**Status:** Approved

## Doel

Give the week view a purpose beyond scheduling: let the user write down what they're actually trying to achieve, assign projects to it, and see — automatically, with no manual upkeep — whether they're making progress and putting in enough time. An AI reviewer checks each goal against SMART criteria and pushes back when a goal doesn't clearly state what moves the business forward.

This builds directly on two prior designs:
- `2026-07-06-daglog-weekplanner-design.md` — the existing `WeekPlannerView` (7-day project-drag grid, `weekSlots`/`planHistory`).
- `2026-08-21-today-into-kanban-design.md` — which explicitly deferred week-planning integration as "a related but separate feature the user wants to design next." This is that feature.

Prerequisite: this design targets the Kanban-home model from the today-into-kanban work (Today column, dual-membership, tiers, pin/snooze/finish-for-today), not the older standalone-Vandaag-view model. The `week-view-brainstorm-6a1cfe` worktree is currently 28 commits behind that work; implementation needs to happen on top of (or be ported to) that branch state.

---

## Naming & placement

Rename the "Week" nav tab to **"Objectives."** Same view (`WeekPlannerView`, renamed accordingly), extended with a goals strip; the existing 7-day drag-and-drop grid is unchanged.

- **Goals strip** — new, across the top of the view. One chip per active goal: title, both progress indicators (see below), target date.
- **Day grid** — mechanics unchanged (past days read-only from `planHistory`, today from `dailyPlan`, future days editable via `weekSlots`). What changes: `WeekProjectCard` gets a small goal-color indicator (dot or left edge) whenever `project.goalId` is set. This is the point of the whole feature — at a glance, the grid answers not just "what am I doing which day" but "which goal is that day's work actually serving." Projects with no goal show no indicator, which is itself a visible signal (unassigned work sitting on the calendar).
- **Project sidebar** — currently grouped by status (Actief/Backlog). Changes to grouped-by-goal: each goal a collapsible section (title + both progress indicators, accented with the goal's color), its linked projects listed underneath as drag sources, an "Unassigned" section at the bottom for projects with no `goalId`. Drag-to-day behavior is unchanged.

Projects remain the only draggable unit on this view — tasks are explicitly out of scope, matching the original weekplanner design's scoping.

---

## Data model

Additive only; no existing fields change shape.

```typescript
export interface Goal {
  id: string
  title: string              // what you want to achieve
  description?: string       // the "why" — what business outcome this drives
  startDate: string           // YYYY-MM-DD
  targetDate: string          // YYYY-MM-DD
  targetDaysWorked?: number   // optional effort target, e.g. 20
  color: string                // small fixed palette; ties sidebar section, strip chip, and day-grid card indicator together visually
  createdAt: string
  updatedAt: string
}
```

`Project` gets one new optional field:

```typescript
goalId?: string   // one goal per project — no multi-goal linking
```

Store: new `goals: Goal[]` array (Zustand slice, e.g. `goalsSlice.ts`), persisted and synced to Firestore the same way `planHistory`/`weekSlots` are (`SyncData` in `firestore.ts`).

New store actions:
```typescript
addGoal(goal: Omit<Goal, 'id' | 'createdAt' | 'updatedAt'>): void
updateGoal(id: string, patch: Partial<Goal>): void
deleteGoal(id: string): void
assignProjectToGoal(projectId: string, goalId: string | null): void
```

---

## Progress

Two facets, computed on read (no new stored aggregate state), shown side by side rather than conflated into one number:

- **Completion** — `done projects / total linked projects` among projects with `project.goalId === goal.id`. Shows "no projects linked yet" state when total is 0.
- **Effort/pace** — sum of `daysWorkedLog` entries across linked projects, counting only dates within `[goal.startDate, min(today, goal.targetDate)]`, against `goal.targetDaysWorked`. Only shown when a target is set. This reuses the existing `daysWorked`/`daysWorkedLog` mechanism on `Project` — no timer, no new time-tracking (the app deliberately removed its Pomodoro/timer feature previously; this does not reintroduce it).

Date-range filtering (rather than link-time filtering) means days already logged on a project before it was linked to a goal still count, as long as they fall inside the goal's window — keeps the model simple, no need to track "when was this project linked."

---

## Lifecycle

A goal is **active** while today falls within `[startDate, targetDate]` (or `targetDate` is still ahead). Once `targetDate` passes, it drops into a collapsed **"Past objectives"** section in the strip/sidebar, read-only — mirroring how past days already work in the grid. No separate archive/complete action for v1; progress numbers already show whether it was hit.

---

## AI SMART reviewer

New endpoint `api/goal-review.ts`, following the existing stateless pattern (`api/done-reflection.ts`, `api/project-decisions.ts`): POST, `gpt-4o`, `response_format: json_object`, system prompt encodes the rubric.

**Trigger**: on-demand only, via a "Review objective" button in the goal create/edit form. Non-blocking — a goal can be saved as a rough draft and reviewed any time, suggestions can be ignored entirely.

**Request body**:
```typescript
{
  title: string
  description?: string
  startDate: string
  targetDate: string
  targetDaysWorked?: number
  linkedProjectTitles: string[]
  otherActiveGoalTitles: string[]   // for redundancy/conflict sanity-check
  personalRules: string[]           // existing settingsSlice data, reused as-is
}
```

**Response body** — one entry per SMART letter, each a pass/fail plus a concrete note:
```typescript
{
  specific: { pass: boolean; note: string }
  measurable: { pass: boolean; note: string }
  achievable: { pass: boolean; note: string }
  relevant: { pass: boolean; note: string }
  timeBound: { pass: boolean; note: string }
}
```

There is no stored "business strategy" document anywhere in the app to check goals against, and this design doesn't add one. For the **Relevant** check specifically, the model works from the goal's own `description` plus the user's existing `personalRules` — if the description doesn't explain what business outcome the goal drives, the reviewer says so and asks for it, rather than silently passing or fabricating business context it doesn't have.

**UI**: the checklist renders inline below the goal form after a review, five short lines. No persistence of past reviews — re-running review re-evaluates the current draft.

---

## Components

| Component | Change |
|---|---|
| `WeekPlannerView` → conceptually "Objectives" | Add goals strip above existing grid |
| `WeekProjectSidebar` | Regroup by `goalId` instead of `status`; add "Unassigned" bucket |
| `WeekProjectCard` | Add goal-color indicator (dot/edge) when `project.goalId` is set — the grid, not just the sidebar, shows goal linkage |
| `GoalChip` (new) | Strip item: title, completion + effort progress, target date |
| `GoalForm` (new) | Create/edit modal: title, description, dates, target days, color, "Review objective" button + checklist result |
| `api/goal-review.ts` (new) | SMART-review endpoint |
| `goalsSlice.ts` (new) | `goals` state + CRUD actions |

---

## Out of scope

- Multi-goal projects (one `goalId` per project only).
- Actual hour/timer tracking — effort stays day-granularity (`daysWorked`).
- Goal templates, reminders/notifications about pace.
- A separate stored business-context/strategy document — the AI reviewer works from the goal's own text plus existing `personalRules`.
- Tasks on the Objectives view — projects only, same as the original weekplanner scoping.
