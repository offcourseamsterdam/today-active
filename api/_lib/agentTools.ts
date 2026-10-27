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
    description: 'Creates a new task, optionally attached to a project and/or added to tomorrow\'s plan.',
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
    description: 'Updates fields on an existing task, and/or moves it between projects (or to orphan with projectId: null).',
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
    description: 'Marks a task done (sets status and completedAt). Not supported for recurring tasks.',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' } },
      required: ['taskId'],
    },
  },
  {
    name: 'drop_task',
    description: 'Marks a task dropped. This never deletes data.',
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
      "Updates status/title/category on a Vandaag project, and/or sets its trackerProjectId link. Clears waitingOn when the new status is \"done\" (mirrors the app's own status-change button). Set syncStatus: true to also push the new status to its linked tracker project after this write commits (reported in the `tracker` field of the result; never rolled back if the tracker call fails).",
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
      'Read-only: compares Vandaag projects against linked Off Course Project Tracker projects. Reports (a) status mismatches on linked pairs, (b) broken links (trackerProjectId pointing at a tracker project that no longer exists), (c) unlinked Vandaag projects with likely tracker matches by normalized title (restricted to tracker projects not already linked elsewhere), (d) tracker projects not linked from any Vandaag project, and (e) duplicates (two+ Vandaag projects linked to the same tracker project, and near-identical titles within each app). Status mismatches and duplicates always cover every project; includeDone only narrows (c)/(d).',
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
]
