import type { VercelRequest, VercelResponse } from '@vercel/node'
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { v4 as uuid } from 'uuid'

function getAdminApp() {
  if (getApps().length > 0) return getApps()[0]
  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

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

  if (!process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
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
    const app = getAdminApp()
    const db = getFirestore(app)
    const docRef = db.collection('users').doc(uid)
    const snap = await docRef.get()

    if (!snap.exists) {
      res.status(404).json({ error: 'User document not found' })
      return
    }

    const data = snap.data() as Record<string, unknown>
    const existing = (data.writeAway as unknown[]) ?? []

    const entryId = uuid()
    const entry = {
      id: entryId,
      text: text.trim(),
      tag: safeTag,
      createdAt: new Date().toISOString(),
    }

    const updates: Record<string, unknown> = {
      writeAway: [entry, ...existing],
    }

    // If urgent-work: also create an orphan task
    let taskId: string | undefined
    if (safeTag === 'urgent-work') {
      taskId = uuid()
      const task = {
        id: taskId,
        title: text.trim(),
        status: 'backlog',
        isRecurring: false,
        isUncomfortable: false,
        createdAt: new Date().toISOString(),
      }
      const orphanTasks = (data.orphanTasks as unknown[]) ?? []
      updates.orphanTasks = [task, ...orphanTasks]
      updates.writeAway = [{ ...entry, taskId }, ...existing]
    }

    await docRef.update(updates)

    res.status(200).json({ ok: true, entryId, taskId })
  } catch (err) {
    console.error('[write-away]', err)
    res.status(500).json({ error: 'Failed to save entry' })
  }
}
