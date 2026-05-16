# Make Task Actionable — AI feature design

**Date:** 2026-05-16
**Status:** approved, implementation pending

## Problem

Tasks are often vague ("Tochtjes aanvragen", "alle listings updaten", "halvey's check-in"). GTD says a task should describe the **very next physical action** — concrete enough that you can start it in <2 minutes. The user manually rewrites tasks but it's friction. An AI feature can do this transformation on demand, and learn from accepted edits over time.

## Goals

1. One click per task → AI produces a more actionable version (concrete next action, channel, optional draft).
2. One click per project → process all active tasks in batch with a preview-checklist.
3. Capture every accept/edit/reject as feedback so suggestions improve over weeks.

## Non-goals (v1)

- Settings UI for the user's tool list (hardcoded defaults; editable in v1.1).
- Niveau-2 preference-profile (synthesized after 50+ feedback entries).
- Auto-trigger on vague tasks (everything is opt-in via click).
- Working on orphan/recurring tasks (v1 = project-scoped tasks only).

## UX

### Per-task trigger

Inside `ProjectModalTasks.tsx`, every `SortableTaskRow` gets a sparkle ✨ button between the subtask-chip and the delete button. Hover-revealed, like the other row actions.

Click → opens `MakeActionablePanel` (a small floating modal or inline card under the task). The panel:
1. Shows loading state ("AI denkt na...")
2. Renders one of three output forms (see below)
3. Has `Accepteer` / `Bewerk` / `Verwerp` buttons; all log feedback to Firestore

### Bulk trigger

Header of TASKS section in `ProjectModalTasks.tsx` gets a button: `✨ Maak X taken actionable` (X = count of active tasks). Click → opens `MakeActionableBulkPanel` modal:
1. Single batched API call processes all active tasks
2. Renders a list, one row per task: original title → suggested change (with channel chip)
3. Checkbox per row, all checked by default
4. Bottom: `Pas toe op N taken` + `Annuleer`

### Output forms

The AI classifies each task and returns ONE of:

**1. Concrete action** (small, clear task)
```
Nieuwe titel: "Google Ads → Bril Mij ad group op pause"
Channel:      Google Ads dashboard
Draft:        (optioneel concept-bericht, alleen voor Slack/Gmail/phone-script)
```

**2. Subtasks** (task is too big for one action)
```
Hernoem hoofdtask naar:  "Tochtjes aanvragen"  (ongewijzigd, of lichte rewrite)
Subtaken (worden geschreven naar task.subtasks):
  - Lijst maken van tochten die geboekt moeten worden
  - Alexander mailen om boot te reserveren
  - Sebastiaan bevestigen via WhatsApp
  - Confirmaties verwerken in admin panel
```

**3. Alternatives** (ambigue: meerdere zinnige routes)
```
Optie A: Slack DM Jannah over €40
Optie B: Email Jannah met breakdown van Marchella's uitgaven
Optie C: Bel Jannah morgen tussen 10–11
```
User picks one → fills out as Concrete Action.

## Data model

### Task additions (additive, no migration)

```ts
// types/index.ts
export interface Task {
  // ... existing fields ...
  actionableChannel?: string   // 'Slack' | 'Gmail' | 'Boat Local admin' | 'phone' | 'Google Ads' | ...
  actionableDraft?: string     // optioneel concept-bericht (markdown)
}
```

### AI feedback collection

New Firestore sub-collection `users/{uid}/aiFeedback/{entryId}`:
```ts
export interface AIFeedbackEntry {
  id: string
  taskId: string
  projectId?: string
  original: string             // original task title
  suggested: string            // AI's suggested rewrite (the concrete-action title or first subtask)
  channel?: string             // AI's suggested channel
  outcome: 'accepted' | 'edited' | 'rejected'
  userVersion?: string         // if edited: what the user kept
  createdAt: string            // ISO
}
```

### Settings additions

```ts
// settings slice
userTools: string[]   // default: ['Slack', 'Gmail', 'Boat Local admin', 'phone']
```

Not exposed in UI in v1 — hardcoded default if the field is missing.

## API endpoint — `api/make-actionable.ts`

Vercel serverless, POST.

**Request:**
```ts
{
  tasks: Array<{
    id: string
    title: string
    notes?: string                  // currently no task.notes field; placeholder for future
    subtasks?: Array<{ title: string; done: boolean }>
  }>
  project: {
    title: string
    notes?: string                  // first ~500 chars
    waitingOn?: Array<{ person: string; since: string }>
  }
  userTools: string[]
  recentFeedback: AIFeedbackEntry[] // last 15 'accepted' or 'edited'
}
```

**Response:**
```ts
{
  results: Array<{
    taskId: string
    type: 'concrete' | 'subtasks' | 'alternatives'
    newTitle?: string               // for 'concrete' or 'subtasks'
    channel?: string                // 'concrete' only
    draftMessage?: string           // 'concrete' only, optional
    subtasks?: Array<{ title: string }>
    alternatives?: Array<{          // 'alternatives' only
      title: string
      channel?: string
      draftMessage?: string
    }>
    reasoning?: string              // short explanation, shown subtly in UI
  }>
}
```

**Model:** `gpt-4o-mini`, low temperature (0.3), `response_format: { type: 'json_object' }`.

**System prompt** (excerpt, Dutch-aware):
> Je bent een productiviteitsassistent die taken transformeert naar concrete next-actions volgens David Allen's GTD-principe. Voor elke taak: classificeer of het (1) één concrete actie is, (2) te groot is en gesplitst moet, of (3) ambigue met meerdere zinnige paden. De gebruiker werkt met deze tools: {userTools}. Schrijf antwoorden in dezelfde taal als de input (vaak Nederlands). Houd titels onder 80 tekens. Voorbeelden van eerder werk van deze gebruiker: {recentFeedback as few-shot}.

## Components

### `MakeActionablePanel.tsx` (per task)
Props: `task`, `project`, `onAccept(updates)`, `onClose()`. 
- Fires API call on mount with `tasks: [task]`
- Renders output form based on `result.type`
- For `subtasks`: shows new title + bulleted subtasks, accept writes title + creates subtasks
- For `concrete`: shows new title + channel chip + draft (collapsible), accept writes title + actionableChannel + actionableDraft
- For `alternatives`: 3 cards, click one to fill into Concrete-action form
- `Bewerk` mode: inline editing of suggested title/draft before accepting
- Accept/Edit/Reject all call `logAIFeedback({ outcome, ... })`

### `MakeActionableBulkPanel.tsx` (project-wide)
Props: `project`, `onClose()`.
- Fires single batched API call with all active tasks
- Renders list with checkboxes per task
- On `Pas toe op N taken`: iterates checked items, applies updates, logs feedback per task
- Discarded items log `outcome: 'rejected'`

### `lib/aiFeedback.ts`
Helpers:
- `loadRecentAIFeedback(uid, limit=15): Promise<AIFeedbackEntry[]>`
- `writeAIFeedback(uid, entry): Promise<void>`

### Sparkle button in `SortableTaskRow`
Small ✨ button revealed on hover, between SubtaskChip and delete. Opens `MakeActionablePanel`.

### Bulk button in `ProjectModalTasks`
Header has new button `✨ Maak X taken actionable` (X = active task count). Disabled if X = 0. Opens `MakeActionableBulkPanel`.

## Error handling

| Case | Behavior |
|---|---|
| `OPENAI_API_KEY` missing in env | API returns 503 + message; UI shows "AI niet geconfigureerd — voeg OPENAI_API_KEY toe in Vercel" with link to settings |
| API timeout (>15s) | Show "AI traag, probeer opnieuw" with retry button |
| OpenAI rate-limit (429) | Show "Even wachten, probeer over 30 sec opnieuw"; disable button for 30s |
| Invalid JSON response | Fall back to rendering raw text + manual edit textarea |
| Firestore write fails (feedback) | Silent fail — log to console, don't block the user from accepting |

## Learning (Level 1)

Implementation:
1. After accept/edit/reject, call `writeAIFeedback(uid, { taskId, original, suggested, channel, outcome, userVersion, createdAt })`.
2. Before each AI call (per-task or bulk), call `loadRecentAIFeedback(uid, 15)` and pass into request body.
3. API system prompt includes these as few-shot examples in the format:
   ```
   Voorbeelden van eerder geaccepteerde transformaties van deze gebruiker:
     "checken bij jannah over €40" → "Slack DM Jannah: €40 + drankjes van Marchella?"
     "alle listings updaten" → "Boat Local admin: top 5 oudste listings updaten"
   ```

After ~50 entries, v1.1 will add a periodic summarization pass that produces a "preference profile" string stored separately and injected into every prompt.

## Testing plan (manual, dev preview)

1. **Concrete task path**: Add a task "Bril Mij groep pauzeren" to any project. Click ✨. Verify: panel shows "concrete" result with channel chip. Accept → task title updates, `actionableChannel` written.
2. **Subtasks path**: Add "Tochtjes aanvragen". Click ✨. Verify: panel shows 2–5 suggested subtasks. Accept → subtasks added to `task.subtasks`.
3. **Alternatives path**: Add "halvey's check-in". Click ✨. Verify: 2–3 options shown. Pick one → fills in Concrete form. Accept.
4. **Bulk**: Project with 5 mixed tasks. Click bulk button. Verify: preview with checkboxes; uncheck one; apply → only checked ones change.
5. **Edit**: Click ✨ on a task. Click Bewerk → edit the suggested title → Accept. Verify: `userVersion` is logged in `aiFeedback` and matches the edit.
6. **Reject**: Click ✨ → Verwerp. Verify: task unchanged, `outcome: 'rejected'` logged.
7. **Few-shot loop**: After 5 acceptances, run again on a similar task → verify the AI output reflects the user's style (e.g. uses Slack for Jannah if that was a previous pattern).
8. **Error**: Temporarily mis-set `OPENAI_API_KEY` → verify error UI.

## Production prerequisite

`OPENAI_API_KEY` must be set in Vercel project Production environment (`halveybeers-projects/vandaag-app`). Without it, the feature returns 503 and the UI shows the not-configured message. To add: Vercel dashboard → Settings → Environment Variables → Production → `OPENAI_API_KEY` → redeploy.

## Files to create

- `docs/plans/2026-05-16-make-actionable-design.md` (this file)
- `api/make-actionable.ts`
- `src/components/kanban/MakeActionablePanel.tsx`
- `src/components/kanban/MakeActionableBulkPanel.tsx`
- `src/lib/aiFeedback.ts`

## Files to modify

- `src/types/index.ts` — add `actionableChannel`, `actionableDraft` to `Task`; add `AIFeedbackEntry`
- `src/components/kanban/ProjectModalTasks.tsx` — add bulk button + wire panels
- (`SortableTaskRow` lives in ProjectModalTasks.tsx) — add sparkle button
- `src/store/settingsSlice.ts` or equivalent — add `userTools` default
