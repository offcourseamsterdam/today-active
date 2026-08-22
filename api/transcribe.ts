import type { VercelRequest, VercelResponse } from '@vercel/node'
// Stays on OpenAI (Whisper) — Anthropic has no audio transcription API.
import OpenAI, { toFile } from 'openai'

// Read raw body from request stream (Vercel doesn't auto-parse binary content types)
function readRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export const config = {
  api: { bodyParser: false },
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: 'OPENAI_API_KEY not configured' })
    return
  }

  try {
    const language = (req.query.language as string) || 'auto'

    // Read raw binary body — disable Vercel's body parser to get raw audio bytes
    const buffer = Buffer.isBuffer(req.body)
      ? req.body
      : await readRawBody(req)

    if (buffer.length === 0) {
      res.status(400).json({ error: 'Empty audio data' })
      return
    }

    const file = await toFile(buffer, 'audio.webm', { type: 'audio/webm' })

    const openai = new OpenAI({ apiKey })
    const transcription = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      prompt: 'Meeting recording.',
      ...(language !== 'auto' ? { language } : {}),
    })

    res.status(200).json({ text: transcription.text })
  } catch (err) {
    console.error('Transcription error:', err)
    const message = err instanceof Error ? err.message : 'Transcription failed'
    res.status(500).json({ error: message })
  }
}
