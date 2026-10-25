import type { VercelRequest, VercelResponse } from '@vercel/node'
import { v4 as uuid } from 'uuid'
import { getDb, hasAdminCredentials } from './_lib/firebaseAdmin.js'
import { stripUndefined } from './_lib/agentOps.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const secret = process.env.WRITE_AWAY_SECRET
  const uid = process.env.WRITE_AWAY_UID

  if (!secret || !uid) {
    res.status(503).json({ error: 'WRITE_AWAY_SECRET or WRITE_AWAY_UID not configured in Vercel env' })
    return
  }

  if (!hasAdminCredentials()) {
    res.status(503).json({ error: 'Firebase Admin credentials not configured' })
    return
  }

  const { text, tag, secret: requestSecret } = req.body as {
    text?: string
    tag?: string
    secret?: string
  }

  if (requestSecret !== secret) {
    res.status(401).json({ error: 'Invalid secret' })
    return
  }

  if (!text?.trim()) {
    res.status(400).json({ error: 'text is required' })
    return
  }

  const validTags = ['urgent-work', 'work', 'personal']
  const safeTag = validTags.includes(tag ?? '') ? tag! : 'work'

  try {
    const db = getDb()
    const docRef = db.collection('users').doc(uid)

    const { entryId, taskId } = await db.runTransaction(async tx => {
      const snap = await tx.get(docRef)
      if (!snap.exists) {
        throw new Error('NOT_FOUND')
      }

      const data = snap.data() as Record<string, unknown>
      const existing = (data.writeAway as unknown[]) ?? []

      const newEntryId = uuid()
      const entry = {
        id: newEntryId,
        text: text.trim(),
        tag: safeTag,
        createdAt: new Date().toISOString(),
      }

      const updates: Record<string, unknown> = {
        writeAway: [entry, ...existing],
        syncedAt: new Date().toISOString(),
      }

      // If urgent-work: also create an orphan task
      let newTaskId: string | undefined
      if (safeTag === 'urgent-work') {
        newTaskId = uuid()
        const task = {
          id: newTaskId,
          title: text.trim(),
          status: 'backlog',
          isRecurring: false,
          isUncomfortable: false,
          createdAt: new Date().toISOString(),
        }
        const orphanTasks = (data.orphanTasks as unknown[]) ?? []
        updates.orphanTasks = [task, ...orphanTasks]
        updates.writeAway = [{ ...entry, taskId: newTaskId }, ...existing]
      }

      tx.update(docRef, stripUndefined(updates))
      return { entryId: newEntryId, taskId: newTaskId }
    })

    res.status(200).json({ ok: true, entryId, taskId })
  } catch (err) {
    if (err instanceof Error && err.message === 'NOT_FOUND') {
      res.status(404).json({ error: 'User document not found' })
      return
    }
    console.error('[write-away]', err)
    res.status(500).json({ error: 'Failed to save entry' })
  }
}
