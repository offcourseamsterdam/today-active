import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    ok: true,
    hasOpenAiKey: !!process.env.OPENAI_API_KEY,
    keyPrefix: process.env.OPENAI_API_KEY?.slice(0, 7) ?? null,
    nodeVersion: process.version,
    timestamp: new Date().toISOString(),
  })
}
