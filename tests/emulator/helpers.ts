import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getDb } from '../../api/_lib/firebaseAdmin'
import type { SyncData } from '../../api/_lib/agentOps'

export const TEST_TOKEN = 'test-token'

/** Sets the env vars every emulator test needs; call once in a `beforeAll`. */
export function configureAgentEnv(uid: string): void {
  process.env.AGENT_API_TOKEN = TEST_TOKEN
  process.env.AGENT_UID = uid
  delete process.env.WRITE_AWAY_UID
  delete process.env.WRITE_AWAY_SECRET
}

export function emptySyncData(overrides: Partial<SyncData> = {}): SyncData {
  return {
    projects: [],
    orphanTasks: [],
    recurringTasks: [],
    meetings: [],
    recurringMeetings: [],
    settings: { inProgressLimit: 5, planningTime: 'evening', contexts: [], inProgressLimitChangeLog: [] },
    dailyPlan: null,
    tomorrowPlan: null,
    planHistory: {},
    weekSlots: {},
    goals: [],
    personalRules: [],
    writeAway: [],
    syncedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

export async function seedUserDoc(uid: string, data: Partial<SyncData> = {}): Promise<void> {
  await getDb().collection('users').doc(uid).set(emptySyncData(data))
}

export async function readUserDoc(uid: string): Promise<SyncData | undefined> {
  const snap = await getDb().collection('users').doc(uid).get()
  return snap.exists ? (snap.data() as SyncData) : undefined
}

export async function deleteUserDoc(uid: string): Promise<void> {
  await getDb().collection('users').doc(uid).delete()
}

export interface MockResult {
  statusCode: number
  body: unknown
  ended: boolean
}

/** Minimal VercelRequest/VercelResponse mocks — just enough for our handlers. */
export function mockReqRes(opts: {
  method?: string
  headers?: Record<string, string>
  body?: unknown
}): { req: VercelRequest; res: VercelResponse; result: MockResult } {
  const result: MockResult = { statusCode: 200, body: undefined, ended: false }
  const req = {
    method: opts.method ?? 'POST',
    headers: opts.headers ?? {},
    body: opts.body,
  } as unknown as VercelRequest

  const res = {
    status(code: number) {
      result.statusCode = code
      return res
    },
    json(payload: unknown) {
      result.body = payload
      return res
    },
    end() {
      result.ended = true
      return res
    },
  } as unknown as VercelResponse

  return { req, res, result }
}
