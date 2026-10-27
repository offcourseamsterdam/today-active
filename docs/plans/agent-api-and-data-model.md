# Agent API, the Firestore overwrite fix, and a data-model proposal

## 1. Agent API

Two authenticated entry points expose the same set of operations:

- **`POST /api/agent`** — plain HTTP, body `{ action, params }`, response `{ ok: true, result }` or `{ error }`.
- **`POST /api/mcp`** — Model Context Protocol, Streamable HTTP transport, JSON-RPC 2.0, stateless, POST-only. Supports `initialize`, `notifications/initialized`, `tools/list`, `tools/call`, `ping`.

Both are thin wrappers around the same pure operation registry (`api/_lib/agentOps.ts`) and the same transactional write path (`api/_lib/runAgentAction.ts`), so the two protocols can never drift apart in behavior.

### Auth

`Authorization: Bearer <AGENT_API_TOKEN>`, compared via SHA-256 digest + `crypto.timingSafeEqual` (`api/_lib/auth.ts`) so a wrong-length guess can't be timed. Order of checks:

1. **Config check** (`getAgentConfigError`, `api/_lib/firebaseAdmin.ts`): `AGENT_API_TOKEN` unset, or Firebase Admin credentials unset (unless `FIRESTORE_EMULATOR_HOST` is set), or no uid configured → **503**, generic message, never echoes any env value.
2. **Bearer check**: missing/wrong → **401**.

Target uid: `AGENT_UID` if set, else `WRITE_AWAY_UID` (so a single uid env var can serve both the legacy Raycast endpoint and the new agent API without duplicating config).

### Operations (`api/_lib/agentOps.ts`)

| action | params | notes |
|---|---|---|
| `list_projects` | `{ includeDone? }` | `includeDone` defaults false — hides done projects and done/dropped tasks. Each project includes `trackerProjectId` if linked |
| `list_today` | — | resolves `dailyPlan`'s id lists to full task/project objects; `null` unless the plan's date is today in **Europe/Amsterdam** |
| `list_tomorrow` | — | same, for `tomorrowPlan` and "tomorrow" |
| `list_orphan_tasks` | — | open (`backlog`) orphan tasks only |
| `add_task` | `{ title, projectId?, taskType?, nextAction?, kanbanColumn?, addToToday?, addToTomorrow? }` | mirrors the store's task factory (uuid, `status: 'backlog'`, `isRecurring: false`, …); `addToToday`/`addToTomorrow` append to `shortTasks` (or `maintenanceTasks` if `taskType === 'maintenance'`) of `dailyPlan`/`tomorrowPlan` respectively. `addToTomorrow` creates a fresh tomorrow plan if none exists or it's stale. `addToToday` instead **refreshes** a stale `dailyPlan` first — see below — so it never silently clobbers yesterday's plan |
| `update_task` | `{ taskId, title?, projectId?, taskType?, nextAction?, kanbanColumn?, addToToday?, addToTomorrow? }` | `projectId: null` moves a project task to orphan; a string moves it to that project (404 if it doesn't exist). `addToToday`/`addToTomorrow` put this existing task onto today's/tomorrow's plan — a no-op if the task is already in either tier of that plan |
| `complete_task` | `{ taskId }` | `status: 'done'`, `completedAt` set. **Rejects recurring tasks (400)** — the app itself has no wired-up path that marks a recurring task "done" (completion there is tracked via `lastCompletedDate`, which no UI currently writes); rather than invent behavior the app doesn't have, we reject with a clear error |
| `drop_task` | `{ taskId }` | `status: 'dropped'` — works for recurring tasks too, since it's a plain field flip with no derived semantics. **Never a hard delete**, anywhere |
| `add_project` | `{ title, category?, status?, trackerProjectId? }` | defaults: `category: 'personal'`, `status: 'backlog'`. `trackerProjectId` optionally links the new project to an 8-char Off Course Project Tracker project id |
| `rename_project` | `{ projectId, title?, trackerProjectId? }` | bumps `updatedAt`; at least one of `title`/`trackerProjectId` is required. `trackerProjectId: null` (or `""`) clears the link. Unchanged by this round of work |
| `update_project` | `{ projectId, title?, status?, category?, trackerProjectId?, syncStatus? }` | broader than `rename_project`: status/category too, and an optional push to the tracker. At least one of `title`/`status`/`category`/`trackerProjectId` is required. Mirrors `moveProject`'s (`src/store/projectsSlice.ts`) only status-change side effect — `waitingOn` is cleared when the new status is `done`, preserved otherwise. The WIP-limit swap-modal gate `moveProject` enforces for `in_progress`/`waiting` is a client-only UX prompt with no sensible server resolution, so it's intentionally **not** enforced here. `syncStatus: true` additionally pushes the mapped status to the linked tracker project **after** the Vandaag write commits (see below) — never rolled back if that push fails |
| `list_tracker_projects` | `{ status?, includeCompleted? }` | **Read-only.** Returns `{ workspaceId, projects }` from the separate "Off Course — Project Tracker" app/Firebase project (see below) — `workspaceId` is included so the caller can see which workspace was actually read. `status` filters to one or a list of tracker statuses; `includeCompleted` defaults true |
| `update_tracker_project` | `{ projectId, status?, title?, urgency? }` | **Tracker-only write** (`api/_lib/trackerOps.ts`). At least one of `status`/`title`/`urgency` is required. Writes only the tracker doc's `projects` field, inside a transaction — every other project and every other top-level field is untouched, and unknown fields on the target project are preserved. Returns `{ project, previousStatus }`. See "Status-transition timestamps" below |
| `tracker_sync_report` | `{ includeDone? }` | **Read-only** (`api/_lib/trackerSync.ts`). Compares Vandaag projects against tracker projects; see "Cross-app sync" below |
| `sync_tracker_status` | `{ dryRun?, projectIds? }` | Pulls tracker status into linked Vandaag projects (never the reverse). `dryRun` defaults **true** (report only); pass `false` to apply. `projectIds` optionally limits to specific Vandaag project ids. See "Cross-app sync" below |

All inputs are validated (types, enum membership from `src/types`, title length) → **400**; unknown ids → **404**.

### Tracker integration (`list_tracker_projects`, `update_tracker_project`, `api/_lib/trackerOps.ts`)

Read-only bridge into the "Off Course — Project Tracker" app's Firestore doc at `workspaces/{workspaceId}/tracker/state` (fields: `dna`, `people`, `edges`, `goals`, `frames`, `projects`). Each tracker project is normalized defensively (missing fields, `subtasks` as strings or `{title, done}` objects) and returned with `assignees` resolved from `assigneeIds` via `people`, plus `goal`/`frame` when a project's `goalId`/`frameId` resolves to one.

Config (`api/_lib/firebaseAdmin.ts`):

- `TRACKER_WORKSPACE_ID` — the workspace to read. If unset, `TRACKER_USER_UID` is used instead (see below); the absence of **both** makes `getTrackerConfigError()` return `"Tracker is not configured"`.
- `TRACKER_USER_UID` — optional. When `TRACKER_WORKSPACE_ID` is unset, this is treated as the tracker app's own user uid, and the active workspace is resolved by reading `users/{TRACKER_USER_UID}.workspaceId` from the tracker's Firestore (the tracker app can have several `workspaces` docs named "Off Course," so the uid's own user doc is the source of truth for which one is "active"). `TRACKER_WORKSPACE_ID` wins if both are set. The resolved id is returned as `workspaceId` in the tool result.
- `TRACKER_FIREBASE_PROJECT_ID` — defaults to `project-tracker-bc5e4`. If it equals Vandaag's own `FIREBASE_PROJECT_ID`, the tracker reuses Vandaag's existing default Firebase Admin app/db. Otherwise a second, **named** admin app (`"tracker"`) is lazily initialized from either `TRACKER_FIREBASE_SERVICE_ACCOUNT` (a full service-account JSON string) or `TRACKER_FIREBASE_CLIENT_EMAIL` + `TRACKER_FIREBASE_PRIVATE_KEY` (same `\n`-unescaping as Vandaag's own credentials).
- Being unconfigured only affects this one tool — it returns a generic error (never echoing env values) rather than tripping `getAgentConfigError()`'s 503 gate for the whole agent API/MCP endpoint.
- `getAdminApp()` resolves the app named `'[DEFAULT]'` specifically (not just `getApps()[0]`), so creating the named tracker app first doesn't get mistaken for Vandaag's own app.
- **Secret safety:** every Firestore read in `trackerOps.ts` goes through a wrapper (`getTrackerDbSafe`) that catches *any* failure from acquiring the tracker's admin app/db — including a malformed `TRACKER_FIREBASE_SERVICE_ACCOUNT` failing `JSON.parse` with a snippet of the secret in its own error message — and rethrows the same generic `AgentOpError(503, 'Tracker is not configured')` with no logging of the original error, so a bad secret can never leak into a response or a log line.

#### `update_tracker_project`: status-transition timestamps

The tracker app's own zustand store actions (`useAppStore.js` in its live bundle) are the source of truth for how `status`, `startedAt`, and `completedAt` move together:

```
startProject:    status -> in_progress, startedAt = existing ?? now
pauseProject:    status -> paused                       (no timestamp change)
resumeProject:   status -> in_progress                   (no timestamp change — startedAt is already set by then)
completeProject: status -> completed, completedAt = now
```

`update_tracker_project` mirrors this by resulting status rather than by observed transition (so e.g. passing `status: 'in_progress'` behaves the same whether the project was `not_started` or `paused` before, exactly like the two different buttons `startProject`/`resumeProject` do in the UI):

- `-> in_progress`: `startedAt = existing ?? now` (never clobbers an already-set `startedAt`).
- `-> completed`: `completedAt = now`, unconditionally.
- `-> paused`: no timestamp side effects.
- **Leaving `completed` for any other status: `completedAt` is cleared.** This one is *not* observed anywhere in the live bundle — there's no "uncomplete" action to mirror — so it's our own choice, made to avoid a stale completion timestamp surviving on a project that's active again. `startedAt` is never cleared by any transition (including back to `not_started`), since nothing in the app does that either.

**`urgency`:** the live bundle (`index.js`/`useAppStore.js`) has no `urgency` field anywhere in its project shape, store actions, or UI strings — the only status-adjacent enum found is an unrelated `domainStatus` (`rustig`/`actief`/`urgent`) used only by "domain" kind entries, not regular projects. Since there's no enum to validate against, `urgency` is accepted as either a string or a number and passed through as-is, undocumented by the app itself.

### Cross-app sync (`tracker_sync_report`, `sync_tracker_status`, `api/_lib/trackerSync.ts`)

Status mapping, used by both tools:

| Tracker | Vandaag |
|---|---|
| `not_started` | `backlog` |
| `in_progress` | `in_progress` |
| `paused` | `waiting` |
| `completed` | `done` |

`trackerSync.ts` has zero Firestore/HTTP imports — both tools' core logic (`buildTrackerSyncReport`, `computeTrackerStatusChanges`) are pure functions over plain `Project[]`/`TrackerProjectSummary[]` arrays; the IO (reading both apps' data, and for `sync_tracker_status`, writing Vandaag) lives in `runAgentAction.ts`.

**`tracker_sync_report`** (read-only) reports, for every Vandaag project linked via `trackerProjectId`:
- **(a) status mismatches** — the linked pair's statuses don't agree under the mapping above; includes both sides' current status and what each would need to be to agree.
- **(b) broken links** — `trackerProjectId` points at a tracker project id that no longer exists.
- **(c) unlinked-Vandaag suggestions** — for each unlinked Vandaag project, candidate tracker projects ranked by normalized-title similarity (lowercased, diacritics/punctuation stripped, whitespace collapsed; score 1 for an exact match, 0.95 for containment, else the better of token-Jaccard and a Levenshtein ratio — included at `>= 0.8`). Restricted to tracker projects **not already linked** from any Vandaag project, since a tracker project someone else already points to isn't a useful suggestion even with a perfect title match.
- **(d) unlinked tracker projects** — the same "not linked from anywhere" set from (c), listed on its own.
- **(e) duplicates** — two-or-more Vandaag projects linked to the same tracker id, plus near-identical-title pairs (same threshold as (c)) within each app separately.

`includeDone` (default `false`) only narrows (c)/(d) — a done Vandaag project or a completed tracker project isn't a useful "needs linking" suggestion by default. **(a) and (e) always consider every project regardless of status** — a status mismatch or a duplicate link is a correctness issue worth surfacing even on finished work, not something to hide behind a flag.

**`sync_tracker_status`** (write, Vandaag-only) is the one-directional pull: tracker status -> Vandaag status, for every linked project whose mapped status actually differs (a broken link is silently skipped here — that's `tracker_sync_report`'s job to surface). `dryRun` defaults to **true**; the tracker is always read first, then the (would-be) changes are computed inside the same Vandaag transaction used everywhere else, applying them — including the `moveProject` `waitingOn`-clear-on-`done` mirror — only when `dryRun: false`. It never writes to the tracker.

### `update_project` + tracker sync (`runAgentAction.ts`)

`update_project`'s `syncStatus: true` option composes the two integrations above for the single-project case: after the normal Vandaag transaction commits, if the project is linked and its status actually changed, `attachTrackerSync()` calls `update_tracker_project` with the mapped status and folds the outcome into the result as `tracker: { updated: true, previousStatus, status } | { skipped: reason } | { error: generic message }`. The Vandaag write is never rolled back if this second call fails or the project isn't linked/status didn't change — those are reported, not treated as part of the same unit of work.

### Write path

Every write runs inside `db.runTransaction`: read the doc, run the pure op against a normalized snapshot, `tx.update()` **only the changed top-level fields** (e.g. just `projects` and `tomorrowPlan`, not the whole doc) plus a fresh `syncedAt`. Reads never write (no `syncedAt` bump), which the emulator tests assert directly.

`api/_lib/agentOps.ts` has zero Firestore/HTTP imports — it's pure functions over a plain `SyncData` snapshot — so it's unit-testable without the emulator (`api/_lib/agentOps.test.ts`). The emulator tests (`tests/emulator/*.test.ts`) exercise the real transaction + auth + dispatch path end-to-end against `firebase emulators:exec`.

### Stale `dailyPlan` refresh (`src/lib/dailyPlanRollover.ts`, shared)

`addToToday` must not treat a stale `dailyPlan` (the app wasn't opened yet today) as "today's plan" and clobber it — that would silently lose yesterday's plan without archiving it. Instead it mirrors the client's `refreshDailyPlan` (`src/store/plansSlice.ts`): if `tomorrowPlan.date` is today, promote it (merging in any still-unfinished tasks rolled over from a stale `dailyPlan`, which gets archived into `planHistory`); otherwise, if `dailyPlan` is stale, archive it into `planHistory` and roll its unfinished tasks into a fresh plan for today. Only then is the task appended.

That promote/rollover computation (`computeDailyPlanRefresh` + `rolloverTasks`) lives in `src/lib/dailyPlanRollover.ts` — a pure, framework-free module imported by both the client store and `api/_lib/agentOps.ts` (`ensureTodayPlanForWrite`), so the two can't drift apart. `addToTomorrow` is unaffected — a stale `tomorrowPlan` is just rebuilt fresh, as before, since there's nothing to archive-and-roll for a plan that was never "today."

Any `planHistory`/`tomorrowPlan` changes from this refresh are included in the write's patch even if the specific task being added turns out to already be present post-rollover (and is therefore not re-added) — the archive must never be silently dropped.

### `api/write-away.ts`

Kept its request/response contract unchanged, but now shares `api/_lib/firebaseAdmin.ts`'s admin init (emulator-aware) and writes through a transaction that also bumps `syncedAt`, so its writes are picked up by the client sync fix below instead of risking being clobbered by a stale tab.

## 2. The Firestore overwrite problem, and the fix

### The problem

All user data lives in one doc, `users/{uid}`. Before this change, `useFirestoreSync` read the doc once at login, then on every local store change did a **blind `setDoc`** of the entire document, debounced 3s, plus a best-effort save on `beforeunload`. There was no listener and no merge: if the agent API (or `write-away`, or a second tab) wrote to Firestore while a tab was open, that tab's next debounced save — or its `beforeunload` save — would overwrite the doc with its own stale in-memory state, silently destroying the other write. This is the central problem the agent API would otherwise make much worse (an agent write racing an open tab is now a routine occurrence, not a rare multi-device edge case).

### The fix

`useFirestoreSync` (`src/hooks/useFirestoreSync.ts`) now:

1. Keeps **`baseRef`** — the last snapshot this client has seen-or-written. This is the three-way-merge ancestor.
2. Subscribes to the doc with `onSnapshot` (`subscribeToUserData`, `src/lib/firestore.ts`) instead of a one-time `getDoc`. The first emission doubles as the login load (cloud newer → apply to store; local newer/no doc → push up). Every later emission with `hasPendingWrites: false` is a genuine remote change:
   - If `remote.syncedAt === baseRef.current.syncedAt`, it's an echo of our own write (or a no-op) — ignored.
   - If there are no pending local edits, the remote snapshot is applied straight to the store (guarded so this doesn't re-trigger a save).
   - If local edits **are** pending, instead of waiting for the debounce timer to fire a save that would ignore the new remote state, a save is triggered immediately — which performs the merge below.
3. Every save (`saveUserDataGuarded`, `src/lib/firestore.ts`) runs inside a Firestore transaction: read the doc fresh, and
   - if `remote.syncedAt === base.syncedAt` (nothing moved since our base) → write local as-is;
   - otherwise → three-way merge `(base, local, remote)` via `src/lib/syncMerge.ts`, write that, **and apply the merged result back to the store** (so a remote-only addition, e.g. a task the agent API just added, shows up locally even though this tab never saw it as a distinct snapshot).
4. The `beforeunload`/unmount save is the same guarded path, and is skipped entirely if nothing changed locally since the last save — so it can never blind-overwrite, and doesn't do needless work.

### The merge (`src/lib/syncMerge.ts`)

Generic rule: if only one side changed a value since `base`, take that side; if both changed, local wins — **except**:

- **Entity arrays** (`projects` — including each project's nested `tasks` — `orphanTasks`, `recurringTasks`, `goals`, `meetings`, `recurringMeetings`, `writeAway`) are merged **by id**: an id added on either side is kept (not discarded as "the other side's whole-array value"); a genuine same-id conflict falls back to the generic rule, applied per-entity.
- **Plan id-lists** (`dailyPlan`/`tomorrowPlan`'s `shortTasks`, `maintenanceTasks`, `shortProjects`, `maintenanceProjects`, `meetings`, `shortMeetingIds`, `maintenanceMeetingIds`, `completedItemIds`, `pinnedItemIds`) are **unioned** on conflict rather than one side clobbering the other's additions — this is the case that matters most for the agent API (it appends to `tomorrowPlan.shortTasks` while a human might be editing the same plan locally).

All of this is a pure function (`mergeSyncData`), unit-tested in `src/lib/syncMerge.test.ts` without touching Firestore.

### Why this doesn't loop or regress

- The store-subscribe listener that schedules saves is gated by `isApplyingRemoteRef` — anything that programmatically writes remote/merged data into the store does so with that flag set, so it never re-triggers itself as a "local edit."
- The `onSnapshot` listener ignores `hasPendingWrites: true` (our own optimistic write) and recognizes the subsequent server-acked echo via the `syncedAt` match, so a save never re-triggers its own listener callback into another save.
- Login-time behavior is preserved: `localStorage`'s `vandaag-synced-at` key is still read/written exactly as before, so a page reload still compares against the last synced timestamp the same way.

## 3. Data-model proposal (document only — no migration code in this PR)

The single-doc model (`users/{uid}` holding every project, task, meeting, etc. as nested arrays) is simple to sync but has real costs that are only growing as the agent API and MCP endpoint add more concurrent writers:

- Every write — human or agent — touches the *whole* `projects` array (or `orphanTasks`, etc.), so two edits to two different projects still have to merge at the array level.
- There's no way to read or write a single task/project without pulling (and risking contention on) the entire collection it lives in.
- Firestore document writes are capped at 1 MiB; a long-lived account with years of projects/tasks is the realistic way this app could eventually hit that ceiling.

### Proposed target shape

Move the array-shaped collections into subcollections:

```
users/{uid}                         — settings, dailyPlan, tomorrowPlan, planHistory, weekSlots,
                                       personalRules, syncedAt (small, frequently-written document)
users/{uid}/projects/{projectId}    — one doc per project, tasks still nested inside (a project's
                                       tasks are always read/written together with the project, so
                                       there's little to gain from a further split there)
users/{uid}/orphanTasks/{taskId}
users/{uid}/recurringTasks/{taskId}
users/{uid}/goals/{goalId}
users/{uid}/meetings/{meetingId}
users/{uid}/recurringMeetings/{meetingId}
users/{uid}/writeAway/{entryId}
```

This turns "merge the whole array" into "write the one doc that changed," which is both cheaper and removes most of the need for application-level array merging — Firestore's own per-document last-write-wins (or a per-field transaction) covers it.

### Migration path (dual-read, backward compatible)

1. **Backfill, don't cut over.** A one-off script (not part of this PR) reads each `users/{uid}` doc and writes its `projects[]`, `orphanTasks[]`, etc. into the new subcollections, leaving the original arrays in place untouched.
2. **Dual-read period.** `src/lib/firestore.ts` reads both shapes: if the subcollections exist and have data, prefer them; otherwise fall back to the legacy arrays (so an account that hasn't been backfilled yet keeps working exactly as today). The agent API and MCP tools gain the same dual-read in `api/_lib/agentOps.ts`.
3. **Dual-write period.** Every write (client sync, agent API, write-away) writes to *both* shapes for a transition window, so either code path — old or new — always sees current data. This is the riskiest phase and should run for a full backup/rollback cycle (see below) before trusting the new shape alone.
4. **Cut over reads**, then **stop writing the legacy arrays**, then — only after a verification pass confirms no client is still reading the old shape — delete the legacy array fields.
5. **Rollback at any point** before step 4 is just "stop writing the new shape and keep reading the old one" — the legacy arrays are never touched until step 4, so rollback has no data-loss risk. After step 4, rollback would require restoring from the pre-cutover export (step 0 below).

### Before any of this runs

- **Nothing in this PR migrates data.** This section is a proposal to discuss, not a plan already in motion.
- It requires **Beer's explicit sign-off** before a single write happens.
- It requires a **full Firestore export/backup** (`gcloud firestore export`) of the production project immediately before the backfill step, so step 5's rollback path is real and tested, not theoretical.
