import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import handler from '../../api/write-away'
import { seedUserDoc, readUserDoc, mockReqRes } from './helpers'

const UID = 'write-away-test-uid'
const SECRET = 'test-write-away-secret'

describe('api/write-away.ts (Firestore emulator)', () => {
  beforeAll(() => {
    process.env.WRITE_AWAY_SECRET = SECRET
    process.env.WRITE_AWAY_UID = UID
    delete process.env.AGENT_UID
  })

  beforeEach(async () => {
    await seedUserDoc(UID, {})
  })

  it('rejects a wrong secret', async () => {
    const { req, res, result } = mockReqRes({ body: { text: 'hello', secret: 'wrong' } })
    await handler(req, res)
    expect(result.statusCode).toBe(401)
  })

  it('saves a plain entry and bumps syncedAt', async () => {
    const before = await readUserDoc(UID)
    const { req, res, result } = mockReqRes({ body: { text: 'Buy milk', tag: 'personal', secret: SECRET } })
    await handler(req, res)
    expect(result.statusCode).toBe(200)
    const after = await readUserDoc(UID)
    expect(after!.writeAway).toHaveLength(1)
    expect(after!.writeAway[0].text).toBe('Buy milk')
    expect(after!.syncedAt).not.toBe(before!.syncedAt)
  })

  it('creates an orphan task for urgent-work entries', async () => {
    const { req, res, result } = mockReqRes({ body: { text: 'Fix prod', tag: 'urgent-work', secret: SECRET } })
    await handler(req, res)
    expect(result.statusCode).toBe(200)
    const after = await readUserDoc(UID)
    expect(after!.orphanTasks).toHaveLength(1)
    expect(after!.orphanTasks[0].title).toBe('Fix prod')
    expect(after!.writeAway[0].taskId).toBe(after!.orphanTasks[0].id)
  })

  it('returns 404 when the user document does not exist', async () => {
    const otherUid = 'no-such-write-away-uid'
    process.env.WRITE_AWAY_UID = otherUid
    const { req, res, result } = mockReqRes({ body: { text: 'x', secret: SECRET } })
    await handler(req, res)
    expect(result.statusCode).toBe(404)
    process.env.WRITE_AWAY_UID = UID
  })
})
