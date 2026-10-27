/** MCP `tools/list` definitions — one entry per action in agentOps.ts. Shared so the plain HTTP API and MCP stay in sync. */
export interface McpToolDef {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

const TASK_TYPE_ENUM = ['deep', 'short', 'maintenance', 'reminder']
const PROJECT_STATUS_ENUM = ['backlog', 'in_progress', 'waiting', 'done']
const CATEGORY_ENUM = ['marketing', 'ops', 'admin', 'finance', 'product', 'personal']
const TRACKER_STATUS_ENUM = ['not_started', 'in_progress', 'paused', 'completed']

export const MCP_TOOLS: McpToolDef[] = [
  {
    name: 'list_projects',
    description: 'Lists all projects with their tasks (id, title, status, category, trackerProjectId if linked, tasks summary).',
    inputSchema: {
      type: 'object',
      properties: {
        includeDone: { type: 'boolean', description: 'Include done/dropped tasks and done projects. Default false.' },
      },
    },
  },
  {
    name: 'list_today',
    description: "Resolves today's daily plan (deep block, short tasks, maintenance tasks) to full task/project objects. Returns null if there is no plan for today.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_tomorrow',
    description: "Resolves tomorrow's plan to full task/project objects. Returns null if there is no plan for tomorrow.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_orphan_tasks',
    description: 'Lists open (backlog) tasks that are not attached to any project.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'add_task',
    description: 'Creates a new task, optionally attached to a project and/or added to tomorrow\'s plan. If projectId is given and that project is linked to a tracker project, also best-effort creates a mirrored subtask there (reported in the `tracker` field: `{updated: true}` | `{skipped}` | `{error}`; omitted entirely when the project isn\'t linked).',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Required.' },
        projectId: { type: 'string', description: 'Attach to this project; omit for an orphan task.' },
        taskType: { type: 'string', enum: TASK_TYPE_ENUM },
        nextAction: { type: 'string' },
        kanbanColumn: { type: 'string', enum: PROJECT_STATUS_ENUM },
        addToToday: { type: 'boolean', description: 'Append to today\'s plan (short tier, or maintenance tier if taskType is "maintenance").' },
        addToTomorrow: { type: 'boolean', description: 'Append to tomorrow\'s plan (short tier, or maintenance tier if taskType is "maintenance").' },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_task',
    description: 'Updates fields on an existing task, and/or moves it between projects (or to orphan with projectId: null). Best-effort mirrors a title change or a project move into/out of a tracker-linked project (reported in `tracker`, same convention as add_task).',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        title: { type: 'string' },
        projectId: { type: ['string', 'null'], description: 'Move to this project, or null to make it an orphan task.' },
        taskType: { type: 'string', enum: TASK_TYPE_ENUM },
        nextAction: { type: 'string' },
        kanbanColumn: { type: 'string', enum: PROJECT_STATUS_ENUM },
        addToToday: { type: 'boolean', description: "Add this task to today's plan if it isn't already on it (checks both tiers; no-op if already present)." },
        addToTomorrow: { type: 'boolean', description: "Add this task to tomorrow's plan if it isn't already on it (checks both tiers; no-op if already present)." },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'complete_task',
    description: 'Marks a task done (sets status and completedAt). Not supported for recurring tasks. Best-effort pushes done: true to a tracker-linked project\'s mirrored subtask (reported in `tracker`, same convention as add_task).',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' } },
      required: ['taskId'],
    },
  },
  {
    name: 'drop_task',
    description: 'Marks a task dropped. This never deletes data. Best-effort removes the mirrored subtask from a tracker-linked project (reported in `tracker`, same convention as add_task).',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' } },
      required: ['taskId'],
    },
  },
  {
    name: 'add_project',
    description: 'Creates a new project.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        category: { type: 'string', enum: CATEGORY_ENUM, description: 'Defaults to "personal".' },
        status: { type: 'string', enum: PROJECT_STATUS_ENUM, description: 'Defaults to "backlog".' },
        trackerProjectId: {
          type: 'string',
          description: 'Links this project to an 8-char Off Course Project Tracker project id.',
        },
        marketingCode: { type: 'string', description: 'The UTM/source code used in this project\'s marketing links. Max 200 chars.' },
        marketingPeriod: {
          type: 'object',
          properties: {
            from: { type: 'string', description: 'YYYY-MM-DD' },
            to: { type: 'string', description: 'YYYY-MM-DD' },
          },
          description: 'Campaign window. from must be on or before to when both are set.',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'rename_project',
    description: "Renames a project (bumps its updatedAt) and/or sets its trackerProjectId link.",
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        title: { type: 'string' },
        trackerProjectId: {
          type: ['string', 'null'],
          description: 'Links this project to an 8-char Off Course Project Tracker project id, or null to clear the link.',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'update_project',
    description:
      "Updates status/title/category/marketingCode/marketingPeriod on a Vandaag project, and/or sets its trackerProjectId link. Clears waitingOn when the new status is \"done\" (mirrors the app's own status-change button). Set syncStatus: true to also push the new status to its linked tracker project after this write commits (reported in the `tracker` field of the result; never rolled back if the tracker call fails).",
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        title: { type: 'string' },
        status: { type: 'string', enum: PROJECT_STATUS_ENUM },
        category: { type: 'string', enum: CATEGORY_ENUM },
        trackerProjectId: {
          type: ['string', 'null'],
          description: 'Links this project to an 8-char Off Course Project Tracker project id, or null to clear the link.',
        },
        marketingCode: {
          type: ['string', 'null'],
          description: 'The UTM/source code used in this project\'s marketing links. Max 200 chars. Null or "" clears it.',
        },
        marketingPeriod: {
          type: ['object', 'null'],
          properties: {
            from: { type: 'string', description: 'YYYY-MM-DD' },
            to: { type: 'string', description: 'YYYY-MM-DD' },
          },
          description: 'Campaign window. from must be on or before to when both are set. Null clears it; an object with neither from nor to also clears it.',
        },
        syncStatus: {
          type: 'boolean',
          description: 'If true and the project is linked and its status changed, also push the mapped status to the tracker project.',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'list_tracker_projects',
    description:
      'Read-only: lists projects from the Off Course Project Tracker app (a separate workspace from Vandaag), with assignees resolved to names. Returns `{ workspaceId, projects }` so the caller can see which workspace was read. Returns a "Tracker is not configured" error if TRACKER_WORKSPACE_ID/TRACKER_USER_UID etc. are not set.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: ['string', 'array'],
          items: { type: 'string' },
          description: 'Filter to one or more tracker statuses (e.g. "in_progress", or ["in_progress", "paused"]).',
        },
        includeCompleted: { type: 'boolean', description: 'Include projects with status "completed". Defaults to true.' },
      },
    },
  },
  {
    name: 'update_tracker_project',
    description:
      'Writes to a project in the Off Course Project Tracker app: status, title, and/or urgency (at least one required). Status transitions mirror the tracker app\'s own buttons: moving to "in_progress" sets startedAt if not already set; moving to "completed" sets completedAt to now; moving away from "completed" clears completedAt. Only the targeted project changes — every other project and top-level field in the tracker doc is left untouched. Returns the updated project summary plus its previous status.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: '8-char Off Course Project Tracker project id.' },
        status: { type: 'string', enum: TRACKER_STATUS_ENUM },
        title: { type: 'string' },
        urgency: {
          type: ['string', 'number'],
          description: 'The live tracker app has no fixed urgency enum, so either a string or a number is accepted as-is.',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'tracker_sync_report',
    description:
      'Read-only: compares Vandaag projects against linked Off Course Project Tracker projects. Reports (a) status mismatches on linked pairs, (b) broken links (trackerProjectId pointing at a tracker project that no longer exists), (c) unlinked Vandaag projects with likely tracker matches by normalized title (restricted to tracker projects not already linked elsewhere), (d) tracker projects not linked from any Vandaag project, (e) duplicates (two+ Vandaag projects linked to the same tracker project, and near-identical titles within each app), and (f) a `tasks` section — `pendingChanges` (what sync_tracker_tasks would do) and `unlinkedSubtasks` (tracker subtasks with no vandaagTaskId link). Status mismatches and duplicates always cover every project; includeDone only narrows (c)/(d). Also opportunistically logs any tracker-app drift detected since the last sync call (see list_changes).',
    inputSchema: {
      type: 'object',
      properties: {
        includeDone: {
          type: 'boolean',
          description: 'Include done Vandaag projects and completed tracker projects in the unlinked/suggestion lists (c, d). Defaults to false. Mismatches (a) are always reported regardless.',
        },
      },
    },
  },
  {
    name: 'sync_tracker_status',
    description:
      'Pulls tracker status into linked Vandaag projects using the same status mapping as tracker_sync_report (not_started<->backlog, in_progress<->in_progress, paused<->waiting, completed<->done). Defaults to a dry run that only reports what would change; pass dryRun: false to actually apply the changes to Vandaag. Never writes to the tracker.',
    inputSchema: {
      type: 'object',
      properties: {
        dryRun: { type: 'boolean', description: 'Defaults to true (report only). Pass false to apply the changes.' },
        projectIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Limit to these Vandaag project ids. Omit to consider every linked project.',
        },
      },
    },
  },
  {
    name: 'sync_tracker_tasks',
    description:
      'Two-way sync between Vandaag project tasks and Off Course Project Tracker subtasks, for every project linked via trackerProjectId (or just projectIds). A tracker subtask carries vandaagTaskId once linked; matching is always by that id, never by title, so nothing is ever duplicated. Per linked task: creates a subtask if none exists; removes it if the task was dropped; moves it if the task moved to a different linked project; otherwise resolves any title/done disagreement using the last-seen tracker snapshot — only the side that actually changed since the last sync wins, or if both changed, title follows Vandaag and done is sticky-true (never un-synced back to open; an exclusive tracker-side un-complete still works). Tracker subtasks with no vandaagTaskId are left alone and reported as unlinkedSubtasks, unless importUnlinked creates a Vandaag task for them and stamps the link on. Defaults to a dry run (dryRun: true) that only reports the plan; pass dryRun: false to apply it to both sides. Returns { dryRun, changes, unlinkedSubtasks, importedTasks, tracker }, where tracker mirrors the {updated}|{skipped}|{error} convention used elsewhere for the tracker-side write.',
    inputSchema: {
      type: 'object',
      properties: {
        projectIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Limit to these Vandaag project ids. Omit to consider every linked project.',
        },
        dryRun: { type: 'boolean', description: 'Defaults to true (report only). Pass false to apply the changes to both Vandaag and the tracker.' },
        importUnlinked: {
          type: 'boolean',
          description: 'Defaults to false. When true, creates a Vandaag task (in the linked project) for every unlinked tracker subtask and stamps vandaagTaskId onto it.',
        },
      },
    },
  },
  {
    name: 'list_changes',
    description:
      'Read-only: lists change-log entries (users/{uid}/changes), newest first. Logs every agent-API write (side "agent") plus tracker-app drift detected on sync/report calls (side "tracker"). before/after only ever contain the fields that actually changed.',
    inputSchema: {
      type: 'object',
      properties: {
        since: { type: 'string', description: 'ISO timestamp; only entries at or after this time.' },
        side: { type: 'string', enum: ['vandaag', 'tracker', 'agent'] },
        entity: { type: 'string', enum: ['project', 'task', 'subtask', 'deepBlock'] },
        limit: { type: 'number', description: 'Defaults to 50, max 500.' },
      },
    },
  },
  {
    name: 'complete_deep_block',
    description:
      'Marks a deep block done for a date (defaults to today, Europe/Amsterdam) and records it in the durable deep-block log used by deep_block_stats. For today, also mirrors the app\'s own "Done" button: clears dailyPlan.deepBlock.projectId and stamps completedProjectTitle/completedAt (rolling over a stale dailyPlan first, same as addToToday). Idempotent per date. category defaults to the active deep-block project\'s category (marketing -> "marketing", everything else -> "other"); required explicitly for a non-today date or when there is no active project to derive it from.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD, defaults to today (Europe/Amsterdam).' },
        category: { type: 'string', enum: ['marketing', 'other'] },
      },
    },
  },
  {
    name: 'deep_block_stats',
    description:
      'Read-only: weekly deep-block completion counts (per ISO week, Europe/Amsterdam) for the trailing N weeks, split by category, plus current/longest streak. Streaks count consecutive workdays (Mon-Fri) with at least one completion — weekends neither break nor extend a streak, though a weekend completion still counts in that week\'s totals. The current streak gives today a grace day (not done yet doesn\'t break it, since the day isn\'t over).',
    inputSchema: {
      type: 'object',
      properties: {
        weeks: { type: 'number', description: 'Defaults to 8, max 52.' },
      },
    },
  },
]
