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

export function getAdminApp(): App {
  const existing = getApps()
  if (existing.length > 0) return existing[0]
  return createAdminApp()
}

export function getDb(): Firestore {
  return getFirestore(getAdminApp())
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
