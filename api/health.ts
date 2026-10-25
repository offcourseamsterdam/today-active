import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    ok: true,
    hasOpenAiKey: !!process.env.OPENAI_API_KEY,
    hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
    hasAgentToken: !!process.env.AGENT_API_TOKEN,
    nodeVersion: process.version,
    timestamp: new Date().toISOString(),
  })
}
