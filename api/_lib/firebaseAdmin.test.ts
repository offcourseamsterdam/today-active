import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getApps, deleteApp } from 'firebase-admin/app'
import {
  getAdminApp,
  getTrackerAdminApp,
  hasTrackerAdminCredentials,
  getTrackerConfigError,
} from './firebaseAdmin'

const ENV_KEYS = [
  'TRACKER_WORKSPACE_ID',
  'TRACKER_USER_UID',
  'TRACKER_FIREBASE_PROJECT_ID',
  'TRACKER_FIREBASE_SERVICE_ACCOUNT',
  'TRACKER_FIREBASE_CLIENT_EMAIL',
  'TRACKER_FIREBASE_PRIVATE_KEY',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
  'FIRESTORE_EMULATOR_HOST',
] as const

let savedEnv: Record<string, string | undefined> = {}

beforeEach(async () => {
  savedEnv = {}
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
  await Promise.all(getApps().map(app => deleteApp(app)))
})

afterEach(async () => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  await Promise.all(getApps().map(app => deleteApp(app)))
})

describe('getTrackerConfigError / hasTrackerAdminCredentials', () => {
  it('is "not configured" when TRACKER_WORKSPACE_ID is unset', () => {
    expect(getTrackerConfigError()).toBe('Tracker is not configured')
  })

  it('is "not configured" when the workspace id is set but there are no credentials', () => {
    process.env.TRACKER_WORKSPACE_ID = 'ws1'
    expect(getTrackerConfigError()).toBe('Tracker is not configured')
  })

  it('is configured under the emulator with just a workspace id', () => {
    process.env.TRACKER_WORKSPACE_ID = 'ws1'
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080'
    expect(hasTrackerAdminCredentials()).toBe(true)
    expect(getTrackerConfigError()).toBeNull()
  })

  it('is configured via TRACKER_FIREBASE_SERVICE_ACCOUNT alone', () => {
    process.env.TRACKER_WORKSPACE_ID = 'ws1'
    process.env.TRACKER_FIREBASE_PROJECT_ID = 'other-project'
    process.env.TRACKER_FIREBASE_SERVICE_ACCOUNT = '{"project_id":"other-project"}'
    expect(getTrackerConfigError()).toBeNull()
  })

  it('reuses Vandaag credential presence when the tracker project equals FIREBASE_PROJECT_ID', () => {
    process.env.TRACKER_WORKSPACE_ID = 'ws1'
    process.env.FIREBASE_PROJECT_ID = 'main-project'
    // TRACKER_FIREBASE_PROJECT_ID left unset -> defaults to project-tracker-bc5e4, which differs
    // from main-project, so this should NOT be considered configured without tracker creds.
    expect(getTrackerConfigError()).toBe('Tracker is not configured')
  })

  it('is "not configured" when neither TRACKER_WORKSPACE_ID nor TRACKER_USER_UID is set, even with credentials', () => {
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080'
    expect(getTrackerConfigError()).toBe('Tracker is not configured')
  })

  it('is configured via TRACKER_USER_UID alone (workspace resolved later at read time)', () => {
    process.env.TRACKER_USER_UID = 'user1'
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080'
    expect(getTrackerConfigError()).toBeNull()
  })
})

describe('getAdminApp / getTrackerAdminApp', () => {
  it('getAdminApp always returns the default app, not a previously created named app', () => {
    process.env.FIREBASE_PROJECT_ID = 'main-project'
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080'
    process.env.TRACKER_WORKSPACE_ID = 'ws1'
    process.env.TRACKER_FIREBASE_PROJECT_ID = 'tracker-project'

    // Create the named tracker app FIRST, before any default app exists.
    const trackerApp = getTrackerAdminApp()
    expect(trackerApp.name).toBe('tracker')

    const defaultApp = getAdminApp()
    expect(defaultApp.name).toBe('[DEFAULT]')
    expect(defaultApp.options.projectId).toBe('main-project')
  })

  it('reuses the default app when the tracker project matches FIREBASE_PROJECT_ID', () => {
    process.env.FIREBASE_PROJECT_ID = 'main-project'
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080'
    process.env.TRACKER_WORKSPACE_ID = 'ws1'
    process.env.TRACKER_FIREBASE_PROJECT_ID = 'main-project'

    const defaultApp = getAdminApp()
    const trackerApp = getTrackerAdminApp()
    expect(trackerApp).toBe(defaultApp)
  })

  it('initializes a second named app when the tracker project differs from FIREBASE_PROJECT_ID', () => {
    process.env.FIREBASE_PROJECT_ID = 'main-project'
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080'
    process.env.TRACKER_WORKSPACE_ID = 'ws1'
    process.env.TRACKER_FIREBASE_PROJECT_ID = 'tracker-project'

    const defaultApp = getAdminApp()
    const trackerApp = getTrackerAdminApp()
    expect(trackerApp).not.toBe(defaultApp)
    expect(trackerApp.name).toBe('tracker')
    expect(trackerApp.options.projectId).toBe('tracker-project')
  })

  it('does not re-initialize the named tracker app on a second call', () => {
    process.env.FIREBASE_PROJECT_ID = 'main-project'
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080'
    process.env.TRACKER_WORKSPACE_ID = 'ws1'
    process.env.TRACKER_FIREBASE_PROJECT_ID = 'tracker-project'

    const first = getTrackerAdminApp()
    const second = getTrackerAdminApp()
    expect(first).toBe(second)
  })
})
