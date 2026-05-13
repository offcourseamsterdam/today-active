# Waiting follow-up check-in — design

**Date:** 2026-05-13
**Status:** approved, implementation pending

## Problem

`waitingOn` entries live on every project. Today they surface only on the kanban project card and inside the project modal. Users forget to follow up on them — entries rot for weeks without being acted on or removed. There is no integration with the daily planning ritual where the user already builds focus around what needs attention.

## Goals

1. Bind the follow-up check-in to the planning ritual (plan today / plan tomorrow), so stale waiting items are reviewed daily.
2. Give the user one-tap actions on each entry without leaving the planning flow.
3. Mirror the same actions on the kanban project card so the user can also act on waiting entries in context.

## Non-goals

- Replace the existing `ProjectModalWaiting` editor (per-project add/edit/remove stays).
- Surface waiting items in Vandaag, review, or anywhere outside the planning modals + kanban cards.
- Per-entry custom reminder cadences (snooze covers the same need with less friction).

## UX

### Where it appears

1. **`PlanningModal` (plan today)** — new `WaitingFollowUpPanel` above the three tiers.
2. **Plan tomorrow modal** — same panel.
3. **`ProjectCard`** on the kanban — existing waiting list replaced with the same row component, dense, actions hover-revealed.
4. **`CrossListedCard`** in the Waiting kanban column — same row component, actions hover-revealed.

### Row layout

```
[Project · Person]                              [Xd badge]   [✓] [📅] [💤] [✕]
```

On project card / cross-listed card the `Project` part is omitted (the card is the context).

### Actions

- **✓ Followed up** — sets `since` to today on that entry. Row re-sorts to bottom.
- **📅 Nudge today** — creates an orphan task `"Volg op bij {Person} — {Project}"` with `taskType: 'maintenance'`, adds it to the maintenance tier of today's plan. Entry stays in the panel.
- **💤 3d** — sets `snoozedUntil = today + 3` on the entry. Hidden from the panel until the snooze expires; staleness continues to accrue underneath.
- **✕** — removes the entry entirely.

### Filtering / sorting

- Show all entries with `status !== 'done'` projects.
- Hide entries where `snoozedUntil > today`.
- Sort: red (≥14d since `since`) → amber (7–13d) → normal (1–6d). Ties: by `since` ascending (oldest first).

### Empty state

"No one to chase today" + soft hint "Add waiting-on entries from a project card."

### Panel header

`Following up · N` (N = visible count, excludes snoozed). Collapsible (chevron).

## Schema change (additive)

```ts
// types/index.ts
export interface WaitingOn {
  person: string
  since: string         // ISO date
  snoozedUntil?: string // ISO date — hide from panel until this date
}
```

`normalizeWaitingOn()` already passes unknown fields through; no migration needed for existing entries.

## Component shape

### `WaitingEntryRow` (new, reusable)

```ts
interface WaitingEntryRowProps {
  entry: WaitingOn
  entryIndex: number          // index within project's waitingOn[]
  projectId: string
  projectTitle: string
  showProject?: boolean       // default false
  actionsHoverOnly?: boolean  // default false
  onOpenProject?: (projectId: string) => void
}
```

Owns all 4 actions internally, calls store mutations directly.

### `WaitingFollowUpPanel` (new)

Aggregates entries across `projects` (where `status !== 'done'`), sorts, renders `WaitingEntryRow` list with `showProject` true and actions always visible. Used at top of both planning modals.

### Refactors

- `ProjectCard.tsx` — replace the existing waitingEntries map with `WaitingEntryRow` (showProject=false, actionsHoverOnly=true). Buttons `stopPropagation` so dnd-kit drag + card-click-to-open are unaffected.
- `KanbanColumn.tsx` (`CrossListedCard`) — same swap.

## Store actions

No new store actions needed. All 4 actions use existing `updateProject` / `addOrphanTask` / `addMaintenanceTask` paths:

- Followed up → `updateProject(projectId, { waitingOn: <updated array with new since> })`
- Snooze → `updateProject(projectId, { waitingOn: <updated array with snoozedUntil> })`
- Remove → `updateProject(projectId, { waitingOn: <filtered array> })`
- Nudge → `addOrphanTask({ title, taskType: 'maintenance' })` then `addMaintenanceTask(newId)`

## Utility additions

In `lib/utils.ts`:

```ts
export function isWaitingSnoozed(entry: WaitingOn, today = new Date()): boolean
export function flattenWaitingEntries(projects: Project[]): Array<...>
```

## Testing

Manual via dev preview:
1. Add waiting entries on 3 projects with synthetic `since` dates spanning normal / amber / red tiers.
2. Open plan-today modal → verify panel shows all 3 sorted red→amber→normal.
3. Click ✓ Followed up → entry resorts to bottom, badge resets to 0d.
4. Click 📅 Nudge today → close modal, verify maintenance tier in Vandaag has the new "Volg op bij..." task.
5. Click 💤 3d → entry disappears; manually edit `snoozedUntil` to yesterday → entry returns on next open.
6. Click ✕ → entry gone.
7. Snooze all entries → panel shows empty state.
8. Project card on kanban — hover waiting entry → 4 buttons fade in, drag still works, click action does not open project modal.

## Out of scope (deferred)

- Configurable staleness thresholds.
- Snooze duration picker (fixed at 3 days).
- Surfacing in Vandaag header.
- Per-entry notes / context field.
