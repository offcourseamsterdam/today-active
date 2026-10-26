import { initializeApp, getApps, cert, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

export function isEmulator(): boolean {
  return !!process.env.FIRESTORE_EMULATOR_HOST
}

function createAdminApp(): App {
  if (isEmulator()) {
    // The emulator ignores credentials entirely; it only needs a project id,
    // which must match whatever --project the emulator was started with.
    return initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'demo-vandaag',
    })
  }
  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

const DEFAULT_APP_NAME = '[DEFAULT]'
const TRACKER_APP_NAME = 'tracker'
export const DEFAULT_TRACKER_FIREBASE_PROJECT_ID = 'project-tracker-bc5e4'

export function getAdminApp(): App {
  const existing = getApps().find(app => app.name === DEFAULT_APP_NAME)
  if (existing) return existing
  return createAdminApp()
}

export function getDb(): Firestore {
  return getFirestore(getAdminApp())
}

function trackerFirebaseProjectId(): string {
  return process.env.TRACKER_FIREBASE_PROJECT_ID || DEFAULT_TRACKER_FIREBASE_PROJECT_ID
}

/** True when the tracker project is the same Firebase project Vandaag itself uses — reuse the default app/db. */
function trackerUsesDefaultApp(): boolean {
  return trackerFirebaseProjectId() === process.env.FIREBASE_PROJECT_ID
}

function createTrackerAdminApp(): App {
  const projectId = trackerFirebaseProjectId()
  if (isEmulator()) {
    return initializeApp({ projectId }, TRACKER_APP_NAME)
  }
  const serviceAccountJson = process.env.TRACKER_FIREBASE_SERVICE_ACCOUNT
  if (serviceAccountJson) {
    const parsed = JSON.parse(serviceAccountJson) as { project_id?: string; client_email?: string; private_key?: string }
    return initializeApp(
      {
        credential: cert({
          projectId: parsed.project_id || projectId,
          clientEmail: parsed.client_email,
          privateKey: parsed.private_key?.replace(/\\n/g, '\n'),
        }),
      },
      TRACKER_APP_NAME,
    )
  }
  return initializeApp(
    {
      credential: cert({
        projectId,
        clientEmail: process.env.TRACKER_FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.TRACKER_FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    },
    TRACKER_APP_NAME,
  )
}

/** The tracker app: the default Vandaag app if the tracker lives in the same Firebase project, else a named second app. */
export function getTrackerAdminApp(): App {
  if (trackerUsesDefaultApp()) return getAdminApp()
  const existing = getApps().find(app => app.name === TRACKER_APP_NAME)
  if (existing) return existing
  return createTrackerAdminApp()
}

export function getTrackerDb(): Firestore {
  return getFirestore(getTrackerAdminApp())
}

/** True when the tracker integration has everything it needs to talk to Firestore. */
export function hasTrackerAdminCredentials(): boolean {
  if (trackerUsesDefaultApp()) return hasAdminCredentials()
  if (isEmulator()) return true
  return !!(
    process.env.TRACKER_FIREBASE_SERVICE_ACCOUNT ||
    (process.env.TRACKER_FIREBASE_CLIENT_EMAIL && process.env.TRACKER_FIREBASE_PRIVATE_KEY)
  )
}

export function getTrackerWorkspaceId(): string | undefined {
  return process.env.TRACKER_WORKSPACE_ID
}

/** Tracker-app uid whose `users/{uid}.workspaceId` resolves the workspace when TRACKER_WORKSPACE_ID is unset. */
export function getTrackerUserUid(): string | undefined {
  return process.env.TRACKER_USER_UID
}

/**
 * Null when the tracker integration is fully configured; otherwise a safe, generic
 * message (never echoes env values) suitable for a tool-level error.
 */
export function getTrackerConfigError(): string | null {
  if (!getTrackerWorkspaceId() && !getTrackerUserUid()) return 'Tracker is not configured'
  if (!hasTrackerAdminCredentials()) return 'Tracker is not configured'
  return null
}

/** True when the admin SDK has everything it needs to talk to Firestore (emulator, or real credentials). */
export function hasAdminCredentials(): boolean {
  if (isEmulator()) return true
  return !!(
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  )
}

/** Target uid for the agent API / MCP endpoint: AGENT_UID if set, else WRITE_AWAY_UID. */
export function getAgentUid(): string | undefined {
  return process.env.AGENT_UID || process.env.WRITE_AWAY_UID
}

/**
 * Null when fully configured; otherwise a safe, generic message (never echoes
 * env values) suitable for a 503 response.
 */
export function getAgentConfigError(): string | null {
  if (!process.env.AGENT_API_TOKEN) return 'Agent API is not configured'
  if (!hasAdminCredentials()) return 'Agent API is not configured'
  if (!getAgentUid()) return 'Agent API is not configured'
  return null
}
